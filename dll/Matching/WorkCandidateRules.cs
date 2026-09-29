namespace DD.Danmaku.Matching;

using DD.Danmaku.Web.Api;

/// <summary>作品级判断不要求分集编号，不将作品缺少集号视为信息不足。</summary>
internal static class WorkCandidateRules
{
    internal static CandidateAssessment Evaluate(TargetMediaDto target, MatchCandidateInput candidate)
    {
        var reasons = new List<string>();
        var conflicts = new List<string>();
        var episodic = target.MediaType == "episode";
        var parsedTarget = MatchMetadata.Parse(target.Title, episodic);
        var parsedCandidate = MatchMetadata.Parse(candidate.Title, episodic);
        var names = new[] { candidate.Title }.Concat(candidate.Aliases ?? []);
        var similarity = names.Max(name => MatchMetadata.Similarity(parsedTarget.Title,
            MatchMetadata.Parse(name, episodic).Title));
        var season = candidate.SeasonNumber ?? parsedCandidate.Season;
        var targetSeason = target.SeasonNumber ?? parsedTarget.Season;
        if (target.MediaType is not null && candidate.MediaType is not null
            && target.MediaType != candidate.MediaType) conflicts.Add("作品类型不一致");
        if (episodic && targetSeason is not null && season is not null && targetSeason != season)
            conflicts.Add("作品季度不一致");
        var providerMatch = false;
        foreach (var provider in target.ProviderIds ?? [])
        {
            // 集级标识不能用来确认作品；只比较明确标注的相同作用范围。
            if (provider.Scope == "episode") continue;
            var other = (candidate.ProviderIds ?? []).FirstOrDefault(p =>
                p.Scope == provider.Scope && p.Provider.Equals(provider.Provider, StringComparison.OrdinalIgnoreCase));
            if (other is null) continue;
            if (other.Id != provider.Id) conflicts.Add($"{provider.Provider}/{provider.Scope} ID 不一致");
            else { providerMatch = true; reasons.Add("作品平台标识一致"); }
        }
        var score = similarity * 0.85m;
        if (providerMatch) score = Math.Max(score, 0.95m);
        if (episodic && targetSeason is not null && targetSeason == season) score += 0.10m;
        var confirmation = false;
        if (target.Year is not null && candidate.Year is not null)
        {
            var difference = Math.Abs(target.Year.Value - candidate.Year.Value);
            if (difference == 0) score += 0.05m;
            else { reasons.Add("作品年份存在差异"); confirmation = difference > 1; }
        }
        reasons.Add($"作品标题/别名相似度 {similarity:0.000}");
        // 未知季度可交 AI 判断，但传统规则不得仅凭系列同名跨季度自动选择。
        if (episodic && targetSeason is not null && season is null && !providerMatch)
            score = Math.Min(score, 0.80m);
        var sufficient = providerMatch || !string.IsNullOrWhiteSpace(parsedTarget.Title)
            && !string.IsNullOrWhiteSpace(parsedCandidate.Title);
        if (!sufficient) reasons.Add("缺少作品标题或可靠平台标识");
        return new CandidateAssessment(new MatchCandidateDto(candidate.CandidateId, candidate.SourceId,
            candidate.AnimeId, null, candidate.Title, conflicts.Count > 0 ? 0 : Math.Round(Math.Clamp(score, 0, 1), 4),
            conflicts.Count == 0, reasons, conflicts), sufficient, confirmation);
    }
}
