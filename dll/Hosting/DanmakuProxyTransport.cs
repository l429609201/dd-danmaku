namespace DD.Danmaku.Hosting;

using System.Net;
using System.Net.Http;
using System.Text.Json;

/// <summary>插件代理的受限传输层；目标地址仅由后端配置与路由白名单生成。</summary>
internal static class DanmakuProxyTransport
{
    // 不跟随重定向，防止上游把认证头带往其他服务；不共享 Cookie。
    private static readonly HttpClient Client = new(new HttpClientHandler
    {
        AllowAutoRedirect = false, UseCookies = false,
        AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
    }) { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly SemaphoreSlim Slots = new(8, 8);
    internal sealed record Reply(byte[] Body, int StatusCode);

    internal static async Task<Reply> SendAsync(Uri target, HttpMethod method,
        IReadOnlyDictionary<string, string> headers, byte[]? body, CancellationToken token)
    {
        if (!target.IsAbsoluteUri || target.Scheme is not ("http" or "https")
            || !string.IsNullOrEmpty(target.UserInfo) || !string.IsNullOrEmpty(target.Fragment))
            throw new ArgumentException("代理上游地址无效");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(100));
        var entered = false;
        try
        {
            await Slots.WaitAsync(timeout.Token);
            entered = true;
            using var request = new HttpRequestMessage(method, target);
            request.Headers.Accept.ParseAdd("application/json");
            foreach (var header in headers)
            {
                // 只允许服务端生成的上游协议头，禁止传递 Emby 会话或浏览器 Cookie。
                if (header.Key is not ("X-Ddd-User" or "X-Ddd-Ts" or "X-Ddd-Sign"
                    or "X-AppId" or "X-Signature" or "X-Timestamp" or "X-User-Agent"))
                    throw new ArgumentException("代理请求头不在白名单内");
                request.Headers.Add(header.Key, header.Value);
            }
            if (body is not null)
            {
                if (body.Length > 256 * 1024) throw new InvalidDataException("代理请求体过大");
                request.Content = new ByteArrayContent(body);
                request.Content.Headers.ContentType = new("application/json");
            }
            using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode)
                throw new ApiAccessException(502, "UPSTREAM_REJECTED", $"弹幕上游请求失败（HTTP {(int)response.StatusCode}）");
            const int limit = 64 * 1024 * 1024;
            if (response.Content.Headers.ContentLength > limit) throw new InvalidDataException("代理响应过大");
            await using var input = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var output = new MemoryStream();
            var buffer = new byte[81920];
            int read;
            while ((read = await input.ReadAsync(buffer.AsMemory(), timeout.Token)) > 0)
            {
                if (output.Length + read > limit) throw new InvalidDataException("代理响应过大");
                output.Write(buffer, 0, read);
            }
            var bytes = output.ToArray();
            // HTML 登录页与空响应不能作为可用 API；保留 JSON 字段大小写供原协议消费。
            using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 64 });
            if (json.RootElement.ValueKind != JsonValueKind.Object)
                throw new ApiAccessException(502, "UPSTREAM_INVALID_RESPONSE", "弹幕上游返回的 JSON 结构无效");
            return new Reply(bytes, (int)response.StatusCode);
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        { throw new ApiAccessException(504, "UPSTREAM_TIMEOUT", "弹幕上游请求超时"); }
        catch (HttpRequestException)
        { throw new ApiAccessException(502, "UPSTREAM_UNAVAILABLE", "无法连接弹幕上游"); }
        catch (JsonException)
        { throw new ApiAccessException(502, "UPSTREAM_INVALID_RESPONSE", "弹幕上游未返回有效 JSON"); }
        finally { if (entered) Slots.Release(); }
    }
}
