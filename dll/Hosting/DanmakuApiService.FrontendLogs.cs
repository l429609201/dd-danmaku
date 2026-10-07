namespace DD.Danmaku.Hosting;

using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Services;

/// <summary>上传当前认证用户的前端日志。</summary>
[Route("/dd-danmaku/api/frontend-logs", "POST")]
public sealed class UploadFrontendLogsRequest : IRequiresRequestStream
{
    /// <summary>宿主提供的原始请求流。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

/// <summary>前端日志批次，不接受客户端指定用户身份。</summary>
public sealed class FrontendLogBatch
{
    /// <summary>前端会话标识，最长 128 字符。</summary>
    public string SessionId { get; set; } = "";
    /// <summary>每批一至一百条日志。</summary>
    public List<FrontendLogEntryInput> Entries { get; set; } = [];
}

/// <summary>仅接受明确的文本字段，不接受对象和响应体。</summary>
public sealed class FrontendLogEntryInput
{
    /// <summary>debug、info、warn 或 error。</summary>
    public string Level { get; set; } = "";
    /// <summary>最长 24000 字符的日志文本，允许展开 JSON。</summary>
    public string Message { get; set; } = "";
    /// <summary>前端事件时间。</summary>
    public DateTimeOffset? Timestamp { get; set; }
}

/// <summary>读取目标用户的固定日志槽位。</summary>
[Route("/dd-danmaku/api/frontend-logs/files", "GET")]
public sealed class FrontendLogFilesRequest
{
    /// <summary>默认当前用户，只有管理员可选择其他用户。</summary>
    public string? UserId { get; set; }
}

/// <summary>按条件查询目标用户的一个固定日志文件。</summary>
[Route("/dd-danmaku/api/frontend-logs", "GET")]
public sealed class QueryFrontendLogsRequest
{
    /// <summary>current 或 1 至 4。</summary>
    public string FileId { get; set; } = "current";
    /// <summary>默认当前用户，只有管理员可选择其他用户。</summary>
    public string? UserId { get; set; }
    /// <summary>可选日志等级。</summary>
    public string? Level { get; set; }
    /// <summary>最长 200 字符的文本关键词。</summary>
    public string? Keyword { get; set; }
    /// <summary>从一开始的页号。</summary>
    public int Page { get; set; } = 1;
    /// <summary>每页一至二百条，默认一百条。</summary>
    public int PageSize { get; set; } = 100;
}

/// <summary>以可读 UTF-8 文本导出目标用户的一个固定日志文件。</summary>
[Route("/dd-danmaku/api/frontend-logs/export", "GET")]
public sealed class ExportFrontendLogsRequest
{
    /// <summary>current 或 1 至 4。</summary>
    public string FileId { get; set; } = "current";
    /// <summary>默认当前用户，只有管理员可选择其他用户。</summary>
    public string? UserId { get; set; }
    /// <summary>可选日志等级。</summary>
    public string? Level { get; set; }
    /// <summary>逗号分隔的导出等级白名单；省略为全部，空字符串为不导出。</summary>
    public string? Levels { get; set; }
    /// <summary>最长 200 字符的文本关键词。</summary>
    public string? Keyword { get; set; }
}

/// <summary>清除目标用户在所有保留槽位中的日志。</summary>
[Route("/dd-danmaku/api/frontend-logs", "DELETE")]
public sealed class ClearFrontendLogsRequest
{
    /// <summary>默认当前用户，只有管理员可选择其他用户。</summary>
    public string? UserId { get; set; }
}

public sealed partial class DanmakuApiService
{
    /// <summary>认证用户只能上传自己的日志，身份由宿主确定。</summary>
    public Task<object> Post(UploadFrontendLogsRequest request) => Execute(async (user, plugin, host) =>
    {
        var store = RequireFrontendLogs(host);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 128 * 1024, "application/json");
        var batch = ApiHttpResult.Parse<FrontendLogBatch>(bytes);
        if (batch.SessionId?.Length > 128 || batch.Entries?.Any(entry => entry?.Message?.Length > FrontendLogStore.MaxMessageChars) == true)
            throw new ArgumentException("日志文本超过长度限制");
        // 当前请求携带的令牌也按精确值清理，避免无字段名的日志文本泄露凭据。
        foreach (var credential in new[] { Request.Headers["X-Emby-Token"], Request.Headers["X-MediaBrowser-Token"],
            Request.QueryString["api_key"] }.Where(value => !string.IsNullOrEmpty(value)).Distinct(StringComparer.Ordinal))
        {
            batch.SessionId = batch.SessionId?.Replace(credential!, "[已脱敏凭据]", StringComparison.Ordinal)!;
            if (batch.Entries is not null)
                foreach (var entry in batch.Entries)
                    if (entry?.Message is not null) entry.Message = entry.Message.Replace(credential!, "[已脱敏凭据]", StringComparison.Ordinal);
        }
        var accepted = await store.AppendAsync(user.Id.ToString("N"), batch, Request.CancellationToken);
        return ApiHttpResult.Success(new { Accepted = accepted });
    });

    /// <summary>文件大小和更新时间仅统计目标用户，不暴露其他用户活动。</summary>
    public Task<object> Get(FrontendLogFilesRequest request) => Execute(async (user, plugin, host) =>
    {
        var userId = FrontendLogUser(user, request.UserId);
        return ApiHttpResult.Success(new { Files = await RequireFrontendLogs(host).FilesAsync(userId, Request.CancellationToken),
            MaxFileBytes = FrontendLogStore.MaxFileBytes, MaxFiles = FrontendLogStore.MaxFiles });
    });

    /// <summary>用户仅可查询本人，管理员可明确指定其他用户，筛选后倒序分页。</summary>
    public Task<object> Get(QueryFrontendLogsRequest request) => Execute(async (user, plugin, host) =>
    {
        var userId = FrontendLogUser(user, request.UserId);
        if (request.Page < 1 || request.PageSize is < 1 or > 200) throw new ArgumentException("日志分页无效");
        var entries = await RequireFrontendLogs(host).ReadAsync(request.FileId, userId, request.Level, request.Keyword, Request.CancellationToken);
        var offset = Math.Min(((long)request.Page - 1) * request.PageSize, int.MaxValue);
        return ApiHttpResult.Success(new { Entries = entries.Skip((int)offset).Take(request.PageSize).ToArray(),
            Total = entries.Length, request.Page, request.PageSize });
    });

    /// <summary>导出目标用户的脱敏固定字段，不输出原始文件内容。</summary>
    public Task<object> Get(ExportFrontendLogsRequest request) => Execute(async (user, plugin, host) =>
    {
        var userId = FrontendLogUser(user, request.UserId);
        HashSet<string>? levels = null;
        if (request.Levels is not null)
        {
            // 导出独立等级集合，不改变查询接口的单等级筛选契约。
            var values = request.Levels.Length == 0 ? [] : request.Levels.Split(',');
            if (request.Levels.Length > 32 || values.Any(value => value is not ("debug" or "info" or "warn" or "error")))
                throw new ArgumentException("日志导出等级无效");
            levels = new HashSet<string>(values, StringComparer.Ordinal);
        }
        var entries = await RequireFrontendLogs(host).ReadAsync(request.FileId, userId, request.Level, request.Keyword, Request.CancellationToken);
        // 下载采用独立可读文本格式，内部结构化改写格式保持不变。
        return new ApiHttpResult(200, FrontendLogStore.ExportText(entries.Where(entry => levels is null || levels.Contains(entry.Level))), "text/plain; charset=utf-8");
    });

    /// <summary>清除目标用户全部保留日志，不触及其他用户数据。</summary>
    public Task<object> Delete(ClearFrontendLogsRequest request) => Execute(async (user, plugin, host) =>
    {
        var userId = FrontendLogUser(user, request.UserId);
        var removed = await RequireFrontendLogs(host).ClearAsync(userId, Request.CancellationToken);
        return ApiHttpResult.Success(new { Removed = removed });
    });

    // 即使管理员省略用户标识也仅返回本人，禁止空参数变成全用户查询。
    private static string FrontendLogUser(User user, string? requested)
    {
        if (string.IsNullOrWhiteSpace(requested)) return user.Id.ToString("N");
        if (requested.Length > 36 || !Guid.TryParse(requested, out var id) || id == Guid.Empty)
            throw new ArgumentException("用户标识无效");
        if (id != user.Id) EmbyAccessControl.RequireAdministrator(user);
        return id.ToString("N");
    }
    private static FrontendLogStore RequireFrontendLogs(EmbyHostServices host)
        => host.FrontendLogs is { Ready: true } store ? store
            : throw new ApiAccessException(503, "FRONTEND_LOGS_UNAVAILABLE", "前端日志存储尚未就绪");
}
