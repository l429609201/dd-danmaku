namespace DD.Danmaku.Hosting;

using System.Text;
using MediaBrowser.Model.Services;

/// <summary>Create a short-lived progress channel for the current Emby user.</summary>
[Route("/dd-danmaku/api/operations/start", "POST")]
public sealed class StartOperationRequest { }

/// <summary>Subscribe to sanitized progress for a channel owned by the current user.</summary>
[Route("/dd-danmaku/api/operations/{OperationId}/events", "GET")]
public sealed class OperationEventsRequest
{
    /// <summary>Canonical server-issued operation identifier.</summary>
    public string OperationId { get; set; } = "";
}

public sealed partial class DanmakuApiService
{
    /// <summary>Create an authenticated, owner-scoped operation channel.</summary>
    public Task<object> Post(StartOperationRequest request) => Execute((user, plugin, host) =>
        Task.FromResult(ApiHttpResult.Success(new { OperationId = OperationEventHub.Start(user.Id) })));

    /// <summary>Subscribe to sanitized progress events for an operation owned by this user.</summary>
    public object Get(OperationEventsRequest request)
    {
        try
        {
            var user = _access.Authenticate(Request);
            // Only canonical nonempty IDs are accepted; response is identical for unknown and foreign IDs.
            if (request.OperationId.Length != 32 || !Guid.TryParseExact(request.OperationId, "N", out var id)
                || id == Guid.Empty || id.ToString("N") != request.OperationId)
                throw new ApiAccessException(404, "OPERATION_NOT_FOUND", "操作不存在或不可访问");
            var subscription = OperationEventHub.Subscribe(user.Id, request.OperationId);
            return new OperationEventStream(subscription);
        }
        catch (ApiAccessException e) { return ApiHttpResult.Error(e.Status, e.Code, e.Message); }
        catch (Exception) { return ApiHttpResult.Error(500, "INTERNAL_ERROR", "插件处理请求失败"); }
    }
}

/// <summary>Emby calls this writer after route execution; its lifetime owns the subscription.</summary>
internal sealed class OperationEventStream(OperationEventHub.Subscription subscription) : IAsyncStreamWriter
{
    public async Task WriteToAsync(IResponse response, CancellationToken cancellationToken)
    {
        using (subscription)
        {
            response.StatusCode = 200;
            response.ContentType = "text/event-stream; charset=utf-8";
            response.AddHeader("Cache-Control", "no-store, no-transform");
            response.AddHeader("X-Content-Type-Options", "nosniff");
            response.AddHeader("X-Accel-Buffering", "no");
            var reader = subscription.Reader;
            try
            {
                // Flush immediately: the host can impose a short request timeout, so clients may reconnect
                // and recover the bounded replay without missing an event at subscription time.
                await WriteAsync(response, ": connected\n\n", cancellationToken);
                var pending = reader.WaitToReadAsync(cancellationToken).AsTask();
                while (true)
                {
                    var completed = await Task.WhenAny(pending, Task.Delay(TimeSpan.FromSeconds(5), cancellationToken));
                    cancellationToken.ThrowIfCancellationRequested();
                    if (completed != pending)
                    {
                        await WriteAsync(response, ": keepalive\n\n", cancellationToken);
                        continue;
                    }
                    if (!await pending) break;
                    while (reader.TryRead(out var item)) await WriteAsync(response, item, cancellationToken);
                    pending = reader.WaitToReadAsync(cancellationToken).AsTask();
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
            catch (IOException) when (cancellationToken.IsCancellationRequested) { }
        }
    }

    private static async Task WriteAsync(IResponse response, string text, CancellationToken token)
    {
        await response.OutputWriter.WriteAsync(Encoding.UTF8.GetBytes(text), token);
        await response.OutputWriter.FlushAsync(token);
    }
}
