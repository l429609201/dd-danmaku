namespace DD.Danmaku.Hosting;

using System.Text.Json;
using MediaBrowser.Model.Services;

/// <summary>管理员用固定关键词验证官方中转，不接受客户端指定地址。</summary>
[Route("/dd-danmaku/api/proxy/official/health", "GET")]
public sealed class OfficialRelayHealthRequest { }

public sealed partial class DanmakuApiService
{
    private static readonly SemaphoreSlim RelayHealthGate = new(1, 1);
    private static readonly Dictionary<Guid, (DateTimeOffset At, object Result)> RelayHealthCache = new();

    /// <summary>通过真实签名搜索验证连接；缓存按用户隔离，日志及回包不包含中转地址。</summary>
    public Task<object> Get(OfficialRelayHealthRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        await RelayHealthGate.WaitAsync(Request.CancellationToken);
        try
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var owner in RelayHealthCache.Where(pair => now - pair.Value.At >= TimeSpan.FromMinutes(1))
                .Select(pair => pair.Key).ToArray()) RelayHealthCache.Remove(owner);
            if (RelayHealthCache.TryGetValue(user.Id, out var cached)) return ApiHttpResult.Success(cached.Result);
            if (!OnlineOfficialConfigured())
                return ApiHttpResult.Success(new { Status = "unconfigured", LatencyMilliseconds = (long?)null,
                    CheckedAt = now, HttpStatus = (int?)null });
            using var stop = CancellationTokenSource.CreateLinkedTokenSource(Request.CancellationToken);
            stop.CancelAfter(TimeSpan.FromSeconds(5));
            var watch = System.Diagnostics.Stopwatch.StartNew();
            object result;
            try
            {
                // 与实际业务使用相同的签名身份和安全传输；空搜索结果同样表示接口可用。
                // 不记录目标域名、不调用流控后备、不自动重试、不触发 XML 保存。
                var body = await OnlineFetchAsync("official", plugin.Configuration, user.Id,
                    "/search/anime?keyword=test", null, stop.Token);
                using var document = JsonDocument.Parse(body);
                if (!document.RootElement.TryGetProperty("animes", out var works) || works.ValueKind != JsonValueKind.Array)
                    throw new ApiAccessException(502, "UPSTREAM_PROTOCOL_MISMATCH", "搜索响应格式不符合协议");
                result = new { Status = "available", LatencyMilliseconds = (long?)watch.ElapsedMilliseconds,
                    CheckedAt = DateTimeOffset.UtcNow, HttpStatus = (int?)200, ErrorCode = (string?)null };
            }
            catch (OperationCanceledException) when (!Request.CancellationToken.IsCancellationRequested)
            {
                result = new { Status = "timeout", LatencyMilliseconds = (long?)watch.ElapsedMilliseconds,
                    CheckedAt = DateTimeOffset.UtcNow, HttpStatus = (int?)null, ErrorCode = "UPSTREAM_TIMEOUT" };
            }
            catch (ApiAccessException error)
            {
                result = new { Status = error.Code == "UPSTREAM_AUTH_REJECTED" ? "auth-rejected"
                        : error.Code == "UPSTREAM_RATE_LIMITED" ? "rate-limited" : "unavailable",
                    LatencyMilliseconds = (long?)watch.ElapsedMilliseconds, CheckedAt = DateTimeOffset.UtcNow,
                    HttpStatus = (int?)(error.UpstreamReply?.StatusCode ?? error.Status), ErrorCode = error.Code };
            }
            catch (JsonException)
            {
                result = new { Status = "unavailable", LatencyMilliseconds = (long?)watch.ElapsedMilliseconds,
                    CheckedAt = DateTimeOffset.UtcNow, HttpStatus = (int?)200, ErrorCode = "UPSTREAM_PROTOCOL_MISMATCH" };
            }
            if (RelayHealthCache.Count < 128) RelayHealthCache[user.Id] = (DateTimeOffset.UtcNow, result);
            return ApiHttpResult.Success(result);
        }
        finally { RelayHealthGate.Release(); }
    });
}
