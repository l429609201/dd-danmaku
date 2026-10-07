namespace DD.Danmaku.Matching;

using DD.Danmaku.Web.Api;

/// <summary>无状态判断编排；全部候选参与判定后才裁剪返回列表。</summary>
public sealed class MatchService : IMatchService
{
    private readonly IRuleMatcher _rules;
    private readonly IIntelligentMatcher _ranking;
    private readonly IAiMatchService _ai;
    private readonly Func<PluginConfiguration> _configuration;
    private readonly Action<string>? _info;
    private readonly Action<string>? _warn;

    /// <summary>组合规则、排序、AI 与服务端配置的匹配服务。</summary>
    public MatchService(IRuleMatcher rules, IIntelligentMatcher ranking, IAiMatchService ai,
        Func<PluginConfiguration> configuration, Action<string>? info = null, Action<string>? warn = null)
        => (_rules, _ranking, _ai, _configuration, _info, _warn) = (rules, ranking, ai, configuration, info, warn);

    /// <summary>验证候选后按配置策略执行规则及 AI 匹配。</summary>
    public async Task<ResolveMatchResponse> ResolveAsync(ResolveMatchRequest request, CancellationToken cancellationToken)
    {
        MatchRequestValidator.Validate(request);
        cancellationToken.ThrowIfCancellationRequested();
        var config = _configuration();
        var preferAi = config.MatchStrategy == "ai-first";
        var allowFallback = config.AllowMatchFallback;
        var warnings = new List<string>();
        // 使用内部关联号；不记录媒体路径、用户数据、提示词或服务凭据。
        var trace = request.TraceId ?? Guid.NewGuid().ToString("N")[..8];
        void Warn(string message) {
            warnings.Add(message); _warn?.Invoke($"匹配 #{trace}：{message}");
            request.Progress?.Invoke("resolve", message);
        }
        var target = request.Target!;
        _info?.Invoke($"匹配 #{trace}：开始，范围={request.SelectionScope}，策略={(preferAi ? "AI 优先" : "传统优先")}，作品候选数={request.Candidates!.Count}，类型={target.MediaType ?? "未知"}，季={target.SeasonNumber}，集={target.EpisodeNumber}，年份={target.Year}，平台标识数={target.ProviderIds?.Count ?? 0}，AI候选上限={config.AiMaxCandidates}，AI超时秒={config.AiTimeoutSeconds}");
        var assessments = new List<CandidateAssessment>();
        foreach (var candidate in request.Candidates!)
        {
            cancellationToken.ThrowIfCancellationRequested();
            // 作品选择不能复用要求双方分集编号齐全的旧规则。
            var assessment = request.SelectionScope == "work"
                ? WorkCandidateRules.Evaluate(target, candidate)
                : _rules.Evaluate(target, candidate, request.NumberingContext, warnings);
            assessments.Add(assessment);
            _info?.Invoke($"匹配 #{trace}：候选序号={assessments.Count}，类型={candidate.MediaType ?? "未知"}，季={candidate.SeasonNumber}，年份={candidate.Year}，标题存在={!string.IsNullOrWhiteSpace(candidate.Title)}，平台标识数={candidate.ProviderIds?.Count ?? 0}，规则分={assessment.Result.Score}，合格={assessment.Result.Eligible}，信息足够={assessment.MetadataSufficient}");
        }
        var traditional = _ranking.Rank(assessments);
        IReadOnlyList<CandidateAssessment> ranked = traditional;
        var modeUsed = "traditional";
        var tryAi = preferAi || (allowFallback && traditional.Count > 0 && !IsConfirmed(traditional, request));
        if (tryAi)
        {
            // 故障降级不受策略回退开关限制；授权失败绝不调用提供者。
            try
            {
                var unavailable = !config.AiEnabled ? "AI 未启用"
                    : !request.AiAuthorized ? "当前用户未获 AI 授权"
                    : !_ai.IsAvailable ? "AI 提供者不可用" : null;
                if (unavailable is not null) Warn($"{unavailable}，使用传统匹配");
                else
                {
                    request.Progress?.Invoke("resolve", $"开始 AI 辅助判断，候选数={traditional.Count}，超时={config.AiTimeoutSeconds}秒");
                    _info?.Invoke($"匹配 #{trace}：开始 AI 辅助判断");
                    ranked = _ranking.Rank(await _ai.RerankAsync(request, traditional, cancellationToken));
                    modeUsed = preferAi ? "ai" : "ai-fallback";
                    if (!preferAi) warnings.Add("传统匹配无法唯一确认，已使用 AI 回退");
                }
            }
            // 用户取消或宿主停止必须传播，不伪装为 AI 故障继续处理。
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception error)
            {
                ranked = traditional;
                modeUsed = "traditional";
                var reason = error is MatchRequestException matchError ? matchError.ErrorCode
                    : error is OperationCanceledException ? "AI_TIMEOUT" : error.GetType().Name;
                Warn($"AI 调用失败（{reason}），已降级传统匹配");
            }
        }
        // 正常 AI 结果无法确认时，仍由插件设置决定是否尝试传统结果。
        if (preferAi && modeUsed == "ai" && allowFallback)
        {
            var aiEligible = ranked.Where(c => c.Result.Eligible).ToArray();
            var best = aiEligible.FirstOrDefault();
            var confirmed = best is not null && best.MetadataSufficient && !best.RequiresConfirmation
                && !request.CandidatesTruncated && best.Result.Score >= _ai.MatchThreshold
                && !aiEligible.Skip(1).Any(c => best.Result.Score - c.Result.Score <= 0.08m);
            if (!confirmed)
            {
                ranked = traditional;
                modeUsed = "traditional";
                Warn($"AI 未满足确认条件：分数={best?.Result.Score}，阈值={_ai.MatchThreshold}，元数据充分={best?.MetadataSufficient}，需确认={best?.RequiresConfirmation}，候选截断={request.CandidatesTruncated}；已回退到传统匹配");
            }
        }
        cancellationToken.ThrowIfCancellationRequested();
        if (request.CandidatesTruncated) warnings.Add("候选集已截断，不能自动确认唯一匹配");
        var eligible = ranked.Where(c => c.Result.Eligible).ToArray();
        var threshold = modeUsed.StartsWith("ai", StringComparison.Ordinal) ? _ai.MatchThreshold : 0.85m;
        var status = "unmatched";
        string? selected = null;
        if (eligible.Length > 0)
        {
            var best = eligible[0];
            if (!best.MetadataSufficient) status = "insufficient_metadata";
            else if (best.Result.Score >= threshold)
            {
                var close = eligible.Skip(1).Any(c => best.Result.Score - c.Result.Score <= 0.08m);
                if (close || best.RequiresConfirmation || request.CandidatesTruncated) status = "ambiguous";
                else { status = "matched"; selected = best.Result.CandidateId; }
            }
            else if (eligible.Any(c => !c.MetadataSufficient)) status = "insufficient_metadata";
        }
        var chosen = ranked.FirstOrDefault(candidate => candidate.Result.CandidateId == selected);
        var outcome = $"完成，实际模式={modeUsed}，状态={status}，选中候选={selected ?? "无"}，作品ID={chosen?.Result.AnimeId}，章节ID={chosen?.Result.EpisodeId}，标题={chosen?.Result.Title}，分数={chosen?.Result.Score}";
        _info?.Invoke($"匹配 #{trace}：{outcome}");
        request.Progress?.Invoke("resolve", outcome);
        return new ResolveMatchResponse(modeUsed, status, selected, status != "matched",
            ranked.Take(request.ResultLimit).Select(c => c.Result).ToArray(), warnings.Distinct().ToArray());
    }

    private static bool IsConfirmed(IReadOnlyList<CandidateAssessment> ranked, ResolveMatchRequest request)
    {
        var eligible = ranked.Where(c => c.Result.Eligible).ToArray();
        if (eligible.Length == 0 || request.CandidatesTruncated) return false;
        var best = eligible[0];
        return best.MetadataSufficient && best.Result.Score >= 0.85m
            && !best.RequiresConfirmation
            && !eligible.Skip(1).Any(c => best.Result.Score - c.Result.Score <= 0.08m);
    }
}
