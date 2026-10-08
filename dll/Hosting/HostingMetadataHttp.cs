namespace DD.Danmaku.Hosting;

using System.Net.Http;
using System.Text.Json;

// 健康探测与按需证据共用安全连接池；取消贯穿 DNS、排队、连接和响应读取。
internal sealed class HostingMetadataHttp : IDisposable
{
    private readonly HttpClient _public;
    private readonly HttpClient _private;
    private readonly SemaphoreSlim _slots = new(8, 8);
    private readonly Func<Uri, bool, CancellationToken, Task> _validate;
    internal HostingMetadataHttp() : this(BackendSourcePolicy.RequireSafeTargetAsync,
        BackendSourcePolicy.CreateHandler(), BackendSourcePolicy.CreateHandler()) { }
    internal HostingMetadataHttp(Func<Uri, bool, CancellationToken, Task> validate,
        HttpMessageHandler publicHandler, HttpMessageHandler privateHandler)
    {
        if (ReferenceEquals(publicHandler, privateHandler)) throw new ArgumentException("不同权限不能共用处理器");
        _validate = validate;
        _public = new(publicHandler, true) { Timeout = Timeout.InfiniteTimeSpan };
        _private = new(privateHandler, true) { Timeout = Timeout.InfiniteTimeSpan };
    }

    internal async Task<JsonElement> GetAsync(Uri target, bool allowPrivate, string? bearer, CancellationToken token)
    {
        await _slots.WaitAsync(token).ConfigureAwait(false);
        try
        {
            await _validate(target, allowPrivate, token).ConfigureAwait(false);
            using var request = new HttpRequestMessage(HttpMethod.Get, target);
            request.Options.Set(BackendSourcePolicy.AllowPrivateOption, allowPrivate);
            request.Headers.Accept.ParseAdd("application/json");
            request.Headers.UserAgent.ParseAdd("DD.Danmaku/1.3.6");
            if (!string.IsNullOrEmpty(bearer)) request.Headers.Authorization = new("Bearer", bearer);
            using var response = await (allowPrivate ? _private : _public).SendAsync(request,
                HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException("元数据请求失败", null, response.StatusCode);
            const int maxBody = 1024 * 1024;
            if (response.Content.Headers.ContentLength > maxBody) throw new InvalidDataException("元数据响应过大");
            await using var stream = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false);
            using var body = new MemoryStream();
            var buffer = new byte[16384];
            int count;
            while ((count = await stream.ReadAsync(buffer, token).ConfigureAwait(false)) > 0)
            {
                if (body.Length + count > maxBody) throw new InvalidDataException("元数据响应过大");
                body.Write(buffer, 0, count);
            }
            using var document = JsonDocument.Parse(body.GetBuffer().AsMemory(0, (int)body.Length),
                new JsonDocumentOptions { MaxDepth = 24 });
            DD.Danmaku.Web.Api.MatchJson.RejectDuplicateProperties(document.RootElement);
            return document.RootElement.Clone();
        }
        catch (HttpRequestException error)
        {
            // 不让底层异常携带端点、认证查询串或内层异常进入调用链。
            throw new HttpRequestException("元数据请求失败", null, error.StatusCode);
        }
        finally { _slots.Release(); }
    }
    public void Dispose() { _public.Dispose(); _private.Dispose(); }
}
