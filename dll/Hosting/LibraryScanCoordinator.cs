namespace DD.Danmaku.Hosting;

using System.Text.Json;
using MediaBrowser.Controller.Library;

/// <summary>最近一次完整结果；快速扫描中的深度计数不应被前端显示为已校验。</summary>
public sealed record LibraryScanResult(DateTime CompletedUtc, double Seconds, bool Deep, List<LibraryScanRow> Libraries);

/// <summary>宿主级扫描协调器，手动和定时共享任务，失败不覆盖成功快照。</summary>
internal sealed class LibraryScanCoordinator(ILibraryManager library, string directory,
    LocalPlaybackService playback) : IDisposable
{
    private readonly object _gate = new();
    private readonly LibraryScanner _scanner = new(library);
    private CancellationTokenSource? _cancel;
    private Task? _task;
    private bool _disposed, _deep;
    private int _processed;
    private string _state = "尚未扫描", _error = "";
    private LibraryScanResult? _result;
    private string ResultPath => Path.Combine(directory, "library-scan.json");

    // 管理入口复用同一媒体库服务，只返回选择所需的标识和名称。
    internal LibraryOption[] LibraryOptions() => library.GetVirtualFolders()
        .Select(folder => new LibraryOption(folder.ItemId, folder.Name)).ToArray();

    internal void Load()
    {
        try
        {
            if (File.Exists(ResultPath))
                _result = JsonSerializer.Deserialize<LibraryScanResult>(File.ReadAllText(ResultPath));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        { _error = "无法读取历史扫描结果，请重新扫描"; }
    }

    internal object Snapshot()
    {
        lock (_gate) return new { Running = _cancel is not null, State = _state,
            Error = _error, Processed = _processed, Deep = _deep, Result = _result };
    }

    internal Task Start(bool deep, CancellationToken token = default, IProgress<double>? progress = null)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_cancel is not null) return _task!;
            _cancel = CancellationTokenSource.CreateLinkedTokenSource(token);
            _deep = deep; _processed = 0; _error = ""; _state = "扫描中";
            var source = _cancel;
            // 仅原生任务调用此入口，任务引用在锁内发布。
            _task = Task.Run(() => Run(deep, source, progress));
            return _task;
        }
    }

    private void Run(bool deep, CancellationTokenSource source, IProgress<double>? progress)
    {
        var started = DateTime.UtcNow;
        try
        {
            // 同一媒体可能从重叠媒体库枚举，按条目及来源去重；不逐文件重写索引。
            var found = new Dictionary<(string, string?), ScanRecordEntry>();
            var rows = _scanner.Scan(deep, source.Token, count => { lock (_gate) _processed = count; },
                entry =>
                {
                    found[(entry.ItemId, entry.Source)] = entry;
                    if (found.Count > 10000)
                        throw new InvalidOperationException("扫描记录超过10000条索引上限，请缩小扫描范围");
                }, progress);
            var result = new LibraryScanResult(DateTime.UtcNow, (DateTime.UtcNow - started).TotalSeconds, deep, rows);
            source.Token.ThrowIfCancellationRequested();
            // 索引成功提交后才能发布完成；失败/取消不会提交收集到的半轮记录。
            playback.MergeScanAsync(found.Values, new DateTimeOffset(started), source.Token).GetAwaiter().GetResult();
            Directory.CreateDirectory(directory);
            var temporary = ResultPath + ".tmp";
            // 先完成快照写入再发布，取消/失败不会用半成品覆盖上次结果。
            File.WriteAllText(temporary, JsonSerializer.Serialize(result), System.Text.Encoding.UTF8);
            source.Token.ThrowIfCancellationRequested();
            File.Move(temporary, ResultPath, true);
            lock (_gate) { _result = result; _state = "已完成"; }
        }
        // 将取消与失败交还 Emby，不能让控制台把失败记录成成功。
        catch (OperationCanceledException) { lock (_gate) _state = "已取消"; throw; }
        catch (Exception)
        {
            lock (_gate) { _state = "失败"; _error = "扫描、记录索引或快照保存失败；请检查权限及索引10000条/16MB容量限制"; }
            throw;
        }
        finally
        {
            lock (_gate) { _cancel = null; source.Dispose(); }
        }
    }

    internal void Cancel() { lock (_gate) _cancel?.Cancel(); }
    public void Dispose() { lock (_gate) { _disposed = true; _cancel?.Cancel(); } }
}
