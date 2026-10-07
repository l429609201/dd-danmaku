namespace DD.Danmaku.Hosting;

using MediaBrowser.Model.Services;

/// <summary>管理员读取代理设置；密钥永不回显。</summary>
[Route("/dd-danmaku/api/config/proxy", "GET")]
public sealed class ProxySettingsRequest { }
/// <summary>管理员更新代理设置。</summary>
[Route("/dd-danmaku/api/config/proxy", "PUT")]
public sealed class SaveProxySettingsRequest : IRequiresRequestStream
{
    /// <summary>受限 JSON 正文。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>空密钥保留原值，清除需显式指定。</summary>
public sealed record ProxySettingsInput(bool Enabled, string BaseUrl, string ServerType,
    string AppId, string? AppSecret, bool ClearSecret, string? SourceId = null, IReadOnlyList<string>? PrivateSourcePrefixes = null);

public sealed partial class DanmakuApiService
{
    /// <summary>读取不含认证密钥的代理配置。</summary>
    public Task<object> Get(ProxySettingsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return Task.FromResult(ApiHttpResult.Success(ProxySettingsView(plugin.Configuration)));
    });
    /// <summary>配置只接受固定 API 前缀，避免查询串和路径重写。</summary>
    public Task<object> Put(SaveProxySettingsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 16384, "application/json");
        var input = ApiHttpResult.Parse<ProxySettingsInput>(bytes);
        var url = (input.BaseUrl ?? "").Trim().TrimEnd('/');
        var source = (input.SourceId ?? "").Trim();
        // 来源独立于服务器类型，禁止冒用官方来源或引入路径字符。
        if (source.Length > 64 || source.Equals("dandanplay", StringComparison.OrdinalIgnoreCase)
            || source.Any(ch => char.IsControl(ch) || "<>:\"/\\|?*".Contains(ch))
            || source is "." or ".." || source.EndsWith('.'))
            throw new ArgumentException("自定义来源标识无效");
        if (input.ServerType is not ("generic" or "Misaka_Danmu_Server")
            || input.AppId?.Length > 256 || input.AppSecret?.Length > 2048 || url.Length > 2048)
            throw new ArgumentException("代理配置参数无效");
        if (input.Enabled || url.Length > 0)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")
                || uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0)
                throw new ArgumentException("代理地址必须是无凭据和查询参数的 HTTP API 前缀");
        }
        string[]? privatePrefixes = null;
        if (input.PrivateSourcePrefixes is { } prefixes)
        {
            if (prefixes.Count > 100) throw new ArgumentException("内网来源授权列表过长");
            privatePrefixes = prefixes.Select(value =>
            {
                if (value is null || value.Length > 2048 || !Uri.TryCreate(value.Trim(), UriKind.Absolute, out var target)
                    || target.Scheme is not ("http" or "https") || target.UserInfo.Length != 0
                    || target.Query.Length != 0 || target.Fragment.Length != 0)
                    throw new ArgumentException("内网来源授权前缀无效");
                return target.AbsoluteUri.TrimEnd('/');
            }).Distinct(StringComparer.Ordinal).ToArray();
        }
        lock (DD.Danmaku.Web.Api.PluginConfigurationService.ConfigurationGate)
        {
            var c = plugin.Configuration.CopyForUpdate();
            c.DanmakuProxyEnabled = input.Enabled;
            if (privatePrefixes is not null) c.BackendPrivateSourcePrefixes = privatePrefixes;
            c.DanmakuProxySourceId = source;
            c.DanmakuProxyBaseUrl = url;
            c.DanmakuProxyServerType = input.ServerType;
            c.DanmakuProxyAppId = input.AppId ?? "";
            if (input.ClearSecret) c.DanmakuProxyAppSecret = "";
            else if (!string.IsNullOrEmpty(input.AppSecret)) c.DanmakuProxyAppSecret = input.AppSecret;
            plugin.UpdateConfiguration(c);
            return ApiHttpResult.Success(ProxySettingsView(c));
        }
    });
    private static object ProxySettingsView(PluginConfiguration c) => new
    {
        Enabled = c.DanmakuProxyEnabled, BaseUrl = c.DanmakuProxyBaseUrl,
        SourceId = c.DanmakuProxySourceId,
        ServerType = c.DanmakuProxyServerType, AppId = c.DanmakuProxyAppId,
        HasSecret = !string.IsNullOrEmpty(c.DanmakuProxyAppSecret),
        PrivateSourcePrefixes = c.BackendPrivateSourcePrefixes ?? []
    };
}
