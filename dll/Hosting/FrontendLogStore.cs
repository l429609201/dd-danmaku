namespace DD.Danmaku.Hosting;

using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// 固定文件集合与全局轮转锁保证所有用户共享容量上限。
internal sealed class FrontendLogStore : IDisposable
{
    internal const int MaxFileBytes = 2 * 1024 * 1024;
    internal const int MaxFiles = 5;
    private readonly string _directory;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, Queue<long>> _uploads = new(StringComparer.Ordinal);
    internal bool Ready { get; private set; }
    internal sealed record Entry(DateTimeOffset Timestamp, DateTimeOffset ReceivedAt, string UserId,
        string SessionId, string Level, string Message);
    internal sealed record LogFile(string Id, long SizeBytes, DateTimeOffset UpdatedAt);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly Regex Secrets = new(
        "(?i)(?:[\"']?)(?:authorization|proxy-authorization|cookie|set-cookie|x-emby-token|x-mediabrowser-token|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|passwd|secret|credential)(?:[\"']?)\\s*[:=]\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s,;}&]+)",
        RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
    private static readonly Regex Headers = new(@"(?im)\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*",
        RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
    private static readonly Regex Locations = new(
        @"(?i)\b[a-z][a-z0-9+.-]*://[^\s<>""']+|(?:[a-z]:[\\/]|\\\\|/)[^\s<>""']+|\b(?:[\w.-]+[\\/])+[^\s<>""']+|\b(?:bearer|basic)\s+[^\s,;]+|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)?|\b[a-f0-9]{32,64}\b",
        RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));

    internal FrontendLogStore(string dataDirectory)
    {
        _directory = Path.GetFullPath(Path.Combine(dataDirectory, "Logs"));
        try
        {
            CheckDirectory();
            Directory.CreateDirectory(_directory);
            var temporary = CheckedPath("rewrite.tmp");
            if (File.Exists(temporary)) File.Delete(temporary);
            // 重启仅恢复容量内的完整合法行，丢弃损坏尾行和超限内容。
            foreach (var id in Ids()) Repair(id);
            Ready = true;
        }
        catch (IOException) { Ready = false; }
        catch (UnauthorizedAccessException) { Ready = false; }
    }

    internal async Task<int> AppendAsync(string userId, FrontendLogBatch batch, CancellationToken token)
    {
        if (batch.SessionId is null || batch.SessionId.Length is < 1 or > 128
            || batch.Entries is null || batch.Entries.Count is < 1 or > 100)
            throw new ArgumentException("日志批次无效");
        var now = DateTimeOffset.UtcNow;
        var session = Sanitize(batch.SessionId);
        var lines = new List<byte[]>(batch.Entries.Count);
        foreach (var item in batch.Entries)
        {
            if (item is null || item.Message is null || item.Message.Length > 2048 || item.Timestamp is null)
                throw new ArgumentException("日志条目无效");
            lines.Add(Encode(new(item.Timestamp.Value, now, userId, session, NormalizeLevel(item.Level), Sanitize(item.Message))));
        }
        await _gate.WaitAsync(token);
        try
        {
            RequireReady();
            RateLimit(userId);
            foreach (var line in lines)
            {
                token.ThrowIfCancellationRequested();
                var current = FilePath("current");
                if (File.Exists(current) && new FileInfo(current).Length + line.Length > MaxFileBytes) Rotate();
                // 单行写入；中断导致的残行由重启修复。
                using var stream = new FileStream(FilePath("current"), FileMode.Append, FileAccess.Write, FileShare.Read);
                stream.Write(line);
            }
            return lines.Count;
        }
        finally { _gate.Release(); }
    }

    internal async Task<LogFile[]> FilesAsync(string userId, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            RequireReady();
            var files = new List<LogFile>();
            foreach (var id in Ids())
            {
                token.ThrowIfCancellationRequested();
                var entries = ReadEntries(FilePath(id)).Where(e => e.UserId == userId).ToArray();
                // 元数据同样按用户隔离，不暴露其他用户产生的文件大小和更新时间。
                if (entries.Length > 0) files.Add(new(id, entries.Sum(e => (long)Encode(e).Length), entries.Max(e => e.ReceivedAt)));
            }
            return files.ToArray();
        }
        finally { _gate.Release(); }
    }

    internal async Task<int> ClearAsync(string userId, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            RequireReady();
            var removed = 0;
            foreach (var id in Ids())
            {
                token.ThrowIfCancellationRequested();
                var path = FilePath(id);
                if (!File.Exists(path)) continue;
                var entries = ReadEntries(path);
                var retained = entries.Where(e => e.UserId != userId).ToArray();
                if (entries.Count == retained.Length) continue;
                // 只清除目标用户；其他用户数据和固定轮转槽位保持不变。
                ReplaceFile(id, Export(retained));
                removed += entries.Count - retained.Length;
            }
            return removed;
        }
        finally { _gate.Release(); }
    }

    internal async Task<Entry[]> ReadAsync(string fileId, string? userId, string? level, string? keyword, CancellationToken token)
    {
        if (userId?.Length > 36 || keyword?.Length > 200) throw new ArgumentException("日志筛选无效");
        if (!string.IsNullOrEmpty(userId))
        {
            if (!Guid.TryParse(userId, out var guid) || guid == Guid.Empty) throw new ArgumentException("用户标识无效");
            userId = guid.ToString("N");
        }
        if (!string.IsNullOrEmpty(level)) level = NormalizeLevel(level);
        await _gate.WaitAsync(token);
        try
        {
            RequireReady();
            return ReadEntries(FilePath(fileId)).Where(e => (string.IsNullOrEmpty(userId) || e.UserId == userId)
                && (string.IsNullOrEmpty(level) || e.Level == level)
                && (string.IsNullOrEmpty(keyword) || e.Message.Contains(keyword, StringComparison.OrdinalIgnoreCase)))
                .Reverse().ToArray();
        }
        finally { _gate.Release(); }
    }

    private static byte[] Encode(Entry entry) => Encoding.UTF8.GetBytes(JsonSerializer.Serialize(entry, Json) + "\n");
    internal static byte[] Export(IEnumerable<Entry> entries)
    {
        using var output = new MemoryStream();
        foreach (var entry in entries) output.Write(Encode(entry));
        return output.ToArray();
    }
    private static string NormalizeLevel(string? value) => value?.ToLowerInvariant() switch
    {
        "debug" => "debug", "info" => "info", "warn" or "warning" => "warn", "error" => "error",
        _ => throw new ArgumentException("日志等级无效")
    };

    internal static string Sanitize(string text)
    {
        // 原始对象和响应体不入库；方括号日志分类与数组计数标签仍保留。
        try
        {
            if (text.Contains('{') || Regex.IsMatch(text, @"\[\s*(?:""|'|\[|\d|true\b|false\b|null\b)", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100)))
                return "[已移除结构化内容]";
            text = Headers.Replace(text, "[已脱敏凭据]");
            text = Locations.Replace(text, "[已脱敏地址]");
            text = Secrets.Replace(text, "[已脱敏凭据]");
            return new string(text.Select(c => char.IsControl(c) || c is '\u2028' or '\u2029' ? ' ' : c).ToArray());
        }
        catch (RegexMatchTimeoutException) { return "[已移除复杂内容]"; }
    }

    private void RateLimit(string userId)
    {
        var now = Environment.TickCount64;
        // 限流表同样有界；满表拒绝新用户，不允许通过淘汰活动用户绕过限制。
        foreach (var key in _uploads.Where(x => x.Value.Count == 0 || now - x.Value.Last() >= 1000).Select(x => x.Key).ToArray())
            _uploads.Remove(key);
        if (!_uploads.TryGetValue(userId, out var queue))
        {
            if (_uploads.Count >= 4096) throw new ApiAccessException(429, "FRONTEND_LOG_RATE_LIMIT", "日志上传过于频繁");
            _uploads[userId] = queue = new Queue<long>();
        }
        while (queue.Count > 0 && now - queue.Peek() >= 1000) queue.Dequeue();
        if (queue.Count >= 4) throw new ApiAccessException(429, "FRONTEND_LOG_RATE_LIMIT", "日志上传过于频繁");
        queue.Enqueue(now);
    }

    private void Rotate()
    {
        var oldest = FilePath("4");
        if (File.Exists(oldest)) File.Delete(oldest);
        for (var index = 3; index >= 0; index--)
        {
            var source = FilePath(index == 0 ? "current" : index.ToString());
            var target = FilePath((index + 1).ToString());
            if (File.Exists(source)) File.Move(source, target, true);
        }
    }
    private void Repair(string id)
    {
        var path = FilePath(id);
        if (!File.Exists(path)) return;
        var repaired = Export(ReadEntries(path));
        // 改写与清除共用一个固定临时文件，避免失败时截断原文件。
        ReplaceFile(id, repaired);
    }
    private void ReplaceFile(string id, byte[] bytes)
    {
        if (bytes.Length > MaxFileBytes) throw new InvalidDataException("日志改写超过容量限制");
        var temporary = CheckedPath("rewrite.tmp");
        var created = false;
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                created = true;
                stream.Write(bytes);
                stream.Flush(true);
            }
            // 临时文件与目标同目录；原子替换前重新核验所有绝对路径。
            File.Move(CheckedPath("rewrite.tmp"), FilePath(id), true);
        }
        finally
        {
            if (created)
            {
                var cleanup = CheckedPath("rewrite.tmp");
                if (File.Exists(cleanup)) File.Delete(cleanup);
            }
        }
    }
    private static List<Entry> ReadEntries(string path)
    {
        var entries = new List<Entry>();
        if (!File.Exists(path)) return entries;
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        var buffer = new byte[(int)Math.Min(stream.Length, MaxFileBytes)];
        var count = 0;
        while (count < buffer.Length)
        {
            var read = stream.Read(buffer, count, buffer.Length - count);
            if (read == 0) break;
            count += read;
        }
        var start = 0;
        var outputBytes = 0;
        for (var i = 0; i < count; i++)
        {
            if (buffer[i] != '\n') continue;
            if (i - start is > 0 and <= 32 * 1024)
            {
                try
                {
                    var entry = JsonSerializer.Deserialize<Entry>(buffer.AsSpan(start, i - start), Json);
                    if (entry is not null && entry.Message is not null && entry.Message.Length <= 2048
                        && entry.SessionId is not null && entry.SessionId.Length <= 128
                        && Guid.TryParseExact(entry.UserId, "N", out var user) && user != Guid.Empty)
                    {
                        entry = entry with { Message = Sanitize(entry.Message), SessionId = Sanitize(entry.SessionId), Level = NormalizeLevel(entry.Level) };
                        var length = Encode(entry).Length;
                        if (outputBytes + length <= MaxFileBytes) { entries.Add(entry); outputBytes += length; }
                    }
                }
                catch (JsonException) { }
                catch (ArgumentException) { }
            }
            start = i + 1;
        }
        return entries;
    }

    private static IEnumerable<string> Ids() => ["current", "1", "2", "3", "4"];
    private string FilePath(string id)
    {
        if (!Ids().Contains(id, StringComparer.Ordinal)) throw new ArgumentException("日志文件标识无效");
        return CheckedPath(id + ".jsonl");
    }
    private string CheckedPath(string fileName)
    {
        CheckDirectory();
        var path = Path.GetFullPath(Path.Combine(_directory, fileName));
        if (Path.GetDirectoryName(path) != _directory) throw new IOException("日志路径无效");
        if (File.Exists(path) || Directory.Exists(path) || new FileInfo(path).LinkTarget is not null)
            if ((File.GetAttributes(path) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
                throw new IOException("日志文件不能是链接或目录");
        return path;
    }
    private void CheckDirectory()
    {
        for (var directory = new DirectoryInfo(_directory); directory is not null; directory = directory.Parent)
            if (directory.LinkTarget is not null || (directory.Exists && (directory.Attributes & FileAttributes.ReparsePoint) != 0))
                throw new IOException("日志目录不能包含符号链接");
    }
    private void RequireReady()
    {
        if (!Ready) throw new ApiAccessException(503, "FRONTEND_LOGS_UNAVAILABLE", "前端日志存储尚未就绪");
    }
    public void Dispose()
    {
        // 保留可能仍被请求持有的信号量，卸载后拒绝新操作。
        _gate.Wait();
        try { Ready = false; _uploads.Clear(); }
        finally { _gate.Release(); }
    }
}
