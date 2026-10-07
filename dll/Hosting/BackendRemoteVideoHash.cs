namespace DD.Danmaku.Hosting;

using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.MediaInfo;

// 仅从 Emby 已授权媒体源取得远程文件；不接受客户端 URL、路径或认证上下文。
internal static class BackendRemoteVideoHash
{
    private const long MaxFileSize = 1_000_000_000_000L;
    private const int ChunkSize = 16 * 1024 * 1024;
    private const int BufferSize = 128 * 1024;
    private static readonly object Gate = new();
    private static readonly Dictionary<string, Flight> Flights = new(StringComparer.Ordinal);
    private static readonly SemaphoreSlim Slots = new(4, 4);
    private static readonly HttpClient PublicClient = CreateClient();
    private static readonly HttpClient PrivateClient = CreateClient();
    private static HttpClient CreateClient()
    {
        var handler = BackendSourcePolicy.CreateHandler();
        // 哈希必须读取原文件字节，不能由 HTTP 自动解压改变输入。
        handler.AutomaticDecompression = DecompressionMethods.None;
        return new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
    }
    private sealed class Flight
    {
        internal readonly CancellationTokenSource Stop = new(TimeSpan.FromSeconds(30));
        internal Task<BackendVideoHashResult> Task = null!;
        internal int Waiters;
        internal bool Completed;
    }

    internal static async Task<BackendVideoHashResult> GetAsync(EmbyAccessControl access, User user,
        string itemId, IMediaSourceManager mediaSources, PluginConfiguration configuration,
        CancellationToken token, string? mediaSourceId = null)
    {
        token.ThrowIfCancellationRequested();
        if (mediaSources is null || configuration is null || mediaSourceId is { Length: > 160 }
            || mediaSourceId?.Any(char.IsControl) == true)
            return Fallback("invalid_media_source_request");
        BaseItem item;
        try { item = access.RequireVideoItem(user, itemId); }
        catch (ApiAccessException) { throw; }
        catch (ArgumentException) { return Fallback("invalid_item_id"); }
        List<MediaSourceInfo> sources;
        try { sources = BackendMediaSources.Read(mediaSources, item, user); }
        catch (OperationCanceledException) { throw; }
        catch (Exception) { return Fallback("media_source_unavailable"); }
        token.ThrowIfCancellationRequested();
        if (sources.Count > 100) return Fallback("media_source_ambiguous");
        var candidates = sources.Where(source => IsCandidate(source, mediaSourceId)
            && (string.IsNullOrEmpty(source.ItemId) || source.ItemId == item.Id.ToString("N")
                || source.ItemId == itemId)).ToArray();
        if (mediaSourceId is not null && candidates.Length != 1) return Fallback("media_source_not_found");
        if (mediaSourceId is null && candidates.Length != 1) return Fallback(candidates.Length == 0
            ? "media_source_not_found" : "media_source_ambiguous");
        var source = candidates[0];
        if (!TrySourceUri(source, out var uri) || !TryHeaders(source.RequiredHttpHeaders, out var headers))
            return Fallback("media_source_invalid");
        if (uri.AbsolutePath.EndsWith(".strm", StringComparison.OrdinalIgnoreCase))
            return Fallback("strm_not_hashable");
        var allowPrivate = IsApprovedPrivate(uri, configuration);
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(
            new { User = user.Id, Item = item.Id, Source = source.Id, Address = uri.AbsoluteUri, Private = allowPrivate,
                Headers = headers.OrderBy(entry => entry.Key, StringComparer.OrdinalIgnoreCase).ToArray() }))));
        Flight flight;
        lock (Gate)
        {
            if (!Flights.TryGetValue(key, out flight!))
            {
                if (Flights.Count >= 4) return Fallback("hash_busy");
                flight = new Flight();
                flight.Task = CalculateAsync(uri, headers, allowPrivate, flight.Stop.Token);
                Flights[key] = flight;
                _ = FinishAsync(key, flight);
            }
            flight.Waiters++;
        }
        try { return await flight.Task.WaitAsync(token).ConfigureAwait(false); }
        finally
        {
            lock (Gate)
            {
                flight.Waiters--;
                if (flight.Waiters == 0 && !flight.Completed)
                {
                    if (Flights.TryGetValue(key, out var current) && ReferenceEquals(current, flight)) Flights.Remove(key);
                    flight.Stop.Cancel();
                }
            }
        }
    }

    private static bool IsCandidate(MediaSourceInfo source, string? requestedId)
    {
        if (source is null || source.Protocol != MediaProtocol.Http || source.IsInfiniteStream || source.IsRemote == false
            || source.RequiresOpening || source.RequiresClosing || source.RequiresLooping || !string.IsNullOrEmpty(source.LiveStreamId)
            || string.IsNullOrWhiteSpace(source.Path) || string.IsNullOrWhiteSpace(source.Id)
            || source.Path.Contains(".m3u8", StringComparison.OrdinalIgnoreCase)
            || source.Path.Contains(".mpd", StringComparison.OrdinalIgnoreCase)) return false;
        return requestedId is null || string.Equals(source.Id, requestedId, StringComparison.Ordinal);
    }

    private static bool TrySourceUri(MediaSourceInfo source, out Uri uri)
    {
        uri = null!;
        if (source.Path is null || source.Path.Length > 8192 || source.Path.Any(char.IsControl)
            || !Uri.TryCreate(source.Path, UriKind.Absolute, out var parsed)) return false;
        uri = parsed;
        if (uri.Scheme is not ("http" or "https")
            || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0 || uri.Host.Length == 0) return false;
        return true;
    }

    private static bool TryHeaders(Dictionary<string, string>? input, out Dictionary<string, string> headers)
    {
        headers = new(StringComparer.OrdinalIgnoreCase);
        if (input is null) return true;
        if (input.Count > 32) return false;
        foreach (var pair in input)
        {
            if (pair.Key.Length is 0 or > 128 || pair.Value is null || pair.Value.Length > 2048
                || new[] { "Host", "Range", "Connection", "Transfer-Encoding", "Content-Length", "Accept-Encoding",
                    "If-Match", "If-Unmodified-Since", "Proxy-Authorization", "Proxy-Connection" }
                    .Contains(pair.Key, StringComparer.OrdinalIgnoreCase)
                || pair.Value.Contains("MediaBrowser ", StringComparison.OrdinalIgnoreCase)
                || pair.Key.Any(c => c is not (>= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '-'))
                || pair.Value.Any(char.IsControl) || pair.Key.Equals("Cookie", StringComparison.OrdinalIgnoreCase)
                || pair.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase)
                || pair.Key.Equals("X-Emby-Token", StringComparison.OrdinalIgnoreCase)
                || pair.Key.Equals("X-MediaBrowser-Token", StringComparison.OrdinalIgnoreCase)
                || pair.Key.Equals("MediaBrowser", StringComparison.OrdinalIgnoreCase)) return false;
            headers[pair.Key] = pair.Value;
        }
        return true;
    }

    private static bool IsApprovedPrivate(Uri target, PluginConfiguration configuration)
    {
        IEnumerable<string?> values = configuration.BackendPrivateSourcePrefixes ?? [];
        if (configuration.DanmakuProxyEnabled) values = values.Append(configuration.DanmakuProxyBaseUrl);
        foreach (var value in values)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var approved) || approved.Scheme is not ("http" or "https")
                || approved.UserInfo.Length != 0 || approved.Query.Length != 0 || approved.Fragment.Length != 0) continue;
            if (!string.Equals(target.Scheme, approved.Scheme, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(target.Host, approved.Host, StringComparison.OrdinalIgnoreCase)
                || target.Port != approved.Port) continue;
            var path = approved.AbsolutePath.TrimEnd('/');
            if (target.AbsolutePath.Equals(path, StringComparison.Ordinal) || target.AbsolutePath.StartsWith(path + "/", StringComparison.Ordinal)) return true;
        }
        return false;
    }

    private static async Task<BackendVideoHashResult> CalculateAsync(Uri uri, Dictionary<string, string> headers,
        bool allowPrivate, CancellationToken token)
    {
        var entered = false;
        try
        {
            await Task.Yield();
            token.ThrowIfCancellationRequested();
            await Slots.WaitAsync(token).ConfigureAwait(false);
            entered = true;
            var client = allowPrivate ? PrivateClient : PublicClient;
            using var head = await SendAsync(client, HttpMethod.Head, uri, headers, null, allowPrivate, token).ConfigureAwait(false);
            if ((int)head.StatusCode is < 200 or >= 300 || !FileResponse(head)
                || !TryLength(head, out var size) || size <= 0 || size > MaxFileSize)
                return Fallback("remote_size_unavailable");
            var etag = head.Headers.ETag?.IsWeak == false ? head.Headers.ETag.Tag : null;
            var lastModified = head.Content.Headers.LastModified;
            if (etag is null && lastModified is null) return Fallback("remote_version_unverifiable");
            var conditions = new Dictionary<string, string>(headers, StringComparer.OrdinalIgnoreCase);
            if (etag is not null) conditions["If-Match"] = etag;
            else conditions["If-Unmodified-Since"] = lastModified!.Value.ToUniversalTime().ToString("R", System.Globalization.CultureInfo.InvariantCulture);
            using var md5 = IncrementalHash.CreateHash(HashAlgorithmName.MD5);
            if (size < 2L * ChunkSize)
            {
                using var full = await SendAsync(client, HttpMethod.Get, uri, conditions, null, allowPrivate, token).ConfigureAwait(false);
                if (!SameVersion(full, etag, lastModified) || full.StatusCode != HttpStatusCode.OK || !await AppendExactAsync(full, md5, size, token).ConfigureAwait(false)) return Fallback("remote_content_changed");
            }
            else
            {
                if (!await AppendRangeAsync(client, uri, conditions, 0, ChunkSize - 1, size, md5, allowPrivate, token).ConfigureAwait(false)
                    || !await AppendRangeAsync(client, uri, conditions, size - ChunkSize, size - 1, size, md5, allowPrivate, token).ConfigureAwait(false))
                    return Fallback("remote_content_changed");
            }
            return new("remotehash", Convert.ToHexString(md5.GetHashAndReset()).ToLowerInvariant(), size);
        }
        catch (ApiAccessException) { return Fallback("remote_target_denied"); }
        catch (OperationCanceledException) { return Fallback("hash_timeout"); }
        catch (HttpRequestException) { return Fallback("remote_unavailable"); }
        catch (IOException) { return Fallback("remote_unavailable"); }
        finally { if (entered) Slots.Release(); }
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, Uri uri,
        Dictionary<string, string> headers, string? range, bool allowPrivate, CancellationToken token)
    {
        await BackendSourcePolicy.RequireSafeTargetAsync(uri, allowPrivate, token).ConfigureAwait(false);
        using var request = new HttpRequestMessage(method, uri);
        foreach (var pair in headers) request.Headers.TryAddWithoutValidation(pair.Key, pair.Value);
        if (range is not null) request.Headers.TryAddWithoutValidation("Range", range);
        request.Headers.AcceptEncoding.ParseAdd("identity");
        request.Options.Set(BackendSourcePolicy.AllowPrivateOption, allowPrivate);
        return await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
    }

    private static bool FileResponse(HttpResponseMessage response)
    {
        var type = response.Content.Headers.ContentType?.MediaType;
        return !response.Content.Headers.ContentEncoding.Any(encoding => !encoding.Equals("identity", StringComparison.OrdinalIgnoreCase))
            && type is not null && (type.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
                || type.Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase))
            && !type.Contains("mpegurl", StringComparison.OrdinalIgnoreCase);
    }

    private static bool SameVersion(HttpResponseMessage response, string? etag, DateTimeOffset? modified)
        => etag is not null ? response.Headers.ETag?.Tag == etag && response.Headers.ETag?.IsWeak == false
            : modified is not null && response.Content.Headers.LastModified == modified;

    private static bool TryLength(HttpResponseMessage response, out long length)
    {
        length = response.Content.Headers.ContentLength ?? -1;
        return length >= 0;
    }

    private static async Task<bool> AppendRangeAsync(HttpClient client, Uri uri, Dictionary<string, string> headers,
        long start, long end, long total, IncrementalHash md5, bool allowPrivate, CancellationToken token)
    {
        using var response = await SendAsync(client, HttpMethod.Get, uri, headers, $"bytes={start}-{end}", allowPrivate, token).ConfigureAwait(false);
        if (!SameVersion(response, headers.TryGetValue("If-Match", out var etag) ? etag : null,
                headers.TryGetValue("If-Unmodified-Since", out var modified) && DateTimeOffset.TryParse(modified, out var date) ? date : null)
            || response.StatusCode != HttpStatusCode.PartialContent || response.Content.Headers.ContentLength != end - start + 1
            || response.Content.Headers.ContentRange?.Unit != "bytes"
            || response.Content.Headers.ContentRange?.From != start || response.Content.Headers.ContentRange?.To != end
            || response.Content.Headers.ContentRange?.Length != total) return false;
        return await AppendExactAsync(response, md5, end - start + 1, token).ConfigureAwait(false);
    }

    private static async Task<bool> AppendExactAsync(HttpResponseMessage response, IncrementalHash md5,
        long expected, CancellationToken token)
    {
        if (!FileResponse(response) || response.Content.Headers.ContentLength != expected || expected > ChunkSize * 2L) return false;
        await using var stream = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false);
        var buffer = new byte[BufferSize]; long remaining = expected;
        while (remaining > 0)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(0, (int)Math.Min(BufferSize, remaining)), token).ConfigureAwait(false);
            if (read <= 0) return false;
            md5.AppendData(buffer, 0, read); remaining -= read;
        }
        var extra = await stream.ReadAsync(buffer.AsMemory(0, 1), token).ConfigureAwait(false);
        return extra == 0;
    }

    private static async Task FinishAsync(string key, Flight flight)
    {
        try { await flight.Task.ConfigureAwait(false); }
        catch { }
        finally { lock (Gate) { flight.Completed = true; if (Flights.TryGetValue(key, out var current) && ReferenceEquals(current, flight)) Flights.Remove(key); flight.Stop.Dispose(); } }
    }

    private static BackendVideoHashResult Fallback(string reason) => new("filenamefallback", null, null, reason);
}
