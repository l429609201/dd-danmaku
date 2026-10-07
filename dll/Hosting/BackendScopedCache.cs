namespace DD.Danmaku.Hosting;

/// <summary>账户作用域有界缓存；只有最后等待者离开才取消共享读取。</summary>
internal sealed class BackendScopedCache<T>
{
    private sealed class Flight
    {
        internal readonly CancellationTokenSource Stop = new(TimeSpan.FromSeconds(30));
        internal Task<T> Task = null!;
        internal int Waiters;
        internal bool Finished;
    }
    private readonly object _gate = new();
    private readonly Dictionary<string, (DateTimeOffset At, T Value)> _values = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Flight> _flights = new(StringComparer.Ordinal);
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);

    internal async Task<T> GetAsync(string key, Func<CancellationToken, Task<T>> read, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        Flight flight;
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var expired in _values.Where(entry => now - entry.Value.At >= Ttl).Select(entry => entry.Key).ToArray())
                _values.Remove(expired);
            if (_values.TryGetValue(key, out var cached)) return cached.Value;
            if (!_flights.TryGetValue(key, out flight!))
            {
                if (_flights.Count >= 64) throw new ApiAccessException(429, "OPERATION_LIMIT", "账户读取任务过多");
                flight = new Flight();
                _flights.Add(key, flight);
                var owned = flight;
                flight.Task = Task.Run(() => read(owned.Stop.Token));
                _ = ObserveAsync(key, owned);
            }
            flight.Waiters++;
        }
        try { return await flight.Task.WaitAsync(token).ConfigureAwait(false); }
        finally
        {
            lock (_gate)
            {
                flight.Waiters--;
                if (flight.Waiters == 0)
                {
                    if (flight.Finished) flight.Stop.Dispose();
                    else if (!flight.Task.IsCompleted)
                    {
                        if (_flights.TryGetValue(key, out var current) && ReferenceEquals(current, flight)) _flights.Remove(key);
                        flight.Stop.Cancel();
                    }
                }
            }
        }
    }

    private async Task ObserveAsync(string key, Flight flight)
    {
        try
        {
            var value = await flight.Task.ConfigureAwait(false);
            lock (_gate)
            {
                if (!flight.Stop.IsCancellationRequested)
                {
                    while (_values.Count >= 256) _values.Remove(_values.MinBy(entry => entry.Value.At).Key);
                    _values[key] = (DateTimeOffset.UtcNow, value);
                }
            }
        }
        catch (Exception) { /* 失败只交给当前等待者，不缓存失败或在后台泄露凭据。 */ }
        finally
        {
            lock (_gate)
            {
                flight.Finished = true;
                if (_flights.TryGetValue(key, out var current) && ReferenceEquals(current, flight)) _flights.Remove(key);
                if (flight.Waiters == 0) flight.Stop.Dispose();
            }
        }
    }
}
