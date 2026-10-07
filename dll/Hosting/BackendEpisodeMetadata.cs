namespace DD.Danmaku.Hosting;

using System.Globalization;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// 所有参数均由服务器有效用户配置及已授权媒体实体提取，不绑定任意客户端 URL。
internal sealed class MetadataOptions
{
    internal bool Enabled { get; }
    internal Uri BaseUri { get; }
    internal Guid UserId { get; }
    internal string Revision { get; }
    internal string ApiKey { get; }
    internal string CachePartition { get; }
    internal bool AllowPrivate { get; }

    private MetadataOptions(bool enabled, Uri baseUri, string key, Guid userId, string revision, bool allowPrivate)
    {
        Enabled = enabled; BaseUri = baseUri; ApiKey = key; UserId = userId; Revision = revision;
        AllowPrivate = allowPrivate;
        // 密钥仅参与摘要，不进入缓存键、DTO、日志和异常消息。
        CachePartition = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            JsonSerializer.Serialize(new[] { userId.ToString("N"), baseUri.AbsoluteUri, key, revision, allowPrivate.ToString() }))));
    }

    internal static MetadataOptions FromDefaults(FrontendDefaults defaults, Guid userId, string revision,
        PluginConfiguration? configuration = null)
    {
        if (userId == Guid.Empty || revision is null || revision.Length > 256 || revision.Any(char.IsControl))
            throw new ArgumentException("元数据用户或配置版本无效");
        var enabled = defaults.TmdbEpisodeMappingEnable == true;
        var key = defaults.TmdbApiKey ?? "";
        if (key.Length > 512 || key.Any(c => char.IsControl(c) || char.IsWhiteSpace(c)))
            throw new ArgumentException("TMDB 密钥格式无效");
        var address = string.IsNullOrEmpty(defaults.TmdbApiBaseUrl)
            ? "https://api.themoviedb.org/" : defaults.TmdbApiBaseUrl;
        if (address.Length > 2048 || address.Any(char.IsControl)
            || !Uri.TryCreate(address, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("https" or "http") || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            throw new ArgumentException("TMDB 基址必须是无查询和认证信息的 HTTP 或 HTTPS 地址");
        // 兼容旧配置的镜像路径前缀；固定路径追加到前缀下，不把客户端 URL 当任务目标。
        uri = new UriBuilder(uri) { Path = uri.AbsolutePath.TrimEnd('/') + "/" }.Uri;
        var allowPrivate = (configuration?.BackendPrivateSourcePrefixes ?? []).Any(prefix =>
            Uri.TryCreate(prefix, UriKind.Absolute, out var approved) && approved.Scheme is "http" or "https"
            && approved.UserInfo.Length == 0 && approved.Query.Length == 0 && approved.Fragment.Length == 0
            && string.Equals(uri.AbsoluteUri.TrimEnd('/'), approved.AbsoluteUri.TrimEnd('/'), StringComparison.Ordinal));
        return new MetadataOptions(enabled, uri, key, userId, revision, allowPrivate);
    }
}

internal sealed record MetadataEpisodeInput(bool IsEpisode, int? Season, int? Episode,
    string? TmdbId, string? EpisodeGroupId);
internal sealed record MetadataMappingResult(string Mode, int? Season, int? Episode,
    int? OriginalSeason, int? OriginalEpisode, string? Direction = null,
    string? EpisodeGroupId = null, string? Reason = null,
    IReadOnlyList<MetadataMappingCandidate>? Candidates = null);
internal sealed record MetadataMappingCandidate(int Season, int Episode, string Direction);
internal sealed record MetadataConfigurationResult(bool IsValid, string? Reason = null);
internal sealed record MetadataGroupSummary(string Id, string Name, int Type);
internal sealed record MetadataEpisode(int Season, int Episode);
internal sealed record MetadataSeasonGroup(int Season, IReadOnlyList<MetadataEpisode> Episodes);
internal sealed record MetadataGroupDetail(string Id, IReadOnlyList<MetadataSeasonGroup> Groups);

// 可替换安全校验委托由宿主传入；生产连接处理器同时核验 DNS 并绑定目标 IP。
internal sealed class BackendEpisodeMetadata : IDisposable
{
    private const int MaxBody = 4 * 1024 * 1024;
    private readonly HttpClient _client;
    private readonly HttpClient _privateClient;
    private readonly Func<Uri, bool, CancellationToken, Task> _validateTarget;
    private readonly object _gate = new();
    private readonly Dictionary<string, Cached> _cache = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Task<object>> _flights = new(StringComparer.Ordinal);
    private sealed record Cached(object Value, DateTimeOffset Expires);

    internal BackendEpisodeMetadata()
        : this(BackendSourcePolicy.RequireSafeTargetAsync, BackendSourcePolicy.CreateHandler(),
            BackendSourcePolicy.CreateHandler()) { }

    // 仅隔离测试注入处理器；两种权限各自持有独立安全连接池。
    internal BackendEpisodeMetadata(Func<Uri, bool, CancellationToken, Task> validateTarget,
        HttpMessageHandler handler, HttpMessageHandler? privateHandler = null)
    {
        _validateTarget = validateTarget ?? throw new ArgumentNullException(nameof(validateTarget));
        if (ReferenceEquals(handler, privateHandler)) throw new ArgumentException("不同权限不能共用连接处理器");
        _client = new HttpClient(handler, true) { Timeout = Timeout.InfiniteTimeSpan };
        _privateClient = new HttpClient(privateHandler ?? BackendSourcePolicy.CreateHandler(), true)
            { Timeout = Timeout.InfiniteTimeSpan };
    }

    internal async Task<MetadataConfigurationResult> ValidateConfigurationAsync(MetadataOptions options,
        CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (string.IsNullOrEmpty(options.ApiKey)) return new(false, "not_configured");
        try
        {
            return (MetadataConfigurationResult)await FetchAsync("3/configuration", options,
                TimeSpan.FromMinutes(15), root =>
                {
                    if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("images", out var images)
                        || images.ValueKind != JsonValueKind.Object)
                        throw new InvalidDataException("TMDB 配置格式无效");
                    // 只验证协议结构，不把图片域名、密钥或上游正文发送给客户端。
                    var keys = Array(root, "change_keys", 2000);
                    foreach (var key in keys.EnumerateArray())
                        if (key.ValueKind != JsonValueKind.String || key.GetString() is not { Length: <= 128 })
                            throw new InvalidDataException("TMDB 配置键格式无效");
                    return new MetadataConfigurationResult(true);
                }, token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch (OperationCanceledException) { return new(false, "upstream_timeout"); }
        catch (HttpRequestException error)
        {
            return new(false, error.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden
                ? "credential_rejected" : "upstream_failed");
        }
        catch (JsonException) { return new(false, "invalid_upstream_json"); }
        catch (InvalidDataException) { return new(false, "invalid_upstream_data"); }
    }

    internal async Task<IReadOnlyList<MetadataGroupSummary>> GetEpisodeGroupsAsync(string tmdbId,
        MetadataOptions options, CancellationToken token)
    {
        if (string.IsNullOrEmpty(tmdbId) || tmdbId.Length > 20 || !tmdbId.All(c => c is >= '0' and <= '9')
            || !ulong.TryParse(tmdbId, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id == 0)
            throw new ArgumentException("TMDB 剧集标识无效");
        return (IReadOnlyList<MetadataGroupSummary>)await FetchAsync($"3/tv/{tmdbId}/episode_groups",
            options, TimeSpan.FromDays(7), ParseList, token).ConfigureAwait(false);
    }

    internal async Task<MetadataGroupDetail> GetEpisodeGroupAsync(string groupId, MetadataOptions options,
        CancellationToken token)
    {
        RequireGroupId(groupId);
        return (MetadataGroupDetail)await FetchAsync($"3/tv/episode_group/{groupId}", options,
            TimeSpan.FromDays(30), root => ParseDetail(groupId, root), token).ConfigureAwait(false);
    }

    internal async Task<MetadataMappingResult> MapAsync(MetadataEpisodeInput item, MetadataOptions options,
        CancellationToken token, Func<Task>? authorize = null)
    {
        token.ThrowIfCancellationRequested();
        MetadataMappingResult Fallback(string reason) => new("originalfallback", item.Season, item.Episode,
            item.Season, item.Episode, Reason: reason);
        if (!item.IsEpisode) return Fallback("not_episode");
        if (!options.Enabled || string.IsNullOrEmpty(options.ApiKey)) return Fallback("not_configured");
        if (item.Season is null or < 0 or > 999 || item.Episode is null or < 0 or > 99999)
            return Fallback("missing_episode_numbers");
        try
        {
            var groupId = item.EpisodeGroupId;
            if (string.IsNullOrEmpty(groupId) && !string.IsNullOrEmpty(item.TmdbId))
            {
                if (authorize is not null) await authorize().ConfigureAwait(false);
                var list = await GetEpisodeGroupsAsync(item.TmdbId, options, token).ConfigureAwait(false);
                if (authorize is not null) await authorize().ConfigureAwait(false);
                groupId = (list.FirstOrDefault(g => g.Type == 7) ?? list.FirstOrDefault())?.Id;
            }
            if (string.IsNullOrEmpty(groupId)) return Fallback("no_episode_group");
            // 剧集组列表与详情是独立外部步骤，业务调用可在每步检查原用户授权。
            if (authorize is not null) await authorize().ConfigureAwait(false);
            var detail = await GetEpisodeGroupAsync(groupId, options, token).ConfigureAwait(false);
            if (authorize is not null) await authorize().ConfigureAwait(false);
            return MapDetail(item, detail);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch (OperationCanceledException) { return Fallback("upstream_timeout"); }
        catch (HttpRequestException) { return Fallback("upstream_failed"); }
        catch (JsonException) { return Fallback("invalid_upstream_json"); }
        catch (InvalidDataException) { return Fallback("invalid_upstream_data"); }
        catch (ArgumentException) { return Fallback("invalid_provider_id"); }
        // 安全策略错误不吞掉，宿主可按其稳定错误码返回。
    }

    internal static MetadataMappingResult MapDetail(MetadataEpisodeInput item, MetadataGroupDetail detail)
    {
        var forward = new Dictionary<(int, int), MetadataEpisode>();
        var reverse = new Dictionary<(int, int), MetadataEpisode>();
        var forwardConflicts = new HashSet<(int, int)>();
        var reverseConflicts = new HashSet<(int, int)>();
        // 相同键的重复相同值可合并；冲突值禁用该键，不能凭最后覆盖猜测集数。
        static void Add(Dictionary<(int, int), MetadataEpisode> map, HashSet<(int, int)> conflicts,
            (int, int) key, MetadataEpisode value)
        {
            if (conflicts.Contains(key)) return;
            if (map.TryGetValue(key, out var previous) && previous != value)
            {
                map.Remove(key);
                conflicts.Add(key);
            }
            else map.TryAdd(key, value);
        }
        foreach (var group in detail.Groups)
            for (var i = 0; i < group.Episodes.Count; i++)
            {
                var episode = group.Episodes[i];
                // 保持原数组顺序，不按 order 重新排序。
                Add(forward, forwardConflicts, (group.Season, i + 1), episode);
                Add(reverse, reverseConflicts, (episode.Season, episode.Episode), new(group.Season, i + 1));
            }
        var key = (item.Season ?? -1, item.Episode ?? -1);
        var candidates = new List<MetadataMappingCandidate>();
        if (forward.TryGetValue(key, out var forwardMapped))
            candidates.Add(new(forwardMapped.Season, forwardMapped.Episode, "custom_to_tmdb"));
        if (reverse.TryGetValue(key, out var reverseMapped)
            && !candidates.Any(candidate => candidate.Season == reverseMapped.Season && candidate.Episode == reverseMapped.Episode))
            candidates.Add(new(reverseMapped.Season, reverseMapped.Episode, "tmdb_to_custom"));
        if (candidates.Count > 0)
        {
            var first = candidates[0];
            return new("mapped", first.Season, first.Episode, item.Season, item.Episode,
                first.Direction, detail.Id, Candidates: candidates);
        }
        return new("originalfallback", item.Season, item.Episode, item.Season, item.Episode,
            EpisodeGroupId: detail.Id, Reason: "no_mapping", Candidates: []);
    }

    private async Task<object> FetchAsync(string path, MetadataOptions options, TimeSpan ttl,
        Func<JsonElement, object> parse, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (string.IsNullOrEmpty(options.ApiKey)) throw new ArgumentException("未配置 TMDB 密钥");
        var target = new Uri(options.BaseUri, path);
        // 每次调用包括缓存命中均重新执行策略，以便配置或 DNS 策略变更立即生效。
        await _validateTarget(target, options.AllowPrivate, token).ConfigureAwait(false);
        var key = options.CachePartition + ":" + path;
        Task<object> flight;
        lock (_gate)
        {
            if (_cache.TryGetValue(key, out var hit) && hit.Expires > DateTimeOffset.UtcNow) return hit.Value;
            if (!_flights.TryGetValue(key, out flight!))
            {
                if (_flights.Count >= 64) throw new HttpRequestException("TMDB 并发请求过多");
                // 共用请求使用独立超时；某一等待者取消不会取消其他等待者。
                flight = FetchCoreAsync(target, options, parse);
                _flights[key] = flight;
                _ = FinishFlightAsync(key, flight, ttl);
            }
        }
        return await flight.WaitAsync(token).ConfigureAwait(false);
    }

    private async Task FinishFlightAsync(string key, Task<object> flight, TimeSpan ttl)
    {
        try
        {
            var value = await flight.ConfigureAwait(false);
            lock (_gate)
            {
                if (_cache.Count >= 256)
                    _cache.Remove(_cache.MinBy(entry => entry.Value.Expires).Key);
                _cache[key] = new(value, DateTimeOffset.UtcNow + ttl);
            }
        }
        catch (Exception) { /* 失败不缓存，等待者仍收到原异常。 */ }
        finally { lock (_gate) _flights.Remove(key); }
    }

    private async Task<object> FetchCoreAsync(Uri target, MetadataOptions options, Func<JsonElement, object> parse)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        await _validateTarget(target, options.AllowPrivate, timeout.Token).ConfigureAwait(false);
        var uri = new UriBuilder(target) { Query = "api_key=" + Uri.EscapeDataString(options.ApiKey) }.Uri;
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Accept.ParseAdd("application/json");
        request.Options.Set(BackendSourcePolicy.AllowPrivateOption, options.AllowPrivate);
        HttpResponseMessage upstream;
        try
        {
            upstream = await (options.AllowPrivate ? _privateClient : _client).SendAsync(request, HttpCompletionOption.ResponseHeadersRead,
                timeout.Token).ConfigureAwait(false);
        }
        catch (HttpRequestException)
        {
            // 不保留可能含 api_key 查询串的底层异常或其 InnerException。
            throw new HttpRequestException("TMDB 网络请求失败");
        }
        using var response = upstream;
        if (!response.IsSuccessStatusCode) throw new HttpRequestException("TMDB 请求失败", null, response.StatusCode);
        if (response.Content.Headers.ContentLength > MaxBody) throw new InvalidDataException("TMDB 响应过大");
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
        using var body = new MemoryStream();
        var buffer = new byte[16 * 1024];
        int count;
        while ((count = await stream.ReadAsync(buffer, timeout.Token).ConfigureAwait(false)) != 0)
        {
            if (body.Length + count > MaxBody) throw new InvalidDataException("TMDB 响应过大");
            body.Write(buffer, 0, count);
        }
        using var document = JsonDocument.Parse(body.GetBuffer().AsMemory(0, (int)body.Length),
            new JsonDocumentOptions { MaxDepth = 32 });
        return parse(document.RootElement);
    }

    private static object ParseList(JsonElement root)
    {
        var results = Array(root, "results", 500);
        var list = new List<MetadataGroupSummary>();
        foreach (var item in results.EnumerateArray())
        {
            var id = Text(item, "id", 128); RequireGroupId(id);
            list.Add(new(id, Text(item, "name", 512), Number(item, "type", 0, 100)));
        }
        return list.AsReadOnly();
    }

    private static MetadataGroupDetail ParseDetail(string id, JsonElement root)
    {
        var groups = Array(root, "groups", 1000);
        var result = new List<MetadataSeasonGroup>();
        var total = 0;
        foreach (var group in groups.EnumerateArray())
        {
            if (group.ValueKind != JsonValueKind.Object) throw new InvalidDataException("TMDB 分组格式无效");
            var season = group.TryGetProperty("order", out _) ? Number(group, "order", 0, 999) : result.Count + 1;
            if (season > 999) throw new InvalidDataException("TMDB 季号超出范围");
            var episodes = Array(group, "episodes", 99999);
            total += episodes.GetArrayLength();
            if (total > 50000) throw new InvalidDataException("TMDB 集数过多");
            var list = new List<MetadataEpisode>();
            foreach (var episode in episodes.EnumerateArray())
                list.Add(new(Number(episode, "season_number", 0, 999), Number(episode, "episode_number", 0, 99999)));
            result.Add(new(season, list.AsReadOnly()));
        }
        return new(id, result.AsReadOnly());
    }

    private static JsonElement Array(JsonElement root, string key, int max)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(key, out var value)
            || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > max)
            throw new InvalidDataException("TMDB 数组格式或数量无效");
        return value;
    }

    private static string Text(JsonElement root, string key, int max)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(key, out var value)
            || value.ValueKind != JsonValueKind.String || value.GetString() is not { } text
            || text.Length > max || text.Any(char.IsControl)) throw new InvalidDataException("TMDB 文本格式无效");
        return text;
    }

    private static int Number(JsonElement root, string key, int min, int max)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty(key, out var value)
            || value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number)
            || number < min || number > max) throw new InvalidDataException("TMDB 数值格式无效");
        return number;
    }

    private static void RequireGroupId(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 128
            || !id.All(c => c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '-' or '_'))
            throw new ArgumentException("TMDB 分组标识无效");
    }

    public void Dispose()
    {
        _client.Dispose();
        _privateClient.Dispose();
    }
}
