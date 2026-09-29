namespace DD.Danmaku.Matching;

using DD.Danmaku.Web.Api;

/// <summary>普通匹配只检查调用方提供的候选，不访问媒体库或源网络。</summary>
public sealed class RuleMatcher : IRuleMatcher
{
    /// <inheritdoc/>
    public CandidateAssessment Evaluate(TargetMediaDto target, MatchCandidateInput candidate,
        NumberingContextDto? numbering, ICollection<string> warnings)
        => CandidateRules.Evaluate(target, candidate, numbering, warnings);
}

/// <summary>仅排序，不允许相似度覆盖硬冲突或填补缺失元数据。</summary>
public sealed class IntelligentMatcher : IIntelligentMatcher
{
    /// <inheritdoc/>
    public IReadOnlyList<CandidateAssessment> Rank(IEnumerable<CandidateAssessment> candidates)
        => candidates.OrderByDescending(c => c.Result.Eligible)
            .ThenByDescending(c => c.Result.Score)
            .ThenBy(c => c.Result.CandidateId, StringComparer.Ordinal).ToArray();
}


