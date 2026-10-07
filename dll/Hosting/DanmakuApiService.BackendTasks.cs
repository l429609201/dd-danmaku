namespace DD.Danmaku.Hosting;

using MediaBrowser.Model.Services;

/// <summary>查询本人后端任务，不暴露其它用户任务。</summary>
[Route("/dd-danmaku/api/business/tasks", "GET")]
public sealed class BackendTaskListRequest { }
/// <summary>查询本人具体任务的状态。</summary>
[Route("/dd-danmaku/api/business/tasks/{TaskId}", "GET")]
public sealed class BackendTaskStatusRequest
{
    /// <summary>后端生成的任务标识。</summary>
    public string TaskId { get; set; } = "";
}
/// <summary>读取本人任务结果，保留经过传输层验证的原始上游 JSON。</summary>
[Route("/dd-danmaku/api/business/tasks/{TaskId}/result", "GET")]
public sealed class BackendTaskResultRequest
{
    /// <summary>后端生成的任务标识。</summary>
    public string TaskId { get; set; } = "";
}
/// <summary>主动取消任务，或通知播放页已经结束。</summary>
[Route("/dd-danmaku/api/business/tasks/{TaskId}/cancel", "POST")]
public sealed class BackendTaskCancelRequest : IRequiresRequestStream
{
    /// <summary>后端生成的任务标识。</summary>
    public string TaskId { get; set; } = "";
    /// <summary>受限 JSON 请求正文。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
internal sealed record BackendTaskCancelInput(bool PlaybackEnded = false);

public sealed partial class DanmakuApiService
{
    /// <summary>列出本人仍有权限查看的媒体任务。</summary>
    public Task<object> Get(BackendTaskListRequest request) => Execute((user, plugin, host) =>
    {
        var visible = new List<BackendTaskView>();
        foreach (var task in host.BackendTasks.List(user.Id))
        {
            try { _access.RequireVideo(user, task.ItemId); visible.Add(task); }
            catch (ApiAccessException error) when (error.Status == 404) { }
        }
        return Task.FromResult<ApiHttpResult>(ApiHttpResult.Success(new { Tasks = visible }));
    });

    /// <summary>认证本人并重新检查原任务媒体权限后返回状态。</summary>
    public Task<object> Get(BackendTaskStatusRequest request) => Execute((user, plugin, host) =>
    {
        var task = host.BackendTasks.Read(user.Id, request.TaskId);
        _access.RequireVideo(user, task.ItemId);
        return Task.FromResult<ApiHttpResult>(ApiHttpResult.Success(task));
    });

    /// <summary>认证本人并重新检查媒体权限后返回原始任务结果。</summary>
    public Task<object> Get(BackendTaskResultRequest request) => Execute(async (user, plugin, host) =>
    {
        var task = host.BackendTasks.Read(user.Id, request.TaskId);
        _access.RequireVideo(user, task.ItemId);
        await host.BackendTasks.AuthorizeResultAsync(user.Id, request.TaskId, Request.CancellationToken);
        var reply = host.BackendTasks.Result(user.Id, request.TaskId);
        return new ApiHttpResult(reply.StatusCode, reply.Body, "application/json; charset=utf-8");
    });

    /// <summary>切集取消搜索工作；已确定分集的下载和收藏保持原上下文完成。</summary>
    public Task<object> Post(BackendTaskCancelRequest request) => Execute(async (user, plugin, host) =>
    {
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 4096, "application/json");
        var input = ApiHttpResult.Parse<BackendTaskCancelInput>(body);
        var task = host.BackendTasks.Read(user.Id, request.TaskId);
        _access.RequireVideo(user, task.ItemId);
        host.BackendTasks.Cancel(user.Id, request.TaskId, input.PlaybackEnded);
        return ApiHttpResult.Success(host.BackendTasks.Read(user.Id, request.TaskId));
    });
}
