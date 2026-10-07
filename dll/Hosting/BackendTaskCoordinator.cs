namespace DD.Danmaku.Hosting;

using System.Text.Json;

internal sealed record BackendTaskReply(int StatusCode, byte[] Body);
internal sealed record BackendDownloadRecord(string Id, Guid Owner, string ItemId, string SourceId,
    string EpisodeId, int ChConvert, string SavePurpose, string Revision, DateTimeOffset CreatedAt,
    string State = "accepted", string? UpstreamTaskId = null, string? SelectionIntent = null);
internal sealed record BackendTaskView(string Id, string ItemId, string Kind, string Status,
    string? ErrorCode, DateTimeOffset CreatedAt, bool ResultAvailable);

/// <summary>有界本人任务，下载与页面生命周期分离；恢复日志只保存身份和阶段。</summary>
internal sealed class BackendTaskCoordinator : IDisposable
{
    private const int MaxTasks = 128;
    private const int MaxPerUser = 4;
    private const long MaxResultBytes = 128L * 1024 * 1024;
    private static readonly TimeSpan Retention = TimeSpan.FromMinutes(5);
    private readonly object _gate = new();
    private readonly Dictionary<string, Entry> _entries = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _flights = new(StringComparer.Ordinal);
    private readonly CancellationTokenSource _stop = new();
    private readonly string _directory;
    private readonly Action<string>? _log;
    private readonly Action<string>? _diagnostic;
    private long _resultBytes;
    private bool _disposed;
    private Task? _recovery;

    internal BackendTaskCoordinator(string directory, Action<string>? log = null, Action<string>? diagnostic = null)
    {
        _log = log;
        _diagnostic = diagnostic;
        _directory = Path.GetFullPath(directory);
        Directory.CreateDirectory(_directory);
    }

    internal sealed class Context
    {
        private readonly BackendTaskCoordinator _owner;
        private readonly Entry _entry;
        internal string Id => _entry.Id;
        internal CancellationToken Token => _entry.Stop.Token;
        internal BackendDownloadRecord? Download => _entry.Download;
        internal Context(BackendTaskCoordinator owner, Entry entry) => (_owner, _entry) = (owner, entry);
        internal void Progress(string stage, int? count = null)
        {
            _entry.Stage = stage;
            _owner.Log(_entry, "阶段=" + stage + (count.HasValue ? "，数值=" + count.Value : ""));
            OperationEventHub.Publish(_entry.Owner, _entry.Id, stage, count, "running");
        }
        internal void Detail(string stage, string detail, int? count = null)
        {
            detail = new string(detail.Where(character => !char.IsControl(character) || character is '\n' or '\r' or '\t').Take(24000).ToArray());
            detail = System.Text.RegularExpressions.Regex.Replace(detail, @"(?i)[a-z][a-z0-9+.-]*://[^\s""'<>]+", "[地址已脱敏]");
            _entry.Stage = stage;
            _owner.Log(_entry, "阶段=" + stage + "，" + detail);
            OperationEventHub.Publish(_entry.Owner, _entry.Id, stage, count, "running", detail: detail);
        }
        internal void Checkpoint(string state, string? upstreamTaskId = null)
        {
            Token.ThrowIfCancellationRequested();
            if (_entry.Download is not { } record) return;
            if (state is not ("accepted" or "fetching" or "polling" or "saving"))
                throw new ArgumentException("下载检查点无效");
            if (upstreamTaskId is not null && !ValidIdentifier(upstreamTaskId))
                throw new ArgumentException("上游任务标识无效");
            _entry.Download = record with { State = state, UpstreamTaskId = upstreamTaskId ?? record.UpstreamTaskId };
            _owner.Persist(_entry.Download);
        }
    }

    internal sealed class Entry
    {
        internal required string Id;
        internal required Guid Owner;
        internal required string ItemId;
        internal required string Kind;
        internal required string Key;
        internal required DateTimeOffset CreatedAt;
        internal required CancellationTokenSource Stop;
        internal string Status = "pending";
        internal string Stage = "accepted";
        internal string? ErrorCode;
        internal DateTimeOffset? CompletedAt;
        internal BackendTaskReply? Reply;
        internal BackendDownloadRecord? Download;
        internal bool UserCancelled;
        internal Func<CancellationToken, Task>? AuthorizeResult;
        internal BackendTaskView View() => new(Id, ItemId, Kind, Status, ErrorCode, CreatedAt, Reply is not null);
    }

    internal BackendTaskView Start(Guid owner, string itemId, string kind, string fingerprint,
        Func<Context, Task<BackendTaskReply>> work, BackendDownloadRecord? download = null,
        Func<CancellationToken, Task>? authorizeResult = null)
    {
        if (owner == Guid.Empty || !ValidIdentifier(itemId) || kind is not ("match" or "search" or "download" or "watch")
            || fingerprint is not { Length: > 0 and <= 512 }) throw new ArgumentException("后端任务身份无效");
        if (download is not null && (kind != "download" || download.Owner != owner || download.ItemId != itemId))
            throw new ArgumentException("下载记录与任务身份不一致");
        var key = owner.ToString("N") + "|" + kind + "|" + itemId + "|" + fingerprint;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            Prune();
            if (_flights.TryGetValue(key, out var existing) && _entries.TryGetValue(existing, out var shared))
                return shared.View();
            if (_entries.Count >= MaxTasks || _entries.Values.Count(entry => entry.Owner == owner && entry.CompletedAt is null) >= MaxPerUser)
                throw new ApiAccessException(429, "OPERATION_LIMIT", "当前后端任务过多，请稍后重试");
            var id = OperationEventHub.Start(owner);
            var stop = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token);
            var budget = kind == "download" && download is not null
                ? download.CreatedAt.AddMinutes(10) - DateTimeOffset.UtcNow : TimeSpan.FromMinutes(3);
            stop.CancelAfter(budget > TimeSpan.Zero ? budget : TimeSpan.FromMilliseconds(1));
            var entry = new Entry { Id = id, Owner = owner, ItemId = itemId, Kind = kind, Key = key,
                CreatedAt = DateTimeOffset.UtcNow, Stop = stop, AuthorizeResult = authorizeResult };
            if (download is not null)
            {
                entry.Download = download with { Id = string.IsNullOrEmpty(download.Id) ? id : download.Id };
                try { Persist(entry.Download); }
                catch { stop.Dispose(); OperationEventHub.Complete(owner, id, "failed", "STORAGE_ERROR"); throw; }
            }
            _entries.Add(id, entry);
            _flights.Add(key, id);
            Log(entry, "已受理");
            _ = Task.Run(() => RunAsync(entry, work));
            return entry.View();
        }
    }

    internal async Task AuthorizeResultAsync(Guid owner, string id, CancellationToken token)
    {
        Func<CancellationToken, Task>? authorize;
        lock (_gate) authorize = Owned(owner, id).AuthorizeResult;
        token.ThrowIfCancellationRequested();
        if (authorize is not null) await authorize(token);
    }

    internal BackendTaskView Read(Guid owner, string id)
    {
        lock (_gate) { Prune(); return Owned(owner, id).View(); }
    }
    internal IReadOnlyList<BackendTaskView> List(Guid owner)
    {
        lock (_gate) { Prune(); return _entries.Values.Where(entry => entry.Owner == owner)
            .OrderByDescending(entry => entry.CreatedAt).Select(entry => entry.View()).ToArray(); }
    }
    internal BackendTaskReply Result(Guid owner, string id)
    {
        lock (_gate)
        {
            Prune();
            var entry = Owned(owner, id);
            return entry.Reply ?? throw new ApiAccessException(entry.CompletedAt is null ? 409 : 410,
                entry.CompletedAt is null ? "TASK_NOT_READY" : "TASK_RESULT_EXPIRED", "后端任务结果尚未就绪或已过期");
        }
    }
    internal void Cancel(Guid owner, string id, bool playbackEnded)
    {
        lock (_gate)
        {
            var entry = Owned(owner, id);
            // 页面结束只取消未确定分集的工作；确定分集的下载仍使用原授权上下文完成。
            if (entry.CompletedAt is not null || playbackEnded && entry.Kind is "download" or "watch") return;
            entry.UserCancelled = true;
            entry.Stop.Cancel();
        }
    }

    private Entry Owned(Guid owner, string id) => _entries.TryGetValue(id, out var entry) && entry.Owner == owner
        ? entry : throw new ApiAccessException(404, "TASK_NOT_FOUND", "任务不存在或不属于当前用户");

    private async Task RunAsync(Entry entry, Func<Context, Task<BackendTaskReply>> work)
    {
        using var heartbeatStop = new CancellationTokenSource();
        var heartbeat = KeepAliveAsync(entry, heartbeatStop.Token);
        BackendTaskReply reply;
        var status = "succeeded";
        string? code = null;
        try
        {
            lock (_gate) entry.Status = "running";
            Log(entry, "开始执行");
            OperationEventHub.Publish(entry.Owner, entry.Id, "progress", status: "running");
            reply = await work(new Context(this, entry));
            entry.Stop.Token.ThrowIfCancellationRequested();
        }
        catch (OperationCanceledException)
        {
            code = entry.UserCancelled || _stop.IsCancellationRequested ? "OPERATION_CANCELLED" : "UPSTREAM_TIMEOUT";
            status = code == "UPSTREAM_TIMEOUT" ? "failed" : "cancelled";
            reply = Failure(code == "UPSTREAM_TIMEOUT" ? 504 : 409, code, "后端任务已取消或超时");
        }
        catch (ApiAccessException error)
        {
            status = "failed"; code = error.Code;
            Diagnose(entry, code, error);
            reply = error.UpstreamReply is { } upstream ? new(upstream.StatusCode, upstream.Body)
                : Failure(error.Status, error.Code, error.Message);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { status = "failed"; code = "STORAGE_ERROR"; Diagnose(entry, code, error); reply = Failure(500, code, "任务存储不可用"); }
        catch (Exception error)
        { status = "failed"; code = "INTERNAL_ERROR"; Diagnose(entry, code, error); reply = Failure(500, code, "后端任务执行失败"); }
        if (entry.Download is { } record && !_stop.IsCancellationRequested)
        {
            try
            {
                // 先落盘终态；即使删除失败，重启也不会将已完成任务重新受理。
                Persist(record with { State = status });
                try { File.Delete(RecordPath(record.Id)); }
                catch (Exception cleanup) when (cleanup is IOException or UnauthorizedAccessException) { }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { status = "failed"; code = "STORAGE_ERROR"; reply = Failure(500, code, "下载任务状态无法保存"); }
        }
        lock (_gate)
        {
            // 有界结果缓存；优先移除已完成任务的正文，不抹去终态及诊断码。
            foreach (var old in _entries.Values.Where(value => value.Reply is not null && value.CompletedAt is not null)
                .OrderBy(value => value.CompletedAt))
            {
                if (_resultBytes + reply.Body.Length <= MaxResultBytes) break;
                _resultBytes -= old.Reply!.Body.Length;
                old.Reply = null;
            }
            entry.Status = status;
            entry.ErrorCode = code;
            entry.CompletedAt = DateTimeOffset.UtcNow;
            if (reply.Body.Length <= MaxResultBytes - _resultBytes) { entry.Reply = reply; _resultBytes += reply.Body.Length; }
            _flights.Remove(entry.Key);
        }
        heartbeatStop.Cancel();
        await heartbeat;
        OperationEventHub.Complete(entry.Owner, entry.Id, status, code);
        Log(entry, "结束，状态=" + status + "，错误码=" + (code ?? "无"));
        entry.Stop.Dispose();
    }

    // 日志故障不能改变任务结果；不输出令牌、来源 URL、请求正文或异常 Message。
    private void Log(Entry entry, string text)
    {
        try { _log?.Invoke($"后端任务：id={entry.Id}，类型={entry.Kind}，{text}"); }
        catch { }
    }

    private void Diagnose(Entry entry, string code, Exception error)
    {
        try
        {
            var frames = new List<string>();
            for (Exception? current = error; current is not null && frames.Count < 8; current = current.InnerException)
            {
                // 只记录异常类型和方法帧，不包含源文件路径或异常携带的业务数据。
                var methods = (new System.Diagnostics.StackTrace(current, false).GetFrames() ?? [])
                    .Select(frame => frame.GetMethod()).Where(method => method is not null).Take(24)
                    .Select(method => method!.DeclaringType?.FullName + "." + method.Name);
                frames.Add(current.GetType().FullName + "\n" + string.Join("\n", methods));
            }
            _diagnostic?.Invoke($"后端任务失败：id={entry.Id}，类型={entry.Kind}，阶段={entry.Stage}，错误码={code}\n"
                + string.Join("\n内部异常：", frames));
        }
        catch { }
    }

    private static async Task KeepAliveAsync(Entry entry, CancellationToken token)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        try { while (await timer.WaitForNextTickAsync(token)) OperationEventHub.Touch(entry.Owner, entry.Id); }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
    }

    private static BackendTaskReply Failure(int status, string code, string message) => new(status,
        JsonSerializer.SerializeToUtf8Bytes(new { success = false, errorCode = code, errorMessage = message }));

    private void Prune()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var entry in _entries.Values.Where(entry => entry.CompletedAt is { } completed && now - completed > Retention).ToArray())
        { if (entry.Reply is not null) _resultBytes -= entry.Reply.Body.Length; _entries.Remove(entry.Id); }
    }

    private string RecordPath(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new ArgumentException("任务记录标识无效");
        var file = Path.GetFullPath(Path.Combine(_directory, id + ".json"));
        if (!string.Equals(Path.GetDirectoryName(file), _directory, StringComparison.Ordinal))
            throw new IOException("任务记录越出存储范围");
        if (File.Exists(file) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("任务记录不能是链接");
        return file;
    }

    private void Persist(BackendDownloadRecord record)
    {
        var target = RecordPath(record.Id);
        var pending = target + ".tmp";
        var bytes = JsonSerializer.SerializeToUtf8Bytes(record);
        if (bytes.Length > 65536) throw new InvalidDataException("下载记录过大");
        if (File.Exists(pending) && (File.GetAttributes(pending) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("任务临时记录不能是链接");
        File.WriteAllBytes(pending, bytes);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(pending, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        // 两个路径都由已核验任务 ID 和固定目录生成，原子替换不接受客户端路径。
        File.Move(pending, target, overwrite: true);
    }

    internal void RecoverOnce(Func<BackendDownloadRecord, CancellationToken, Task> recover)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _recovery ??= Task.Run(async () =>
            {
                IReadOnlyList<BackendDownloadRecord> records;
                try { records = Recoverable(); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return; }
                foreach (var record in records)
                {
                    if (_stop.IsCancellationRequested) return;
                    if (record.CreatedAt.AddMinutes(10) <= DateTimeOffset.UtcNow) continue;
                    try { await recover(record, _stop.Token); }
                    catch (OperationCanceledException) when (_stop.IsCancellationRequested) { return; }
                    catch (Exception) { /* 单条记录失败不能阻断其它用户的可恢复任务。 */ }
                }
            });
        }
    }

    internal IReadOnlyList<BackendDownloadRecord> Recoverable()
    {
        var records = new List<BackendDownloadRecord>();
        foreach (var file in Directory.EnumerateFiles(_directory, "*.json"))
        {
            var id = Path.GetFileNameWithoutExtension(file);
            try
            {
                if (!Guid.TryParseExact(id, "N", out _) || new FileInfo(file).Length > 65536) continue;
                var checkedPath = RecordPath(id);
                var record = JsonSerializer.Deserialize<BackendDownloadRecord>(File.ReadAllBytes(checkedPath));
                if (record is null || record.Id != id || record.Owner == Guid.Empty || !ValidIdentifier(record.ItemId)
                    || !ValidIdentifier(record.SourceId) || !ValidIdentifier(record.EpisodeId)
                    || record.SelectionIntent is not null && !Guid.TryParseExact(record.SelectionIntent, "N", out _)
                    || record.ChConvert is < 0 or > 2 || record.SavePurpose is not ("auto" or "selection" or "none")
                    || record.Revision is not { Length: > 0 and <= 256 }
                    || record.UpstreamTaskId is not null && !ValidIdentifier(record.UpstreamTaskId)
                    || record.State == "polling" && record.UpstreamTaskId is null
                    || record.CreatedAt > DateTimeOffset.UtcNow
                    || DateTimeOffset.UtcNow - record.CreatedAt > TimeSpan.FromMinutes(12)) continue;
                if (record.State is "accepted" or "polling" or "saving") records.Add(record);
                // fetching 期间没有上游任务 ID 时无法确认是否已受理，不自动重复创建生成任务。
                else if (record.State == "fetching" && record.UpstreamTaskId is not null) records.Add(record);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException or ArgumentException) { }
        }
        return records.OrderByDescending(record => record.CreatedAt).Take(MaxTasks).ToArray();
    }

    private static bool ValidIdentifier(string? text) => text is { Length: > 0 and <= 160 }
        && text.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');

    public void Dispose()
    {
        lock (_gate) { if (_disposed) return; _disposed = true; _stop.Cancel(); }
    }
}
