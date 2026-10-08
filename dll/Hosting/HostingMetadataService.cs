namespace DD.Danmaku.Hosting;

using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using DD.Danmaku.Web.Api;

// DTO 只含固定状态和原因码，不返回凭据、域名、账户名称或上游正文。
internal sealed record MetadataProviderHealthDto(bool Enabled, string Status, string? Reason, DateTimeOffset? CheckedAt);
internal sealed record MetadataHealthDto(MetadataProviderHealthDto Tmdb, MetadataProviderHealthDto Bangumi);

internal sealed class HostingMetadataService : IDisposable
{
    private readonly object _gate = new();
    private readonly HostingMetadataHttp _http;
    private readonly CancellationTokenSource _stop = new();
    private readonly Dictionary<Guid, OwnerState> _owners = new();
    private bool _disposed;
    private sealed record Settings(bool Enabled, Uri? Base, bool AllowPrivate, string Credential, string? Error);
    private sealed class OwnerState
    {
        internal required string Revision;
        internal required Settings Tmdb;
        internal required Settings Bangumi;
        internal required CancellationTokenSource Stop;
        internal required MetadataHealthDto Health;
        internal Task? Probe;
        internal readonly Dictionary<string, (Task<JsonElement?> Task, DateTimeOffset Expires)> Evidence = new();
    }
    internal HostingMetadataService(HostingMetadataHttp? http = null) => _http = http ?? new();

    internal MetadataHealthDto EnsureStarted(Guid owner, FrontendDefaults defaults, PluginConfiguration configuration, bool force = false)
    {
        if (owner == Guid.Empty) throw new ArgumentException("元数据配置所属用户无效");
        var tmdb = TmdbSettings(defaults, configuration, owner);
        var bgm = BangumiSettings(defaults, configuration);
        var revision = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { Owner = owner, Tmdb = tmdb, Bangumi = bgm })));
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_owners.TryGetValue(owner, out var old) && old.Revision == revision && !force) return old.Health;
            if (old is not null) Cancel(old);
            if (!_owners.ContainsKey(owner) && _owners.Count >= 128)
            {
                var first = _owners.First(); Cancel(first.Value); _owners.Remove(first.Key);
            }
            var state = new OwnerState { Revision = revision, Tmdb = tmdb, Bangumi = bgm,
                Stop = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token),
                Health = new(Initial(tmdb), Initial(bgm)) };
            _owners[owner] = state;
            // 直接启动有界异步 I/O，不为每次读取创建 Task.Run 或持久轮询任务。
            state.Probe = ProbeAsync(owner, state);
            return state.Health;
        }
    }
    private static MetadataProviderHealthDto Initial(Settings settings) => new(settings.Enabled,
        !settings.Enabled ? "disabled" : settings.Error is null ? "checking" : "invalid", settings.Enabled ? settings.Error : null, null);

    private async Task ProbeAsync(Guid owner, OwnerState state)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(state.Stop.Token);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        var tmdb = CheckAsync(state.Tmdb, true, deadline.Token);
        var bangumi = CheckAsync(state.Bangumi, false, deadline.Token);
        var results = await Task.WhenAll(tmdb, bangumi).ConfigureAwait(false);
        lock (_gate)
            if (!state.Stop.IsCancellationRequested && _owners.TryGetValue(owner, out var current) && ReferenceEquals(current, state))
                state.Health = new(results[0], results[1]);
    }
    private async Task<MetadataProviderHealthDto> CheckAsync(Settings settings, bool tmdb, CancellationToken token)
    {
        if (!settings.Enabled || settings.Error is not null) return Initial(settings);
        try
        {
            var path = tmdb ? "3/configuration" : settings.Credential.Length > 0 ? "me" : "subjects?limit=1&offset=0";
            var json = await ReadAsync(settings, path, tmdb, token).ConfigureAwait(false);
            var valid = json.ValueKind == JsonValueKind.Object && (tmdb
                ? json.TryGetProperty("images", out var images) && images.ValueKind == JsonValueKind.Object
                    && json.TryGetProperty("change_keys", out var keys) && keys.ValueKind == JsonValueKind.Array
                : settings.Credential.Length > 0 ? Text(json, "username") is { Length: > 0 }
                    : json.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array);
            return new(true, valid ? "valid" : "invalid", valid ? null : "invalid_upstream_data", DateTimeOffset.UtcNow);
        }
        catch (Exception error) { return new(true, "invalid", Reason(error), DateTimeOffset.UtcNow); }
    }
    private Task<JsonElement> ReadAsync(Settings settings, string path, bool tmdb, CancellationToken token)
    {
        var uri = new Uri(settings.Base!, path);
        if (tmdb) uri = new UriBuilder(uri) { Query = (uri.Query.Length > 1 ? uri.Query[1..] + "&" : "") + "api_key=" + Uri.EscapeDataString(settings.Credential) }.Uri;
        return _http.GetAsync(uri, settings.AllowPrivate, tmdb ? null : settings.Credential, token);
    }

    // target 必须由宿主媒体授权后构造；不接受提示词、搜索关键字或任意 URL。
    internal async Task<JsonElement?> GetEvidenceAsync(TargetMediaDto target, FrontendDefaults defaults,
        PluginConfiguration configuration, Guid owner, CancellationToken token)
    {
        EnsureStarted(owner, defaults, configuration);
        OwnerState state;
        Task<JsonElement?> flight;
        lock (_gate)
        {
            state = _owners[owner];
            var key = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(target)));
            if (state.Evidence.TryGetValue(key, out var cached) && cached.Expires > DateTimeOffset.UtcNow) flight = cached.Task;
            else
            {
                // 不能驱逐未完成请求后无限新增后台等待者。
                if (state.Evidence.Count >= 64)
                {
                    var completed = state.Evidence.FirstOrDefault(entry => entry.Value.Task.IsCompleted);
                    if (completed.Key is null) return null;
                    state.Evidence.Remove(completed.Key);
                }
                flight = EvidenceAsync(state, target);
                state.Evidence[key] = (flight, DateTimeOffset.UtcNow.AddMinutes(5));
            }
        }
        var result = await flight.WaitAsync(token).ConfigureAwait(false);
        lock (_gate)
            return !state.Stop.IsCancellationRequested && _owners.TryGetValue(owner, out var current) && ReferenceEquals(current, state) ? result : null;
    }
    private async Task<JsonElement?> EvidenceAsync(OwnerState state, TargetMediaDto target)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(state.Stop.Token);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        try
        {
            if (state.Probe is { } probe) await probe.WaitAsync(deadline.Token).ConfigureAwait(false);
            var ids = target.ProviderIds ?? [];
            var scope = target.MediaType == "movie" ? "movie" : "series";
            var tmdb = ids.FirstOrDefault(id => id.Provider.Equals("Tmdb", StringComparison.OrdinalIgnoreCase) && id.Scope == scope && NumericId(id.Id));
            var bgm = ids.FirstOrDefault(id => (id.Provider.Equals("Bangumi", StringComparison.OrdinalIgnoreCase) || id.Provider.Equals("Bgm", StringComparison.OrdinalIgnoreCase)) && id.Scope == scope && NumericId(id.Id));
            var work = new List<Task<object?>>();
            if (state.Health.Tmdb.Status == "valid" && tmdb is not null)
                work.Add(DetailAsync(state.Tmdb, "3/" + (scope == "movie" ? "movie/" : "tv/") + tmdb.Id + "?append_to_response=alternative_titles", true, tmdb.Id, deadline.Token));
            if (state.Health.Bangumi.Status == "valid" && bgm is not null)
                work.Add(DetailAsync(state.Bangumi, "subjects/" + bgm.Id, false, bgm.Id, deadline.Token));
            var results = (await Task.WhenAll(work).ConfigureAwait(false)).Where(x => x is not null).ToArray();
            return results.Length == 0 ? null : JsonSerializer.SerializeToElement(new { Evidence = results });
        }
        catch (Exception) { return null; /* 补充失败不能制造元数据或阻断原匹配。 */ }
    }
    private async Task<object?> DetailAsync(Settings settings, string path, bool tmdb, string id, CancellationToken token)
    {
        try
        {
            var root = await ReadAsync(settings, path, tmdb, token).ConfigureAwait(false);
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("id", out var actual) || actual.ToString() != id) return null;
            var fields = new Dictionary<string, JsonElement>();
            var allowed = tmdb ? new[] { "title", "original_title", "name", "original_name", "release_date", "first_air_date", "type" }
                : new[] { "name", "name_cn", "date", "type" };
            foreach (var name in allowed)
                if (root.TryGetProperty(name, out var value) && value.ValueKind is JsonValueKind.String or JsonValueKind.Number)
                {
                    var text = value.ToString();
                    if (text.Length <= 256 && !text.Any(char.IsControl)
                        && !text.Contains("://", StringComparison.Ordinal)) fields[name] = value.Clone();
                }
            // 只抽取明确别名键，不把任意 infobox、网址、图片或大段上游正文给 AI。
            var aliases = new List<string>();
            void Add(JsonElement value)
            {
                if (aliases.Count >= 12 || value.ValueKind != JsonValueKind.String) return;
                var text = value.GetString();
                if (text is { Length: > 0 and <= 128 } && !text.Any(char.IsControl)
                    && !text.Contains("://", StringComparison.Ordinal) && !aliases.Contains(text)) aliases.Add(text);
            }
            if (tmdb && root.TryGetProperty("alternative_titles", out var alternative) && alternative.ValueKind == JsonValueKind.Object)
            {
                foreach (var key in new[] { "titles", "results" })
                    if (alternative.TryGetProperty(key, out var list) && list.ValueKind == JsonValueKind.Array)
                        foreach (var item in list.EnumerateArray().Take(100))
                            if (item.ValueKind == JsonValueKind.Object && item.TryGetProperty("title", out var title)) Add(title);
            }
            if (!tmdb && root.TryGetProperty("infobox", out var infobox) && infobox.ValueKind == JsonValueKind.Array)
                foreach (var item in infobox.EnumerateArray().Take(100))
                    if (item.ValueKind == JsonValueKind.Object && Text(item, "key") is "别名" or "中文名"
                        && item.TryGetProperty("value", out var value))
                    {
                        if (value.ValueKind == JsonValueKind.String) Add(value);
                        else if (value.ValueKind == JsonValueKind.Array)
                            foreach (var alias in value.EnumerateArray().Take(12))
                                if (alias.ValueKind == JsonValueKind.Object && alias.TryGetProperty("v", out var text)) Add(text);
                    }
            var result = new { Provider = tmdb ? "Tmdb" : "Bangumi", Id = id, Fields = fields, Aliases = aliases };
            while (aliases.Count > 0 && JsonSerializer.SerializeToUtf8Bytes(result).Length > 4096) aliases.RemoveAt(aliases.Count - 1);
            return JsonSerializer.SerializeToUtf8Bytes(result).Length <= 4096 ? result : null;
        }
        catch (Exception) { return null; }
    }
    private static bool NumericId(string id) => id.Length is > 0 and <= 20 && id.All(char.IsAsciiDigit) && ulong.TryParse(id, out var number) && number > 0;
    private static string? Text(JsonElement json, string field) => json.TryGetProperty(field, out var value)
        && value.ValueKind == JsonValueKind.String && value.GetString() is { Length: <= 512 } text ? text : null;
    private static string Reason(Exception error) => error switch
    {
        OperationCanceledException => "upstream_timeout",
        HttpRequestException http when http.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden => "credential_rejected",
        HttpRequestException => "upstream_failed",
        JsonException => "invalid_upstream_json",
        InvalidDataException => "invalid_upstream_data",
        ApiAccessException => "source_not_allowed",
        _ => "configuration_invalid"
    };
    private static Settings TmdbSettings(FrontendDefaults defaults, PluginConfiguration configuration, Guid owner)
    {
        try
        {
            var value = MetadataOptions.FromDefaults(defaults, owner, "health-v1", configuration);
            return new(value.Enabled, value.BaseUri, value.AllowPrivate, value.ApiKey, value.Enabled && value.ApiKey.Length == 0 ? "not_configured" : null);
        }
        catch (ArgumentException) { return new(defaults.TmdbEpisodeMappingEnable == true, null, false, "", "configuration_invalid"); }
    }
    private static Settings BangumiSettings(FrontendDefaults defaults, PluginConfiguration configuration)
    {
        var enabled = defaults.BangumiEnable == true || defaults.BgmSearchFallbackEnable == true;
        var credential = defaults.BangumiToken ?? "";
        var address = string.IsNullOrWhiteSpace(defaults.BangumiApiPrefix) ? "https://api.bgm.tv" : defaults.BangumiApiPrefix.TrimEnd('/');
        if (address.Length > 2048 || !Uri.TryCreate(address, UriKind.Absolute, out var original) || original.Scheme is not ("http" or "https")
            || original.UserInfo.Length > 0 || original.Query.Length > 0 || original.Fragment.Length > 0
            || credential.Length > 4096 || credential.Any(c => char.IsControl(c) || char.IsWhiteSpace(c)))
            return new(enabled, null, false, "", "configuration_invalid");
        var uri = new Uri(address.EndsWith("/v0", StringComparison.OrdinalIgnoreCase) ? address + "/" : address + "/v0/");
        return new(enabled, uri, BackendSourcePolicy.IsApprovedPrivateBase(original, configuration)
            || BackendSourcePolicy.IsApprovedPrivateBase(uri, configuration), credential, null);
    }
    private static void Cancel(OwnerState state)
    {
        state.Stop.Cancel();
        // 取消后等待该作用域已启动的有界 I/O 收尾，再释放注册句柄。
        _ = ReleaseAsync(state);
    }
    private static async Task ReleaseAsync(OwnerState state)
    {
        try
        {
            var work = state.Evidence.Values.Select(entry => (Task)entry.Task).ToList();
            if (state.Probe is { } probe) work.Add(probe);
            await Task.WhenAll(work).ConfigureAwait(false);
        }
        catch (Exception) { /* 收尾不传播后台探测异常。 */ }
        finally { state.Stop.Dispose(); }
    }
    internal void Invalidate(Guid? owner = null)
    {
        lock (_gate)
        {
            if (owner is { } id) { if (_owners.Remove(id, out var state)) Cancel(state); }
            else { foreach (var state in _owners.Values) Cancel(state); _owners.Clear(); }
        }
    }
    public void Dispose()
    {
        lock (_gate) { if (_disposed) return; _disposed = true; _stop.Cancel(); foreach (var state in _owners.Values) Cancel(state); _owners.Clear(); }
        _http.Dispose(); _stop.Dispose();
    }
}
