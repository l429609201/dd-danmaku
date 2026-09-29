namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>使用管理员表单草稿查询模型，不保存配置。</summary>
[Route("/dd-danmaku/api/config/ai/models", "POST")]
public sealed class QueryAiModelsRequest : IRequiresRequestStream
{
    /// <summary>仅在正文传递凭据，避免 URL 泄漏。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

/// <summary>模型查询无需预先指定模型或启用匹配。</summary>
public sealed record AiModelsDraft(string? BaseUrl, string? ApiKey = null,
    bool ClearApiKey = false, int TimeoutSeconds = 15);

public sealed partial class DanmakuApiService
{
    public Task<object> Post(QueryAiModelsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 32 * 1024, "application/json");
        var data = ApiHttpResult.Parse<AiModelsDraft>(body);
        if (data.TimeoutSeconds is < 1 or > 120)
            throw new ApiAccessException(400, "AI_TIMEOUT_INVALID", "请求超时必须在 1–120 秒之间");
        if (data.ClearApiKey && !string.IsNullOrWhiteSpace(data.ApiKey))
            throw new ApiAccessException(400, "AI_KEY_CONFLICT", "清除密钥时不能同时提交新密钥");
        PluginConfiguration draft;
        lock (PluginConfigurationService.ConfigurationGate)
        {
            draft = plugin.Configuration.CopyForUpdate();
            var previous = draft.GetAiEndpoint();
            var address = data.BaseUrl?.Trim().TrimEnd('/');
            // 更换地址时不自动沿用旧密钥；必须显式输入或清除。
            if (!string.Equals(previous.Url?.TrimEnd('/'), address, StringComparison.Ordinal)
                && !string.IsNullOrWhiteSpace(previous.Key) && !data.ClearApiKey
                && string.IsNullOrWhiteSpace(data.ApiKey))
                throw new ApiAccessException(400, "AI_KEY_CONFIRM_REQUIRED", "修改地址后请明确填写或清除 API Key，再刷新模型列表");
            draft.AiEndpointConfigured = true;
            draft.AiBaseUrl = address;
            draft.AiApiKey = data.ClearApiKey ? null : string.IsNullOrWhiteSpace(data.ApiKey) ? previous.Key : data.ApiKey;
            draft.AiTimeoutSeconds = data.TimeoutSeconds;
        }
        return ApiHttpResult.Success(new { Models = await host.GetAiModelsAsync(Request.CancellationToken, draft) });
    });
}
