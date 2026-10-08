namespace DD.Danmaku.Hosting;

using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using MediaBrowser.Controller.Configuration;

// 兼容旧 SDK 的媒体源签名：只访问注入配置指定的本机 REST，不信任 Host 或客户端 URL。
internal sealed class BackendEmbyRestHash : IDisposable
{
    private const int ChunkSize = 16 * 1024 * 1024;
    private const int JsonLimit = 4 * 1024 * 1024;
    private const long MaxSize = 1_000_000_000_000L;
    private static readonly HashSet<string> Containers = new(StringComparer.OrdinalIgnoreCase)
        { "mkv", "mp4", "avi", "mov", "wmv", "m4v", "ts", "m2ts", "mts", "mpg", "mpeg", "webm", "flv", "vob", "ogv", "asf" };
    private static readonly SemaphoreSlim Slots = new(4, 4);
    private readonly HttpClient _client;
    private readonly Uri _base;

    // 仅隔离测试可注入 handler；生产入口始终创建禁止重定向、代理、Cookie 和解压的客户端。
    internal BackendEmbyRestHash(HttpMessageHandler handler, Uri trustedBase)
    {
        if (trustedBase.Scheme != "http" || trustedBase.Host != "127.0.0.1" || trustedBase.Port is < 1 or > 65535
            || trustedBase.AbsolutePath != "/" || trustedBase.Query.Length != 0 || trustedBase.Fragment.Length != 0
            || trustedBase.UserInfo.Length != 0) throw new ArgumentException("本机地址无效");
        _base = trustedBase;
        _client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
    }

    internal static Uri? TrustedBase(IServerConfigurationManager manager)
    {
        // 只反射宿主 DI 配置对象的已知端口成员，避免新版宿主变更属性签名引发加载错误。
        try
        {
            var configuration = manager.Configuration;
            foreach (var name in new[] { "LocalHttpServerPort", "HttpServerPortNumber", "HttpServerPort" })
            {
                var value = configuration.GetType().GetProperty(name)?.GetValue(configuration);
                if (value is int port && port is > 0 and <= 65535)
                    return new Uri($"http://127.0.0.1:{port}/");
            }
        }
        catch (Exception error) when (error is System.Reflection.TargetInvocationException or MissingMemberException
            or ArgumentException or InvalidOperationException or NullReferenceException) { }
        return null;
    }

    internal static async Task<BackendVideoHashResult> GetAsync(Uri? trustedBase, Guid owner, string item,
        string? requestedSource, string? ownToken, Func<CancellationToken, Task> authorize, CancellationToken token,
        long ownerInternalId = 0, long itemInternalId = 0)
    {
        if (trustedBase is null) return Fallback("emby_port_unavailable");
        using var reader = new BackendEmbyRestHash(new HttpClientHandler
        {
            AllowAutoRedirect = false, UseProxy = false, UseCookies = false,
            AutomaticDecompression = DecompressionMethods.None
        }, trustedBase);
        return await reader.CalculateAsync(owner, item, requestedSource, ownToken, authorize, token, ownerInternalId, itemInternalId).ConfigureAwait(false);
    }

    internal async Task<BackendVideoHashResult> CalculateAsync(Guid owner, string item, string? requestedSource,
        string? ownToken, Func<CancellationToken, Task> authorize, CancellationToken token,
        long ownerInternalId = 0, long itemInternalId = 0)
    {
        token.ThrowIfCancellationRequested();
        if (owner == Guid.Empty || !Guid.TryParseExact(item, "N", out var itemGuid) || itemGuid == Guid.Empty
            || string.IsNullOrWhiteSpace(ownToken) || ownToken.Length > 4096 || ownToken.Any(char.IsControl)
            || requestedSource is { Length: > 256 } || requestedSource?.Any(char.IsControl) == true)
            return Fallback("emby_request_invalid");
        var apiItem = itemInternalId > 0 ? itemInternalId.ToString(CultureInfo.InvariantCulture) : item;
        var apiUser = ownerInternalId > 0 ? ownerInternalId.ToString(CultureInfo.InvariantCulture) : owner.ToString("N");
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(token);
        budget.CancelAfter(TimeSpan.FromSeconds(30));
        var stop = budget.Token;
        // 授权委托异常不在传输异常捕获范围内，撤销本人权限必须终止任务。
        async Task Check()
        {
            stop.ThrowIfCancellationRequested();
            try { await authorize(stop).ConfigureAwait(false); }
            catch (Exception error) { throw new AuthorizationFailure(error); }
            stop.ThrowIfCancellationRequested();
        }
        var entered = false;
        try
        {
            await Slots.WaitAsync(stop).ConfigureAwait(false);
            entered = true;
            // 再以同一令牌核验本机用户身份，不能用管理员或其它用户播放信息作哈希。
            using var identityRequest = new HttpRequestMessage(HttpMethod.Get, new Uri(_base, "emby/Users/Me"));
            using var identity = await SendAsync(identityRequest, ownToken, Check, stop).ConfigureAwait(false);
            if (identity.StatusCode != HttpStatusCode.OK) return Fallback("emby_identity_unavailable");
            var identityBytes = await ReadJsonAsync(identity, Check, stop).ConfigureAwait(false);
            if (identityBytes is null) return Fallback("emby_identity_invalid");
            using var identityDocument = JsonDocument.Parse(identityBytes, new JsonDocumentOptions { MaxDepth = 32 });
            if (!Unique(identityDocument.RootElement) || identityDocument.RootElement.ValueKind != JsonValueKind.Object
                || Text(identityDocument.RootElement, "Id") is null) return Fallback("emby_identity_invalid");
            if (!BoundId(Text(identityDocument.RootElement, "Id"), owner, ownerInternalId))
                throw new ApiAccessException(403, "ITEM_ACCESS_DENIED", "本机令牌用户不匹配");
            using var playback = new HttpRequestMessage(HttpMethod.Post, new Uri(_base, $"emby/Items/{apiItem}/PlaybackInfo"));
            playback.Content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(new
            {
                UserId = apiUser, MediaSourceId = requestedSource, IsPlayback = false,
                AutoOpenLiveStream = false, EnableTranscoding = false, EnableDirectPlay = true, EnableDirectStream = true
            }));
            playback.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            using var info = await SendAsync(playback, ownToken, Check, stop).ConfigureAwait(false);
            if (info.StatusCode != HttpStatusCode.OK) return Fallback("emby_playback_unavailable");
            var bytes = await ReadJsonAsync(info, Check, stop).ConfigureAwait(false);
            if (bytes is null) return Fallback("emby_playback_invalid");
            using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 32 });
            var root = document.RootElement;
            if (!Unique(root) || root.ValueKind != JsonValueKind.Object) return Fallback("emby_playback_invalid");
            if (root.TryGetProperty("UserId", out var responseUser)
                && (responseUser.ValueKind != JsonValueKind.String || !BoundId(responseUser.GetString(), owner, ownerInternalId)))
                throw new ApiAccessException(403, "ITEM_ACCESS_DENIED", "本机播放信息用户不匹配");
            if (!root.TryGetProperty("MediaSources", out var sources) || sources.ValueKind != JsonValueKind.Array
                || sources.GetArrayLength() is 0 or > 100) return Fallback("emby_media_source_invalid");
            var candidates = sources.EnumerateArray().Where(source => requestedSource is null
                || Text(source, "Id") == requestedSource).ToArray();
            if (candidates.Length != 1) return Fallback("emby_media_source_ambiguous");
            var selected = candidates[0];
            if (selected.ValueKind != JsonValueKind.Object) return Fallback("emby_media_source_invalid");
            var sourceId = Text(selected, "Id");
            var container = Text(selected, "Container");
            var session = Text(root, "PlaySessionId");
            if (!SafeValue(sourceId, 256) || !SafeValue(container, 16) || !Containers.Contains(container!)
                || session is not null && !SafeValue(session, 256)
                || Flag(selected, "IsInfiniteStream") || Flag(selected, "RequiresOpening") || Flag(selected, "RequiresClosing")
                || Flag(selected, "RequiresLooping") || !string.IsNullOrEmpty(Text(selected, "LiveStreamId")))
                return Fallback("emby_media_source_invalid");
            var sourceItem = Text(selected, "ItemId");
            if (sourceItem is not null && !BoundId(sourceItem, itemGuid, itemInternalId))
                return Fallback("emby_media_source_invalid");
            var path = $"emby/Videos/{apiItem}/stream?Static=true&MediaSourceId={Uri.EscapeDataString(sourceId!)}&Container={Uri.EscapeDataString(container!)}";
            if (session is not null) path += "&PlaySessionId=" + Uri.EscapeDataString(session);
            var uri = new Uri(_base, path);
            using var probeRequest = RangeRequest(uri, 0, 0, null, null);
            using var probe = await SendAsync(probeRequest, ownToken, Check, stop).ConfigureAwait(false);
            var size = probe.Content.Headers.ContentRange?.Length ?? -1;
            if (size is <= 0 or > MaxSize || !RangeResponse(probe, 0, 0, size)) return Fallback("emby_range_unavailable");
            if (selected.TryGetProperty("Size", out var sourceSize)
                && sourceSize.ValueKind != JsonValueKind.Null
                && (sourceSize.ValueKind != JsonValueKind.Number || !sourceSize.TryGetInt64(out var declaredSize) || declaredSize != size))
                return Fallback("emby_content_changed");
            var etag = probe.Headers.ETag?.IsWeak == false ? probe.Headers.ETag.Tag : null;
            var modified = probe.Content.Headers.LastModified;
            if (etag is null && modified is null) return Fallback("emby_version_unverifiable");
            if (!await AppendAsync(probe, null, 1, Check, stop).ConfigureAwait(false)) return Fallback("emby_content_changed");
            using var md5 = IncrementalHash.CreateHash(HashAlgorithmName.MD5);
            // 与原生文件/远程哈希完全一致：小于 32 MiB 全量，其他情况头尾各 16 MiB。
            var ranges = size < 2L * ChunkSize ? new[] { (0L, size - 1) }
                : new[] { (0L, ChunkSize - 1L), (size - ChunkSize, size - 1) };
            foreach (var (start, end) in ranges)
            {
                using var request = RangeRequest(uri, start, end, etag, modified);
                using var response = await SendAsync(request, ownToken, Check, stop).ConfigureAwait(false);
                if (!RangeResponse(response, start, end, size)
                    || (etag is not null ? response.Headers.ETag?.IsWeak != false || response.Headers.ETag.Tag != etag
                        : response.Content.Headers.LastModified != modified)
                    || !await AppendAsync(response, md5, end - start + 1, Check, stop).ConfigureAwait(false))
                    return Fallback("emby_content_changed");
            }
            await Check().ConfigureAwait(false);
            return new("remotehash", Convert.ToHexString(md5.GetHashAndReset()).ToLowerInvariant(), size);
        }
        catch (AuthorizationFailure failure)
        {
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure.InnerException!).Throw();
            throw;
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { return Fallback("hash_timeout"); }
        catch (HttpRequestException) { return Fallback("emby_transport_unavailable"); }
        catch (IOException) { return Fallback("emby_transport_unavailable"); }
        catch (JsonException) { return Fallback("emby_playback_invalid"); }
        finally { ownToken = null; if (entered) Slots.Release(); }
    }

    private async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, string token,
        Func<Task> check, CancellationToken stop)
    {
        await check().ConfigureAwait(false);
        request.Headers.Add("X-Emby-Token", token);
        request.Headers.AcceptEncoding.ParseAdd("identity");
        HttpResponseMessage? response = null;
        try
        {
            response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, stop).ConfigureAwait(false);
            await check().ConfigureAwait(false);
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                throw new ApiAccessException((int)response.StatusCode, response.StatusCode == HttpStatusCode.Unauthorized
                    ? "AUTH_REQUIRED" : "ITEM_ACCESS_DENIED", "本机媒体请求授权已失效");
            return response;
        }
        catch { response?.Dispose(); throw; }
        finally { request.Headers.Remove("X-Emby-Token"); }
    }

    private static HttpRequestMessage RangeRequest(Uri uri, long start, long end, string? etag, DateTimeOffset? modified)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Range = new RangeHeaderValue(start, end);
        if (etag is not null) request.Headers.IfMatch.Add(new EntityTagHeaderValue(etag));
        else if (modified is not null) request.Headers.IfUnmodifiedSince = modified;
        return request;
    }

    private static bool RangeResponse(HttpResponseMessage response, long start, long end, long size)
    {
        var range = response.Content.Headers.ContentRange;
        var type = response.Content.Headers.ContentType?.MediaType;
        return response.StatusCode == HttpStatusCode.PartialContent && range?.Unit == "bytes"
            && range.From == start && range.To == end && range.Length == size
            && response.Content.Headers.ContentLength == end - start + 1
            && !response.Content.Headers.ContentEncoding.Any(value => !value.Equals("identity", StringComparison.OrdinalIgnoreCase))
            && type is not null && (type.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                || type.Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase));
    }

    private static async Task<bool> AppendAsync(HttpResponseMessage response, IncrementalHash? hash, long expected,
        Func<Task> check, CancellationToken stop)
    {
        await check().ConfigureAwait(false);
        await using var stream = await response.Content.ReadAsStreamAsync(stop).ConfigureAwait(false);
        await check().ConfigureAwait(false);
        var buffer = new byte[128 * 1024];
        while (expected > 0)
        {
            stop.ThrowIfCancellationRequested();
            var count = await stream.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, expected)), stop).ConfigureAwait(false);
            stop.ThrowIfCancellationRequested();
            if (count == 0) return false;
            hash?.AppendData(buffer, 0, count);
            expected -= count;
        }
        var extra = await stream.ReadAsync(buffer.AsMemory(0, 1), stop).ConfigureAwait(false);
        await check().ConfigureAwait(false);
        return extra == 0;
    }

    private static async Task<byte[]?> ReadJsonAsync(HttpResponseMessage response, Func<Task> check, CancellationToken stop)
    {
        if (response.Content.Headers.ContentLength is > JsonLimit
            || response.Content.Headers.ContentEncoding.Any(value => !value.Equals("identity", StringComparison.OrdinalIgnoreCase))) return null;
        await check().ConfigureAwait(false);
        await using var stream = await response.Content.ReadAsStreamAsync(stop).ConfigureAwait(false);
        await check().ConfigureAwait(false);
        using var data = new MemoryStream();
        var buffer = new byte[64 * 1024];
        while (true)
        {
            stop.ThrowIfCancellationRequested();
            var count = await stream.ReadAsync(buffer.AsMemory(0, Math.Min(buffer.Length, JsonLimit + 1 - (int)data.Length)), stop).ConfigureAwait(false);
            stop.ThrowIfCancellationRequested();
            if (count == 0)
            {
                await check().ConfigureAwait(false);
                return data.ToArray();
            }
            data.Write(buffer, 0, count);
            if (data.Length > JsonLimit)
            {
                await check().ConfigureAwait(false);
                return null;
            }
        }
    }

    private sealed class AuthorizationFailure(Exception error) : Exception("授权检查失败", error);
    private static bool Unique(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var property in value.EnumerateObject())
                if (!names.Add(property.Name) || !Unique(property.Value)) return false;
        }
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray()) if (!Unique(item)) return false;
        return true;
    }
    private static string? Text(JsonElement value, string name) => value.ValueKind == JsonValueKind.Object
        && value.TryGetProperty(name, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString() : null;
    private static bool BoundId(string? value, Guid guid, long numeric) => value is not null
        && (numeric > 0 && value == numeric.ToString(CultureInfo.InvariantCulture)
            || Guid.TryParse(value, out var parsed) && parsed == guid);
    private static bool Flag(JsonElement value, string name) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var field)
        && field.ValueKind != JsonValueKind.False && field.ValueKind != JsonValueKind.Null;
    private static bool SafeValue(string? value, int limit) => !string.IsNullOrWhiteSpace(value)
        && value.Length <= limit && !value.Any(char.IsControl);
    private static BackendVideoHashResult Fallback(string reason) => new("filenamefallback", null, null, reason);
    public void Dispose() => _client.Dispose();
}
