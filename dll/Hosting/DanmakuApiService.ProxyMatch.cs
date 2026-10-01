namespace DD.Danmaku.Hosting;

using System.Text.Json;
using MediaBrowser.Model.Services;

/// <summary>自定义上游匹配入口；只接受 JSON 正文，不接受任意转发地址。</summary>
[Route("/dd-danmaku/api/proxy/custom/match", "POST")]
public sealed class CustomProxyMatchRequest : IRequiresRequestStream
{
    /// <summary>受限匹配正文。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

public sealed partial class DanmakuApiService
{
    /// <summary>由 DLL 为自定义上游签名并转发匹配请求。</summary>
    public Task<object> Post(CustomProxyMatchRequest request) => Execute((user, plugin, host) =>
        TraceProxyAsync(user.Id, async () =>
    {
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 256 * 1024, "application/json");
        // 在发送上游前拒绝非对象 JSON，避免把任意内容作为匹配请求转发。
        using var document = JsonDocument.Parse(body, new JsonDocumentOptions { MaxDepth = 16 });
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new ArgumentException("匹配请求必须是 JSON 对象");
        var reply = await SendCustomProxy(plugin.Configuration, "/match", Request.CancellationToken, body);
        return new ApiHttpResult(reply.StatusCode, reply.Body, "application/json; charset=utf-8");
    }));
}
