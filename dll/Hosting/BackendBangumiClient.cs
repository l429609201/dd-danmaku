namespace DD.Danmaku.Hosting;

using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DD.Danmaku.Web.Api;

/// <summary>服务器绑定账户的 Bangumi 客户端，不接受浏览器地址或请求头。</summary>
internal sealed class BackendBangumiClient
{
    internal sealed record Reply(byte[] Body, int StatusCode);
    internal sealed record Me(string Username);
    internal sealed record Character(string Name, string Relation, string? ImageUrl, IReadOnlyList<string> Actors);
    internal sealed record Episode(int Id, int Number, int Type, string? Name);
    internal sealed record Subject(string Id, string? Title);
    internal sealed record Collection(int Total, IReadOnlyList<(int Id, int Number, int Type, int EpisodeType)> Episodes, bool Complete);
    internal sealed record WatchData(Subject Subject, Collection Collection, int EpisodeId, bool ShouldMarkSubjectDone);
    internal delegate Task<Reply> Requester(Uri target, HttpMethod method,
        IReadOnlyDictionary<string, string> headers, byte[]? body, CancellationToken token);

    private const int MaxBody = 8 * 1024 * 1024;
    private static readonly HttpClient PublicClient = new(BackendSourcePolicy.CreateHandler()) { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly HttpClient PrivateClient = new(BackendSourcePolicy.CreateHandler()) { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly SemaphoreSlim Slots = new(6, 6);
    private static readonly BackendScopedCache<Me> Users = new();
    private static readonly BackendScopedCache<IReadOnlyList<Character>> Characters = new();
    private readonly Requester _request;

    internal BackendBangumiClient(Requester? request = null, bool allowPrivate = false) =>
        _request = request ?? ((uri, method, headers, body, token) => SendAsync(uri, method, headers, body, token, allowPrivate));

    internal Task<Me> GetMeAsync(Uri uri, string token, string scope, CancellationToken cancellationToken) =>
        Users.GetAsync(scope, async stop =>
        {
            var json = await GetJsonAsync(uri, "me", token, stop);
            var username = String(json, "username");
            if (username is not { Length: > 0 and <= 256 }) throw Protocol("Bangumi 用户响应无效");
            return new Me(username);
        }, cancellationToken);

    internal Task<IReadOnlyList<Character>> GetCharactersAsync(Uri uri, string subject, string token,
        string scope, CancellationToken cancellationToken) => Characters.GetAsync(scope + "/" + subject, async stop =>
    {
        var json = await GetJsonAsync(uri, "subjects/" + subject + "/characters", token, stop);
        if (json.ValueKind != JsonValueKind.Array || json.GetArrayLength() > 500) throw Protocol("Bangumi 角色响应无效");
        var result = new List<Character>();
        foreach (var item in json.EnumerateArray())
        {
            var name = String(item, "name");
            if (name is null) continue;
            var actors = new List<string>();
            if (item.TryGetProperty("actors", out var cast) && cast.ValueKind == JsonValueKind.Array)
            {
                if (cast.GetArrayLength() > 100) throw Protocol("Bangumi 演员数量超出限制");
                foreach (var actor in cast.EnumerateArray()) if (String(actor, "name") is { } actorName) actors.Add(actorName);
            }
            string? image = null;
            if (item.TryGetProperty("images", out var images)) image = String(images, "large") ?? String(images, "medium");
            result.Add(new(name, String(item, "relation") ?? "角色", image, actors));
        }
        return result;
    }, cancellationToken);

    internal async Task<WatchData> GetWatchDataAsync(Uri uri, string subject, int episodeNumber,
        string token, CancellationToken cancellationToken)
    {
        var detail = await GetJsonAsync(uri, "subjects/" + subject, token, cancellationToken);
        if (detail.ValueKind != JsonValueKind.Object) throw Protocol("Bangumi 条目响应无效");
        var episodes = await ReadEpisodesAsync(uri, subject, token, cancellationToken);
        var matches = episodes.Where(episode => episode.Number == episodeNumber && episode.Type == 0).ToArray();
        if (matches.Length != 1) throw new ApiAccessException(409, "BANGUMI_EPISODE_AMBIGUOUS", "Bangumi 章节号无法唯一匹配");
        var collection = await ReadCollectionAsync(uri, subject, token, cancellationToken)
            ?? new Collection(0, [], false);
        var completed = CompleteMainEpisodes(episodes, collection, matches[0].Id);
        return new(new(subject, String(detail, "name_cn") ?? String(detail, "name")), collection, matches[0].Id, completed);
    }

    private async Task<IReadOnlyList<Episode>> ReadEpisodesAsync(Uri uri, string subject, string token, CancellationToken stop)
    {
        var pages = await PagesAsync(uri, "episodes?subject_id=" + subject + "&type=0", token, stop, false);
        if (pages is null) throw Protocol("Bangumi 章节列表缺失");
        var result = new List<Episode>();
        foreach (var item in pages)
        {
            var episode = ParseEpisode(item);
            if (episode.Type != 0) throw Protocol("Bangumi 章节类型与请求不一致");
            result.Add(episode);
        }
        if (result.Select(episode => episode.Id).Distinct().Count() != result.Count) throw Incomplete();
        return result;
    }

    internal async Task<Collection?> ReadCollectionAsync(Uri uri, string subject, string token, CancellationToken stop)
    {
        var pages = await PagesAsync(uri, "users/-/collections/" + subject + "/episodes", token, stop, true);
        if (pages is null) return null;
        var result = new List<(int Id, int Number, int Type, int EpisodeType)>();
        foreach (var item in pages)
        {
            if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("episode", out var nested)
                || !item.TryGetProperty("type", out var state) || state.ValueKind != JsonValueKind.Number || !state.TryGetInt32(out var type) || type is < 0 or > 5) throw Incomplete();
            var episode = ParseEpisode(nested);
            result.Add((episode.Id, episode.Number, type, episode.Type));
        }
        if (result.Select(episode => episode.Id).Distinct().Count() != result.Count) throw Incomplete();
        return new(result.Count, result, true);
    }

    private async Task<List<JsonElement>?> PagesAsync(Uri uri, string path, string token, CancellationToken stop, bool allowMissing)
    {
        var result = new List<JsonElement>();
        int? expectedTotal = null;
        for (var page = 0; page < 100; page++)
        {
            stop.ThrowIfCancellationRequested();
            var json = await GetJsonAsync(uri, path + (path.Contains('?') ? "&" : "?") + "limit=100&offset=" + page * 100,
                token, stop, allowMissing && page == 0);
            if (json.ValueKind == JsonValueKind.Undefined && allowMissing && page == 0) return null;
            if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty("total", out var totalValue)
                || totalValue.ValueKind != JsonValueKind.Number || !totalValue.TryGetInt32(out var total) || total is < 0 or > 10000
                || !json.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array || data.GetArrayLength() > 100)
                throw Incomplete();
            if (expectedTotal is not null && expectedTotal != total) throw Incomplete();
            expectedTotal = total;
            foreach (var item in data.EnumerateArray()) result.Add(item.Clone());
            if (result.Count > total) throw Incomplete();
            if (result.Count == total) return result;
            if (data.GetArrayLength() != 100) throw Incomplete();
        }
        throw Incomplete();
    }

    private static Episode ParseEpisode(JsonElement item)
    {
        if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.Number || !id.TryGetInt32(out var numberId) || numberId <= 0
            || !item.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.Number || !type.TryGetInt32(out var episodeType) || episodeType is < 0 or > 6
            || !item.TryGetProperty("sort", out var sort) || sort.ValueKind != JsonValueKind.Number || !sort.TryGetDecimal(out var ordinal)
            || episodeType == 0 && ordinal != decimal.Truncate(ordinal) || ordinal is < 0 or > 99999) throw Incomplete();
        return new(numberId, (int)ordinal, episodeType, String(item, "name"));
    }

    private static bool CompleteMainEpisodes(IReadOnlyList<Episode> expected, Collection actual, int watched)
    {
        var main = actual.Episodes.Where(episode => episode.EpisodeType == 0).ToArray();
        return actual.Complete && expected.Count > 0 && main.Length == expected.Count
            && main.Select(episode => episode.Id).Order().SequenceEqual(expected.Select(episode => episode.Id).Order())
            && main.All(episode => episode.Type == 2 || episode.Id == watched);
    }

    internal async Task EnsureCollectionAsync(Uri uri, string subject, string token, CancellationToken stop) =>
        _ = await SendJsonAsync(uri, "users/-/collections/" + subject, HttpMethod.Post, token,
            JsonSerializer.SerializeToUtf8Bytes(new { type = 3 }), stop);
    internal async Task PutEpisodeAsync(Uri uri, int episode, string token, CancellationToken stop)
    {
        if (episode <= 0) throw new ArgumentException("Bangumi 章节标识无效");
        _ = await SendJsonAsync(uri, "users/-/collections/-/episodes/" + episode, HttpMethod.Put, token,
            JsonSerializer.SerializeToUtf8Bytes(new { type = 2 }), stop);
    }
    internal async Task MarkSubjectDoneAsync(Uri uri, string subject, string token, CancellationToken stop) =>
        _ = await SendJsonAsync(uri, "users/-/collections/" + subject, HttpMethod.Patch, token,
            JsonSerializer.SerializeToUtf8Bytes(new { type = 2 }), stop);

    internal static string Scope(Guid owner, Uri uri, string token) => Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes(owner.ToString("N") + "\n" + uri.AbsoluteUri + "\n" + token))).ToLowerInvariant();
    private async Task<JsonElement> GetJsonAsync(Uri uri, string path, string token, CancellationToken stop, bool allow404 = false)
    {
        var reply = await SendJsonAsync(uri, path, HttpMethod.Get, token, null, stop, allow404);
        if (reply.StatusCode == 404 && allow404) return default;
        try
        {
            using var json = JsonDocument.Parse(reply.Body, new JsonDocumentOptions { MaxDepth = 32 });
            MatchJson.RejectDuplicateProperties(json.RootElement);
            return json.RootElement.Clone();
        }
        catch (JsonException) { throw Protocol("Bangumi 返回的 JSON 无效"); }
    }
    private async Task<Reply> SendJsonAsync(Uri uri, string path, HttpMethod method, string token, byte[]? body,
        CancellationToken stop, bool allow404 = false)
    {
        if (token.Length is < 1 or > 4096 || token.Any(character => char.IsControl(character) || char.IsWhiteSpace(character)))
            throw new ApiAccessException(409, "BANGUMI_AUTH_REJECTED", "Bangumi 令牌格式无效");
        var reply = await _request(new Uri(uri, path), method, new Dictionary<string, string> { ["Authorization"] = "Bearer " + token }, body, stop);
        if (reply.Body.Length > MaxBody) throw new ApiAccessException(502, "BANGUMI_RESPONSE_TOO_LARGE", "Bangumi 响应过大");
        if (reply.StatusCode == 404 && allow404) return reply;
        if (reply.StatusCode is 401 or 403) throw new ApiAccessException(502, "BANGUMI_AUTH_REJECTED", "Bangumi 令牌无效");
        if (reply.StatusCode == 404) throw new ApiAccessException(404, "BANGUMI_NOT_FOUND", "Bangumi 资源不存在");
        if (reply.StatusCode == 429) throw new ApiAccessException(429, "BANGUMI_RATE_LIMITED", "Bangumi 请求被流控");
        if (reply.StatusCode is < 200 or >= 300) throw new ApiAccessException(502, "BANGUMI_UPSTREAM_FAILED", "Bangumi 请求失败");
        return reply;
    }

    private static async Task<Reply> SendAsync(Uri target, HttpMethod method, IReadOnlyDictionary<string, string> headers,
        byte[]? body, CancellationToken token, bool allowPrivate)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        var entered = false;
        try
        {
            await Slots.WaitAsync(timeout.Token); entered = true;
            await BackendSourcePolicy.RequireSafeTargetAsync(target, allowPrivate, timeout.Token);
            using var request = new HttpRequestMessage(method, target);
            request.Options.Set(BackendSourcePolicy.AllowPrivateOption, allowPrivate);
            request.Headers.Accept.ParseAdd("application/json");
            request.Headers.UserAgent.ParseAdd("DD.Danmaku/1.3.6");
            foreach (var header in headers)
                if (header.Key == "Authorization") request.Headers.TryAddWithoutValidation(header.Key, header.Value);
                else throw new ArgumentException("Bangumi 请求头不受支持");
            if (body is not null) request.Content = new ByteArrayContent(body) { Headers = { ContentType = new("application/json") } };
            using var response = await (allowPrivate ? PrivateClient : PublicClient).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (response.Content.Headers.ContentLength > MaxBody) throw new ApiAccessException(502, "BANGUMI_RESPONSE_TOO_LARGE", "Bangumi 响应过大");
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[32768];
            int read;
            while ((read = await stream.ReadAsync(chunk, timeout.Token)) > 0)
            {
                if (buffer.Length + read > MaxBody) throw new ApiAccessException(502, "BANGUMI_RESPONSE_TOO_LARGE", "Bangumi 响应过大");
                buffer.Write(chunk, 0, read);
            }
            return new(buffer.ToArray(), (int)response.StatusCode);
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        { throw new ApiAccessException(504, "BANGUMI_TIMEOUT", "Bangumi 请求超时"); }
        catch (HttpRequestException) { throw new ApiAccessException(502, "BANGUMI_UPSTREAM_FAILED", "Bangumi 请求无法完成"); }
        finally { if (entered) Slots.Release(); }
    }

    private static string? String(JsonElement item, string property) => item.ValueKind == JsonValueKind.Object
        && item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
        && value.GetString() is { Length: <= 2048 } text ? text : null;
    private static ApiAccessException Protocol(string message) => new(502, "BANGUMI_PROTOCOL_INVALID", message);
    private static ApiAccessException Incomplete() => new(502, "BANGUMI_COLLECTION_INCOMPLETE", "Bangumi 章节分页或类型数据不完整");
}
