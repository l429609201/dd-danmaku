namespace DD.Danmaku.Hosting;

using System.Globalization;
using DD.Danmaku.Danmaku;
using MediaBrowser.Model.Services;

/// <summary>沿用参考插件的四个读取路径；只注册 GET，不开放搜索、刷新或下载落盘。</summary>
[Route("/plugin/danmu/{Id}", "GET")]
[Route("/api/danmu/{Id}", "GET")]
[Route("/plugin/danmu/raw/{Id}", "GET")]
[Route("/api/danmu/{Id}/raw", "GET")]
public sealed class CompatibleDanmuRequest
{
    /// <summary>当前用户有权访问的媒体标识。</summary>
    public string Id { get; set; } = "";
    /// <summary>读取 XML、JSON 或来源清单的操作类型。</summary>
    public string Option { get; set; } = "DownloadXml";
    /// <summary>需要读取的来源名称列表。</summary>
    public List<string> NeedSites { get; set; } = [];
    /// <summary>单来源或聚合读取模式。</summary>
    public string Mode { get; set; } = "single";
    /// <summary>可选的单个弹幕来源名称。</summary>
    public string? Source { get; set; }
}

public sealed partial class DanmakuApiService
{
    /// <summary>只读兼容接口，按来源返回 XML、JSON 或来源清单。</summary>
    public Task<object> Get(CompatibleDanmuRequest request) => Execute(async (user, plugin, host) =>
    {
        var id = _access.RequireVideo(user, request.Id);
        if (request.Option is not ("DownloadXml" or "GetJsonById" or "select"))
            throw new ApiAccessException(400, "READ_ONLY_OPERATION", "仅支持弹幕读取和 select 查询");
        if (request.Mode is not ("single" or "aggregate")) throw new ArgumentException("获取模式无效");
        if (request.NeedSites is { Count: > 32 }) throw new ArgumentException("来源数量超过限制");
        if (request.Source is not null && request.NeedSites is { Count: > 0 })
            throw new ArgumentException("Source 与 NeedSites 不能同时使用");
        var explicitSources = request.Source is not null || request.NeedSites is { Count: > 0 };
        // 默认单来源播放才应用本人选择；来源列表和显式聚合仍保持共享查询语义。
        Web.Api.PlaybackQueryDto? preferred = null;
        if (!explicitSources && request.Mode == "single" && request.Option != "select"
            && plugin.Configuration.FilePersistenceEnabled && plugin.Configuration.FilePersistenceReadEnabled
            && await host.Selections.FindAsync(user.Id.ToString("N"), id, Request.CancellationToken) is not null)
            preferred = await QueryUserPlaybackAsync(id, null, user, plugin, host);
        var sources = preferred?.StorageLocation == "temporary" ? new[] { preferred.Source ?? "" }
            : request.Source is not null ? new[] { request.Source.Trim() }
            : request.NeedSites is { Count: > 0 } ? request.NeedSites.Select(s => s?.Trim() ?? "").Distinct(StringComparer.Ordinal).ToArray()
            : (await host.Playback.GetSourcesAsync(id, Request.CancellationToken)).Append("").ToArray();
        if (sources.Any(s => s.Length > 64 || s.Any(c => char.IsControl(c) || "<>:\"/\\|?*".Contains(c))))
            throw new ArgumentException("弹幕来源名称无效");
        var groups = new List<object>();
        var available = new List<object>();
        var merged = new List<DanmakuComment>();
        var total = 0;
        // 不带 mode/source 时，XML 和 JSON 均只返回第一个可读取文件；select 始终枚举。
        foreach (var source in sources)
        {
            Web.Api.PlaybackQueryDto playback;
            try { playback = preferred?.StorageLocation == "temporary" ? preferred
                : request.Option == "select" ? await host.Playback.QueryAsync(id, Request.CancellationToken, source)
                : await QuerySharedPlaybackAsync(id, source, user, plugin, host); }
            catch (Exception error) when (!explicitSources && request.Mode == "single"
                && request.Option != "select" && error is IOException or UnauthorizedAccessException)
            {
                // 默认模式允许跳过损坏或不可读旁车，但不记录服务器路径。
                _matchLogger.Warn("弹幕读取：跳过不可读取的旁车文件");
                continue;
            }
            if (!playback.Found)
            {
                if (explicitSources) throw new ApiAccessException(404, "DANMAKU_NOT_FOUND", "指定来源弹幕不存在");
                continue;
            }
            available.Add(new { source, name = source.Length == 0 ? "未标注来源" : source });
            if (request.Option == "select") continue;
            total += playback.Comments.Count;
            if (total > DanmakuXml.MaxComments)
                throw new ApiAccessException(413, "COMMENT_LIMIT", "弹幕超过单次读取上限");
            if (request.Option == "DownloadXml")
            {
                // 播放查询返回 API DTO；写 XML 前转换回内部弹幕模型，保持存储层与接口层解耦。
                merged.AddRange(playback.Comments.Select(c => new DanmakuComment(
                    c.Text, c.Time, c.Mode, c.Color, c.UserId,
                    c.FontSize, c.Timestamp, c.Pool, c.Cid, c.Weight)));
            }
            else groups.Add(new
            {
                source, sourceName = source.Length == 0 ? "未标注来源" : source, opened = true,
                // 输出 Bilibili 九段 p 属性，并保留解析器已保存的来源字段。
                danmuEvents = playback.Comments.Select(c => new
                {
                    m = c.Text,
                    p = string.Join(",", c.Time.ToString("R", CultureInfo.InvariantCulture), c.Mode.ToString(CultureInfo.InvariantCulture),
                        c.FontSize.ToString(CultureInfo.InvariantCulture), c.Color.ToString(CultureInfo.InvariantCulture),
                        c.Timestamp.ToString(CultureInfo.InvariantCulture), c.Pool.ToString(CultureInfo.InvariantCulture),
                        c.UserId ?? "", c.Cid ?? "0", c.Weight.ToString(CultureInfo.InvariantCulture))
                }).ToArray()
            });
            if (request.Mode == "single") break;
        }
        if (request.Option == "select") return ApiHttpResult.Json(new { sources = available });
        if (available.Count == 0) throw new ApiAccessException(404, "DANMAKU_NOT_FOUND", "没有可读取的本地弹幕文件");
        if (request.Option == "DownloadXml")
        {
            // 聚合仅排序，不擅自删除重复发言或更改来源时间轴。
            using var stream = new MemoryStream();
            await DanmakuXml.WriteAsync(stream, merged.OrderBy(c => c.Time).ToArray(), Request.CancellationToken);
            return new ApiHttpResult(200, stream.ToArray(), "application/xml; charset=utf-8");
        }
        var result = ApiHttpResult.Json(new { hasNext = false, data = groups, extra = (string?)null });
        return result;
    });
}
