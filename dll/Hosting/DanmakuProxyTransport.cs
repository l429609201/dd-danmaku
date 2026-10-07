namespace DD.Danmaku.Hosting;

using System.Net;
using System.Net.Http;
using System.Text.Json;

/// <summary>插件代理的受限传输层；目标地址仅由后端配置与路由白名单生成。</summary>
internal static class DanmakuProxyTransport
{
    // 不跟随重定向，防止上游把认证头带往其他服务；不共享 Cookie。
    private static readonly HttpClient Client = new(BackendSourcePolicy.CreateHandler())
        { Timeout = Timeout.InfiniteTimeSpan };
    // 内网授权与普通来源使用独立连接池，不能复用另一权限等级建立的连接。
    private static readonly HttpClient PrivateClient = new(BackendSourcePolicy.CreateHandler())
        { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly SemaphoreSlim Slots = new(8, 8);
    internal sealed record Reply(byte[] Body, int StatusCode);

    internal static async Task<Reply> SendAsync(Uri target, HttpMethod method,
        IReadOnlyDictionary<string, string> headers, byte[]? body, CancellationToken token, bool allowPrivate = false)
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
            await BackendSourcePolicy.RequireSafeTargetAsync(target, allowPrivate, timeout.Token);
            using var request = new HttpRequestMessage(method, target);
            // 仅后端已授权的来源能访问内网；连接时再次核验解析地址。
            request.Options.Set(BackendSourcePolicy.AllowPrivateOption, allowPrivate);
            request.Headers.Accept.ParseAdd("application/json");
            foreach (var header in headers)
            {
                // 只允许服务端生成的上游协议头，禁止传递 Emby 会话或浏览器 Cookie。
                if (header.Key is not ("X-Ddd-User" or "X-Ddd-Ts" or "X-Ddd-Sign"
                    or "X-AppId" or "X-Signature" or "X-Timestamp" or "X-User-Agent" or "User-Agent"))
                    throw new ArgumentException("代理请求头不在白名单内");
                request.Headers.Add(header.Key, header.Value);
            }
            if (body is not null)
            {
                if (body.Length > 256 * 1024) throw new InvalidDataException("代理请求体过大");
                request.Content = new ByteArrayContent(body);
                request.Content.Headers.ContentType = new("application/json");
            }
            using var response = await (allowPrivate ? PrivateClient : Client).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
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
            ValidateResponse(bytes, (int)response.StatusCode);
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

    internal static void ValidateResponse(byte[] bytes, int statusCode = 200)
    {
        JsonDocument parsed;
        try { parsed = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 64 }); }
        catch (JsonException) when (statusCode == 429)
        {
            throw new ApiAccessException(429, "UPSTREAM_RATE_LIMITED", "弹幕上游请求被流控（HTTP 429）");
        }
        using var json = parsed;
        var root = json.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
            throw statusCode == 429
                ? new ApiAccessException(429, "UPSTREAM_RATE_LIMITED", "弹幕上游请求被流控（HTTP 429）")
                : new ApiAccessException(502, "UPSTREAM_INVALID_RESPONSE", "弹幕上游返回的 JSON 结构无效");
        if (statusCode is < 200 or >= 300)
        {
            var code = statusCode == 429 ? "UPSTREAM_RATE_LIMITED"
                : statusCode is 401 or 403 ? "UPSTREAM_AUTH_REJECTED" : "UPSTREAM_REJECTED";
            throw new ApiAccessException(502, code, $"弹幕上游请求失败（HTTP {statusCode}）")
            { UpstreamReply = new(bytes, statusCode) };
        }
        var errorCode = root.TryGetProperty("errorCode", out var error)
            && int.TryParse(error.ToString(), out var number) ? number : 0;
        // 业务失败仍终止当前匹配并发事件；HTTP 回包则保留上游 JSON 原文。
        if ((root.TryGetProperty("success", out var success) && success.ValueKind == JsonValueKind.False) || errorCode != 0)
        {
            var code = errorCode == 429 ? "UPSTREAM_RATE_LIMITED"
                : errorCode is 401 or 403 ? "UPSTREAM_AUTH_REJECTED" : "UPSTREAM_BUSINESS_ERROR";
            throw new ApiAccessException(502, code, $"弹幕上游报告业务失败（错误码 {errorCode}）")
            { UpstreamReply = new(bytes, statusCode) };
        }
    }
}
