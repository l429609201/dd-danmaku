namespace DD.Danmaku.Hosting;

using System.Net.Http;
using System.Reflection;
using System.Text.Json;
using MediaBrowser.Model.Services;

/// <summary>官方代理只接受官方 API 相对路径，由后端生成签名与中转目标。</summary>
[Route("/dd-danmaku/api/proxy/official", "GET,POST")]
public sealed class OfficialProxyRequest : IRequiresRequestStream
{
    /// <summary>官方 API 相对路径及受限查询参数。</summary>
    public string Path { get; set; } = "";
    /// <summary>match 请求正文。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

public sealed partial class DanmakuApiService
{
    // 构建资源缺失时所有值为空；不使用源码内默认密钥，也不回退浏览器签名。
    private sealed record OfficialBuildSettings(string Secret, string BrandMark, string ObfuscationKey,
        string RelayPrefix, string UserAgent);
    private static readonly Lazy<OfficialBuildSettings> OfficialSettings = new(() =>
    {
        using var stream = typeof(DanmakuApiService).Assembly.GetManifestResourceStream("DD.Danmaku.OfficialSigning.json");
        return stream is null ? new("", "", "", "", "")
            : JsonSerializer.Deserialize<OfficialBuildSettings>(stream) ?? new("", "", "", "", "");
    });
    /// <summary>官方只读请求。</summary>
    public Task<object> Get(OfficialProxyRequest request) => ForwardOfficial(request, false);
    /// <summary>官方匹配请求。</summary>
    public Task<object> Post(OfficialProxyRequest request) => ForwardOfficial(request, true);
    private Task<object> ForwardOfficial(OfficialProxyRequest request, bool post) => Execute((user, plugin, host) =>
        TraceProxyAsync(user.Id, async () =>
    {
        var settings = OfficialSettings.Value;
        var signer = new OfficialRequestSigner(settings.Secret, settings.BrandMark, settings.ObfuscationKey);
        if (!signer.IsConfigured || string.IsNullOrEmpty(settings.RelayPrefix) || string.IsNullOrEmpty(settings.UserAgent))
            throw new ApiAccessException(503, "OFFICIAL_PROXY_UNAVAILABLE", "此 DLL 构建未配置官方中转签名");
        var raw = request.Path;
        if (string.IsNullOrEmpty(raw) || raw.Length > 4096 || !raw.StartsWith("/api/v2/", StringComparison.Ordinal)
            || raw.Contains('#') || raw.Contains('\\') || raw.Contains("..", StringComparison.Ordinal))
            throw new ArgumentException("官方代理路径无效");
        var upstream = new Uri("https://api.dandanplay.net" + raw);
        var path = upstream.AbsolutePath;
        var tail = path[8..];
        var allowed = post ? tail == "match" : tail is "search/anime" or "search/episodes"
            || tail.StartsWith("bangumi/", StringComparison.Ordinal) || tail.StartsWith("comment/", StringComparison.Ordinal);
        if (!allowed) throw new ArgumentException("不支持的官方接口");
        foreach (var pair in upstream.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var key = Uri.UnescapeDataString(pair.Split('=')[0]);
            if (key is not ("keyword" or "anime" or "episode" or "withRelated" or "chConvert"))
                throw new ArgumentException("官方查询参数不在白名单内");
        }
        var headers = new Dictionary<string, string>(signer.CreateHeaders(user.Id, path))
        { ["X-User-Agent"] = settings.UserAgent };
        byte[]? body = post ? await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 256 * 1024, "application/json") : null;
        // 中转前缀来自构建配置，不接受浏览器指定目标或认证身份。
        var target = new Uri(settings.RelayPrefix + upstream.AbsoluteUri);
        var reply = await DanmakuProxyTransport.SendAsync(target, post ? HttpMethod.Post : HttpMethod.Get,
            headers, body, Request.CancellationToken);
        // 仅弹幕正文请求可触发保存；媒体权限由保存编排再次核验。
        if (!post && reply.StatusCode is >= 200 and < 300 && tail.StartsWith("comment/", StringComparison.Ordinal))
            ProxyProgress(user.Id, "save");
        var responseBody = !post && reply.StatusCode is >= 200 and < 300
            && tail.StartsWith("comment/", StringComparison.Ordinal)
            ? await SaveProxyCommentsAsync(reply.Body, Request.QueryString["ItemId"],
                DD.Danmaku.Danmaku.DanmakuXmlMetadata.OfficialSource, ProxyIdentifier(tail[8..]), user, plugin, host,
                SelectionUpstreamRevision(DD.Danmaku.Danmaku.DanmakuXmlMetadata.OfficialSource, plugin.Configuration),
                OfficialChConvert(upstream))
            : reply.Body;
        return new ApiHttpResult(reply.StatusCode, responseBody, "application/json; charset=utf-8");
    }));
}
