namespace DD.Danmaku.Hosting;

using System.Security.Cryptography;
using MediaBrowser.Controller.Entities;

internal sealed record BackendVideoHashResult(string Mode, string? Hash, long? FileSize, string? Reason = null);

internal static class BackendVideoHash
{
    private const int ChunkSize = 16 * 1024 * 1024;
    private static readonly object Gate = new();
    private static readonly Dictionary<string, HashFlight> Flights = new(StringComparer.Ordinal);
    private sealed class HashFlight
    {
        internal readonly CancellationTokenSource Cancellation = new(TimeSpan.FromSeconds(30));
        internal Task<BackendVideoHashResult> Task = null!;
        internal int Waiters;
        internal bool Completed;
    }
    private static readonly HashSet<string> VideoExtensions = new(StringComparer.OrdinalIgnoreCase)
        { ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".m4v", ".ts", ".m2ts", ".mts", ".mpg", ".mpeg", ".webm", ".flv", ".vob", ".ogv", ".asf" };

    internal static async Task<BackendVideoHashResult> GetAsync(EmbyAccessControl access, User user,
        string itemId, EmbyPlaybackFileResolver resolver, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        // 即使父流程已授权，也再次检查；公开调用面仅接受 itemId，绝不接受 URL 或路径。
        var authorizedId = access.RequireVideo(user, itemId);
        string? path;
        try { path = await resolver.ResolveAsync(authorizedId, token).ConfigureAwait(false); }
        catch (IOException) { return Fallback("local_unavailable"); }
        catch (UnauthorizedAccessException) { return Fallback("local_unavailable"); }
        token.ThrowIfCancellationRequested();
        if (path is null || !VideoExtensions.Contains(Path.GetExtension(path))) return Fallback("local_unavailable");
        try
        {
            if (!SafeLocalFile(path)) return Fallback("local_unavailable");
            var file = new FileInfo(path);
            if (file.Length <= 0) return Fallback("empty_file");
            // 只保留进行中的计算；用户、条目、真实文件长度和修改时间隔离单飞，路径不进入 DTO。
            var key = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(
                System.Text.Json.JsonSerializer.Serialize(new[] { user.Id.ToString("N"), authorizedId, path,
                    file.Length.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    file.LastWriteTimeUtc.Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture) }))));
            HashFlight flight;
            lock (Gate)
            {
                if (!Flights.TryGetValue(key, out flight!))
                {
                    if (Flights.Count >= 16) return Fallback("hash_busy");
                    flight = new HashFlight();
                    flight.Task = CalculateAsync(path, file.Length, file.LastWriteTimeUtc, flight.Cancellation.Token);
                    Flights[key] = flight;
                    flight.Waiters++;
                    _ = FinishAsync(key, flight);
                }
                else flight.Waiters++;
            }
            try { return await flight.Task.WaitAsync(token).ConfigureAwait(false); }
            finally
            {
                lock (Gate)
                {
                    flight.Waiters--;
                    // 最后一名等待者离开才中断真实文件读取；切集取消不能伤及仍在等待的请求。
                    if (flight.Waiters == 0 && !flight.Completed)
                    {
                        if (Flights.TryGetValue(key, out var current) && ReferenceEquals(current, flight))
                            Flights.Remove(key);
                        flight.Cancellation.Cancel();
                    }
                }
            }
        }
        catch (IOException) { return Fallback("local_unavailable"); }
        catch (UnauthorizedAccessException) { return Fallback("local_unavailable"); }
    }

    private static async Task FinishAsync(string key, HashFlight flight)
    {
        try { await flight.Task.ConfigureAwait(false); }
        catch (Exception) { /* 失败不缓存，取消由等待者自行处理。 */ }
        finally
        {
            lock (Gate)
            {
                flight.Completed = true;
                if (Flights.TryGetValue(key, out var current) && ReferenceEquals(current, flight))
                    Flights.Remove(key);
                flight.Cancellation.Dispose();
            }
        }
    }

    // 拒绝 STRM、目录、符号链接及父目录链接；不解析 STRM 文本中的远程地址。
    private static bool SafeLocalFile(string path)
    {
        if (!Path.IsPathFullyQualified(path) || path.Any(char.IsControl)) return false;
        for (var current = path; current is not null; current = Path.GetDirectoryName(current))
        {
            var attributes = File.GetAttributes(current);
            if ((attributes & FileAttributes.ReparsePoint) != 0) return false;
            if (current == path && (attributes & FileAttributes.Directory) != 0) return false;
            var parent = Path.GetDirectoryName(current);
            if (parent == current || string.IsNullOrEmpty(parent)) break;
        }
        return true;
    }

    private static async Task<BackendVideoHashResult> CalculateAsync(string path, long size, DateTime modified,
        CancellationToken token)
    {
        try
        {
            await Task.Yield();
            token.ThrowIfCancellationRequested();
            if (!SafeLocalFile(path)) return Fallback("local_unavailable");
            await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read,
                128 * 1024, FileOptions.Asynchronous | FileOptions.RandomAccess);
            if (file.Length != size) return Fallback("file_changed");
            using var md5 = IncrementalHash.CreateHash(HashAlgorithmName.MD5);
            var buffer = new byte[128 * 1024];
            // 与 ede.js calculateFileHash 一致：小于 32 MiB 全量，否则头尾各 16 MiB 顺序拼接。
            if (size < 2L * ChunkSize)
                await AppendAsync(file, md5, buffer, size, token).ConfigureAwait(false);
            else
            {
                await AppendAsync(file, md5, buffer, ChunkSize, token).ConfigureAwait(false);
                file.Seek(size - ChunkSize, SeekOrigin.Begin);
                await AppendAsync(file, md5, buffer, ChunkSize, token).ConfigureAwait(false);
            }
            if (file.Length != size || File.GetLastWriteTimeUtc(path) != modified || !SafeLocalFile(path))
                return Fallback("file_changed");
            return new("localhash", Convert.ToHexString(md5.GetHashAndReset()).ToLowerInvariant(), size);
        }
        catch (OperationCanceledException) { return Fallback("hash_timeout"); }
        catch (IOException) { return Fallback("local_unavailable"); }
        catch (UnauthorizedAccessException) { return Fallback("local_unavailable"); }
    }

    private static async Task AppendAsync(FileStream file, IncrementalHash hash, byte[] buffer, long remaining,
        CancellationToken token)
    {
        while (remaining > 0)
        {
            var read = await file.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, remaining)), token)
                .ConfigureAwait(false);
            if (read == 0) throw new EndOfStreamException("视频文件在哈希过程中发生变化");
            hash.AppendData(buffer, 0, read);
            remaining -= read;
        }
    }

    private static BackendVideoHashResult Fallback(string reason) => new("filenamefallback", null, null, reason);
}
