namespace DD.Danmaku.Hosting;

using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using DD.Danmaku.Danmaku;
using DD.Danmaku.Matching;
using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>Run an authenticated server-side online match for a visible media item.</summary>
[Route("/dd-danmaku/api/matches/online", "POST")]
public sealed class OnlineMatchHttpRequest : IRequiresRequestStream
{
    /// <summary>Bounded JSON request stream supplied by Emby.</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

internal sealed record OnlineMatchInput(string ItemId, string Title, string? FileName = null,
    string? MediaType = null, int? SeasonNumber = null, int? EpisodeNumber = null, int? Year = null,
    IReadOnlyList<string>? SourcePriority = null, string MatchMode = "fileNameOnly",
    string? FileHash = null, long? FileSize = null, int? VideoDuration = null,
    bool MatchApiEnabled = true, string? OperationId = null,
    string? AnimeBlacklist = null, string? EpisodeBlacklist = null, bool ApplyCustomBlacklist = false,
    string? PreferredAnimeId = null, int? PreferredEpisodeNumber = null);

internal sealed record OnlineEpisode(string? AnimeId, string? AnimeTitle, string? EpisodeId,
    string? EpisodeTitle, int? EpisodeNumber = null, string? ImageUrl = null, decimal? Score = null,
    JsonElement? UpstreamFields = null);

internal sealed record OnlineMatchResult(string Status, string? SourceId, string? SourceType,
    OnlineEpisode? Selected, IReadOnlyList<OnlineEpisode> Candidates, bool RequiresConfirmation, string ModeUsed);

// 仅由一次后台任务持有；来源和用户隔离，不能提升为跨任务缓存。
internal sealed class OnlineMatchReuseContext
{
    // 各来源分区共享任务总预算；不共享评分正文，避免相同候选ID跨用户或来源误命中。
    private readonly AiTaskScoreCache _scoreBudget = new();
    private readonly Dictionary<(Guid UserId, string Source, string SourceId, PluginConfiguration Config), AiTaskScoreCache> _scoreCaches = new();
    internal AiTaskScoreCache GetScoreCache(Guid userId, string source, string sourceId, PluginConfiguration config)
    {
        var key = (userId, source, sourceId, config);
        if (!_scoreCaches.TryGetValue(key, out var cache))
        {
            cache = _scoreBudget.CreatePartition();
            _scoreCaches.Add(key, cache);
        }
        return cache;
    }
    internal int ResponseBytes { get; set; }
    internal Dictionary<(Guid UserId, string Source, string SourceId, PluginConfiguration Config, string Path), byte[]> Responses { get; } = new();
    internal Dictionary<(Guid UserId, string Source, string SourceId, PluginConfiguration Config, bool AiAuthorized, string Data), MatchHttpResult> Resolutions { get; } = new();
}

public sealed partial class DanmakuApiService
{
    /// <summary>Resolve official or configured custom sources for the authenticated media item.</summary>
    public Task<object> Post(OnlineMatchHttpRequest request) => Execute(async (user, plugin, host) =>
    {
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 16 * 1024, "application/json");
        var input = ApiHttpResult.Parse<OnlineMatchInput>(bytes);
        var operationId = input.OperationId;
        if (operationId is not null && !OperationEventHub.IsOwned(user.Id, operationId))
            throw new ApiAccessException(404, "OPERATION_NOT_FOUND", "操作不存在或不可访问");
        var completion = "failed";
        var failureCode = "UPSTREAM_ERROR";
        try
        {
        ValidateOnlineInput(input);
        var itemId = _access.RequireVideo(user, input.ItemId);
        if (operationId is not null) OperationEventHub.Publish(user.Id, operationId, "match", status: "running");
        var token = Request.CancellationToken;
        var sources = input.SourcePriority ?? ["official", "custom"];
        var target = new TargetMediaDto(itemId, input.Title, input.FileName, input.MediaType,
            input.SeasonNumber, input.EpisodeNumber, input.Year);
        var empty = new OnlineMatchResult("unmatched", null, null, null, [], true, "traditional");
        foreach (var source in sources)
        {
            token.ThrowIfCancellationRequested();
            if (source == "custom" && (!plugin.Configuration.DanmakuProxyEnabled
                || string.IsNullOrWhiteSpace(plugin.Configuration.DanmakuProxySourceId))) continue;
            if (source == "official" && !OnlineOfficialConfigured())
                throw new ApiAccessException(503, "OFFICIAL_PROXY_UNAVAILABLE", "此 DLL 构建未配置官方中转签名");
            var sourceId = source == "official" ? DanmakuXmlMetadata.OfficialSource
                : plugin.Configuration.DanmakuProxySourceId;
            if (operationId is not null) OperationEventHub.Publish(user.Id, operationId, "source");
            OnlineMatchResult matched;
            try
            {
                matched = await MatchOnlineSourceAsync(input, target, source, sourceId, user.Id,
                    plugin.Configuration, host, token, operationId);
            }
            catch (ApiAccessException error) when (source == "official" && error.Code == "UPSTREAM_RATE_LIMITED")
            {
                // 整个降级流程属于同一任务；不重试被流控的匹配或搜索接口。
                if (operationId is not null) OperationEventHub.Publish(user.Id, operationId,
                    "bgm_fallback", errorCode: error.Code);
                matched = await MatchOnlineSourceAsync(input, target, source, sourceId, user.Id,
                    plugin.Configuration, host, token, operationId, error);
            }
            // Never silently switch upstream after an uncertain nonempty candidate set.
            if (matched.Status != "unmatched")
            {
                completion = "succeeded";
                return ApiHttpResult.Success(matched);
            }
        }
        completion = "succeeded";
        return ApiHttpResult.Success(empty);
        }
        catch (OperationCanceledException) when (Request.CancellationToken.IsCancellationRequested)
        {
            completion = "cancelled";
            throw;
        }
        catch (ApiAccessException error)
        {
            // 事件流保留 HTTP 回包的具体错误，不输出上游正文。
            failureCode = error.Code;
            throw;
        }
        finally
        {
            if (operationId is not null) OperationEventHub.Complete(user.Id, operationId, completion,
                completion == "failed" ? failureCode : null);
        }
    });

    private static void ValidateOnlineInput(OnlineMatchInput input)
    {
        if (input is null || string.IsNullOrWhiteSpace(input.ItemId) || input.ItemId.Length > 256
            || string.IsNullOrWhiteSpace(input.Title) || input.Title.Length > 200
            || input.FileName is { Length: > 256 } || input.FileName?.IndexOfAny(['/', '\\', ':']) >= 0
            || input.MediaType is not ("movie" or "episode")
            || input.SeasonNumber is < 0 or > 999 || input.EpisodeNumber is < 0 or > 99999
            || input.Year is < 1 or > 9999 || input.FileSize is < 0 or > 1099511627776
            || input.VideoDuration is < 0 or > 864000
            || input.MatchMode is not ("fileNameOnly" or "hashAndFileName")
            || input.SourcePriority is { Count: > 2 }
            || input.OperationId is { Length: > 128 }
            || input.AnimeBlacklist is { Length: > 512 } || input.EpisodeBlacklist is { Length: > 512 }
            || (input.PreferredAnimeId is not null || input.PreferredEpisodeNumber is not null)
                && (input.MediaType != "episode" || input.PreferredAnimeId is null
                    || input.PreferredEpisodeNumber is < 1 or > 99999 || !OnlineId(input.PreferredAnimeId))
            || new[] { input.ItemId, input.Title, input.FileName ?? "", input.OperationId ?? "",
                input.AnimeBlacklist ?? "", input.EpisodeBlacklist ?? "" }
                .Any(s => s.Any(char.IsControl)))
            throw new ArgumentException("在线匹配参数无效");
        if (input.MediaType == "episode" && input.EpisodeNumber is null)
            throw new MatchRequestException("剧集匹配需要明确集号", "EPISODE_NUMBER_REQUIRED");
        if (input.MediaType == "movie" && (input.SeasonNumber is not null || input.EpisodeNumber is not null))
            throw new ArgumentException("电影不能包含季集号");
        var priority = input.SourcePriority ?? ["official", "custom"];
        if (priority.Any(s => s is not ("official" or "custom")) || priority.Distinct().Count() != priority.Count)
            throw new ArgumentException("在线匹配来源无效");
        if (input.FileHash is not null && (input.FileHash.Length != 32 || !input.FileHash.All(Uri.IsHexDigit)))
            throw new ArgumentException("文件哈希无效");
    }

    private static bool OnlineOfficialConfigured()
    {
        var settings = OfficialSettings.Value;
        return new OfficialRequestSigner(settings.Secret, settings.BrandMark, settings.ObfuscationKey).IsConfigured
            && !string.IsNullOrWhiteSpace(settings.RelayPrefix) && !string.IsNullOrWhiteSpace(settings.UserAgent);
    }

    private async Task<OnlineMatchResult> MatchOnlineSourceAsync(OnlineMatchInput input, TargetMediaDto target,
        string source, string sourceId, Guid userId, PluginConfiguration config,
        EmbyHostServices host, CancellationToken token, string? operationId, ApiAccessException? rateLimited = null,
        bool aiAuthorized = false, bool allowDirectEpisode = true, Action<string, int?>? taskProgress = null, Action<string, string, int?>? taskDetail = null,
        bool normalizeSeasonEpisode = true, OnlineMatchReuseContext? reuseContext = null,
        Func<TargetMediaDto, CancellationToken, Task<JsonElement?>>? evidenceProvider = null)
    {
        void Progress(string stage, int? count = null)
        {
            // 后台任务统一维护阶段、Emby 日志和本人 SSE，失败时保留最后实际操作。
            if (taskProgress is not null) { taskProgress(stage, count); return; }
            // 旧同步路由仍同时记录日志和发布进度。
            if (operationId is not null)
            {
                _matchLogger.Info("后端匹配：任务={0}，阶段={1}，数量={2}", operationId, stage, count);
                OperationEventHub.Publish(userId, operationId, stage, count);
            }
        }
        // 仅发布明确业务字段，不序列化上游对象、请求地址或凭据。
        void Detail(string stage, string text, int? count = null)
        {
            text = new string(text.Where(character => !char.IsControl(character) || character is '\n' or '\r' or '\t').Take(24000).ToArray());
            if (taskDetail is not null) { taskDetail(stage, text, count); return; }
            _matchLogger.Info("后端匹配：任务={0}，阶段={1}，{2}", operationId, stage, text);
            if (operationId is not null) OperationEventHub.Publish(userId, operationId, stage, count, detail: text);
        }
        string Candidates(IEnumerable<OnlineEpisode> candidates) => "\n" + JsonSerializer.Serialize(candidates.Take(100),
            new JsonSerializerOptions(MatchJson.Options) { WriteIndented = true,
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        // 成功响应只在本任务、本人和当前来源配置内复用；失败不缓存，保留鉴权/流控/取消语义。
        reuseContext ??= new OnlineMatchReuseContext();
        async Task<byte[]> Fetch(string path)
        {
            token.ThrowIfCancellationRequested();
            var key = (userId, source, sourceId, config, path);
            if (reuseContext.Responses.TryGetValue(key, out var bytes)) return bytes;
            bytes = await OnlineFetchAsync(source, config, userId, path, null, token);
            using var document = JsonDocument.Parse(bytes);
            if (document.RootElement.ValueKind == JsonValueKind.Object
                && (!document.RootElement.TryGetProperty("success", out var success) || success.ValueKind != JsonValueKind.False))
            {
                // 搜索必须先通过协议校验，不能把一个200错误结构当作成功响应复用。
                if (path.StartsWith("/search/anime?", StringComparison.Ordinal)) OnlineParseList(bytes, "animes");
                var root = document.RootElement;
                if (root.TryGetProperty("bangumi", out var bangumi) && bangumi.ValueKind == JsonValueKind.Object) root = bangumi;
                var valid = !path.StartsWith("/bangumi/", StringComparison.Ordinal)
                    || root.TryGetProperty("episodes", out var episodes) && episodes.ValueKind == JsonValueKind.Array;
                // 多编号任务也保持有界；超过上限照常读取，不改变匹配和错误语义。
                if (valid && reuseContext.Responses.Count < 128 && bytes.Length <= 8 * 1024 * 1024 - reuseContext.ResponseBytes)
                {
                    reuseContext.Responses[key] = bytes;
                    reuseContext.ResponseBytes += bytes.Length;
                }
            }
            return bytes;
        }
        async Task<MatchHttpResult> Resolve(ResolveMatchRequest request)
        {
            token.ThrowIfCancellationRequested();
            // 只传递任务内分区；普通可靠规则不访问缓存、不加载证据，模型构造最终输入后才判断复用。
            request = request with { ScoreCache = reuseContext.GetScoreCache(userId, source, sourceId, config) };
            // 延迟证据始终绑定本次映射目标；证据未进入序列化键时不能复用旧判断。
            if (evidenceProvider is not null)
                request = request with { EvidenceProvider = ct => evidenceProvider(request.Target!, ct) };
            // 目标包含映射后的季集号；只有完全相同的输入和权限才能复用判断（含已降级的AI失败结果）。
            var key = (userId, source, sourceId, config, aiAuthorized, JsonSerializer.Serialize(request, MatchJson.Options));
            if (evidenceProvider is null && reuseContext.Resolutions.TryGetValue(key, out var cached)) return cached;
            var reply = await host.Matches.ResolveAsync(request, token);
            if (evidenceProvider is null && reply.Body.Success && reply.Body.Data is not null && reuseContext.Resolutions.Count < 128)
                reuseContext.Resolutions[key] = reply;
            return reply;
        }
        var searchTitle = input.SeasonNumber is > 1 ? $"{input.Title} 第{input.SeasonNumber}季" : input.Title;
        var applyBlacklist = source == "official" || input.ApplyCustomBlacklist;
        var animeFilter = applyBlacklist ? OnlineBlacklist(input.AnimeBlacklist) : null;
        var episodeFilter = applyBlacklist ? OnlineBlacklist(input.EpisodeBlacklist) : null;
        bool Allowed(OnlineEpisode candidate) =>
            (animeFilter is null || !animeFilter.IsMatch(candidate.AnimeTitle ?? ""))
            && (episodeFilter is null || !episodeFilter.IsMatch(candidate.EpisodeTitle ?? ""));
        if (rateLimited is null && input.PreferredAnimeId is not null && input.PreferredEpisodeNumber is not null)
        {
            Progress("detail");
            var preferredDetail = await Fetch("/bangumi/" + ProxyIdentifier(input.PreferredAnimeId));
            using var preferredDocument = JsonDocument.Parse(preferredDetail);
            var root = preferredDocument.RootElement;
            if (root.TryGetProperty("bangumi", out var bangumi) && bangumi.ValueKind == JsonValueKind.Object)
                root = bangumi;
            var title = OnlineString(root, "animeTitle");
            if (title is not null && (animeFilter is null || !animeFilter.IsMatch(title)))
            {
                var preferred = new OnlineEpisode(input.PreferredAnimeId, title, null, null);
                var preferredEpisodes = OnlineParseEpisodes(preferredDetail, preferred);
                // 仅复用唯一明确的上游集号，不推断 episodeId 是否连续。
                var preferredMatches = preferredEpisodes.Where(ep => ep.EpisodeNumber == input.PreferredEpisodeNumber && Allowed(ep)).ToArray();
                if (preferredEpisodes.Count > 100 || preferredMatches.Length > 1)
                    return new("ambiguous", sourceId, source, null, preferredMatches.Take(20).ToArray(), true, "user-confirmed-work");
                if (preferredMatches.Length == 1)
                    return new("matched", sourceId, source, preferredMatches[0], preferredMatches, false, "user-confirmed-work");
            }
        }
        var works = new List<OnlineEpisode>();
        var exactFound = false;
        Dictionary<string, byte[]>? bgmDetails = null;
        if (rateLimited is not null)
        {
            var fallback = await OnlineBgmSearchAsync(searchTitle, userId, config, token, Progress);
            works.AddRange(fallback.Works);
            bgmDetails = fallback.Details;
        }
        // 仅文件名模式按上游协议携带全零占位值；哈希模式必须有真实哈希，否则走标题搜索。
        var realHash = input.FileHash is { Length: 32 } && input.FileHash.All(Uri.IsHexDigit)
            && input.FileHash.Any(character => character != '0');
        if (rateLimited is null && input.MatchApiEnabled && !string.IsNullOrWhiteSpace(input.FileName)
            && (input.MatchMode == "fileNameOnly" || input.MatchMode == "hashAndFileName" && realHash))
        {
            var hash = input.MatchMode == "fileNameOnly" ? new string('0', 32) : input.FileHash!;
            var matchBody = JsonSerializer.SerializeToUtf8Bytes(new
            {
                fileName = input.FileName, fileHash = hash, fileSize = input.FileSize ?? 0,
                videoDuration = input.VideoDuration ?? 0,
                matchMode = input.MatchMode
            });
            try
            {
                Detail("upstream", $"发送匹配请求，模式={input.MatchMode}，使用真实哈希={realHash && input.MatchMode == "hashAndFileName"}");
                var match = await OnlineFetchAsync(source, config, userId, "/match", matchBody, token);
                works.AddRange(OnlineParseList(match, "matches", "animes"));
                using var matchDoc = JsonDocument.Parse(match);
                exactFound = matchDoc.RootElement.TryGetProperty("isMatched", out var isMatched)
                    && isMatched.ValueKind == JsonValueKind.True
                    && works.Any(w => w.EpisodeId is not null);
                Detail("upstream", $"匹配接口返回：精确命中={exactFound}，结果数={works.Count}，详情（最多100项）：{Candidates(works)}", works.Count);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (ApiAccessException error) when (error.Code == "UPSTREAM_MATCH_UNAVAILABLE")
            { Progress("search"); }
            catch (ApiAccessException error) when (error.Code == "UPSTREAM_BUSINESS_ERROR"
                && IsMatchParameterRejection(error))
            {
                // 仅参数校验失败降级标题搜索；鉴权、流控和其它业务错误保持原语义。
                Progress("match_fallback");
            }
        }
        // 每个编号方案先过滤明确的季集冲突，再提交规则/AI，不能让高标题相似度覆盖季号。
        bool CompatibleSeason(OnlineEpisode candidate)
        {
            if (input.MediaType != "episode" || target.SeasonNumber is null) return true;
            var season = OnlineCandidateSeason(candidate);
            return season is null || season == target.SeasonNumber;
        }
        bool CompatibleEpisode(OnlineEpisode candidate)
        {
            if (input.MediaType != "episode" || target.EpisodeNumber is null) return true;
            var number = candidate.EpisodeNumber ?? MatchMetadata.Parse(candidate.EpisodeTitle, true).Episode;
            return number is null || number == target.EpisodeNumber;
        }
        var matchEpisodes = works.Where(candidate => candidate.AnimeId is not null
            && candidate.EpisodeId is not null && Allowed(candidate) && CompatibleSeason(candidate)
            && CompatibleEpisode(candidate)).ToArray();
        // 上游精确命中唯一章节且映射未改变目标时直接采用，不再调用智能判断或作品搜索。
        if (rateLimited is null && exactFound && allowDirectEpisode
            && matchEpisodes.Length > 0 && matchEpisodes.Select(candidate => candidate.EpisodeId).Distinct().Count() == 1)
        {
            var exactEpisode = matchEpisodes[0];
            Detail("resolve", $"/match 精确命中，直接采用章节：{Candidates([exactEpisode])}");
            return new("matched", sourceId, source, exactEpisode, [exactEpisode], false, "upstream-exact");
        }
        if (rateLimited is null && matchEpisodes.Length > 0)
        {
            var candidates = matchEpisodes.Take(50).ToArray();
            Detail("resolve", $"优先判断 /match 章节候选：{Candidates(candidates)}", candidates.Length);
            var reply = await Resolve(new ResolveMatchRequest("online", target,
                candidates.Select((candidate, index) => new MatchCandidateInput(index.ToString(), sourceId,
                    candidate.AnimeId, candidate.EpisodeId, candidate.AnimeTitle, MediaType: input.MediaType,
                    SeasonNumber: OnlineCandidateSeason(candidate),
                    EpisodeNumber: candidate.EpisodeNumber ?? MatchMetadata.Parse(candidate.EpisodeTitle, true).Episode,
                    UpstreamFields: candidate.UpstreamFields)).ToArray(),
                20, CandidatesTruncated: matchEpisodes.Length > 50)
                { AiAuthorized = aiAuthorized, PreferReliableRules = true, TraceId = operationId ?? _matchTrace,
                    Progress = (stage, message) => Detail(stage, message) });
            if (!reply.Body.Success || reply.Body.Data is not { } resolution)
                throw new ApiAccessException(reply.StatusCode, "MATCH_FAILED", "后端匹配候选判断失败");
            if (resolution.Status == "matched" && int.TryParse(resolution.SelectedCandidateId, out var index)
                && index >= 0 && index < candidates.Length)
            {
                var selectedMatch = candidates[index];
                var number = selectedMatch.EpisodeNumber ?? MatchMetadata.Parse(selectedMatch.EpisodeTitle, true).Episode;
                if (input.MediaType == "movie" || number == target.EpisodeNumber
                    || allowDirectEpisode && exactFound && matchEpisodes.Select(candidate => candidate.EpisodeId).Distinct().Count() == 1)
                {
                    Detail("resolve", $"/match 章节已确认，模式={resolution.ModeUsed}：{Candidates([selectedMatch])}");
                    return new("matched", sourceId, source, selectedMatch, [selectedMatch], false, resolution.ModeUsed);
                }
            }
            Detail("match_fallback", $"/match 章节未能确认，状态={resolution.Status}，先复用作品候选");
        }
        if (rateLimited is null)
        {
            // 未确认章节不等于未确认作品：按作品ID折叠，但清除章节证据，必须再用详情核验目标集号。
            // 不补未知第一季，不按第一项确认；明确季冲突仍在进入判断前排除。
            var reusedWorks = works.Where(candidate => candidate.AnimeId is not null && Allowed(candidate)
                    && CompatibleSeason(candidate)).DistinctBy(candidate => candidate.AnimeId)
                .Select(candidate => candidate with { EpisodeId = null, EpisodeTitle = null, EpisodeNumber = null,
                    UpstreamFields = OnlineWorkFields(candidate.UpstreamFields) }).Take(51).ToArray();
            if (reusedWorks.Length > 0)
            {
                Detail("resolve", $"复用 /match 作品候选并核验详情：{Candidates(reusedWorks)}", reusedWorks.Length);
                var reused = await ResolveWorksAndEpisodes(reusedWorks.Take(50).ToArray(), reusedWorks.Length > 50, true);
                if (reused.Status == "matched") return reused;
                Detail("match_fallback", $"复用作品/详情未确认，状态={reused.Status}，继续标题搜索");
            }
            // 搜索分支独立判断，不混入未确认的 /match 章节及其候选序号。
            works.Clear();
            exactFound = false;
            Detail("search", $"开始标题搜索，关键词={searchTitle}");
            var search = await Fetch("/search/anime?keyword=" + Uri.EscapeDataString(ProxyKeyword(searchTitle)));
            works.AddRange(OnlineParseList(search, "animes"));
        }
        // /match 的模糊结果可能已经带有 episodeId；保留这些分集候选，不能先按作品 ID 折叠。
        var matchEpisodeWorks = works.Where(w => Allowed(w) && CompatibleSeason(w) && CompatibleEpisode(w) && w.EpisodeId is not null).ToArray();
        works = works.Where(w => w.AnimeId is not null && Allowed(w) && CompatibleSeason(w))
            .DistinctBy(w => w.AnimeId).Take(51).ToList();
        var resolutionWorks = matchEpisodeWorks.Length > 0 ? matchEpisodeWorks : works.ToArray();
        Detail("candidates", $"搜索及匹配结果：有效作品={works.Count}，带分集候选={matchEpisodeWorks.Length}，详情（最多100项）：{Candidates(resolutionWorks)}", resolutionWorks.Length);
        if (works.Count == 0)
        {
            if (rateLimited is not null) throw rateLimited;
            return new("unmatched", sourceId, source, null, [], true, "traditional");
        }
        var limited = works.Take(50).ToArray();
        var limitedResolutionWorks = resolutionWorks.Take(100).ToArray();
        if (rateLimited is not null && input.PreferredAnimeId is not null && input.PreferredEpisodeNumber is not null)
        {
            // 原详情被流控时，只复用 BGM 返回的同一作品；不能丢弃用户确认的集数偏移。
            Progress("resolve", limited.Length);
            var preferred = limited.SingleOrDefault(work => work.AnimeId == input.PreferredAnimeId);
            if (preferred is not null && bgmDetails is not null && bgmDetails.TryGetValue(preferred.AnimeId!, out var bytes))
            {
                var preferredEpisodes = OnlineParseEpisodes(bytes, preferred);
                var matches = preferredEpisodes.Where(ep => ep.EpisodeNumber == input.PreferredEpisodeNumber && Allowed(ep)).ToArray();
                if (matches.Length == 1 && preferredEpisodes.Count <= 100)
                    return new("matched", sourceId, source, matches[0], matches, false, "user-confirmed-work");
            }
            return new("ambiguous", sourceId, source, null, limited, true, "user-confirmed-work");
        }
        return await ResolveWorksAndEpisodes(limitedResolutionWorks, resolutionWorks.Length > 100, false);

        async Task<OnlineMatchResult> ResolveWorksAndEpisodes(OnlineEpisode[] workCandidates, bool truncated, bool strictReuse)
        {
            var directEpisodeIds = workCandidates.Where(w => Allowed(w) && w.EpisodeId is not null)
                .Select(w => w.EpisodeId).Distinct().Take(2).Count();
            Progress("resolve", workCandidates.Length);
            var workReply = await Resolve(new ResolveMatchRequest("online", target,
                workCandidates.Select((w, i) => new MatchCandidateInput(i.ToString(), sourceId, w.AnimeId,
                    Title: w.AnimeTitle, EpisodeId: w.EpisodeId, MediaType: input.MediaType,
                    SeasonNumber: MatchMetadata.Parse(w.AnimeTitle, true).Season
                        ?? (!strictReuse && input.MediaType == "episode" && input.SeasonNumber == 1 ? 1 : null),
                    EpisodeNumber: w.EpisodeNumber, UpstreamFields: w.UpstreamFields)).ToArray(), 20,
                CandidatesTruncated: truncated, SelectionScope: "work")
                { AiAuthorized = aiAuthorized, PreferReliableRules = true, TraceId = operationId ?? _matchTrace,
                        Progress = (stage, message) => Detail(stage, message) });
            if (!workReply.Body.Success || workReply.Body.Data is not { } workResolution)
                throw new ApiAccessException(workReply.StatusCode, "MATCH_FAILED", "后端作品判断失败");
            Detail("resolve", $"作品判断结果：状态={workResolution.Status}，模式={workResolution.ModeUsed}，选中序号={workResolution.SelectedCandidateId}");
            if (workResolution.Status != "matched")
                return OnlineUncertain(workResolution, workCandidates, sourceId, source);
            var work = workCandidates[int.Parse(workResolution.SelectedCandidateId!, System.Globalization.CultureInfo.InvariantCulture)];
            if (allowDirectEpisode && exactFound && directEpisodeIds == 1 && work.EpisodeId is not null)
                return new("matched", sourceId, source, work, [work], false, workResolution.ModeUsed);
            if (work.EpisodeId is not null && input.MediaType == "episode"
                && work.EpisodeNumber == input.EpisodeNumber && Allowed(work))
            {
                // 模糊 /match 结果已由智能判断选出目标章节，避免再次读取整部作品分集。
                Detail("resolve", $"/match 模糊结果已直接确认章节：作品={work.AnimeTitle}，作品ID={work.AnimeId}，章节={work.EpisodeTitle}，章节ID={work.EpisodeId}");
                return new("matched", sourceId, source, work, [work], false, workResolution.ModeUsed);
            }
            Progress("detail");
            var detail = bgmDetails is not null && bgmDetails.TryGetValue(work.AnimeId!, out var cached)
                ? cached : await Fetch("/bangumi/" + ProxyIdentifier(work.AnimeId));
            var upstreamEpisodes = NormalizeSeasonEpisodes(OnlineParseEpisodes(detail, work),
                normalizeSeasonEpisode && source == "official" && (MatchMetadata.Parse(work.AnimeTitle, true).Season ?? 1) > 1);
            Detail("detail", $"分集读取结果：作品={work.AnimeTitle}，作品ID={work.AnimeId}，分集数={upstreamEpisodes.Count}，详情（最多100项）：{Candidates(upstreamEpisodes)}", upstreamEpisodes.Count);
            var episodes = upstreamEpisodes.Where(episode => Allowed(episode) && CompatibleSeason(episode)).ToList();
            if (!strictReuse && upstreamEpisodes.Count == 0 && !string.IsNullOrEmpty(work.EpisodeId) && Allowed(work)) episodes.Add(work);
            if (episodes.Count == 0)
                return new("ambiguous", sourceId, source, null, [work], true, workResolution.ModeUsed);
            // 作品已确认后，按映射后的明确集号在完整详情内查找；不猜数组下标或连续 ID。
            if (input.MediaType == "episode" && target.EpisodeNumber is not null && upstreamEpisodes.Count <= 100)
            {
                var numbered = episodes.Where(episode => episode.EpisodeNumber == target.EpisodeNumber
                    && !string.IsNullOrEmpty(episode.EpisodeId)).ToArray();
                if (numbered.Length == 1)
                {
                    Detail("resolve", $"目标集号唯一命中：{Candidates(numbered)}");
                    return new("matched", sourceId, source, numbered[0], numbered, false, "episode-number");
                }
                Detail("resolve", $"目标集号={target.EpisodeNumber}，同号候选={numbered.Length}，继续分集判断");
            }
            var episodeCandidates = episodes.Take(100).ToArray();
            if (input.MediaType == "movie" && episodeCandidates.Length == 1 && episodes.Count == 1)
                return new("matched", sourceId, source, episodeCandidates[0], episodeCandidates, false, workResolution.ModeUsed);
            var episodeReply = await Resolve(new ResolveMatchRequest("online", target,
                episodeCandidates.Select((ep, i) => new MatchCandidateInput(i.ToString(), sourceId, work.AnimeId,
                    ep.EpisodeId, work.AnimeTitle, MediaType: input.MediaType,
                    SeasonNumber: MatchMetadata.Parse(work.AnimeTitle, true).Season
                        ?? (!strictReuse && input.SeasonNumber == 1 ? 1 : null),
                    EpisodeNumber: ep.EpisodeNumber, Year: null, UpstreamFields: ep.UpstreamFields)).ToArray(),
                20, CandidatesTruncated: episodes.Count > 100)
                { AiAuthorized = aiAuthorized, PreferReliableRules = true, TraceId = operationId ?? _matchTrace,
                        Progress = (stage, message) => Detail(stage, message) });
            if (!episodeReply.Body.Success || episodeReply.Body.Data is not { } episodeResolution)
                throw new ApiAccessException(episodeReply.StatusCode, "MATCH_FAILED", "后端分集判断失败");
            Detail("resolve", $"分集判断结果：状态={episodeResolution.Status}，模式={episodeResolution.ModeUsed}，选中序号={episodeResolution.SelectedCandidateId}");
            if (episodeResolution.Status != "matched") return OnlineUncertain(episodeResolution, episodeCandidates, sourceId, source);
            var selected = episodeCandidates[int.Parse(episodeResolution.SelectedCandidateId!, System.Globalization.CultureInfo.InvariantCulture)];
            return new("matched", sourceId, source, selected, [selected], false, episodeResolution.ModeUsed);
        }

    }

    private static OnlineMatchResult OnlineUncertain(ResolveMatchResponse result, OnlineEpisode[] candidates,
        string sourceId, string source) => new("ambiguous", sourceId, source, null,
        result.Candidates.Where(c => int.TryParse(c.CandidateId, out var i) && i >= 0 && i < candidates.Length)
            .Select(c => candidates[int.Parse(c.CandidateId)] with { Score = c.Score }).ToArray(), true, result.ModeUsed);

    private static Regex? OnlineBlacklist(string? pattern)
    {
        if (string.IsNullOrEmpty(pattern)) return null;
        try { return new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant,
            TimeSpan.FromMilliseconds(50)); }
        catch (ArgumentException) { return null; }
    }

    private static List<OnlineEpisode> OnlineParseList(byte[] body, params string[] keys)
    {
        using var doc = JsonDocument.Parse(body, new JsonDocumentOptions { MaxDepth = 16 });
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.TryGetProperty("success", out var ok)
            && ok.ValueKind == JsonValueKind.False) throw new ApiAccessException(502, "UPSTREAM_PROTOCOL_MISMATCH", "上游匹配响应无效");
        JsonElement array = default;
        foreach (var key in keys)
            if (root.TryGetProperty(key, out array) && array.ValueKind == JsonValueKind.Array) break;
        if (array.ValueKind != JsonValueKind.Array)
            throw new ApiAccessException(502, "UPSTREAM_PROTOCOL_MISMATCH", "上游候选响应无效");
        var result = new List<OnlineEpisode>();
        foreach (var entry in array.EnumerateArray().Take(51))
        {
            if (entry.ValueKind != JsonValueKind.Object) continue;
            var id = OnlineString(entry, "bangumiId") ?? OnlineString(entry, "animeId");
            if (id is null || !OnlineId(id)) continue;
            var episode = OnlineString(entry, "episodeId") ?? OnlineString(entry, "matchedEpisodeId");
            result.Add(new(id, OnlineString(entry, "animeTitle"), episode is not null && OnlineId(episode) ? episode : null,
                OnlineString(entry, "episodeTitle") ?? OnlineString(entry, "matchedEpisodeTitle"),
                OnlineNumber(entry, "episodeNumber") ?? MatchMetadata.Parse(OnlineString(entry, "episodeTitle")
                    ?? OnlineString(entry, "matchedEpisodeTitle"), true).Episode, OnlineString(entry, "imageUrl"), UpstreamFields: OnlineRawFields(entry)));
        }
        return result;
    }

    private static List<OnlineEpisode> OnlineParseEpisodes(byte[] body, OnlineEpisode work)
    {
        using var doc = JsonDocument.Parse(body, new JsonDocumentOptions { MaxDepth = 16 });
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object || root.TryGetProperty("success", out var ok)
            && ok.ValueKind == JsonValueKind.False) throw new ApiAccessException(502, "UPSTREAM_PROTOCOL_MISMATCH", "作品详情无效");
        if (root.TryGetProperty("bangumi", out var bangumi) && bangumi.ValueKind == JsonValueKind.Object) root = bangumi;
        var result = new List<OnlineEpisode>();
        if (!root.TryGetProperty("episodes", out var array) || array.ValueKind != JsonValueKind.Array) return result;
        foreach (var ep in array.EnumerateArray().Take(101))
        {
            if (ep.ValueKind != JsonValueKind.Object) continue;
            var id = OnlineString(ep, "episodeId");
            if (id is null || !OnlineId(id)) continue;
            var title = OnlineString(ep, "episodeTitle");
            result.Add(new(work.AnimeId, work.AnimeTitle, id, title,
                OnlineNumber(ep, "episodeNumber") ?? MatchMetadata.Parse(title, true).Episode, work.ImageUrl,
                UpstreamFields: OnlineRawFields(ep)));
        }
        return result;
    }

    private static JsonElement? OnlineWorkFields(JsonElement? fields)
    {
        if (fields is not { ValueKind: JsonValueKind.Object } entry) return null;
        // 作品级复用不把未确认章节的集号/偏移证据带入AI；保留原始作品白名单字段。
        var result = new Dictionary<string, JsonElement>();
        foreach (var name in new[] { "animeId", "bangumiId", "animeTitle", "type", "typeDescription", "imageUrl" })
            if (entry.TryGetProperty(name, out var value)) result[name] = value.Clone();
        return JsonSerializer.SerializeToElement(result);
    }

    private static JsonElement OnlineRawFields(JsonElement entry)
    {
        // 保留上游字段名与数值类型，未知字段及潜在凭据不进入模型输入。
        var fields = new Dictionary<string, JsonElement>();
        foreach (var name in new[] { "animeId", "bangumiId", "animeTitle", "episodeId", "matchedEpisodeId",
            "episodeTitle", "matchedEpisodeTitle", "episodeNumber", "type", "typeDescription", "shift", "imageUrl" })
            if (entry.TryGetProperty(name, out var value) && value.ValueKind is JsonValueKind.String or JsonValueKind.Number or JsonValueKind.Null)
                fields[name] = value.Clone();
        return JsonSerializer.SerializeToElement(fields);
    }

    private static string? OnlineString(JsonElement element, string key)
    {
        if (!element.TryGetProperty(key, out var value) || value.ValueKind is not (JsonValueKind.String or JsonValueKind.Number)) return null;
        var text = value.ToString();
        return text.Length is > 0 and <= 256 && !text.Any(char.IsControl) ? text : null;
    }
    private static int? OnlineNumber(JsonElement element, string key)
    {
        if (!element.TryGetProperty(key, out var value)) return null;
        return int.TryParse(value.ToString(), out var number) && number is >= 0 and <= 99999 ? number : null;
    }
    private static bool IsMatchParameterRejection(ApiAccessException error)
    {
        if (error.UpstreamReply is not { StatusCode: 200 } reply) return false;
        using var json = JsonDocument.Parse(reply.Body);
        return json.RootElement.TryGetProperty("errorCode", out var code)
            && code.ValueKind == JsonValueKind.Number && code.TryGetInt32(out var value) && value == 2;
    }

    internal static int? OnlineCandidateSeason(OnlineEpisode candidate) => MatchMetadata.Parse(candidate.AnimeTitle, true).Season;

    private static IReadOnlyList<OnlineEpisode> NormalizeSeasonEpisodes(IReadOnlyList<OnlineEpisode> episodes, bool enabled)
    {
        if (!enabled || episodes.Count == 0 || episodes.Count > 100) return episodes;
        var numbers = episodes.Where(episode => episode.EpisodeNumber is > 0)
            .Select(episode => episode.EpisodeNumber!.Value).ToArray();
        if (numbers.Length == 0 || numbers.Distinct().Count() != numbers.Length) return episodes;
        var first = numbers.Min();
        if (first <= 1) return episodes;
        return episodes.Select(episode => episode.EpisodeNumber is > 0
            ? episode with { EpisodeNumber = episode.EpisodeNumber.Value - first + 1 } : episode).ToArray();
    }

    private static bool OnlineId(string value) => value.Length <= 160
        && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    private static async Task<byte[]> OnlineFetchAsync(string source, PluginConfiguration config,
        Guid userId, string suffix, byte[]? body, CancellationToken token)
    {
        DanmakuProxyTransport.Reply reply;
        if (source == "custom") reply = await SendCustomProxy(config, suffix, token, body);
        else
        {
            var settings = OfficialSettings.Value;
            var path = "/api/v2" + suffix.Split('?')[0];
            var signer = new OfficialRequestSigner(settings.Secret, settings.BrandMark, settings.ObfuscationKey);
            var headers = new Dictionary<string, string>(signer.CreateHeaders(userId, path))
            { ["X-User-Agent"] = settings.UserAgent };
            reply = await DanmakuProxyTransport.SendAsync(new Uri(settings.RelayPrefix
                + "https://api.dandanplay.net/api/v2" + suffix), body is null ? HttpMethod.Get : HttpMethod.Post,
                headers, body, token);
        }
        if (reply.StatusCode is 404 or 405 or 501 && suffix == "/match")
            throw new ApiAccessException(502, "UPSTREAM_MATCH_UNAVAILABLE", "上游未提供可选匹配接口");
        if (reply.StatusCode is < 200 or >= 300)
            throw new ApiAccessException(502, "UPSTREAM_MATCH_FAILED", "上游匹配请求失败");
        return reply.Body;
    }
}
