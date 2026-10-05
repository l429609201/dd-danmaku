namespace DD.Danmaku.Hosting;

using System.Globalization;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using DD.Danmaku.Danmaku;

public sealed partial class DanmakuApiService
{
    // 来源与配置指纹共同绑定；禁止配置切换后用旧集 ID 请求新上游。
    private static string SelectionUpstreamRevision(string source, PluginConfiguration config)
    {
        object identity = source == DanmakuXmlMetadata.OfficialSource
            ? new { Official = OfficialSettings.Value }
            : new { config.DanmakuProxyBaseUrl, config.DanmakuProxySourceId,
                config.DanmakuProxyServerType, config.DanmakuProxyAppId, config.DanmakuProxyAppSecret };
        return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(identity)));
    }

    private async Task<IReadOnlyList<DanmakuComment>> FetchSelectionCommentsAsync(
        SelectionContentIdentity identity, Guid userId, PluginConfiguration config, CancellationToken token)
    {
        if (identity.UpstreamRevision != SelectionUpstreamRevision(identity.SourceId, config))
            throw new ApiAccessException(409, "UPSTREAM_CHANGED", "弹幕上游配置已变化，请重新选择");
        var episode = ProxyIdentifier(identity.SourceEpisodeId);
        if (identity.ChConvert is < 0 or > 2) throw new ArgumentException("简繁参数无效");
        var suffix = "/comment/" + episode + "?withRelated=true&chConvert="
            + identity.ChConvert.ToString(CultureInfo.InvariantCulture);
        DanmakuProxyTransport.Reply reply;
        if (identity.SourceId == DanmakuXmlMetadata.OfficialSource)
        {
            var settings = OfficialSettings.Value;
            var signer = new OfficialRequestSigner(settings.Secret, settings.BrandMark, settings.ObfuscationKey);
            if (!signer.IsConfigured || string.IsNullOrEmpty(settings.RelayPrefix) || string.IsNullOrEmpty(settings.UserAgent))
                throw new ApiAccessException(503, "OFFICIAL_PROXY_UNAVAILABLE", "此 DLL 构建未配置官方中转签名");
            var path = "/api/v2/comment/" + episode;
            var headers = new Dictionary<string, string>(signer.CreateHeaders(userId, path))
            { ["X-User-Agent"] = settings.UserAgent };
            reply = await DanmakuProxyTransport.SendAsync(new Uri(settings.RelayPrefix
                + "https://api.dandanplay.net/api/v2" + suffix), HttpMethod.Get, headers, null, token);
        }
        else
        {
            if (identity.SourceId != config.DanmakuProxySourceId)
                throw new ApiAccessException(409, "SOURCE_UNAVAILABLE", "所选弹幕来源当前不可用");
            reply = await SendCustomProxy(config, suffix, token);
        }
        if (reply.StatusCode is < 200 or >= 300) throw new IOException("弹幕上游请求失败");
        return ParseSelectionComments(reply.Body);
    }

    private static IReadOnlyList<DanmakuComment> ParseSelectionComments(byte[] bytes)
    {
        using var document = JsonDocument.Parse(bytes);
        var root = document.RootElement;
        if (root.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array)
            || root.ValueKind == JsonValueKind.Object
                && (root.TryGetProperty("success", out var success) && success.ValueKind == JsonValueKind.False
                    || root.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.String
                        && status.GetString() == "pending"))
            throw new InvalidDataException("上游未成功返回弹幕");
        // 与浏览器按相同优先级兼容四种正文包装，字段类型和 XML 验证仍严格检查。
        var array = root;
        if (root.ValueKind == JsonValueKind.Object)
        {
            if (root.TryGetProperty("comments", out var direct)) array = direct;
            else if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object
                && data.TryGetProperty("comments", out var nested)) array = nested;
            else if (root.TryGetProperty("result", out var result)) array = result;
        }
        if (array.ValueKind != JsonValueKind.Array || array.GetArrayLength() > DanmakuXml.MaxComments)
            throw new InvalidDataException("弹幕正文缺失或超过限制");
        var comments = new List<DanmakuComment>();
        foreach (var entry in array.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object
                || !entry.TryGetProperty("p", out var p) || p.ValueKind != JsonValueKind.String
                || !entry.TryGetProperty("m", out var m) || m.ValueKind != JsonValueKind.String)
                throw new InvalidDataException("上游弹幕字段无效");
            var fields = p.GetString()!.Split(',');
            if (fields.Length < 3) throw new InvalidDataException("上游弹幕字段无效");
            string? commentId = null;
            if (entry.TryGetProperty("cid", out var cid) && cid.ValueKind != JsonValueKind.Null)
            {
                if (cid.ValueKind is not (JsonValueKind.String or JsonValueKind.Number))
                    throw new InvalidDataException("上游弹幕标识无效");
                commentId = cid.ToString();
            }
            var comment = new DanmakuComment(m.GetString()!,
                double.Parse(fields[0], CultureInfo.InvariantCulture), int.Parse(fields[1], CultureInfo.InvariantCulture),
                int.Parse(fields[2], CultureInfo.InvariantCulture), fields.Length > 3 ? fields[3] : null,
                Cid: commentId);
            DanmakuXml.Validate(comment);
            comments.Add(comment);
        }
        return comments;
    }
}
