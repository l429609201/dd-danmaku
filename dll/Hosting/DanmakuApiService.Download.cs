namespace DD.Danmaku.Hosting;

using System.Security.Cryptography;
using System.Text.Json;
using DD.Danmaku.Danmaku;
using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Services;

/// <summary>下载后端已确认分集并按原媒体上下文保存。</summary>
[Route("/dd-danmaku/api/business/download", "POST")]
public sealed class BackendDownloadStartRequest : IRequiresRequestStream
{
    /// <summary>有界正文，不接收上游 URL、凭据或媒体路径。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
internal sealed record BackendDownloadStartInput(string ItemId, string SourceId, string EpisodeId,
    string SelectionTaskId, string SavePurpose = "none");

public sealed partial class DanmakuApiService
{
    internal void StartDownloadRecovery(Plugin plugin, EmbyHostServices host)
    {
        host.BackendTasks.RecoverOnce(async (saved, token) =>
        {
            try
            {
                var latest = await BackendDefaultsAsync(plugin, saved.Owner, token);
                var recoveredSource = DownloadSource(latest, plugin.Configuration, saved.Owner, saved.SourceId);
                StartBackendDownload(saved, recoveredSource, plugin, host, recovered: true);
            }
            catch (ApiAccessException) { /* 单条恢复记录失效时保留日志，不影响其它记录。 */ }
        });
    }

    /// <summary>校验本人分集任务证明并创建后台下载；仅明确手动选择可保存本人弹幕缓存。</summary>
    public Task<object> Post(BackendDownloadStartRequest request) => Execute(async (user, plugin, host) =>
    {
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 16 * 1024, "application/json");
        var input = ApiHttpResult.Parse<BackendDownloadStartInput>(body);
        var item = _access.RequireVideo(user, input.ItemId);
        var episode = ProxyIdentifier(input.EpisodeId);
        if (input.SavePurpose is not ("auto" or "selection" or "none")) throw new ArgumentException("下载保存用途无效");
        await host.BackendTasks.AuthorizeResultAsync(user.Id, input.SelectionTaskId, Request.CancellationToken);
        var proofTask = host.BackendTasks.Read(user.Id, input.SelectionTaskId);
        if (proofTask.ItemId != item || proofTask.Kind is not ("match" or "search") || proofTask.Status != "succeeded")
            throw new ApiAccessException(409, "EPISODE_NOT_CONFIRMED", "分集任务未完成或不属于原媒体");
        // 保存必须来自本人手动搜索/分集任务；自动匹配证明只能下载，不能伪装手动保存。
        if (input.SavePurpose == "selection" && proofTask.Kind != "search")
            throw new ApiAccessException(409, "MANUAL_SELECTION_REQUIRED", "保存需要手动搜索并明确选择分集");
        var proof = host.BackendTasks.Result(user.Id, input.SelectionTaskId);
        VerifyDownloadEpisode(proof.Body, item, input.SourceId, episode);
        var defaults = await BackendDefaultsAsync(plugin, user.Id, Request.CancellationToken);
        var source = DownloadSource(defaults, plugin.Configuration, user.Id, input.SourceId);
        var convert = defaults.ChConvert ?? 0;
        if (convert is < 0 or > 2) throw new ArgumentException("简繁配置无效");
        var revision = DownloadRevision(source, convert);
        var intent = input.SavePurpose == "selection"
            ? await host.Selections.ReserveIntentAsync(user.Id.ToString("N"), item, Request.CancellationToken) : null;
        var record = new BackendDownloadRecord("", user.Id, item, source.Id, episode, convert, input.SavePurpose,
            revision, DateTimeOffset.UtcNow, SelectionIntent: intent);
        return ApiHttpResult.Success(StartBackendDownload(record, source, plugin, host));
    });

    private BackendTaskView StartBackendDownload(BackendDownloadRecord record, BackendBusinessSource source,
        Plugin plugin, EmbyHostServices host, bool recovered = false)
    {
        var fingerprint = record.Revision + "/" + record.SourceId + "/" + record.EpisodeId + "/" + record.SavePurpose + "/" + record.SelectionIntent;
        async Task Authorize(CancellationToken token)
        {
            await DownloadAuthorizeAsync(record, plugin, token);
        }
        return host.BackendTasks.Start(record.Owner, record.ItemId, "download", fingerprint, async context =>
        {
            var current = await DownloadAuthorizeAsync(record, plugin, context.Token);
            var bytes = await BackendCommentDownload.RunAsync(context,
                source.Kind == "custom" && source.Configuration.DanmakuProxyServerType == "Misaka_Danmu_Server",
                record.ChConvert, record.EpisodeId,
                (path, token) => OnlineFetchAsync(source.Kind, source.Configuration, record.Owner, path, null, token), Authorize);
            await Authorize(context.Token);
            context.Progress("save");
            var canSaveSelection = true;
            if (recovered && record.SavePurpose == "selection")
                canSaveSelection = record.SelectionIntent is not null && await host.Selections.TryAdoptIntentAsync(
                    record.Owner.ToString("N"), record.ItemId, record.SelectionIntent, record.CreatedAt, context.Token);
            if (!canSaveSelection)
                return new BackendTaskReply(200, DownloadSaveSkipped(bytes, "SELECTION_CHANGED"));
            void VerifySource()
            {
                // 文件服务提交回调是同步的，必须在真正切换索引前读取最新本人配置。
                DownloadAuthorizeAsync(record, plugin, context.Token).GetAwaiter().GetResult();
            }
            var saved = await SaveProxyCommentsAsync(bytes, record.ItemId, source.XmlSource, record.EpisodeId,
                current, plugin, host, SelectionUpstreamRevision(source.XmlSource, source.Configuration), record.ChConvert,
                new(record.SavePurpose, context.Token, VerifySource, record.SelectionIntent));
            return new BackendTaskReply(200, saved);
        }, record, Authorize);
    }

    private static BackendBusinessSource DownloadSource(FrontendDefaults defaults, PluginConfiguration configuration,
        Guid owner, string sourceId)
    {
        if (sourceId == "official")
        {
            if (!(defaults.UseOfficialApi ?? true)) throw new ApiAccessException(409, "SOURCE_UNAVAILABLE", "官方来源已停用");
            return new("official", "弹弹play", "official", DanmakuXmlMetadata.OfficialSource, configuration.CopyForUpdate());
        }
        var registered = BackendSources(defaults, configuration, owner).SingleOrDefault(source => source.Id == sourceId)
            ?? throw new ApiAccessException(404, "SOURCE_NOT_FOUND", "来源不存在或不属于原用户");
        if (!registered.Enabled || registered.BaseUrl.Length == 0)
            throw new ApiAccessException(409, "SOURCE_UNAVAILABLE", "原来源已停用");
        var projected = registered.Configuration(configuration);
        return new(registered.Id, registered.Name, "custom", projected.DanmakuProxySourceId, projected);
    }
    private static string DownloadRevision(BackendBusinessSource source, int convert) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            source.Id, source.Kind, source.XmlSource, ChConvert = convert,
            Base = source.Kind == "custom" ? source.Configuration.DanmakuProxyBaseUrl : null,
            Type = source.Kind == "custom" ? source.Configuration.DanmakuProxyServerType : null,
            AppId = source.Kind == "custom" ? source.Configuration.DanmakuProxyAppId : null,
            Secret = source.Kind == "custom" ? source.Configuration.DanmakuProxyAppSecret : null,
            Private = source.Kind == "custom" && BackendSourceAuthorization.AllowPrivate(source.Configuration)
        }))).ToLowerInvariant();
    private async Task<User> DownloadAuthorizeAsync(BackendDownloadRecord record, Plugin plugin, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var current = _users.GetUserById(record.Owner);
        if (current is null || current.Policy is null || current.Policy.IsDisabled || current.IsLockedOut)
            throw new ApiAccessException(401, "AUTH_REQUIRED", "原下载用户已无法执行请求");
        _access.RequireVideo(current, record.ItemId);
        var latest = await BackendDefaultsAsync(plugin, record.Owner, token);
        var source = DownloadSource(latest, plugin.Configuration, record.Owner, record.SourceId);
        if (DownloadRevision(source, record.ChConvert) != record.Revision)
            throw new ApiAccessException(409, "UPSTREAM_CHANGED", "原下载来源配置已变更");
        return current;
    }
    private static void VerifyDownloadEpisode(byte[] bytes, string item, string source, string episode)
    {
        using var document = JsonDocument.Parse(bytes);
        var root = document.RootElement;
        if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object
            || OnlineString(data, "itemId") != item || OnlineString(data, "sourceId") != source)
            throw new ApiAccessException(409, "EPISODE_NOT_CONFIRMED", "原分集结果未绑定当前媒体与来源");
        bool Matches(JsonElement value) => value.ValueKind == JsonValueKind.Object
            && OnlineString(value, "episodeId") == episode;
        var valid = data.TryGetProperty("episodes", out var episodes) && episodes.ValueKind == JsonValueKind.Array
            && episodes.EnumerateArray().Count(Matches) == 1;
        if (data.TryGetProperty("match", out var match) && match.ValueKind == JsonValueKind.Object)
            valid |= match.TryGetProperty("selected", out var selected) && Matches(selected)
                || match.TryGetProperty("candidates", out var candidates) && candidates.ValueKind == JsonValueKind.Array
                && candidates.EnumerateArray().Count(Matches) == 1;
        if (!valid) throw new ApiAccessException(409, "EPISODE_NOT_CONFIRMED", "该分集未出现在原来源结果中");
    }
    private static byte[] DownloadSaveSkipped(byte[] body, string code)
    {
        using var document = JsonDocument.Parse(body);
        using var output = new MemoryStream();
        using (var writer = new Utf8JsonWriter(output))
        {
            writer.WriteStartObject();
            if (document.RootElement.ValueKind == JsonValueKind.Array)
            {
                writer.WritePropertyName("comments"); document.RootElement.WriteTo(writer);
            }
            else foreach (var property in document.RootElement.EnumerateObject())
                if (property.Name != "ddSave") property.WriteTo(writer);
            writer.WritePropertyName("ddSave"); JsonSerializer.Serialize(writer, new { status = "skipped", code });
            writer.WriteEndObject();
        }
        return output.ToArray();
    }
}
