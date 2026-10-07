namespace DD.Danmaku.Hosting;

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DD.Danmaku.Persistence;
using MediaBrowser.Model.Services;

/// <summary>本人可用来源安全视图；认证凭据不返回浏览器。</summary>
[Route("/dd-danmaku/api/sources", "GET")]
public sealed class BackendSourcesRequest { }
/// <summary>只验证已保存的来源，不接受浏览器指定上游地址。</summary>
[Route("/dd-danmaku/api/sources/{SourceId}/validate", "GET")]
public sealed class BackendSourceValidateRequest
{
    /// <summary>本人来源的稳定标识。</summary>
    public string SourceId { get; set; } = "";
}

internal sealed record RegisteredBackendSource(string Id, string Name, string BaseUrl,
    string ServerType, string AppId, string Secret, bool Enabled, bool AllowPrivate, bool AdministratorProxy)
{
    internal bool SupportsAsync => ServerType == "Misaka_Danmu_Server";
    internal object View() => new { Id, Name, Enabled, ServerType, SupportsAsync,
        HasSecret = Secret.Length > 0, AdministratorProxy,
        BaseUrl = AdministratorProxy ? null : BaseUrl, AppId = AdministratorProxy ? null : AppId };
    internal PluginConfiguration Configuration(PluginConfiguration original)
    {
        var copy = original.CopyForUpdate();
        copy.DanmakuProxyEnabled = Enabled;
        copy.DanmakuProxySourceId = AdministratorProxy ? original.DanmakuProxySourceId : Id;
        copy.DanmakuProxyBaseUrl = BaseUrl;
        copy.DanmakuProxyServerType = ServerType;
        copy.DanmakuProxyAppId = AppId;
        copy.DanmakuProxyAppSecret = Secret;
        BackendSourceAuthorization.Register(copy, AllowPrivate);
        return copy;
    }
}

public sealed partial class DanmakuApiService
{
    /// <summary>读取有效用户配置并生成来源目录，不发起上游请求。</summary>
    public Task<object> Get(BackendSourcesRequest request) => Execute(async (user, plugin, host) =>
    {
        var defaults = await BackendDefaultsAsync(plugin, user.Id, Request.CancellationToken);
        var sources = BackendSources(defaults, plugin.Configuration, user.Id);
        return ApiHttpResult.Success(new { Sources = sources.Select(source => source.View()).ToArray(),
            Priority = BackendSourcePriority(defaults, sources), OfficialEnabled = defaults.UseOfficialApi ?? true });
    });

    /// <summary>本人已配置来源的有限探测，地址和凭据只由后端读取。</summary>
    public Task<object> Get(BackendSourceValidateRequest request) => Execute(async (user, plugin, host) =>
    {
        var defaults = await BackendDefaultsAsync(plugin, user.Id, Request.CancellationToken);
        var source = BackendSources(defaults, plugin.Configuration, user.Id)
            .SingleOrDefault(candidate => candidate.Id == request.SourceId)
            ?? throw new ApiAccessException(404, "SOURCE_NOT_FOUND", "来源不存在或不属于当前用户");
        if (!source.Enabled || source.BaseUrl.Length == 0)
            throw new ApiAccessException(409, "SOURCE_UNAVAILABLE", "来源未启用或尚未配置");
        var configuration = source.Configuration(plugin.Configuration);
        var reply = await SendCustomProxy(configuration, source.SupportsAsync ? "/version" : "/search/anime?keyword=test",
            Request.CancellationToken);
        using var json = JsonDocument.Parse(reply.Body, new JsonDocumentOptions { MaxDepth = 32 });
        var root = json.RootElement;
        var valid = source.SupportsAsync
            ? root.TryGetProperty("serverName", out var name) && name.GetString() == "Misaka_Danmu_Server"
            : root.TryGetProperty("animes", out var animes) && animes.ValueKind == JsonValueKind.Array;
        if (!valid) throw new ApiAccessException(502, "UPSTREAM_PROTOCOL_MISMATCH", "来源响应协议与配置不符");
        return ApiHttpResult.Success(new { Available = true, source.Id, source.ServerType, source.SupportsAsync });
    });

    internal static async Task<FrontendDefaults> BackendDefaultsAsync(Plugin plugin, Guid userId, CancellationToken token)
    {
        await InitializeParameters(plugin, userId, token);
        var rows = await plugin.Parameters.StoreFor(userId).QueryAsync(null, null, null, token);
        return FrontendDefaults.Merge(await GlobalDefaults(plugin), FrontendParameterMap.FromEntries(rows));
    }

    internal static IReadOnlyList<RegisteredBackendSource> BackendSources(FrontendDefaults defaults,
        PluginConfiguration administrator, Guid userId)
    {
        var text = defaults.CustomApiList;
        if (string.IsNullOrWhiteSpace(text) && !string.IsNullOrWhiteSpace(defaults.CustomApiPrefix))
            text = JsonSerializer.Serialize(new[] { defaults.CustomApiPrefix });
        if (string.IsNullOrWhiteSpace(text)) return [];
        if (text.Length > 128 * 1024) throw new ArgumentException("来源列表过长");
        using var json = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 16 });
        if (json.RootElement.ValueKind != JsonValueKind.Array || json.RootElement.GetArrayLength() > 100)
            throw new ArgumentException("来源列表格式无效");
        var result = new List<RegisteredBackendSource>();
        var index = 0;
        foreach (var entry in json.RootElement.EnumerateArray())
        {
            index++;
            if (entry.ValueKind is not (JsonValueKind.String or JsonValueKind.Object))
                throw new ArgumentException("来源项格式无效");
            string Text(string field, int max = 2048)
            {
                if (entry.ValueKind != JsonValueKind.Object || !entry.TryGetProperty(field, out var value)) return "";
                if (value.ValueKind != JsonValueKind.String) throw new ArgumentException("来源文本格式无效");
                var valueText = value.GetString() ?? "";
                if (valueText.Length > max || valueText.Any(char.IsControl)) throw new ArgumentException("来源文本超出限制");
                return valueText;
            }
            var isAdministratorProxy = Text("type", 32) == "emby-proxy";
            var url = isAdministratorProxy ? administrator.DanmakuProxyBaseUrl
                : entry.ValueKind == JsonValueKind.String ? entry.GetString() ?? "" : Text("url");
            var name = Text("name", 64);
            if (name.Length == 0) name = "自定义源" + index;
            var appId = isAdministratorProxy ? administrator.DanmakuProxyAppId : Text("appId", 256);
            var secret = isAdministratorProxy ? administrator.DanmakuProxyAppSecret : Text("appSecret");
            var serverType = isAdministratorProxy ? administrator.DanmakuProxyServerType
                : Text("serverName", 128) == "Misaka_Danmu_Server" ? "Misaka_Danmu_Server" : "generic";
            var enabled = (defaults.UseCustomApi ?? false) && (!isAdministratorProxy || administrator.DanmakuProxyEnabled);
            if (entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("enabled", out var state))
            {
                if (state.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new ArgumentException("来源启用状态无效");
                enabled &= state.GetBoolean();
            }
            if (isAdministratorProxy && (string.IsNullOrWhiteSpace(url)
                || !Uri.TryCreate(url.TrimEnd('/'), UriKind.Absolute, out var adminUri)
                || adminUri.Scheme is not ("http" or "https") || adminUri.UserInfo.Length != 0
                || adminUri.Query.Length != 0 || adminUri.Fragment.Length != 0 || adminUri.AbsoluteUri.Length > 2048))
            {
                var unavailableId = "custom-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
                    userId.ToString("N") + "\nunconfigured-admin\nTrue")))[..24].ToLowerInvariant();
                if (!result.Any(source => source.Id == unavailableId))
                    result.Add(new(unavailableId, name, "", "generic", "", "", false, false, true));
                continue;
            }
            if (!Uri.TryCreate(url.TrimEnd('/'), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")
                || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.AbsoluteUri.Length > 2048)
                throw new ApiAccessException(409, "SOURCE_NOT_CONFIGURED", "来源 API 前缀无效，请检查本人配置");
            var canonical = uri.AbsoluteUri.TrimEnd('/');
            var id = "custom-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
                userId.ToString("N") + "\n" + canonical + "\n" + isAdministratorProxy)))[..24].ToLowerInvariant();
            var allowPrivate = BackendSourcePolicy.IsApprovedPrivateBase(uri, administrator);
            // 个人明文配置不能自行开启内网权限；重复配置同一身份不会重复请求。
            if (result.Any(source => source.BaseUrl == canonical)) throw new ArgumentException("重复的来源地址，请只保留一项配置");
            result.Add(new(id, name, canonical, serverType, appId, secret, enabled, allowPrivate, isAdministratorProxy));
        }
        return result;
    }

    internal static IReadOnlyList<string> BackendSourcePriority(FrontendDefaults defaults,
        IReadOnlyList<RegisteredBackendSource> sources)
    {
        var priority = new List<string>();
        using var json = JsonDocument.Parse(defaults.ApiPriority ?? "[\"official\",\"custom\"]");
        if (json.RootElement.ValueKind != JsonValueKind.Array || json.RootElement.GetArrayLength() > 100)
            throw new ArgumentException("来源优先级格式无效");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in json.RootElement.EnumerateArray())
        {
            var key = entry.ValueKind == JsonValueKind.String ? entry.GetString() : null;
            if (key is null || !seen.Add(key)) throw new ArgumentException("来源优先级包含重复或无效项");
            if (key == "official") { if (defaults.UseOfficialApi ?? true) priority.Add("official"); }
            else if (key == "custom") priority.AddRange(sources.Where(source => source.Enabled).Select(source => source.Id));
            else throw new ArgumentException("来源优先级包含未知项");
        }
        return priority.Distinct(StringComparer.Ordinal).ToArray();
    }
}
