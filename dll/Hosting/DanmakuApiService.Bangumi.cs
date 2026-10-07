namespace DD.Danmaku.Hosting;

using System.Security.Cryptography;
using System.Text.Json;
using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>读取后端绑定的 Bangumi 用户信息。</summary>
[Route("/dd-danmaku/api/bangumi/me", "GET")]
public sealed class BangumiMeRequest { }
/// <summary>读取授权视频对应来源的 Bangumi 角色。</summary>
[Route("/dd-danmaku/api/bangumi/characters", "GET")]
public sealed class BangumiCharactersRequest
{
    /// <summary>Emby 视频标识。</summary>
    public string ItemId { get; set; } = "";
    /// <summary>当前用户注册的来源标识。</summary>
    public string SourceId { get; set; } = "";
    /// <summary>来源作品标识。</summary>
    public string AnimeId { get; set; } = "";
}
/// <summary>提交原视频已确定章节的看过任务。</summary>
[Route("/dd-danmaku/api/bangumi/watch", "POST")]
public sealed class BangumiWatchRequest : IRequiresRequestStream
{
    /// <summary>受限 JSON 请求正文，不依赖宿主自动绑定正文属性。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
internal sealed record BangumiWatchInput(string ItemId, string SourceId, string AnimeId, int EpisodeNumber);

public sealed partial class DanmakuApiService
{
    private sealed record BangumiAccount(Uri Base, string Token, bool AllowPrivate, string Scope);
    private static BangumiAccount BangumiSettings(FrontendDefaults defaults, Plugin plugin, Guid owner)
    {
        var configured = string.IsNullOrWhiteSpace(defaults.BangumiApiPrefix) ? "https://api.bgm.tv" : defaults.BangumiApiPrefix.TrimEnd('/');
        if (!Uri.TryCreate(configured, UriKind.Absolute, out var original)
            || original.Scheme is not ("http" or "https") || original.UserInfo.Length > 0 || original.Query.Length > 0 || original.Fragment.Length > 0)
            throw new ApiAccessException(409, "BANGUMI_SOURCE_NOT_ALLOWED", "Bangumi API 地址未通过校验");
        var normalized = configured.EndsWith("/v0", StringComparison.OrdinalIgnoreCase) ? configured : configured + "/v0";
        var uri = new Uri(normalized + "/", UriKind.Absolute);
        var token = defaults.BangumiToken;
        if (string.IsNullOrWhiteSpace(token)) throw new ApiAccessException(409, "BANGUMI_TOKEN_NOT_CONFIGURED", "Bangumi Token 未配置");
        var allowPrivate = BackendSourcePolicy.IsApprovedPrivateBase(original, plugin.Configuration)
            || BackendSourcePolicy.IsApprovedPrivateBase(uri, plugin.Configuration);
        return new(uri, token, allowPrivate, BackendBangumiClient.Scope(owner, uri, token));
    }

    /// <summary>读取本人绑定账户的资料，不向客户端返回令牌。</summary>
    public Task<object> Get(BangumiMeRequest request) => Execute(async (user, plugin, host) =>
    {
        var defaults = await BackendDefaultsAsync(plugin, user.Id, Request.CancellationToken);
        var account = BangumiSettings(defaults, plugin, user.Id);
        var me = await new BackendBangumiClient(allowPrivate: account.AllowPrivate).GetMeAsync(account.Base,
            account.Token, account.Scope, Request.CancellationToken);
        return ApiHttpResult.Success(new { me.Username });
    });

    /// <summary>重新授权视频和来源后读取角色资料。</summary>
    public Task<object> Get(BangumiCharactersRequest request) => Execute(async (user, plugin, host) =>
    {
        var item = _access.RequireVideo(user, request.ItemId);
        ValidateBangumiInput(request.SourceId, request.AnimeId);
        var defaults = await BackendDefaultsAsync(plugin, user.Id, Request.CancellationToken);
        var account = BangumiSettings(defaults, plugin, user.Id);
        var subject = await BangumiSubjectAsync(request.SourceId, request.AnimeId, null, defaults, plugin,
            user.Id, Request.CancellationToken);
        var characters = await new BackendBangumiClient(allowPrivate: account.AllowPrivate).GetCharactersAsync(account.Base,
            subject, account.Token, account.Scope, Request.CancellationToken);
        return ApiHttpResult.Success(new { ItemId = item, request.SourceId, request.AnimeId, Characters = characters });
    });

    /// <summary>创建有界后端收藏任务；切集不取消原视频的已确定章节。</summary>
    public Task<object> Post(BangumiWatchRequest request) => Execute(async (user, plugin, host) =>
    {
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 16 * 1024, "application/json");
        var input = ApiHttpResult.Parse<BangumiWatchInput>(bytes);
        ValidateBangumiInput(input.SourceId, input.AnimeId);
        if (input.EpisodeNumber is < 0 or > 99999) throw new ArgumentException("Bangumi 章节号无效");
        var item = _access.RequireVideo(user, input.ItemId);
        var defaults = await BackendDefaultsAsync(plugin, user.Id, Request.CancellationToken);
        var account = BangumiSettings(defaults, plugin, user.Id);
        var revision = BangumiRevision(defaults, plugin.Configuration, account.AllowPrivate);
        var fingerprint = revision + "/" + input.SourceId + "/" + input.AnimeId + "/" + input.EpisodeNumber;
        var task = host.BackendTasks.Start(user.Id, item, "watch", fingerprint, async context =>
        {
            async Task AuthorizeAsync()
            {
                context.Token.ThrowIfCancellationRequested();
                var current = _users.GetUserById(user.Id);
                if (current is null || current.Policy is null || current.Policy.IsDisabled || current.IsLockedOut)
                    throw new ApiAccessException(401, "AUTH_REQUIRED", "原任务用户已无法执行收藏");
                _access.RequireVideo(current, item);
                var latest = await BackendDefaultsAsync(plugin, user.Id, context.Token);
                var settings = BangumiSettings(latest, plugin, user.Id);
                if (revision != BangumiRevision(latest, plugin.Configuration, settings.AllowPrivate))
                    throw new ApiAccessException(409, "UPSTREAM_CHANGED", "收藏账户或来源配置已变更");
            }
            await AuthorizeAsync();
            context.Progress("detail");
            var subject = await BangumiSubjectAsync(input.SourceId, input.AnimeId, input.EpisodeNumber,
                defaults, plugin, user.Id, context.Token);
            var client = new BackendBangumiClient(allowPrivate: account.AllowPrivate);
            context.Progress("collection");
            var data = await client.GetWatchDataAsync(account.Base, subject, input.EpisodeNumber, account.Token, context.Token);
            if (!data.Collection.Complete)
            {
                await AuthorizeAsync();
                await client.EnsureCollectionAsync(account.Base, subject, account.Token, context.Token);
                // 创建收藏后重新读取实际章节，绝不使用零标识或猜测章节位置。
                data = await client.GetWatchDataAsync(account.Base, subject, input.EpisodeNumber, account.Token, context.Token);
                if (!data.Collection.Complete)
                    throw new ApiAccessException(502, "BANGUMI_COLLECTION_INCOMPLETE", "创建后的收藏章节尚不可读取");
            }
            await AuthorizeAsync();
            await client.PutEpisodeAsync(account.Base, data.EpisodeId, account.Token, context.Token);
            // 当前章节写入成功后，再从完整分页证明全篇全部看过。
            var verified = await client.GetWatchDataAsync(account.Base, subject, input.EpisodeNumber, account.Token, context.Token);
            var markedDone = false;
            if (verified.ShouldMarkSubjectDone && verified.Collection.Episodes.Any(episode => episode.Id == data.EpisodeId && episode.Type == 2))
            {
                await AuthorizeAsync();
                await client.MarkSubjectDoneAsync(account.Base, subject, account.Token, context.Token);
                markedDone = true;
            }
            var result = new { Success = true, Data = new { ItemId = item, input.SourceId, input.AnimeId,
                input.EpisodeNumber, data.EpisodeId, Status = "watched", SubjectDone = markedDone } };
            return new BackendTaskReply(200, JsonSerializer.SerializeToUtf8Bytes(result, MatchJson.Options));
        }, authorizeResult: async token =>
        {
            var current = _users.GetUserById(user.Id);
            if (current is null || current.Policy is null || current.Policy.IsDisabled || current.IsLockedOut)
                throw new ApiAccessException(401, "AUTH_REQUIRED", "原任务用户已无法读取收藏结果");
            _access.RequireVideo(current, item);
            var latest = await BackendDefaultsAsync(plugin, user.Id, token);
            var settings = BangumiSettings(latest, plugin, user.Id);
            if (revision != BangumiRevision(latest, plugin.Configuration, settings.AllowPrivate))
                throw new ApiAccessException(409, "UPSTREAM_CHANGED", "收藏账户或来源配置已变更");
        });
        return ApiHttpResult.Success(task);
    });

    private static string BangumiRevision(FrontendDefaults defaults, PluginConfiguration configuration, bool allowPrivate) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            defaults.BangumiApiPrefix, defaults.BangumiToken, defaults.CustomApiList, defaults.CustomApiPrefix,
            configuration.DanmakuProxyEnabled, configuration.DanmakuProxyBaseUrl, configuration.DanmakuProxyAppId,
            configuration.DanmakuProxyAppSecret, configuration.DanmakuProxyServerType, AllowPrivate = allowPrivate
        }))).ToLowerInvariant();

    private static async Task<string> BangumiSubjectAsync(string source, string anime, int? expectedEpisode,
        FrontendDefaults defaults, Plugin plugin, Guid owner, CancellationToken token)
    {
        var configuration = plugin.Configuration;
        if (source != "official")
        {
            var registered = BackendSources(defaults, configuration, owner).SingleOrDefault(candidate => candidate.Id == source)
                ?? throw new ApiAccessException(404, "SOURCE_NOT_FOUND", "来源不存在或不属于当前用户");
            configuration = registered.Configuration(configuration);
        }
        var bytes = await OnlineFetchAsync(source == "official" ? "official" : "custom", configuration, owner,
            "/bangumi/" + ProxyIdentifier(anime), null, token);
        using var document = JsonDocument.Parse(bytes);
        var root = document.RootElement.TryGetProperty("bangumi", out var nested) && nested.ValueKind == JsonValueKind.Object
            ? nested : document.RootElement;
        if (expectedEpisode is not null)
        {
            var title = OnlineString(root, "animeTitle") ?? OnlineString(root, "title") ?? "";
            var episodes = OnlineParseEpisodes(bytes, new OnlineEpisode(anime, title, null, null));
            if (episodes.Count(episode => episode.EpisodeNumber == expectedEpisode && !string.IsNullOrEmpty(episode.EpisodeId)) != 1)
                throw new ApiAccessException(409, "BANGUMI_EPISODE_AMBIGUOUS", "原弹幕来源无法唯一确认当前章节号");
        }
        var url = root.TryGetProperty("bangumiUrl", out var link) && link.ValueKind == JsonValueKind.String ? link.GetString() : null;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var subject) || subject.Scheme is not ("http" or "https")
            || subject.Host is not ("bgm.tv" or "bangumi.tv" or "chii.in") || !subject.IsDefaultPort
            || subject.UserInfo.Length > 0 || subject.Query.Length > 0 || subject.Fragment.Length > 0
            || !subject.AbsolutePath.StartsWith("/subject/", StringComparison.Ordinal)
            || !long.TryParse(subject.AbsolutePath[9..].TrimEnd('/'), out var id) || id <= 0)
            throw new ApiAccessException(502, "BANGUMI_SUBJECT_INVALID", "上游未返回有效 Bangumi 条目标识");
        return id.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    private static void ValidateBangumiInput(string source, string anime)
    {
        if (string.IsNullOrWhiteSpace(source) || source.Length > 160 || string.IsNullOrWhiteSpace(anime)
            || anime.Length > 160 || !anime.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_'))
            throw new ArgumentException("Bangumi 参数无效");
    }
}
