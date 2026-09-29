namespace DD.Danmaku.Matching;

using DD.Danmaku.Web.Api;

internal static class CandidateRules
{
    public static CandidateAssessment Evaluate(TargetMediaDto t, MatchCandidateInput c,
        NumberingContextDto? numbering, ICollection<string> warnings)
    {
        var reasons = new List<string>(); var conflicts = new List<string>();
        var episodic = t.MediaType == "episode";
        var tp = MatchMetadata.Parse(t.Title, episodic);
        var fp = MatchMetadata.Parse(MatchMetadata.FileTitle(t.FileName), episodic);
        var cp = MatchMetadata.Parse(c.Title, c.MediaType == "episode");
        var title = string.IsNullOrWhiteSpace(t.Title) ? fp.Title : tp.Title;
        var ts = t.SeasonNumber ?? tp.Season ?? fp.Season;
        var te = t.EpisodeNumber ?? tp.Episode ?? fp.Episode;
        var cs = c.SeasonNumber ?? cp.Season; var ce = c.EpisodeNumber ?? cp.Episode;
        var confirm = false;
        void Inconsistent(int? explicitValue, int? inferred, string name)
        {
            if (explicitValue is not null && inferred is not null && explicitValue != inferred)
            { warnings.Add($"{c.CandidateId}: {name}元数据矛盾，保留结构化值并要求确认"); confirm = true; }
        }
        Inconsistent(t.SeasonNumber, tp.Season, "目标季号");
        Inconsistent(t.SeasonNumber ?? tp.Season, fp.Season, "文件名季号");
        Inconsistent(t.EpisodeNumber, tp.Episode, "目标集号");
        Inconsistent(t.EpisodeNumber ?? tp.Episode, fp.Episode, "文件名集号");
        Inconsistent(c.SeasonNumber, cp.Season, "候选季号");
        Inconsistent(c.EpisodeNumber, cp.Episode, "候选集号");
        if (numbering is { } n && n.SourceId == c.SourceId)
        {
            if (n.Basis == "manual")
            {
                ts = n.MappedSeasonNumber ?? ts; te = n.MappedEpisodeNumber ?? te;
                reasons.Add("使用调用方明确配置的手动编号映射");
                warnings.Add("手动映射由调用方声明，未由后端独立核验");
            }
            else
            {
                warnings.Add("未核验的 TMDB/文件名映射仅作为提示，不覆盖原始季集");
                confirm = true;
            }
        }
        if (t.MediaType is not null && c.MediaType is not null && t.MediaType != c.MediaType)
            conflicts.Add("媒体类型不一致");
        if (episodic && ts is not null && cs is not null && ts != cs) conflicts.Add("季号不一致");
        if (episodic && te is not null && ce is not null && te != ce) conflicts.Add("集号不一致");
        var providerMatch = false; var exactItem = false;
        foreach (var p in t.ProviderIds ?? [])
        {
            var other = (c.ProviderIds ?? []).FirstOrDefault(x =>
                x.Provider.Equals(p.Provider, StringComparison.OrdinalIgnoreCase) && x.Scope == p.Scope);
            if (other is null) continue;
            if (!string.Equals(p.Id, other.Id, StringComparison.Ordinal))
            { conflicts.Add($"{p.Provider}/{p.Scope} ID 不一致"); continue; }
            providerMatch = true;
            exactItem |= episodic ? p.Scope == "episode" : t.MediaType == "movie" && p.Scope == "movie";
            reasons.Add($"{p.Provider}/{p.Scope} ID 一致");
        }
        var aliasParts = (c.Aliases ?? []).Select(a =>
            MatchMetadata.Parse(a, c.MediaType == "episode")).ToArray();
        foreach (var alias in aliasParts)
        {
            Inconsistent(cs, alias.Season, "候选别名季号");
            Inconsistent(ce, alias.Episode, "候选别名集号");
        }
        var names = new[] { cp.Title }.Concat(aliasParts.Select(a => a.Title)).ToArray();
        var similarity = names.Max(name => MatchMetadata.Similarity(title, name));
        var hasTitles = MatchMetadata.Normalize(title).Length > 0 && names.Any(n => MatchMetadata.Normalize(n).Length > 0);
        var identity = providerMatch || similarity >= 0.80m;
        var score = similarity * 0.60m;
        if (providerMatch) score = Math.Max(score, 0.65m);
        if (exactItem) score = Math.Max(score, 0.95m);
        reasons.Add($"标题/别名相似度 {similarity:0.000}");
        if (identity)
        {
            if (episodic && ts is not null && ts == cs) { score += 0.12m; reasons.Add("季号一致"); }
            if (episodic && te is not null && te == ce) { score += 0.18m; reasons.Add("集号一致"); }
            if (!episodic && t.MediaType == "movie" && c.MediaType == "movie") score += 0.15m;
            if (t.Year is not null && c.Year is not null)
            {
                var diff = Math.Abs(t.Year.Value - c.Year.Value);
                score += diff == 0 ? 0.15m : diff == 1 ? 0.05m : -0.20m;
                reasons.Add(diff == 0 ? "年份一致" : "年份存在差异");
                if (diff > 1) confirm = true;
            }
        }
        var sufficient = t.MediaType is not null && c.MediaType is not null && (hasTitles || providerMatch)
            && (episodic ? exactItem || ts is not null && cs is not null && te is not null && ce is not null
                : exactItem || t.Year is not null && c.Year is not null);
        if (!sufficient) reasons.Add("可靠判断所需的类型、标识或季集/年份信息不足");
        if (episodic && string.IsNullOrWhiteSpace(c.EpisodeId))
            warnings.Add($"{c.CandidateId}: 缺少源 episodeId，不能据此保证弹幕可获取");
        if (conflicts.Count > 0) score = 0;
        return new CandidateAssessment(new MatchCandidateDto(c.CandidateId, c.SourceId, c.AnimeId,
            c.EpisodeId, c.Title, Math.Round(Math.Clamp(score, 0, 1), 4), conflicts.Count == 0,
            reasons, conflicts), sufficient, confirm);
    }
}
