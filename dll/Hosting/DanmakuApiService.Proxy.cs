namespace DD.Danmaku.Hosting;

using System.Globalization;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MediaBrowser.Model.Services;

/// <summary>仅允许已登录用户访问后端固定配置的弹幕上游。</summary>
[Route("/dd-danmaku/api/proxy/custom", "GET")]
public sealed class CustomProxyRequest
{
    /// <summary>白名单操作，不接收任意 URL。</summary>
    public string Operation { get; set; } = "";
    /// <summary>作品、集或异步任务标识。</summary>
    public string? Id { get; set; }
    /// <summary>搜索关键词。</summary>
    public string? Keyword { get; set; }
    /// <summary>简繁转换选项。</summary>
    public int ChConvert { get; set; }
    /// <summary>是否请求御坂异步任务。</summary>
    public bool Async { get; set; }
}

/// <summary>前端选择代理类型时实际验证后台当前配置。</summary>
[Route("/dd-danmaku/api/proxy/validate", "GET")]
public sealed class ValidateCustomProxyRequest { }

public sealed partial class DanmakuApiService
{
    /// <summary>转发自定义弹幕 API，只保留上游 JSON 协议。</summary>
    public Task<object> Get(CustomProxyRequest request) => Execute((user, plugin, host) =>
        TraceProxyAsync(user.Id, async () =>
    {
        var c = plugin.Configuration;
        var path = request.Operation switch
        {
            "search" => "/search/anime?keyword=" + Uri.EscapeDataString(ProxyKeyword(request.Keyword)),
            "bangumi" => "/bangumi/" + ProxyIdentifier(request.Id),
            "comment" => "/comment/" + ProxyIdentifier(request.Id) + "?withRelated=true&chConvert="
                + (request.ChConvert is >= 0 and <= 2 ? request.ChConvert : throw new ArgumentException("简繁参数无效"))
                + (request.Async && c.DanmakuProxyServerType == "Misaka_Danmu_Server" ? "&async=1" : ""),
            "task" when c.DanmakuProxyServerType == "Misaka_Danmu_Server" => "/taskcomment/" + ProxyIdentifier(request.Id),
            _ => throw new ArgumentException("不支持的弹幕代理操作")
        };
        // 请求前固定并核验媒体上下文；任务绑定包含上游配置身份，配置变化后旧任务失效。
        var itemId = Request.QueryString["ItemId"] ?? "";
        var userId = user.Id.ToString("N");
        var upstreamKey = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            JsonSerializer.Serialize(new { c.DanmakuProxyBaseUrl, c.DanmakuProxySourceId,
                c.DanmakuProxyServerType, c.DanmakuProxyAppId, c.DanmakuProxyAppSecret }))));
        if (request.Operation is "comment" or "task")
        {
            if (!string.IsNullOrEmpty(itemId)) _access.RequireVideo(user, itemId);
            if (request.Operation == "task")
                ProxyTaskBindings.Require(ProxyIdentifier(request.Id), userId, itemId, upstreamKey);
        }
        // 搜索、任务进度不写文件；异步完成后重新请求 comment 才保存正文。
        var reply = await SendCustomProxy(c, path, Request.CancellationToken);
        if (request.Operation == "comment")
        {
            using var document = JsonDocument.Parse(reply.Body);
            var root = document.RootElement;
            // 裸数组也是合法正文，只有对象响应才能读取异步任务状态。
            if (root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("status", out var state) && state.ValueKind == JsonValueKind.String
                && state.GetString() == "pending" && root.TryGetProperty("taskId", out var task))
                ProxyTaskBindings.Register(ProxyIdentifier(task.ToString()), userId, itemId,
                    ProxyIdentifier(request.Id), upstreamKey);
        }
        if (request.Operation == "comment" && reply.StatusCode is >= 200 and < 300)
            ProxyProgress(user.Id, "save");
        var responseBody = request.Operation == "comment" && reply.StatusCode is >= 200 and < 300
            ? await SaveProxyCommentsAsync(reply.Body, itemId,
                c.DanmakuProxySourceId, ProxyIdentifier(request.Id), user, plugin, host,
                SelectionUpstreamRevision(c.DanmakuProxySourceId, c), request.ChConvert)
            : reply.Body;
        return new ApiHttpResult(reply.StatusCode, responseBody, "application/json; charset=utf-8");
    }));

    /// <summary>空搜索结果可用，但 HTTP 错误、HTML 或业务失败不可用。</summary>
    public Task<object> Get(ValidateCustomProxyRequest request) => Execute(async (user, plugin, host) =>
    {
        var c = plugin.Configuration;
        var misaka = c.DanmakuProxyServerType == "Misaka_Danmu_Server";
        var reply = await SendCustomProxy(c, misaka ? "/version" : "/search/anime?keyword=test", Request.CancellationToken);
        using var document = JsonDocument.Parse(reply.Body);
        var root = document.RootElement;
        if (root.TryGetProperty("success", out var success) && success.ValueKind == JsonValueKind.False)
            throw new ApiAccessException(502, "UPSTREAM_VALIDATION_FAILED", "上游报告验证失败");
        var valid = misaka
            ? root.TryGetProperty("serverName", out var name) && name.GetString() == "Misaka_Danmu_Server"
                && root.TryGetProperty("version", out var version) && version.ValueKind == JsonValueKind.String
            : root.TryGetProperty("animes", out var animes) && animes.ValueKind == JsonValueKind.Array;
        if (!valid) throw new ApiAccessException(502, "UPSTREAM_PROTOCOL_MISMATCH", "上游响应不符合所选弹幕 API 类型");
        return ApiHttpResult.Success(new { Available = true, ServerType = c.DanmakuProxyServerType, SupportsAsync = misaka });
    });

    private static string ProxyIdentifier(string? id)
    {
        // 不允许路径分隔符、点段或编码后的路径跳转。
        if (string.IsNullOrEmpty(id) || id.Length > 160 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')))
            throw new ArgumentException("上游标识无效");
        return id;
    }
    private static string ProxyKeyword(string? keyword)
    {
        if (string.IsNullOrWhiteSpace(keyword) || keyword.Length > 200) throw new ArgumentException("搜索关键词无效");
        return keyword.Trim();
    }
    private static Task<DanmakuProxyTransport.Reply> SendCustomProxy(PluginConfiguration c, string path,
        CancellationToken token, byte[]? body = null, Action<string>? diagnostic = null)
    {
        if (!c.DanmakuProxyEnabled) throw new ApiAccessException(409, "PROXY_DISABLED", "管理员尚未启用自定义弹幕代理");
        if (!Uri.TryCreate(c.DanmakuProxyBaseUrl.TrimEnd('/') + path, UriKind.Absolute, out var target))
            throw new ApiAccessException(409, "PROXY_NOT_CONFIGURED", "自定义弹幕代理地址未配置");
        var headers = new Dictionary<string, string>();
        if (!string.IsNullOrEmpty(c.DanmakuProxyAppId) && !string.IsNullOrEmpty(c.DanmakuProxyAppSecret))
        {
            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
            var raw = c.DanmakuProxyAppId + ts + target.AbsolutePath + c.DanmakuProxyAppSecret;
            headers["X-AppId"] = c.DanmakuProxyAppId;
            headers["X-Timestamp"] = ts;
            headers["X-Signature"] = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
        }
        // 匹配正文经独立路由校验；GET 与 POST 共用同一签名和传输限制。
        return DanmakuProxyTransport.SendAsync(target, body is null ? HttpMethod.Get : HttpMethod.Post, headers, body, token,
            BackendSourceAuthorization.AllowPrivate(c)
                || ReferenceEquals(c, Plugin.Instance?.Configuration)
                    && BackendSourcePolicy.IsApprovedPrivateBase(new Uri(c.DanmakuProxyBaseUrl), c), diagnostic);
    }
}
