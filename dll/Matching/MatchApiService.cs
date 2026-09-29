namespace DD.Danmaku.Matching;

using System.Text.Json;
using DD.Danmaku.Web.Api;

public sealed record MatchHttpResult(int StatusCode, ApiResponse<ResolveMatchResponse> Body)
{
    public string ContentType => "application/json; charset=utf-8";
    public string ToJson() => JsonSerializer.Serialize(Body, MatchJson.Options);
}

/// <summary>
/// 宿主无关的匹配 HTTP 边界。宿主必须先认证/授权，再传入有界请求体；
/// 按 StatusCode 和 ToJson() 写响应，不交给宿主默认序列化器改变字段名。
/// </summary>
public sealed class MatchApiService
{
    private readonly IMatchService _matcher;
    public MatchApiService(IMatchService matcher) => _matcher = matcher;

    public async Task<MatchHttpResult> ResolveJsonAsync(ReadOnlyMemory<byte> utf8Body,
        CancellationToken cancellationToken)
    {
        var traceId = Guid.NewGuid().ToString("N");
        cancellationToken.ThrowIfCancellationRequested();
        if (utf8Body.Length > MatchRequestValidator.MaxBodyBytes)
            return Error(413, "MATCH_REQUEST_TOO_LARGE", "请求体超过 512 KiB", traceId);
        try
        {
            using var document = JsonDocument.Parse(utf8Body, new JsonDocumentOptions { MaxDepth = 16 });
            MatchJson.RejectDuplicateProperties(document.RootElement);
            var request = document.RootElement.Deserialize<ResolveMatchRequest>(MatchJson.Options);
            return await ResolveCoreAsync(request, traceId, cancellationToken);
        }
        catch (JsonException)
        { return Error(400, "INVALID_MATCH_REQUEST", "请求 JSON 格式、字段或类型无效", traceId); }
    }

    // HTTP 宿主注入的关联号同时用于业务日志与响应；客户端 JSON 不能设置该字段。
    public Task<MatchHttpResult> ResolveAsync(ResolveMatchRequest request, CancellationToken cancellationToken)
        => ResolveCoreAsync(request, request.TraceId ?? Guid.NewGuid().ToString("N"), cancellationToken);

    private async Task<MatchHttpResult> ResolveCoreAsync(ResolveMatchRequest? request, string traceId,
        CancellationToken cancellationToken)
    {
        try
        {
            MatchRequestValidator.Validate(request);
            var result = await _matcher.ResolveAsync(request!, cancellationToken);
            return new MatchHttpResult(200, new ApiResponse<ResolveMatchResponse>(true, null, null, result, traceId));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (MatchRequestException error)
        { return Error(error.StatusCode, error.ErrorCode, error.Message, traceId); }
        catch (Exception)
        { return Error(500, "MATCH_INTERNAL_ERROR", "匹配服务内部错误", traceId); }
    }

    private static MatchHttpResult Error(int status, string code, string message, string traceId)
        => new(status, new ApiResponse<ResolveMatchResponse>(false, message, code, null, traceId));
}
