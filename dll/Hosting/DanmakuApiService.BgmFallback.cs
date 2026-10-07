namespace DD.Danmaku.Hosting;

using System.Net.Http;
using System.Text.Json;

public sealed partial class DanmakuApiService
{
    // BGM 只用于检索作品；弹幕分集标识仍取自官方详情，不推测跨站编号。
    private static async Task<(List<OnlineEpisode> Works, Dictionary<string, byte[]> Details)> OnlineBgmSearchAsync(
        string title, Guid userId, PluginConfiguration config, CancellationToken token,
        Action<string, int?> progress)
    {
        progress("bgm_search", null);
        var body = JsonSerializer.SerializeToUtf8Bytes(new { keyword = title, filter = new { type = new[] { 2 } } });
        // 固定公开 API，不接受前端指定任意目标，也不向 BGM 发送 Emby 或中转凭据。
        var response = await DanmakuProxyTransport.SendAsync(new Uri("https://api.bgm.tv/v0/search/subjects"),
            HttpMethod.Post, new Dictionary<string, string>
            { ["User-Agent"] = "DD-Danmaku/1.3.6 (https://github.com/l429609201/dd-danmaku)" }, body, token);
        var subjects = OnlineBgmSubjectIds(response.Body);
        var works = new List<OnlineEpisode>();
        var details = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        ApiAccessException? lastError = null;
        var inspected = 0;
        foreach (var subjectId in subjects)
        {
            token.ThrowIfCancellationRequested();
            progress("bgm_detail", ++inspected);
            try
            {
                var bytes = await OnlineFetchAsync("official", config, userId, "/bangumi/bgmtv/" + subjectId, null, token);
                using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16 });
                var root = document.RootElement;
                if (root.TryGetProperty("bangumi", out var bangumi) && bangumi.ValueKind == JsonValueKind.Object) root = bangumi;
                var id = OnlineString(root, "animeId") ?? OnlineString(root, "bangumiId");
                if (id is null || !OnlineId(id)) continue;
                var work = new OnlineEpisode(id, OnlineString(root, "animeTitle"), null, null,
                    ImageUrl: OnlineString(root, "imageUrl"));
                if (OnlineParseEpisodes(bytes, work).Count == 0 || details.ContainsKey(id)) continue;
                works.Add(work);
                details.Add(id, bytes);
            }
            catch (ApiAccessException error)
            {
                lastError = error;
                // 详情也流控或鉴权拒绝时不继续打剩余作品，更不重试受限搜索。
                if (error.Code is "UPSTREAM_RATE_LIMITED" or "UPSTREAM_AUTH_REJECTED") break;
            }
        }
        if (works.Count == 0 && lastError is not null) throw lastError;
        return (works, details);
    }

    internal static IReadOnlyList<string> OnlineBgmSubjectIds(byte[] bytes)
    {
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16 });
        if (document.RootElement.ValueKind != JsonValueKind.Object
            || !document.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
            throw new ApiAccessException(502, "UPSTREAM_PROTOCOL_MISMATCH", "BGM 搜索响应无效");
        var ids = new List<string>();
        foreach (var subject in data.EnumerateArray())
        {
            if (subject.ValueKind != JsonValueKind.Object || !subject.TryGetProperty("id", out var id)
                || !long.TryParse(id.ToString(), out var number) || number <= 0) continue;
            var value = number.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (ids.Contains(value, StringComparer.Ordinal)) continue;
            ids.Add(value);
            if (ids.Count == 3) break;
        }
        return ids;
    }
}
