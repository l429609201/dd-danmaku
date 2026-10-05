namespace DD.Danmaku.Hosting;

using System.Globalization;
using System.Text.Json;
using DD.Danmaku.Danmaku;
using MediaBrowser.Controller.Entities;

public sealed partial class DanmakuApiService
{
    // 中转已取得正文时直接写文件，不要求浏览器再次上传；失败状态附加在 JSON 中。
    private async Task<byte[]> SaveProxyCommentsAsync(byte[] body, string? itemId, string source,
        string episodeId, User user, Plugin plugin, EmbyHostServices host, string upstreamRevision, int chConvert)
    {
        JsonDocument document;
        try { document = JsonDocument.Parse(body); }
        catch (JsonException) { return body; }
        using var responseDocument = document;
        if (document.RootElement.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array)) return body;
        var root = document.RootElement;
        var status = "skipped";
        var code = "NO_MEDIA_CONTEXT";
        try
        {
            if (!string.IsNullOrWhiteSpace(itemId))
            {
                var id = _access.RequireVideo(user, itemId);
                var purpose = Request.QueryString["SavePurpose"] ?? "auto";
                if (purpose is not ("auto" or "selection" or "none")) throw new ArgumentException("保存用途无效");
                var operation = purpose == "selection" ? DanmakuWritePolicy.Operation.Selection
                    : DanmakuWritePolicy.Operation.CreateShared;
                void Authorize()
                {
                    var current = _access.Authenticate(Request);
                    if (current.Id != user.Id) throw new ApiAccessException(403, "USER_CHANGED", "用户身份已变化");
                    _access.RequireVideo(current, id);
                    var currentConfiguration = plugin.Configuration;
                    // 与播放策略使用同一阻断顺序，提交前仍重新认证并核验媒体权限。
                    if (purpose == "auto" && DanmakuWritePolicy.AutoSaveBlockReason(current, currentConfiguration) is { } blocked)
                        throw new ApiAccessException(403, blocked, "当前自动保存策略不允许写入");
                    DanmakuWritePolicy.Require(current, currentConfiguration, operation);
                    if (upstreamRevision != SelectionUpstreamRevision(source, currentConfiguration))
                        throw new ApiAccessException(409, "UPSTREAM_CHANGED", "弹幕上游配置已变化");
                }
                var configuration = plugin.Configuration;
                var autoSaveBlockReason = purpose == "auto"
                    ? DanmakuWritePolicy.AutoSaveBlockReason(user, configuration) : null;
                if (string.IsNullOrWhiteSpace(source)) code = "SOURCE_NOT_CONFIGURED";
                else if (purpose == "none") code = "SAVE_NOT_REQUESTED";
                // 自动保存与播放策略共用阻断码；本人选择保留原有文件开关与操作边界。
                else if (autoSaveBlockReason is not null) code = autoSaveBlockReason;
                else if (!configuration.FilePersistenceEnabled) code = "FILE_PERSISTENCE_DISABLED";
                else if (!configuration.FilePersistenceWriteEnabled) code = "XML_WRITE_DISABLED";
                else if (!DanmakuWritePolicy.Can(user, configuration, operation)) code = "WRITE_NOT_AUTHORIZED";
                else if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("status", out var pending)
                    && pending.ValueKind == JsonValueKind.String && pending.GetString() == "pending") code = "PENDING_COMMENTS";
                else
                {
                    var comments = ParseSelectionComments(body);
                    Authorize();
                    if (purpose == "selection")
                    {
                        // 明确重搜只改变本人选择，不能顺带创建共享文件。
                        await host.Selections.SaveAsync(user.Id.ToString("N"),
                            new(id, source, episodeId, chConvert, upstreamRevision), comments,
                            Authorize, Request.CancellationToken);
                        status = "saved";
                        code = "SELECTION_SAVED";
                    }
                    else if (comments.Count == 0) code = "EMPTY_COMMENTS";
                    else
                    {
                        // 自动保存只创建；刷新和替换必须走独立授权流程。
                        await host.Playback.SaveAsync(id, comments, Request.CancellationToken, false, source,
                            new DanmakuXmlMetadata { SourceEpisodeId = episodeId,
                                UpdatedByUserId = user.Id.ToString("N"), WriteMethod = "auto",
                                FetchedAt = DateTimeOffset.UtcNow, UpstreamRevision = upstreamRevision,
                                ChConvert = chConvert }, Authorize);
                        status = "saved";
                        code = "SAVED";
                    }
                }
            }
        }
        catch (OperationCanceledException) { throw; }
        catch (ApiAccessException error) { status = error.Code == "XML_EXISTS" ? "skipped" : "failed"; code = error.Code; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException
            or InvalidDataException or FormatException or OverflowException or ArgumentException
            or InvalidOperationException or KeyNotFoundException or System.Xml.XmlException)
        { status = "failed"; code = "AUTO_SAVE_FAILED"; }
        // 保存失败仍返回上游正文，禁止浏览器重复上传绕过授权。
        using var output = new MemoryStream();
        using (var writer = new Utf8JsonWriter(output))
        {
            writer.WriteStartObject();
            // 数组正文规范化后才能附加安全保存状态；对象只替换本插件的 ddSave 字段。
            if (root.ValueKind == JsonValueKind.Array)
            {
                writer.WritePropertyName("comments");
                root.WriteTo(writer);
            }
            else
                foreach (var property in root.EnumerateObject())
                    if (property.Name != "ddSave") property.WriteTo(writer);
            writer.WritePropertyName("ddSave");
            JsonSerializer.Serialize(writer, new { status, code });
            writer.WriteEndObject();
        }
        return output.ToArray();
    }

    // 从官方白名单查询串提取转换参数，拒绝重复值，不能用前端另传值冒充。
    private static int OfficialChConvert(Uri upstream)
    {
        var values = upstream.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Split('=', 2)).Where(x => Uri.UnescapeDataString(x[0]) == "chConvert").ToArray();
        if (values.Length == 0) return 0;
        if (values.Length != 1 || values[0].Length != 2
            || !int.TryParse(Uri.UnescapeDataString(values[0][1]), NumberStyles.None,
                CultureInfo.InvariantCulture, out var value) || value is < 0 or > 2)
            throw new ArgumentException("简繁参数无效");
        return value;
    }
}
