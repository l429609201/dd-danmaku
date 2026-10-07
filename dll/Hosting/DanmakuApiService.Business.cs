namespace DD.Danmaku.Hosting;

using System.Security.Cryptography;
using System.Text.Json;
using DD.Danmaku.Danmaku;
using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Model.Services;

/// <summary>提交整个后端自动匹配流程。</summary>
[Route("/dd-danmaku/api/business/match", "POST")]
public sealed class BackendMatchStartRequest : IRequiresRequestStream
{
    /// <summary>仅包含媒体和已注册来源标识的 JSON 正文。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>提交后端手动作品搜索。</summary>
[Route("/dd-danmaku/api/business/search", "POST")]
public sealed class BackendSearchStartRequest : IRequiresRequestStream
{
    /// <summary>有界的搜索 JSON 正文。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>提交已注册来源的作品分集读取。</summary>
[Route("/dd-danmaku/api/business/episodes", "POST")]
public sealed class BackendEpisodesStartRequest : IRequiresRequestStream
{
    /// <summary>有界的作品 JSON 正文。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
internal sealed record BackendMatchStartInput(string ItemId, string? MediaSourceId = null,
    string? PreferredSourceId = null, string? PreferredAnimeId = null, int? PreferredEpisodeNumber = null);
internal sealed record BackendSearchStartInput(string ItemId, string Keyword, string? SourceId = null);
internal sealed record BackendEpisodesStartInput(string ItemId, string SourceId, string AnimeId);
internal sealed record BackendSearchResult(string SourceId, string SourceName, string Status,
    IReadOnlyList<OnlineEpisode> Works, string? ErrorCode = null);
internal sealed record BackendBusinessSource(string Id, string Name, string Kind, string XmlSource, PluginConfiguration Configuration);

public sealed partial class DanmakuApiService
{
    private static readonly BackendEpisodeMetadata BusinessMetadata = new();

    /// <summary>服务器读取本人配置、实际媒体、映射和哈希，再按来源优先级完成匹配。</summary>
    public Task<object> Post(BackendMatchStartRequest request) => Execute(async (user, plugin, host) =>
    {
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 16 * 1024, "application/json");
        var input = ApiHttpResult.Parse<BackendMatchStartInput>(body);
        var item = _access.RequireVideo(user, input.ItemId);
        if (input.MediaSourceId is { Length: > 256 } || input.MediaSourceId?.Any(char.IsControl) == true)
            throw new ArgumentException("媒体源标识无效");
        if (input.PreferredAnimeId is not null || input.PreferredSourceId is not null || input.PreferredEpisodeNumber is not null)
        {
            if (input.PreferredSourceId is null || input.PreferredAnimeId is null || !OnlineId(input.PreferredAnimeId)
                || input.PreferredEpisodeNumber is null or < 0 or > 99999) throw new ArgumentException("已确认作品信息不完整");
        }
        var defaults = await BackendDefaultsAsync(plugin, user.Id, Request.CancellationToken);
        var configuration = plugin.Configuration.CopyForUpdate();
        var sources = BusinessSources(defaults, configuration, user.Id);
        if (input.PreferredSourceId is not null && !sources.Any(source => source.Id == input.PreferredSourceId))
            throw new ApiAccessException(404, "SOURCE_NOT_FOUND", "已确认来源已不可用");
        var revision = BusinessRevision(defaults, configuration);
        var fingerprint = revision + "/" + Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(input)));
        var task = host.BackendTasks.Start(user.Id, item, "match", fingerprint, async context =>
        {
            // 进入每个宿主调用前发布阶段，授权或元数据读取失败也能精确定位。
            context.Progress("authorize");
            var current = await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
            context.Progress("metadata");
            var media = BackendMediaMetadataReader.Read(_access.RequireVideoItem(current, item));
            context.Progress("mapping");
            var original = new MetadataMappingResult("original", media.Mapping.Season, media.Mapping.Episode,
                media.Mapping.Season, media.Mapping.Episode, "original");
            var manual = BackendMediaMetadataReader.ManualMapping(media, defaults.EpisodeOffsetRules);
            MetadataMappingResult? tmdb = null;
            // 剧集组是惰性后备；原始季集命中时不解析 TMDB 配置，也不请求剧集组。
            async Task<MetadataMappingResult> LoadMappingAsync()
            {
                current = await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
                context.Progress("mapping");
                return tmdb ??= await BusinessMetadata.MapAsync(media.Mapping,
                    MetadataOptions.FromDefaults(defaults, user.Id, revision, configuration), context.Token,
                    async () => { current = await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token); });
            }
            var hash = new BackendVideoHashResult("filenamefallback", null, null, "hash_disabled");
            if (defaults.MatchMode == "hashAndFileName")
            {
                current = await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
                context.Progress("hash");
                // 指定其它版本时，不能误用主版本的本地文件哈希。
                var trustedItem = _access.RequireVideoItem(current, item);
                var nativeSources = BackendMediaSources.Read(_mediaSources, trustedItem, current);
                var chosen = input.MediaSourceId is null ? nativeSources : nativeSources.Where(source => source.Id == input.MediaSourceId).ToList();
                var primary = chosen.Count == 1 && string.Equals(chosen[0].Path, trustedItem.Path, StringComparison.Ordinal);
                if (primary) hash = await BackendVideoHash.GetAsync(_access, current, item, host.PlaybackFiles, context.Token);
                if (hash.Hash is null) hash = await BackendRemoteVideoHash.GetAsync(_access, current, item, _mediaSources,
                    configuration, context.Token, input.MediaSourceId);
            }
            var attempts = new List<object>();
            ApiAccessException? failure = null;
            (OnlineMatchResult Result, MetadataMappingResult Mapping, BackendBusinessSource Source)? ambiguous = null;
            foreach (var source in sources)
            {
                current = await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
                context.Detail("source", $"开始来源：{source.Name}，来源ID={source.Id}，类型={source.Kind}");
                try
                {
                    var outcome = await BusinessTryMappingsAsync(original, manual, LoadMappingAsync,
                        async () => { current = await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token); },
                        async mapping =>
                        {
                            var target = media.Target with { SeasonNumber = mapping.Season, EpisodeNumber = mapping.Episode };
                            var matchInput = new OnlineMatchInput(item, target.Title!, target.FileName, target.MediaType,
                                target.SeasonNumber, target.EpisodeNumber, target.Year, MatchMode: defaults.MatchMode ?? "fileNameOnly",
                                FileHash: hash.Hash, FileSize: hash.FileSize, VideoDuration: media.Duration,
                                MatchApiEnabled: defaults.MatchApiEnable ?? true, AnimeBlacklist: defaults.AnimeTitleBlacklist,
                                EpisodeBlacklist: defaults.EpisodeTitleBlacklist, ApplyCustomBlacklist: defaults.BlacklistApplyToCustomApi ?? false,
                                PreferredAnimeId: input.PreferredSourceId == source.Id ? input.PreferredAnimeId : null,
                                PreferredEpisodeNumber: input.PreferredSourceId == source.Id ? input.PreferredEpisodeNumber : null);
                            if (source.Kind == "official" && !OnlineOfficialConfigured())
                                throw new ApiAccessException(503, "OFFICIAL_PROXY_UNAVAILABLE", "此 DLL 构建未配置官方中转签名");
                            context.Detail("mapping", $"尝试季集：模式={mapping.Mode}，方向={mapping.Direction}，季={mapping.Season}，集={mapping.Episode}");
                            OnlineMatchResult result;
                            var stop = false;
                            try
                            {
                                result = await MatchOnlineSourceAsync(matchInput, target, source.Kind, source.XmlSource, user.Id,
                                    source.Configuration, host, context.Token, context.Id,
                                    aiAuthorized: EmbyAccessControl.CanUseAi(current, source.Configuration), allowDirectEpisode: true,
                                    taskProgress: context.Progress, taskDetail: context.Detail, normalizeSeasonEpisode: defaults.NormalizeSeasonEpisode ?? true);
                            }
                            catch (ApiAccessException error) when (source.Kind == "official" && error.Code == "UPSTREAM_RATE_LIMITED")
                            {
                                // 同一来源发生流控后只降级一次，禁止下轮映射重新撞 match 接口。
                                stop = true;
                                current = await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
                                context.Progress("bgm_fallback");
                                result = await MatchOnlineSourceAsync(matchInput, target, source.Kind, source.XmlSource, user.Id,
                                    source.Configuration, host, context.Token, context.Id, error,
                                    aiAuthorized: EmbyAccessControl.CanUseAi(current, source.Configuration), allowDirectEpisode: true,
                                    taskProgress: context.Progress, taskDetail: context.Detail, normalizeSeasonEpisode: defaults.NormalizeSeasonEpisode ?? true);
                            }
                            // 即使后备上游失败，也保留之前已经过滤过的歧义，且不改变下载来源证明。
                            if (result.Status == "ambiguous" && (ambiguous is null
                                || BusinessMoreUsefulAmbiguity(result, ambiguous.Value.Result)))
                                ambiguous = (result, mapping, source);
                            attempts.Add(new { SourceId = source.Id, result.Status, Mapping = mapping });
                            return (result, stop);
                        });
                    context.Detail("resolve", "来源匹配结果：\n" + JsonSerializer.Serialize(new { source.Id, source.Name, Result = outcome.Result },
                        new JsonSerializerOptions(MatchJson.Options) { WriteIndented = true,
                            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
                    if (outcome.Result.Status != "matched") continue;
                    await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
                    return BusinessReply(new { ItemId = item, SourceId = source.Id, SourceName = source.Name,
                        Match = outcome.Result, Mapping = outcome.Mapping, HashMode = hash.Mode, HashReason = hash.Reason, Attempts = attempts });
                }
                catch (ApiAccessException error)
                {
                    // 授权或配置失效不能被当作某个来源失败后继续执行。
                    if (error.Code is "AUTH_REQUIRED" or "UPSTREAM_CHANGED" or "ITEM_NOT_FOUND" or "ITEM_ACCESS_DENIED") throw;
                    failure = error;
                    attempts.Add(new { SourceId = source.Id, Status = "failed", ErrorCode = error.Code });
                }
            }
            await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
            if (ambiguous is { } uncertain)
                return BusinessReply(new { ItemId = item, SourceId = uncertain.Source.Id, SourceName = uncertain.Source.Name,
                    Match = uncertain.Result, Mapping = uncertain.Mapping, HashMode = hash.Mode, HashReason = hash.Reason, Attempts = attempts });
            if (failure is not null) throw failure;
            return BusinessReply(new { ItemId = item, Match = new OnlineMatchResult("unmatched", null, null, null, [], true, "traditional"),
                Mapping = original, HashMode = hash.Mode, HashReason = hash.Reason, Attempts = attempts });
        }, authorizeResult: async token => { await BusinessAuthorizeAsync(user.Id, item, revision, plugin, token); });
        return ApiHttpResult.Success(task);
    });

    /// <summary>后台按配置编排作品搜索，返回各来源结果及失败状态。</summary>
    public Task<object> Post(BackendSearchStartRequest request) => Execute(async (user, plugin, host) =>
    {
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 16 * 1024, "application/json");
        var input = ApiHttpResult.Parse<BackendSearchStartInput>(body);
        var item = _access.RequireVideo(user, input.ItemId);
        var keyword = ProxyKeyword(input.Keyword);
        var defaults = await BackendDefaultsAsync(plugin, user.Id, Request.CancellationToken);
        var configuration = plugin.Configuration.CopyForUpdate();
        var sources = BusinessSources(defaults, configuration, user.Id);
        if (input.SourceId is not null) sources = [BusinessSource(sources, input.SourceId)];
        var revision = BusinessRevision(defaults, configuration);
        var key = revision + "/" + Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(input)));
        var task = host.BackendTasks.Start(user.Id, item, "search", key, async context =>
        {
            var results = new List<BackendSearchResult>();
            ApiAccessException? lastFailure = null;
            foreach (var source in sources)
            {
                await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
                context.Detail("search", $"来源={source.Name}，搜索关键词={keyword}");
                try
                {
                    IReadOnlyList<OnlineEpisode> works;
                    try
                    {
                        var bytes = await OnlineFetchAsync(source.Kind, source.Configuration, user.Id,
                            "/search/anime?keyword=" + Uri.EscapeDataString(keyword), null, context.Token);
                        works = OnlineParseList(bytes, "animes").Take(100).ToArray();
                    }
                    catch (ApiAccessException error) when (source.Kind == "official" && error.Code == "UPSTREAM_RATE_LIMITED")
                    {
                        context.Progress("bgm_fallback");
                        var fallback = await OnlineBgmSearchAsync(keyword, user.Id, source.Configuration, context.Token, context.Progress);
                        works = fallback.Works.Take(100).ToArray();
                    }
                    context.Detail("candidates", $"来源={source.Name}，搜索结果数={works.Count}，作品（最多10项）："
                        + string.Join("；", works.Take(10).Select(work => $"{work.AnimeTitle}，作品ID={work.AnimeId}")), works.Count);
                    results.Add(new(source.Id, source.Name, "succeeded", works));
                }
                catch (ApiAccessException error)
                {
                    lastFailure = error;
                    results.Add(new(source.Id, source.Name, "failed", [], error.Code));
                }
            }
            if (results.Count > 0 && results.All(result => result.Status == "failed")
                && lastFailure is not null) throw lastFailure;
            await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
            return BusinessReply(new { ItemId = item, Results = results });
        }, authorizeResult: async token => { await BusinessAuthorizeAsync(user.Id, item, revision, plugin, token); });
        return ApiHttpResult.Success(task);
    });

    /// <summary>来源详情和分集读取绑定本人媒体及已注册来源，不接收 URL。</summary>
    public Task<object> Post(BackendEpisodesStartRequest request) => Execute(async (user, plugin, host) =>
    {
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 16 * 1024, "application/json");
        var input = ApiHttpResult.Parse<BackendEpisodesStartInput>(body);
        var item = _access.RequireVideo(user, input.ItemId);
        var anime = ProxyIdentifier(input.AnimeId);
        var defaults = await BackendDefaultsAsync(plugin, user.Id, Request.CancellationToken);
        var configuration = plugin.Configuration.CopyForUpdate();
        var source = BusinessSource(BusinessSources(defaults, configuration, user.Id), input.SourceId);
        var revision = BusinessRevision(defaults, configuration);
        var task = host.BackendTasks.Start(user.Id, item, "search", revision + "/" + source.Id + "/" + anime, async context =>
        {
            await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
            context.Progress("detail");
            var bytes = await OnlineFetchAsync(source.Kind, source.Configuration, user.Id, "/bangumi/" + anime, null, context.Token);
            using var document = JsonDocument.Parse(bytes);
            var root = document.RootElement.TryGetProperty("bangumi", out var nested) ? nested : document.RootElement;
            var title = OnlineString(root, "animeTitle") ?? OnlineString(root, "title") ?? "";
            var episodes = OnlineParseEpisodes(bytes, new OnlineEpisode(anime, title, null, null));
            await BusinessAuthorizeAsync(user.Id, item, revision, plugin, context.Token);
            return BusinessReply(new { ItemId = item, SourceId = source.Id, SourceName = source.Name, AnimeId = anime, Episodes = episodes });
        }, authorizeResult: async token => { await BusinessAuthorizeAsync(user.Id, item, revision, plugin, token); });
        return ApiHttpResult.Success(task);
    });

    // 仅编排已过滤的结果，不在这里推断作品或下载来源。
    internal static async Task<(OnlineMatchResult Result, MetadataMappingResult Mapping)> BusinessTryMappingsAsync(
        MetadataMappingResult original, MetadataMappingResult? manual,
        Func<Task<MetadataMappingResult>> loadMapping, Func<Task> authorize,
        Func<MetadataMappingResult, Task<(OnlineMatchResult Result, bool Stop)>> match)
    {
        var seen = new HashSet<(int?, int?)>();
        (OnlineMatchResult Result, MetadataMappingResult Mapping)? best = null;
        async Task<bool> TryAsync(MetadataMappingResult mapping)
        {
            if (!seen.Add((mapping.Season, mapping.Episode))) return false;
            await authorize();
            var attempt = await match(mapping);
            await authorize();
            if (best is null || attempt.Result.Status == "matched"
                || attempt.Result.Status == "ambiguous" && BusinessMoreUsefulAmbiguity(attempt.Result, best.Value.Result))
                best = (attempt.Result, mapping);
            return attempt.Result.Status == "matched" || attempt.Stop;
        }
        // 手工规则代表用户明确偏移，优先执行；失败仍保留原始季集后备。
        if (manual is not null && await TryAsync(manual with { Direction = "manual" })) return best!.Value;
        if (await TryAsync(original)) return best!.Value;
        // 电影保持 null 季集，绝不构造 S00E00；无有效剧集号时也不访问 TMDB。
        if (original.Episode is null) return best!.Value;
        await authorize();
        var mapped = await loadMapping();
        await authorize();
        foreach (var candidate in mapped.Candidates ?? [])
        {
            if (candidate.Season is < 0 or > 999 || candidate.Episode is < 0 or > 99999) continue;
            var used = mapped with { Season = candidate.Season, Episode = candidate.Episode,
                Direction = candidate.Direction, Candidates = [candidate] };
            if (await TryAsync(used)) break;
        }
        return best!.Value;
    }
    private static bool BusinessMoreUsefulAmbiguity(OnlineMatchResult candidate, OnlineMatchResult current) =>
        current.Status != "ambiguous"
        || candidate.Candidates.Count > 0 && (current.Candidates.Count == 0 || candidate.Candidates.Count < current.Candidates.Count);

    private static IReadOnlyList<BackendBusinessSource> BusinessSources(FrontendDefaults defaults, PluginConfiguration configuration, Guid owner)
    {
        var registered = BackendSources(defaults, configuration, owner);
        var result = new List<BackendBusinessSource>();
        foreach (var key in BackendSourcePriority(defaults, registered))
        {
            if (key == "official") result.Add(new(key, "弹弹play", "official", DanmakuXmlMetadata.OfficialSource, configuration));
            else
            {
                var source = registered.Single(candidate => candidate.Id == key);
                var projection = source.Configuration(configuration);
                result.Add(new(source.Id, source.Name, "custom", projection.DanmakuProxySourceId, projection));
            }
        }
        return result;
    }
    private static BackendBusinessSource BusinessSource(IReadOnlyList<BackendBusinessSource> sources, string id) =>
        sources.SingleOrDefault(source => source.Id == id) ?? throw new ApiAccessException(404, "SOURCE_NOT_FOUND", "来源不存在或已停用");
    private static string BusinessRevision(FrontendDefaults defaults, PluginConfiguration configuration) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            defaults.UseOfficialApi, defaults.UseCustomApi, defaults.CustomApiList, defaults.CustomApiPrefix, defaults.ApiPriority,
            defaults.MatchMode, defaults.MatchApiEnable, defaults.AppendSeasonEpisode, defaults.NormalizeSeasonEpisode, defaults.AnimeTitleBlacklist,
            defaults.EpisodeTitleBlacklist, defaults.BlacklistApplyToCustomApi, defaults.EpisodeOffsetRules,
            defaults.TmdbApiKey, defaults.TmdbApiBaseUrl, defaults.TmdbEpisodeMappingEnable,
            configuration.DanmakuProxyEnabled, configuration.DanmakuProxySourceId, configuration.DanmakuProxyBaseUrl,
            configuration.DanmakuProxyAppId, configuration.DanmakuProxyAppSecret, configuration.DanmakuProxyServerType,
            configuration.BackendPrivateSourcePrefixes, configuration.AiEnabled, configuration.AiUserAccessEnabled,
            configuration.AiAllowedUserIds, configuration.AiBaseUrl, configuration.AiModel, configuration.AiApiKey,
            configuration.LocalAiBaseUrl, configuration.RemoteAiBaseUrl, configuration.RemoteAiApiKey
        }))).ToLowerInvariant();
    private async Task<User> BusinessAuthorizeAsync(Guid owner, string item, string revision, Plugin plugin, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var current = _users.GetUserById(owner);
        if (current is null || current.Policy is null || current.Policy.IsDisabled || current.IsLockedOut)
            throw new ApiAccessException(401, "AUTH_REQUIRED", "原任务用户已无法执行业务请求");
        _access.RequireVideo(current, item);
        if (BusinessRevision(await BackendDefaultsAsync(plugin, owner, token), plugin.Configuration) != revision)
            throw new ApiAccessException(409, "UPSTREAM_CHANGED", "任务来源或映射配置已变更");
        return current;
    }
    private static BackendTaskReply BusinessReply<T>(T data) => new(200,
        JsonSerializer.SerializeToUtf8Bytes(new { Success = true, Data = data }, MatchJson.Options));
}
