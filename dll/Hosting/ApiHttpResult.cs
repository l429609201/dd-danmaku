namespace DD.Danmaku.Hosting;

using System.Text.Json;
using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>固定 JSON 字段和缓存策略，避免宿主序列化器改变无状态匹配协议。</summary>
internal sealed class ApiHttpResult(int status, byte[] body, string contentType) : IAsyncStreamWriter
{
    internal int StatusCode => status;
    internal static ApiHttpResult Json<T>(T data, int status = 200)
        => new(status, JsonSerializer.SerializeToUtf8Bytes(data, MatchJson.Options), "application/json; charset=utf-8");
    internal static ApiHttpResult Success<T>(T data)
        => Json(new ApiResponse<T>(true, null, null, data, null));
    internal static ApiHttpResult Error(int status, string code, string message)
        => Json(new ApiResponse<object>(false, message, code, null, Guid.NewGuid().ToString("N")), status);

    public async Task WriteToAsync(IResponse response, CancellationToken cancellationToken)
    {
        response.StatusCode = status;
        response.ContentType = contentType;
        response.AddHeader("Cache-Control", "no-store");
        response.AddHeader("X-Content-Type-Options", "nosniff");
        response.SetContentLength(body.Length);
        await response.OutputWriter.WriteAsync(body, cancellationToken);
    }

    internal static async Task<byte[]> ReadBodyAsync(Stream stream, IRequest request, int limit,
        params string[] contentTypes)
    {
        var contentType = (request.ContentType ?? "").Split(';')[0].Trim();
        if (!contentTypes.Contains(contentType, StringComparer.OrdinalIgnoreCase))
            throw new ApiAccessException(415, "UNSUPPORTED_CONTENT_TYPE", "请求内容类型不受支持");
        if (request.ContentLength > limit) throw TooLarge();
        using var buffer = new MemoryStream();
        var bytes = new byte[8192];
        int count;
        while ((count = await stream.ReadAsync(bytes.AsMemory(), request.CancellationToken)) > 0)
        {
            if (buffer.Length + count > limit) throw TooLarge();
            buffer.Write(bytes, 0, count);
        }
        return buffer.ToArray();
    }

    internal static T Parse<T>(byte[] body)
    {
        using var document = JsonDocument.Parse(body, new JsonDocumentOptions { MaxDepth = 16 });
        MatchJson.RejectDuplicateProperties(document.RootElement);
        return document.RootElement.Deserialize<T>(MatchJson.Options) ?? throw new JsonException();
    }
    private static ApiAccessException TooLarge() => new(413, "REQUEST_TOO_LARGE", "请求体超过大小限制");
}
