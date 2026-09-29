namespace DD.Danmaku.Matching;

using DD.Danmaku.Web.Api;

public static class MatchRequestValidator
{
    // 请求安全硬上限与 AI 设置范围一致；返回条数仍独立限制为 100。
    public const int MaxCandidates = 1000;
    public const int MaxBodyBytes = 512 * 1024;

    public static void Validate(ResolveMatchRequest? request)
    {
        Require(request is not null, "请求不能为空");
        var r = request!;
        // 只允许显式的作品或分集选择范围，防止未知语义绕过校验。
        Require(r.SelectionScope is "work" or "episode", "selectionScope 仅支持 work 或 episode");
        // mode 仅作为旧客户端兼容输入，绝不参与策略和授权判断。
        Text(r.Mode, 64);
        Require(r.Target is not null && r.Candidates is not null, "target 和 candidates 必须提供");
        Require(r.ResultLimit is >= 1 and <= 100, "resultLimit 必须为 1–100");
        Require(r.Candidates!.Count <= MaxCandidates, $"最多允许 {MaxCandidates} 个候选");
        var t = r.Target!;
        Text(t.ItemId, 256); Text(t.Title, 256); Text(t.FileName, 256);
        Require(t.FileName is null || !t.FileName.Contains('/') && !t.FileName.Contains('\\')
            && !t.FileName.Contains(':'), "fileName 只能包含文件名，不能包含路径或 URL");
        Metadata(t.MediaType, t.SeasonNumber, t.EpisodeNumber, t.Year, t.ProviderIds);
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var candidate in r.Candidates)
        {
            Require(candidate is not null, "候选不能为 null");
            var c = candidate!;
            Identifier(c.CandidateId); Identifier(c.SourceId);
            Require(ids.Add(c.CandidateId), "candidateId 不能重复");
            Text(c.AnimeId, 256); Text(c.EpisodeId, 256); Text(c.Title, 256);
            Require(c.Aliases is null || c.Aliases.Count <= 10, "候选最多允许 10 个别名");
            foreach (var alias in c.Aliases ?? [])
            {
                Require(!string.IsNullOrWhiteSpace(alias), "别名不能为空"); Text(alias, 256);
            }
            Metadata(c.MediaType, c.SeasonNumber, c.EpisodeNumber, c.Year, c.ProviderIds);
        }
        if (r.NumberingContext is not { } n) return;
        Identifier(n.SourceId);
        Require(r.Candidates.Any(c => c.SourceId == n.SourceId), "映射 sourceId 必须对应本次候选源");
        Require(t.MediaType == "episode", "仅剧集可以提供编号映射");
        Require(n.Basis is "manual" or "tmdb" or "filename", "不支持的映射依据");
        Numbers(n.OriginalSeasonNumber, n.OriginalEpisodeNumber);
        Numbers(n.MappedSeasonNumber, n.MappedEpisodeNumber);
        Require(n.MappedSeasonNumber is not null || n.MappedEpisodeNumber is not null, "映射编号不能为空");
        Require(n.OriginalSeasonNumber == t.SeasonNumber && n.OriginalEpisodeNumber == t.EpisodeNumber,
            "映射原始编号必须与 target 的结构化编号一致");
    }

    private static void Metadata(string? type, int? season, int? episode, int? year,
        IReadOnlyList<ProviderIdDto>? providers)
    {
        Require(type is null or "movie" or "episode", "mediaType 仅支持 movie、episode 或 null");
        Numbers(season, episode);
        Require(year is null or >= 1 and <= 9999, "year 超出允许范围");
        Require(type != "movie" || season is null && episode is null, "电影不能提供季集号");
        Require(providers is null || providers.Count <= 16, "最多允许 16 个 Provider ID");
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var provider in providers ?? [])
        {
            Require(provider is not null, "Provider ID 不能为 null");
            var p = provider!;
            Identifier(p.Provider); Identifier(p.Id);
            Require(p.Scope is "movie" or "series" or "season" or "episode", "Provider scope 无效");
            Require(keys.Add(p.Provider + ":" + p.Scope), "同平台同层级 Provider ID 不能重复");
            Require(type != "movie" || p.Scope == "movie", "电影 Provider ID 必须使用 movie scope");
            Require(type != "episode" || p.Scope != "movie", "剧集不能使用 movie scope");
        }
    }

    private static void Numbers(int? season, int? episode)
    {
        Require(season is null or >= 0 and <= 999, "seasonNumber 必须为 0–999 或 null");
        Require(episode is null or >= 0 and <= 99999, "episodeNumber 必须为 0–99999 或 null");
    }

    private static void Identifier(string? value)
    {
        Require(!string.IsNullOrWhiteSpace(value) && value == value.Trim(), "标识不能为空或包含首尾空白");
        Text(value, 256);
    }

    private static void Text(string? value, int limit)
        => Require(value is null || value.Length <= limit && !value.Any(char.IsControl), "文本过长或包含控制字符");

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new MatchRequestException(message);
    }
}
