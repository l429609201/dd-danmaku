namespace DD.Danmaku.Hosting;

using System.Collections.Concurrent;
using System.Net.WebSockets;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Controller.Session;

/// <summary>复用 Emby 监听端口；只转发给已认证且绑定目标播放会话的专用连接。</summary>
public sealed class PlaybackSocketListener(ISessionManager sessions, MediaBrowser.Model.Logging.ILogManager logs) : IWebSocketListener, IServerEntryPoint
{
    // 播放事件只记录动作和转发数量，不输出用户、设备、媒体或凭据。
    private readonly MediaBrowser.Model.Logging.ILogger _logger = logs.GetLogger("DD.Danmaku.Playback");
    // 宿主可能分别创建入口和消息监听实例，统一路由到已启动的入口实例。
    private static PlaybackSocketListener? _active;
    private readonly ConcurrentDictionary<Guid, PlaybackSocketSubscription> _subscriptions = new();
    private readonly object _gate = new();
    private Timer? _expiry;
    private bool _running;
    internal static bool Available => Volatile.Read(ref _active) is not null;

    public void Run()
    {
        lock (_gate)
        {
            if (_running || Interlocked.CompareExchange(ref _active, this, null) is not null) return;
            _running = true;
            sessions.PlaybackStart += Started;
            sessions.PlaybackProgress += Progress;
            sessions.PlaybackStopped += Stopped;
            sessions.SessionEnded += SessionEnded;
            _expiry = new Timer(_ => Expire(), null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10));
        }
    }

    public Task ProcessMessage(WebSocketMessageInfo message)
    {
        if (message.MessageType is not (PlaybackSocketProtocol.Subscribe or PlaybackSocketProtocol.Unsubscribe
            or PlaybackSocketProtocol.Heartbeat)) return Task.CompletedTask;
        return Volatile.Read(ref _active)?.Receive(message) ?? Task.CompletedTask;
    }

    private Task Receive(WebSocketMessageInfo message)
    {
        var connection = message.Connection;
        lock (_gate)
        {
            if (!_running) return Task.CompletedTask;
            if (message.MessageType == PlaybackSocketProtocol.Unsubscribe)
            {
                Remove(connection.Id);
                return Task.CompletedTask;
            }
            if (message.MessageType == PlaybackSocketProtocol.Heartbeat)
            {
                if (_subscriptions.TryGetValue(connection.Id, out var bound) && Valid(bound)) bound.Ping();
                else Remove(connection.Id);
                return Task.CompletedTask;
            }
            // Data 仅为设备标识，不接受客户端指定用户；连接身份由 Emby 验证。
            var user = connection.User;
            var device = message.Data;
            if (user is null || user.InternalId <= 0 || user.Policy is null || user.Policy.IsDisabled || user.IsLockedOut
                || string.IsNullOrWhiteSpace(device) || device.Length > 256
                || connection.State != WebSocketState.Open) return Task.CompletedTask;
            var matches = sessions.Sessions.Where(s => s.IsActive && s.UserInternalId == user.InternalId
                && string.Equals(s.DeviceId, device, StringComparison.Ordinal)).Take(2).ToArray();
            // 多个候选时拒绝猜测，前端保持本地事件源。
            if (matches.Length != 1) return Task.CompletedTask;
            if (_subscriptions.TryGetValue(connection.Id, out var existing))
            {
                if (Valid(existing) && existing.DeviceId == device) existing.Ping();
                else Remove(connection.Id);
                return Task.CompletedTask;
            }
            if (_subscriptions.Count >= 512 || _subscriptions.Values.Count(s => s.UserId == user.InternalId) >= 8)
                return Task.CompletedTask;
            var subscription = new PlaybackSocketSubscription(connection, matches[0].Id, device, user.InternalId, Valid);
            if (_subscriptions.TryAdd(connection.Id, subscription)) connection.Closed += Closed;
            else subscription.Dispose();
        }
        return Task.CompletedTask;
    }

    private bool Valid(PlaybackSocketSubscription bound)
    {
        try
        {
            if (bound.Expired || !ReferenceEquals(Volatile.Read(ref _active), this)) return false;
            var user = bound.Connection.User;
            return user is not null && user.InternalId == bound.UserId && user.Policy is not null
                && !user.Policy.IsDisabled && !user.IsLockedOut && bound.Connection.State == WebSocketState.Open
                && sessions.Sessions.Any(s => s.Id == bound.SessionId && s.IsActive
                    && s.UserInternalId == bound.UserId && s.DeviceId == bound.DeviceId);
        }
        catch (Exception) { return false; } // 宿主退出/对象释放期间失败关闭，不泄漏到播放线程。
    }

    private void Started(object? sender, PlaybackProgressEventArgs args) => Publish(args, "started");
    private void Progress(object? sender, PlaybackProgressEventArgs args)
        => Publish(args, PlaybackSocketProtocol.ProgressName(args));
    private void Stopped(object? sender, PlaybackStopEventArgs args) => Publish(args, "stopped");
    private void Publish(PlaybackProgressEventArgs args, string name)
    {
        // 用户和会话双重核对，绝不先广播再依赖浏览器过滤。
        // 只记录低频生命周期动作，普通进度和心跳不刷屏。
        if (name is "started" or "stopped" or "paused" or "resumed")
            _logger.Info("播放联动：收到动作={0}，当前订阅数={1}", name, _subscriptions.Count);
        foreach (var bound in _subscriptions.Values)
        {
            if (args.Session is null || args.Session.Id != bound.SessionId
                || args.Session.UserInternalId != bound.UserId || args.DeviceId != bound.DeviceId) continue;
            if (!Valid(bound)) { Remove(bound.Connection.Id); continue; }
            bound.Publish(args, name);
        }
    }

    private void SessionEnded(object? sender, SessionEventArgs args) => Expire();
    private void Closed(object? sender, EventArgs args)
    {
        if (sender is IWebSocketConnection connection) Remove(connection.Id);
    }
    private void Expire()
    {
        foreach (var pair in _subscriptions)
            if (pair.Value.Expired || !Valid(pair.Value)) Remove(pair.Key);
    }
    private void Remove(Guid id)
    {
        if (!_subscriptions.TryRemove(id, out var bound)) return;
        bound.Connection.Closed -= Closed;
        bound.Dispose();
    }
    public void Dispose()
    {
        lock (_gate)
        {
            if (!_running) return;
            _running = false;
            Interlocked.CompareExchange(ref _active, null, this);
            sessions.PlaybackStart -= Started;
            sessions.PlaybackProgress -= Progress;
            sessions.PlaybackStopped -= Stopped;
            sessions.SessionEnded -= SessionEnded;
            _expiry?.Dispose();
            foreach (var id in _subscriptions.Keys) Remove(id);
        }
    }
}
