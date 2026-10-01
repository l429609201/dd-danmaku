namespace DD.Danmaku.Hosting;

public sealed partial class DanmakuApiService
{
    private async Task<ApiHttpResult> TraceProxyAsync(Guid userId, Func<Task<ApiHttpResult>> action)
    {
        var operationId = Request.QueryString["OperationId"];
        if (string.IsNullOrEmpty(operationId)) return await action();
        if (!OperationEventHub.IsOwned(userId, operationId))
            throw new ApiAccessException(404, "OPERATION_NOT_FOUND", "操作不存在或不可访问");
        OperationEventHub.Publish(userId, operationId, "upstream");
        var status = "failed";
        try
        {
            var result = await action();
            status = result is ApiHttpResult http && http.StatusCode >= 400 ? "failed" : "succeeded";
            return result;
        }
        catch (OperationCanceledException) when (Request.CancellationToken.IsCancellationRequested)
        {
            status = "cancelled";
            throw;
        }
        finally
        {
            OperationEventHub.Complete(userId, operationId, status,
                status == "failed" ? "UPSTREAM_ERROR" : null);
        }
    }

    private void ProxyProgress(Guid userId, string stage)
    {
        var operationId = Request.QueryString["OperationId"];
        if (!string.IsNullOrEmpty(operationId)) OperationEventHub.Publish(userId, operationId, stage);
    }
}
