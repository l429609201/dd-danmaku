namespace DD.Danmaku.Hosting;

using System.Text.Json;
using System.Threading.Channels;

/// <summary>Short-lived, owner-scoped progress events; payload fields are strictly allowlisted.</summary>
internal static class OperationEventHub
{
    private const int MaxOperations = 128;
    private const int MaxOperationsPerUser = 8;
    private const int MaxSubscribers = 128;
    private const int MaxSubscribersPerOperation = 4;
    private const int MaxEvents = 64;
    private static readonly TimeSpan CompletedTtl = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan ActiveTtl = TimeSpan.FromMinutes(3);
    private static readonly object Gate = new();
    private static readonly Dictionary<string, Operation> Operations = new(StringComparer.Ordinal);
    private static int _subscribers;

    private static readonly HashSet<string> Stages = new(StringComparer.Ordinal)
    {
        "started", "progress", "fetch", "parse", "save", "verify", "normalize", "remove",
        "delete", "scan", "match", "upload", "refresh", "selection", "records", "complete",
        "source", "search", "candidates", "resolve", "detail", "upstream", "completed", "failed",
        "bgm_fallback", "bgm_search", "bgm_detail", "hash", "mapping", "poll", "characters", "collection",
        "authorize", "metadata", "match_fallback"
    };
    private static readonly HashSet<string> Statuses = new(StringComparer.Ordinal)
    {
        "pending", "running", "succeeded", "failed", "skipped", "cancelled"
    };
    private static readonly HashSet<string> ErrorCodes = new(StringComparer.Ordinal)
    {
        "AUTH_REQUIRED", "ADMIN_REQUIRED", "INVALID_REQUEST", "INVALID_DATA", "NOT_FOUND",
        "UPSTREAM_ERROR", "UPSTREAM_TIMEOUT", "STORAGE_ERROR", "STORAGE_DENIED",
        // 固定诊断码同步到前端，不透传上游正文或认证信息。
        "UPSTREAM_PROTOCOL_MISMATCH", "UPSTREAM_INVALID_RESPONSE", "UPSTREAM_BUSINESS_ERROR",
        "UPSTREAM_RATE_LIMITED", "UPSTREAM_AUTH_REJECTED", "UPSTREAM_REJECTED", "UPSTREAM_UNAVAILABLE",
        "UPSTREAM_MATCH_FAILED", "UPSTREAM_MATCH_UNAVAILABLE", "MATCH_FAILED",
        "OFFICIAL_PROXY_UNAVAILABLE", "OFFICIAL_SIGNING_UNAVAILABLE", "OFFICIAL_USER_MARK_INCOMPLETE",
        "PROXY_DISABLED", "PROXY_NOT_CONFIGURED",
        "XML_WRITE_DISABLED", "XML_READ_DISABLED", "USER_CHANGED", "INTERNAL_ERROR",
        "OPERATION_CANCELLED", "OTHER_ERROR", "SOURCE_NOT_FOUND", "SOURCE_TARGET_DENIED", "SOURCE_TARGET_INVALID",
        "SOURCE_DNS_FAILED", "SOURCE_NOT_CONFIGURED", "UPSTREAM_CHANGED", "TASK_RESULT_EXPIRED", "UPSTREAM_TASK_FAILED",
        "BANGUMI_AUTH_REJECTED", "BANGUMI_NOT_FOUND", "BANGUMI_RATE_LIMITED", "BANGUMI_PROTOCOL_INVALID",
        "BANGUMI_EPISODE_AMBIGUOUS", "BANGUMI_TOKEN_NOT_CONFIGURED", "BANGUMI_SUBJECT_INVALID", "BANGUMI_SOURCE_NOT_ALLOWED"
    };

    internal static string Start(Guid userId)
    {
        if (userId == Guid.Empty) throw new ApiAccessException(401, "AUTH_REQUIRED", "需要有效的 Emby 用户身份");
        lock (Gate)
        {
            Prune(DateTimeOffset.UtcNow);
            if (Operations.Values.Count(o => o.Owner == userId && o.CompletedAt is null) >= MaxOperationsPerUser)
                throw new ApiAccessException(429, "OPERATION_LIMIT", "进行中的操作过多，请稍后重试");
            while (Operations.Count >= MaxOperations)
            {
                var completed = Operations.Where(pair => pair.Value.CompletedAt is not null)
                    .OrderBy(pair => pair.Value.CompletedAt).FirstOrDefault();
                if (completed.Key is null)
                    throw new ApiAccessException(429, "OPERATION_LIMIT", "进行中的操作过多，请稍后重试");
                Operations.Remove(completed.Key);
            }
            var id = Guid.NewGuid().ToString("N");
            var operation = new Operation(userId, DateTimeOffset.UtcNow);
            Operations.Add(id, operation);
            AddEvent(operation, new Event("started", null, "pending", null));
            return id;
        }
    }

    internal static bool IsOwned(Guid userId, string operationId)
    {
        lock (Gate)
        {
            Prune(DateTimeOffset.UtcNow);
            return FindOwnedActive(userId, operationId, out _);
        }
    }

    internal static bool Publish(Guid userId, string operationId, string stage, int? count = null,
        string? status = null, string? errorCode = null, string? detail = null)
    {
        // 详情只由后端构造；限制长度并移除控制字符，禁止将网络位置带入本人事件流。
        if (detail is not null)
        {
            detail = new string(detail.Where(character => !char.IsControl(character) || character is '\n' or '\r' or '\t').Take(24000).ToArray());
            detail = System.Text.RegularExpressions.Regex.Replace(detail, @"(?i)[a-z][a-z0-9+.-]*://[^\s""'<>]+", "[地址已脱敏]");
        }
        lock (Gate)
        {
            Prune(DateTimeOffset.UtcNow);
            if (!FindOwnedActive(userId, operationId, out var operation)) return false;
            AddEvent(operation, new Event(Stages.Contains(stage) ? stage : "progress",
                count is >= 0 and <= 1000000 ? count : null,
                status is not null && Statuses.Contains(status) ? status : "running",
                errorCode is null ? null : ErrorCodes.Contains(errorCode) ? errorCode : "OTHER_ERROR", detail));
            return true;
        }
    }

    internal static bool Complete(Guid userId, string operationId, string status = "succeeded", string? errorCode = null)
    {
        lock (Gate)
        {
            Prune(DateTimeOffset.UtcNow);
            if (!FindOwnedActive(userId, operationId, out var operation)) return false;
            var terminal = status is "succeeded" or "failed" or "cancelled" ? status : "failed";
            AddEvent(operation, new Event(terminal == "failed" ? "failed" : "completed", null, terminal,
                errorCode is null ? null : ErrorCodes.Contains(errorCode) ? errorCode : "OTHER_ERROR"));
            operation.CompletedAt = DateTimeOffset.UtcNow;
            foreach (var subscriber in operation.Subscribers) subscriber.Writer.TryComplete();
            return true;
        }
    }

    internal static Subscription Subscribe(Guid userId, string operationId)
    {
        lock (Gate)
        {
            Prune(DateTimeOffset.UtcNow);
            if (userId == Guid.Empty || !Operations.TryGetValue(operationId, out var operation) || operation.Owner != userId)
                throw new ApiAccessException(404, "OPERATION_NOT_FOUND", "操作不存在或不可访问");
            if (_subscribers >= MaxSubscribers || operation.Subscribers.Count >= MaxSubscribersPerOperation)
                throw new ApiAccessException(429, "SUBSCRIBER_LIMIT", "操作订阅数量已达上限");
            var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(MaxEvents)
            {
                SingleReader = true, SingleWriter = false, FullMode = BoundedChannelFullMode.DropOldest
            });
            // Replay and registration share the same lock with Publish, so no event can be lost between them.
            foreach (var item in operation.Events) channel.Writer.TryWrite(item);
            if (operation.CompletedAt is not null) channel.Writer.TryComplete();
            else operation.Subscribers.Add(channel);
            _subscribers++;
            return new Subscription(operation, channel);
        }
    }

    // 续租仅供仍在执行的服务器任务调用，不发布伪造进度，也不接受客户端续租。
    internal static void Touch(Guid owner, string id)
    {
        lock (Gate)
            if (FindOwnedActive(owner, id, out var operation)) operation.LastActivityAt = DateTimeOffset.UtcNow;
    }

    private static bool FindOwnedActive(Guid userId, string id, out Operation operation)
    {
        if (userId != Guid.Empty && Operations.TryGetValue(id, out operation!)
            && operation.Owner == userId && operation.CompletedAt is null) return true;
        operation = null!;
        return false;
    }

    private static void AddEvent(Operation operation, Event value)
    {
        // 活动租约随真实业务进度续期，异步下载不会因创建时间超过三分钟而丢失订阅。
        operation.LastActivityAt = DateTimeOffset.UtcNow;
        var payload = "data: " + JsonSerializer.Serialize(value, EventJsonOptions) + "\n\n";
        operation.Events.Enqueue(payload);
        if (operation.Events.Count > MaxEvents) operation.Events.Dequeue();
        foreach (var subscriber in operation.Subscribers) subscriber.Writer.TryWrite(payload);
    }

    private static readonly JsonSerializerOptions EventJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private static void Prune(DateTimeOffset now)
    {
        foreach (var pair in Operations.ToArray())
        {
            if (now - (pair.Value.CompletedAt ?? pair.Value.LastActivityAt)
                < (pair.Value.CompletedAt is null ? ActiveTtl : CompletedTtl)) continue;
            Operations.Remove(pair.Key);
            foreach (var subscriber in pair.Value.Subscribers) subscriber.Writer.TryComplete();
        }
    }

    private sealed record Event(string Stage, int? Count, string Status, string? ErrorCode, string? Detail = null);

    internal sealed class Operation(Guid owner, DateTimeOffset createdAt)
    {
        internal Guid Owner { get; } = owner;
        internal DateTimeOffset CreatedAt { get; } = createdAt;
        internal DateTimeOffset LastActivityAt { get; set; } = createdAt;
        internal DateTimeOffset? CompletedAt { get; set; }
        internal Queue<string> Events { get; } = new();
        internal HashSet<Channel<string>> Subscribers { get; } = new();
    }

    internal sealed class Subscription : IDisposable
    {
        private readonly Operation _operation;
        private readonly Channel<string> _channel;
        private bool _disposed;
        internal Subscription(Operation operation, Channel<string> channel) => (_operation, _channel) = (operation, channel);
        internal ChannelReader<string> Reader => _channel.Reader;
        public void Dispose()
        {
            lock (Gate)
            {
                if (_disposed) return;
                _disposed = true;
                _operation.Subscribers.Remove(_channel);
                _channel.Writer.TryComplete();
                _subscribers--;
            }
        }
    }
}
