namespace DD.Danmaku.Hosting;

using System.Text.Json;
using System.Threading.Channels;
using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;

/// <summary>每条连接使用有界串行队列；慢连接失效，不无限积压或打乱生命周期事件。</summary>
internal sealed class PlaybackSocketSubscription : IDisposable
{
    private readonly Channel<string> _outbound = Channel.CreateBounded<string>(new BoundedChannelOptions(64)
    { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
    private readonly CancellationTokenSource _stop = new();
    private readonly object _gate = new();
    private readonly string _epoch = Guid.NewGuid().ToString("N");
    private long _sequence;
    private long _lastPing = Environment.TickCount64;
    private int _disposed;
    internal IWebSocketConnection Connection { get; }
    internal string SessionId { get; }
    internal string DeviceId { get; }
    internal long UserId { get; }
    internal bool Expired => Volatile.Read(ref _disposed) != 0
        || Environment.TickCount64 - Interlocked.Read(ref _lastPing) > 120000;

    private readonly Func<PlaybackSocketSubscription, bool> _valid;
    private readonly Action<string>? _log;
    private readonly HashSet<string> _retired = new(StringComparer.Ordinal);
    private string? _playSession;

    internal PlaybackSocketSubscription(IWebSocketConnection connection, string sessionId, string deviceId,
        long userId, Func<PlaybackSocketSubscription, bool> valid, Action<string>? log = null)
    {
        Connection = connection;
        SessionId = sessionId;
        DeviceId = deviceId;
        UserId = userId;
        _valid = valid;
        _log = log;
        // 发布到订阅表前先排入握手，避免首条播放消息先于 Ready 到达。
        Ping();
        _ = SendLoop();
    }

    internal void Ping()
    {
        lock (_gate)
        {
            if (Expired) return;
            Interlocked.Exchange(ref _lastPing, Environment.TickCount64);
            Enqueue(PlaybackSocketProtocol.Ready, new
            { protocolVersion = PlaybackSocketProtocol.Version, connectionEpoch = _epoch, sessionId = SessionId });
        }
    }

    internal void Publish(PlaybackProgressEventArgs args, string name)
    {
        lock (_gate)
        {
            if (Expired) return;
            var value = PlaybackSocketProtocol.Project(args, name, _epoch, _sequence + 1);
            if (value is null || _retired.Contains(value.PlaySessionId)) return;
            if (_playSession is not null && _playSession != value.PlaySessionId)
            {
                // 只有开始事件可以替换活动播放；旧进度/停止不能重新占用当前会话。
                if (name != "started") return;
                _retired.Add(_playSession);
            }
            _playSession = value.PlaySessionId;
            if (name == "stopped") _retired.Add(value.PlaySessionId);
            // 有界保存旧播放标识；达到上限让浏览器重连，不丢弃旧标识后重新接受迟到事件。
            if (_retired.Count >= 256) { Dispose("PLAY_SESSION_LIMIT"); return; }
            _sequence = value.Sequence;
            Enqueue(PlaybackSocketProtocol.State, value);
        }
    }

    private void Enqueue<T>(string type, T data)
    {
        var payload = JsonSerializer.Serialize(data, MatchJson.Options);
        var message = "{\"MessageType\":" + JsonSerializer.Serialize(type) + ",\"Data\":" + payload + "}";
        if (!_outbound.Writer.TryWrite(message)) Dispose("QUEUE_LIMIT");
    }

    private async Task SendLoop()
    {
        try
        {
            await foreach (var message in _outbound.Reader.ReadAllAsync(_stop.Token).ConfigureAwait(false))
            {
                // 入队之后也可能退出登录或更换会话；发送前再次核对，不能排空旧身份的积压消息。
                if (Expired || !_valid(this)) { Dispose("AUTH_OR_SESSION_INVALID"); break; }
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                await Connection.SendAsync(message.AsMemory(), timeout.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested) { }
        catch (OperationCanceledException) { Dispose("SEND_TIMEOUT"); }
        catch (Exception) { Dispose("SEND_FAILED"); }
        finally
        {
            Dispose();
            lock (_gate) _stop.Dispose();
        }
    }

    public void Dispose() => Dispose("SUBSCRIPTION_RELEASED");

    internal void Dispose(string reason)
    {
        lock (_gate)
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            try { _log?.Invoke(reason); } catch (Exception) { /* 日志失败不阻断资源回收。 */ }
            // 与消费循环的 CTS 释放串行，防止完成队列后 Cancel 访问已释放的 CTS。
            _stop.Cancel();
            _outbound.Writer.TryComplete();
        }
        // 不关闭宿主连接；订阅只拥有自己的队列，浏览器负责释放其专用连接。
    }
}
