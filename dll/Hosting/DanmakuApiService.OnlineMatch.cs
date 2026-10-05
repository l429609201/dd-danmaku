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
    string? EpisodeTitle, int? EpisodeNumber = null, string? ImageUrl = null, decimal? Score = null);

internal sealed record OnlineMatchResult(string Status, string? SourceId, string? SourceType,
    OnlineEpisode? Selected, IReadOnlyList<OnlineEpisode> Candidates, bool RequiresConfirmation, string ModeUsed);

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
            var matched = await MatchOnlineSourceAsync(input, target, source, sourceId, user.Id,
                plugin.Configuration, host, token, operationId);
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
        finally
        {
            if (operationId is not null) OperationEventHub.Complete(user.Id, operationId, completion,
                completion == "failed" ? "UPSTREAM_ERROR" : null);
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
        EmbyHostServices host, CancellationToken token, string? operationId)
    {
        void Progress(string stage, int? count = null)
        {
            if (operationId is not null) OperationEventHub.Publish(userId, operationId, stage, count);
        }
        var searchTitle = input.SeasonNumber is > 1 ? $"{input.Title} 第{input.SeasonNumber}季" : input.Title;
        var applyBlacklist = source == "official" || input.ApplyCustomBlacklist;
        var animeFilter = applyBlacklist ? OnlineBlacklist(input.AnimeBlacklist) : null;
        var episodeFilter = applyBlacklist ? OnlineBlacklist(input.EpisodeBlacklist) : null;
        bool Allowed(OnlineEpisode candidate) =>
            (animeFilter is null || !animeFilter.IsMatch(candidate.AnimeTitle ?? ""))
            && (episodeFilter is null || !episodeFilter.IsMatch(candidate.EpisodeTitle ?? ""));
        if (input.PreferredAnimeId is not null && input.PreferredEpisodeNumber is not null)
        {
            Progress("detail");
            var preferredDetail = await OnlineFetchAsync(source, config, userId,
                "/bangumi/" + ProxyIdentifier(input.PreferredAnimeId), null, token);
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
        if (input.MatchApiEnabled && !string.IsNullOrWhiteSpace(input.FileName))
        {
            // An unavailable hash downgrades to filename-only. Never send a placeholder hash.
            var hash = input.MatchMode == "hashAndFileName" ? input.FileHash : null;
            var matchBody = JsonSerializer.SerializeToUtf8Bytes(new
            {
                fileName = input.FileName, fileHash = hash ?? "", fileSize = input.FileSize ?? 0,
                videoDuration = input.VideoDuration ?? 0,
                matchMode = hash is null ? "fileNameOnly" : "hashAndFileName"
            });
            try
            {
                Progress("upstream");
                var match = await OnlineFetchAsync(source, config, userId, "/match", matchBody, token);
                works.AddRange(OnlineParseList(match, "matches", "animes"));
                using var matchDoc = JsonDocument.Parse(match);
                exactFound = matchDoc.RootElement.TryGetProperty("isMatched", out var isMatched)
                    && isMatched.ValueKind == JsonValueKind.True
                    && works.Any(w => w.EpisodeId is not null);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (ApiAccessException error) when (error.Code == "UPSTREAM_MATCH_UNAVAILABLE")
            { /* Optional /match is absent; title search remains available. */ }
        }
        if (!exactFound)
        {
            Progress("search");
            var search = await OnlineFetchAsync(source, config, userId,
                "/search/anime?keyword=" + Uri.EscapeDataString(ProxyKeyword(searchTitle)), null, token);
            works.AddRange(OnlineParseList(search, "animes"));
        }
        var directEpisodeIds = works.Where(w => Allowed(w) && w.EpisodeId is not null)
            .Select(w => w.EpisodeId).Distinct().Take(2).Count();
        works = works.Where(w => w.AnimeId is not null && Allowed(w))
            .DistinctBy(w => w.AnimeId).Take(51).ToList();
        Progress("candidates", works.Count);
        if (works.Count == 0) return new("unmatched", sourceId, source, null, [], true, "traditional");
        var limited = works.Take(50).ToArray();
        Progress("resolve", limited.Length);
        var workReply = await host.Matches.ResolveAsync(new ResolveMatchRequest("online", target,
            limited.Select((w, i) => new MatchCandidateInput(i.ToString(), sourceId, w.AnimeId,
                Title: w.AnimeTitle, MediaType: input.MediaType,
                SeasonNumber: MatchMetadata.Parse(w.AnimeTitle, true).Season
                    ?? (input.MediaType == "episode" && input.SeasonNumber == 1 ? 1 : null))).ToArray(), 20,
            CandidatesTruncated: works.Count > 50, SelectionScope: "work")
            { AiAuthorized = false, TraceId = _matchTrace }, token);
        if (!workReply.Body.Success || workReply.Body.Data is not { } workResolution)
            throw new ApiAccessException(workReply.StatusCode, "MATCH_FAILED", "后端作品判断失败");
        if (workResolution.Status != "matched")
            return OnlineUncertain(workResolution, limited, sourceId, source);
        var work = limited[int.Parse(workResolution.SelectedCandidateId!, System.Globalization.CultureInfo.InvariantCulture)];
        if (exactFound && directEpisodeIds == 1 && work.EpisodeId is not null)
            return new("matched", sourceId, source, work, [work], false, workResolution.ModeUsed);
        Progress("detail");
        var detail = await OnlineFetchAsync(source, config, userId, "/bangumi/" + ProxyIdentifier(work.AnimeId), null, token);
        var upstreamEpisodes = OnlineParseEpisodes(detail, work);
        var episodes = upstreamEpisodes.Where(Allowed).ToList();
        if (upstreamEpisodes.Count == 0 && !string.IsNullOrEmpty(work.EpisodeId) && Allowed(work)) episodes.Add(work);
        if (episodes.Count == 0)
            return new("ambiguous", sourceId, source, null, [work], true, workResolution.ModeUsed);
        var episodeCandidates = episodes.Take(100).ToArray();
        if (input.MediaType == "movie" && episodeCandidates.Length == 1 && episodes.Count == 1)
            return new("matched", sourceId, source, episodeCandidates[0], episodeCandidates, false, workResolution.ModeUsed);
        var episodeReply = await host.Matches.ResolveAsync(new ResolveMatchRequest("online", target,
            episodeCandidates.Select((ep, i) => new MatchCandidateInput(i.ToString(), sourceId, work.AnimeId,
                ep.EpisodeId, work.AnimeTitle, MediaType: input.MediaType,
                SeasonNumber: MatchMetadata.Parse(work.AnimeTitle, true).Season
                    ?? (input.SeasonNumber == 1 ? 1 : null),
                EpisodeNumber: ep.EpisodeNumber, Year: null)).ToArray(),
            20, CandidatesTruncated: episodes.Count > 100)
            { AiAuthorized = false, TraceId = _matchTrace }, token);
        if (!episodeReply.Body.Success || episodeReply.Body.Data is not { } episodeResolution)
            throw new ApiAccessException(episodeReply.StatusCode, "MATCH_FAILED", "后端分集判断失败");
        if (episodeResolution.Status != "matched") return OnlineUncertain(episodeResolution, episodeCandidates, sourceId, source);
        var selected = episodeCandidates[int.Parse(episodeResolution.SelectedCandidateId!, System.Globalization.CultureInfo.InvariantCulture)];
        return new("matched", sourceId, source, selected, [selected], false, episodeResolution.ModeUsed);
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
                OnlineNumber(entry, "episodeNumber"), OnlineString(entry, "imageUrl")));
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
                OnlineNumber(ep, "episodeNumber") ?? MatchMetadata.Parse(title, true).Episode, work.ImageUrl));
        }
        return result;
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
