namespace DD.Danmaku.Hosting;

using System.Text.Json;
using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>使用管理员当前表单执行生成测试，不保存或启用配置。</summary>
[Route("/dd-danmaku/api/config/ai/test", "POST")]
public sealed class TestAiRequest : IRequiresRequestStream
{
    /// <summary>受限测试草稿正文。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>测试与运行使用相同端点、模型、密钥与超时。</summary>
public sealed record AiTestDraft(string? BaseUrl, string? Model, string? ApiKey = null,
    bool ClearApiKey = false, int TimeoutSeconds = 15, string TestMode = "connection",
    string? Prompt = null, decimal ConfidenceThreshold = 0.85m, int MaxCandidates = 100);

public sealed partial class DanmakuApiService
{
    /// <summary>只返回协议、耗时与验证状态，不回显凭据或上游原文。</summary>
    public Task<object> Post(TestAiRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 32 * 1024, "application/json");
        var input = ApiHttpResult.Parse<AiTestDraft>(bytes);
        if (input.TimeoutSeconds is < 1 or > 120) throw new ApiAccessException(400, "AI_TIMEOUT_INVALID", "超时必须在1–120秒之间");
        if (input.ClearApiKey && !string.IsNullOrWhiteSpace(input.ApiKey)) throw new ApiAccessException(400, "AI_KEY_CONFLICT", "清除密钥不能同时提交新密钥");
        if (input.ApiKey?.Length > 2048 || input.ApiKey?.Any(char.IsControl) == true)
            throw new ApiAccessException(400, "AI_KEY_INVALID", "密钥格式无效");
        if (input.TestMode is not ("connection" or "match-single" or "match-multiple"))
            throw new ApiAccessException(400, "AI_TEST_MODE_INVALID", "未知测试模式");
        if (input.Prompt?.Length > 8192 || input.ConfidenceThreshold is < 0 or > 1 || input.MaxCandidates is < 1 or > 1000)
            throw new ApiAccessException(400, "AI_TEST_CONFIG_INVALID", "匹配测试参数无效");
        PluginConfiguration draft;
        lock (PluginConfigurationService.ConfigurationGate)
        {
            draft = plugin.Configuration.CopyForUpdate();
            var previous = draft.GetAiEndpoint();
            var address = input.BaseUrl?.Trim().TrimEnd('/');
            if (address != previous.Url?.TrimEnd('/') && !string.IsNullOrEmpty(previous.Key)
                && !input.ClearApiKey && string.IsNullOrWhiteSpace(input.ApiKey))
                throw new ApiAccessException(400, "AI_KEY_CONFIRM_REQUIRED", "修改地址后请重新填写或清除密钥再测试");
            draft.AiEnabled = true;
            draft.AiEndpointConfigured = true;
            draft.AiBaseUrl = address;
            draft.AiModel = input.Model?.Trim();
            draft.AiApiKey = input.ClearApiKey ? null : string.IsNullOrWhiteSpace(input.ApiKey) ? previous.Key : input.ApiKey;
            draft.AiTimeoutSeconds = input.TimeoutSeconds;
            draft.AiMatchPrompt = Matching.AiPromptDefaults.Resolve(input.Prompt);
            draft.AiConfidenceThreshold = input.ConfidenceThreshold;
            draft.AiMaxCandidates = input.MaxCandidates;
            draft.MatchStrategy = "ai-first";
        }
        if (!PluginConfiguration.ValidAiEndpoint(draft.AiBaseUrl, draft.AiModel, draft.AiApiKey))
            throw new ApiAccessException(400, "AI_TEST_CONFIG_INVALID", "请检查地址、模型与密钥格式");
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var protocol = "unknown";
        using var provider = new Matching.OpenAiCompatibleProvider(() => draft,
            new System.Net.Http.HttpClientHandler { AllowAutoRedirect = false },
            (stage, elapsed) => {
                protocol = stage.Split(':')[0];
                _matchLogger.Info("AI测试：阶段={0}，耗时毫秒={1}", stage, elapsed);
            });
        if (input.TestMode != "connection")
        {
            // 固定非私人样例，走实际提示词构造、提供者、评分校验及最终判断；不请求弹幕上游。
            var target = new TargetMediaDto(Title: "测试动画", MediaType: "episode", SeasonNumber: 2, EpisodeNumber: 3);
            MatchCandidateInput Candidate(string id, string title, int season) => new(id, "fixture", "anime-" + id,
                "episode-" + id, title, MediaType: "episode", SeasonNumber: season, EpisodeNumber: 3,
                UpstreamFields: JsonSerializer.SerializeToElement(new { animeId = "anime-" + id, animeTitle = title,
                    episodeId = "episode-" + id, episodeTitle = "第3话", type = "tvseries", typeDescription = "TV动画" }));
            var candidates = new List<MatchCandidateInput> { Candidate("correct", "测试动画 第二季", 2) };
            if (input.TestMode == "match-multiple")
            {
                candidates.Add(Candidate("wrong-season", "测试动画 第一季", 1));
                candidates.Add(Candidate("wrong-title", "完全不同的节目 第二季", 2));
            }
            var progress = new List<string>();
            var service = new Matching.MatchService(new Matching.RuleMatcher(), new Matching.IntelligentMatcher(),
                new Matching.AiMatchService(() => draft, provider), () => draft,
                message => _matchLogger.Info("AI匹配测试：{0}", message), message => _matchLogger.Warn("AI匹配测试：{0}", message));
            var result = await service.ResolveAsync(new ResolveMatchRequest("test", target, candidates)
            { AiAuthorized = true, TraceId = Guid.NewGuid().ToString("N"), Progress = (_, message) => progress.Add(message) }, Request.CancellationToken);
            return ApiHttpResult.Success(new { Status = result.Status, Protocol = protocol,
                ElapsedMilliseconds = watch.ElapsedMilliseconds, ResponseValid = result.ModeUsed.StartsWith("ai", StringComparison.Ordinal),
                TestMode = input.TestMode, CandidateCount = candidates.Count, result.ModeUsed, result.SelectedCandidateId,
                SelectedExpected = result.SelectedCandidateId == "correct", result.Candidates, result.Warnings, Steps = progress });
        }
        var output = await provider.CompleteStructuredAsync("Return only a JSON object with exactly one field: {\"ok\":true}. This is a connectivity and structured generation test.", Request.CancellationToken);
        try
        {
            using var result = JsonDocument.Parse(output);
            MatchJson.RejectDuplicateProperties(result.RootElement);
            if (result.RootElement.ValueKind != JsonValueKind.Object || result.RootElement.EnumerateObject().Count() != 1
                || !result.RootElement.TryGetProperty("ok", out var ok)
                || ok.ValueKind != JsonValueKind.True) throw new JsonException();
        }
        catch (JsonException) { throw new ApiAccessException(502, "AI_TEST_RESPONSE_INVALID", "请求成功但未返回预期的结构化测试结果"); }
        return ApiHttpResult.Success(new { Status = "succeeded", Protocol = protocol,
            ElapsedMilliseconds = watch.ElapsedMilliseconds, ResponseValid = true });
    });
}
