namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>AI 管理配置读取；通过管理员会话混淆响应。</summary>
[Route("/dd-danmaku/api/config/ai", "GET")]
public sealed class AiSettingsRequest { }
/// <summary>AI 管理配置更新。</summary>
[Route("/dd-danmaku/api/config/ai", "PUT")]
public sealed class SaveAiSettingsRequest : IRequiresRequestStream
{
    /// <summary>AI 设置的 JSON 请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

/// <summary>密钥为空保留已有值，清除操作必须显式指定。</summary>
public sealed record AiSettingsDto(string? BaseUrl, string? Model,
    int TimeoutSeconds, decimal ConfidenceThreshold, int MaxCandidates,
    string? Prompt = null, string? ApiKey = null, bool ClearApiKey = false, bool HasApiKey = false,
    string? MigrationNotice = null, string? DefaultPrompt = null);

/// <summary>使用已保存配置读取模型列表。</summary>
[Route("/dd-danmaku/api/config/ai/models", "GET")]
public sealed class AiModelsRequest { }

public sealed partial class DanmakuApiService
{
    /// <summary>管理员读取 AI 设置并保护已存凭据。</summary>
    public Task<object> Get(AiSettingsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        lock (PluginConfigurationService.ConfigurationGate)
            return Task.FromResult(SecretSuccess(AiSettingsView(plugin.Configuration)));
    });

    /// <summary>使用管理员保存的端点配置列出可选 AI 模型。</summary>
    public Task<object> Get(AiModelsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return ApiHttpResult.Success(new { Models = await host.GetAiModelsAsync(Request.CancellationToken) });
    });

    /// <summary>验证并保存 AI 端点、模型及凭据。</summary>
    public Task<object> Put(SaveAiSettingsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        // UTF-8 中文提示词可能超过原先的 16 KiB 限额。
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 128 * 1024, "application/json");
        var data = ApiHttpResult.Parse<AiSettingsDto>(body);
        // 只报告字段约束，不回显用户输入或密钥，避免统一异常吞掉具体原因。
        if (data.TimeoutSeconds is < 1 or > 120)
            throw new ApiAccessException(400, "AI_TIMEOUT_INVALID", "请求超时必须在 1–120 秒之间");
        // 设置范围与匹配请求的安全硬上限统一，避免保存成功后运行时仍被截为 100。
        if (data.MaxCandidates < 1 || data.MaxCandidates > Matching.MatchRequestValidator.MaxCandidates)
            throw new ApiAccessException(400, "AI_CANDIDATES_INVALID", $"最大候选数必须在 1–{Matching.MatchRequestValidator.MaxCandidates} 之间");
        if (data.ConfidenceThreshold is < 0 or > 1)
            throw new ApiAccessException(400, "AI_THRESHOLD_INVALID", "最低匹配分数必须在 0–1 之间");
        var model = data.Model?.Trim();
        if (string.IsNullOrWhiteSpace(model) || model.Length > 256 || model.Any(char.IsControl))
            throw new ApiAccessException(400, "AI_MODEL_INVALID", "模型名称不能为空、不能超过 256 字符或含控制字符；可手动填写模型名后保存");
        var url = data.BaseUrl?.Trim();
        if (url is not { Length: > 0 and <= 2048 } || !Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length != 0
            || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new ApiAccessException(400, "AI_URL_INVALID", "Base URL 必须是完整 HTTP(S) 地址，最多 2048 字符，不能包含账号密码、查询参数或片段");
        if (data.ApiKey is { Length: > 2048 } || data.ApiKey?.Any(char.IsControl) == true)
            throw new ApiAccessException(400, "AI_KEY_INVALID", "API Key 不能超过 2048 字符或包含换行、制表等控制字符");
        if (data.ClearApiKey && !string.IsNullOrWhiteSpace(data.ApiKey))
            throw new ApiAccessException(400, "AI_KEY_CONFLICT", "清除密钥时不能同时提交新密钥");
        if (data.Prompt is { Length: > 8192 }
            || data.Prompt?.Any(c => char.IsControl(c) && c is not '\r' and not '\n' and not '\t') == true)
            throw new ApiAccessException(400, "AI_PROMPT_INVALID", "提示词最多 8192 字符，允许换行和制表，但不能包含其他控制字符");
        lock (PluginConfigurationService.ConfigurationGate)
        {
            var copy = plugin.Configuration.CopyForUpdate();
            var previous = copy.GetAiEndpoint();
            var address = data.BaseUrl!.Trim().TrimEnd('/');
            var key = data.ClearApiKey ? null : string.IsNullOrWhiteSpace(data.ApiKey)
                ? previous.Key : data.ApiKey.Trim();
            // 地址变化时禁止把旧凭据悄悄发送给另一服务，需显式重填或清除。
            if (!string.Equals(previous.Url?.TrimEnd('/'), address, StringComparison.Ordinal)
                && !string.IsNullOrWhiteSpace(previous.Key) && !data.ClearApiKey
                && string.IsNullOrWhiteSpace(data.ApiKey))
                throw new ApiAccessException(400, "AI_KEY_CONFIRM_REQUIRED", "修改地址时请重新填写或清除 API Key");
            copy.AiEndpointConfigured = true;
            copy.AiBaseUrl = address;
            copy.AiModel = data.Model!.Trim();
            copy.AiApiKey = key;
            copy.AiTimeoutSeconds = data.TimeoutSeconds;
            copy.AiConfidenceThreshold = data.ConfidenceThreshold;
            copy.AiMaxCandidates = data.MaxCandidates;
            copy.AiMatchPrompt = Matching.AiPromptDefaults.Resolve(data.Prompt);
            // 成功保存统一配置时才移除旧值；读取不会破坏未迁移的数据。
            copy.LocalAiBaseUrl = copy.LocalAiModel = null;
            copy.RemoteAiBaseUrl = copy.RemoteAiModel = copy.RemoteAiApiKey = null;
            copy.AiProviderOrder = [];
            copy.AiAllowRemote = false;
            plugin.UpdateConfiguration(copy);
            return SecretSuccess(AiSettingsView(plugin.Configuration));
        }
    });

    private static AiSettingsDto AiSettingsView(PluginConfiguration c)
    {
        // 管理员查看配置不等于启用服务，不能通过运行时可用性过滤已保存值。
        var endpoint = (Url: c.AiBaseUrl, Model: c.AiModel, Key: c.AiApiKey);
        string? notice = null;
        var unified = c.AiEndpointConfigured || !string.IsNullOrWhiteSpace(c.AiBaseUrl)
            || !string.IsNullOrWhiteSpace(c.AiModel) || !string.IsNullOrWhiteSpace(c.AiApiKey);
        if (!unified)
        {
            var local = !string.IsNullOrWhiteSpace(c.LocalAiBaseUrl) || !string.IsNullOrWhiteSpace(c.LocalAiModel);
            var remote = !string.IsNullOrWhiteSpace(c.RemoteAiBaseUrl) || !string.IsNullOrWhiteSpace(c.RemoteAiModel)
                || !string.IsNullOrWhiteSpace(c.RemoteAiApiKey);
            // 两套旧配置并存时尊重显式顺序；没有顺序则不擅自选择。
            var kind = (c.AiProviderOrder ?? []).FirstOrDefault(x => x == "local" && local || x == "remote" && remote);
            kind ??= local && !remote ? "local" : remote && !local ? "remote" : null;
            if (kind is not null)
            {
                endpoint = kind == "local" ? (c.LocalAiBaseUrl, c.LocalAiModel, null)
                    : (c.RemoteAiBaseUrl, c.RemoteAiModel, c.RemoteAiApiKey);
                notice = "已读取旧配置供管理员查看，不代表服务已启用；请确认地址、模型，并重新填写或清除密钥后保存统一配置。";
            }
            else if (local || remote)
                notice = "存在两套旧 AI 配置且没有明确优先顺序，请明确填写要使用的地址、模型和密钥；保存成功前保留旧配置。";
        }
        return new(endpoint.Url, endpoint.Model, c.AiTimeoutSeconds, c.AiConfidenceThreshold,
            c.AiMaxCandidates, Prompt: Matching.AiPromptDefaults.Resolve(c.AiMatchPrompt),
            ApiKey: endpoint.Key, HasApiKey: !string.IsNullOrWhiteSpace(endpoint.Key),
            DefaultPrompt: Matching.AiPromptDefaults.Value, MigrationNotice: notice);
    }
}
