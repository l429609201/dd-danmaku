namespace DD.Danmaku.Hosting;

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using DD.Danmaku.Persistence;
using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>新增或编辑本人来源；仅更新本人原参数文件的来源列表。</summary>
[Route("/dd-danmaku/api/sources", "PUT")]
public sealed class BackendSourceSettingsRequest : IRequiresRequestStream
{
    /// <summary>有界 JSON 请求正文，不绑定调用者身份或内网权限。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

public sealed partial class DanmakuApiService
{
    private sealed class SourceSettingsBody
    {
        public string? SourceId { get; set; }
        public string? Name { get; set; }
        public string? Url { get; set; }
        public string? Type { get; set; }
        public string? ServerName { get; set; }
        public string? AppId { get; set; }
        public bool? Enabled { get; set; }
        public string? SecretAction { get; set; }
        public string? AppSecret { get; set; }
    }
    private static readonly JsonSerializerOptions SourceSettingsJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, MaxDepth = 8
    };

    /// <summary>凭据必须显式保持、替换或清空；更换服务器禁止自动携带旧凭据。</summary>
    public Task<object> Put(BackendSourceSettingsRequest request) => Execute(async (user, plugin, host) =>
    {
        var token = Request.CancellationToken;
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 65536, "application/json");
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
        MatchJson.RejectDuplicateProperties(document.RootElement);
        var body = document.RootElement.Deserialize<SourceSettingsBody>(SourceSettingsJson) ?? throw new JsonException();
        await InitializeParameters(plugin, user.Id, token);
        var global = await GlobalDefaults(plugin);
        var safe = await plugin.Parameters.StoreFor(user.Id).MutateAsync(rows =>
        {
            // 在同一个参数文件锁内读取旧密钥并局部更新，不能把安全快照当作完整配置回写。
            var defaults = FrontendDefaults.Merge(global, FrontendParameterMap.FromEntries(rows));
            var result = EditBackendSource(defaults, plugin.Configuration, user.Id, body);
            var mapped = FrontendParameterMap.ToEntries(new FrontendDefaults { CustomApiList = result.Text }).Single();
            var parameter = rows.FirstOrDefault(row => row.Namespace == mapped.Namespace && row.Key == mapped.Key);
            if (parameter is null)
            {
                parameter = mapped;
                rows.Add(parameter);
            }
            parameter.Value = result.Text;
            parameter.Type = "json";
            parameter.UpdatedAt = DateTime.UtcNow;
            return result.Source.View();
        }, token);
        return ApiHttpResult.Success(new { Source = safe });
    });

    private static (string Text, RegisteredBackendSource Source) EditBackendSource(FrontendDefaults defaults,
        PluginConfiguration administrator, Guid owner, SourceSettingsBody body)
    {
        foreach (var text in new[] { body.SourceId, body.Name, body.Url, body.Type, body.ServerName, body.AppId, body.AppSecret })
            if (text is not null && (text.Length > 2048 || text.Any(char.IsControl)))
                throw new ArgumentException("来源字段无效");
        if (body.Name?.Length > 64 || body.AppId?.Length > 256 || body.SourceId?.Length > 64)
            throw new ArgumentException("来源字段过长");
        if (body.SecretAction is not ("retain" or "set" or "clear"))
            throw new ArgumentException("必须明确指定 secretAction 为 retain、set 或 clear");
        if (body.SecretAction != "set" && body.AppSecret is not null
            || body.SecretAction == "set" && (string.IsNullOrEmpty(body.AppSecret)
                || body.AppSecret.All(c => c is '*' or '•') || body.AppSecret == "<KEEP_EXISTING>"))
            throw new ArgumentException("密钥动作与内容不一致，不能保存遮罩文本");
        var sources = BackendSources(defaults, administrator, owner);
        var prior = body.SourceId is null ? null : sources.SingleOrDefault(source => source.Id == body.SourceId)
            ?? (body.SourceId is null ? null : throw new ApiAccessException(404, "SOURCE_NOT_FOUND", "来源不存在或不属于本人"));
        var textList = defaults.CustomApiList;
        if (string.IsNullOrWhiteSpace(textList)) textList = string.IsNullOrWhiteSpace(defaults.CustomApiPrefix)
            ? "[]" : JsonSerializer.Serialize(new[] { defaults.CustomApiPrefix });
        var list = JsonNode.Parse(textList, documentOptions: new JsonDocumentOptions { MaxDepth = 16 }) as JsonArray
            ?? throw new ArgumentException("来源列表无效");
        var index = -1;
        if (prior is not null)
        {
            for (var i = 0; i < list.Count; i++)
            {
                var probe = defaults.Copy(); probe.CustomApiList = new JsonArray(list[i]?.DeepClone()).ToJsonString();
                if (BackendSources(probe, administrator, owner).Any(source => source.Id == prior.Id)) { index = i; break; }
            }
            if (index < 0) throw new ApiAccessException(409, "SOURCE_CHANGED", "来源配置已变更");
        }
        if (prior is null && list.Count >= 100) throw new ArgumentException("来源数量超过限制");
        var node = index < 0 ? new JsonObject() : list[index] is JsonObject obj ? (JsonObject)obj.DeepClone()
            : new JsonObject { ["url"] = list[index]?.GetValue<string>() };
        var admin = prior?.AdministratorProxy == true || prior is null && body.Type == "emby-proxy";
        if (body.Type is not null && body.Type != (admin ? "emby-proxy" : "custom"))
            throw new ArgumentException("不能更换来源身份类型");
        if (admin)
        {
            if (body.Url is not null || body.AppId is not null || body.AppSecret is not null
                || body.ServerName is not null || body.SecretAction != "retain")
                throw new ArgumentException("管理员代理认证和地址不能由个人覆盖");
            node["type"] = "emby-proxy";
        }
        else
        {
            if (prior is null && body.Url is null) throw new ArgumentException("新增来源需要 URL");
            if (body.ServerName is not null && body.ServerName is not ("generic" or "Misaka_Danmu_Server"))
                throw new ArgumentException("来源服务器类型无效");
            if (body.Url is not null) node["url"] = body.Url;
            if (body.ServerName is not null) node["serverName"] = body.ServerName;
            var probe = defaults.Copy(); probe.CustomApiList = new JsonArray(node.DeepClone()).ToJsonString();
            var next = BackendSources(probe, administrator, owner).Single();
            var identityChanged = prior is not null && (next.Id != prior.Id || next.ServerType != prior.ServerType);
            if (identityChanged && body.SecretAction == "retain")
                throw new ArgumentException("更换服务器必须明确替换或清空认证");
            if (identityChanged)
                foreach (var credential in new[] { "appId", "appSecret", "secret", "password", "key" }) node.Remove(credential);
            if (body.AppId is not null) node["appId"] = body.AppId;
            if (body.SecretAction is "set" or "clear")
            {
                foreach (var credential in new[] { "secret", "password", "key" }) node.Remove(credential);
                node["appSecret"] = body.SecretAction == "set" ? body.AppSecret : "";
            }
        }
        if (body.Name is not null) node["name"] = body.Name;
        if (body.Enabled is not null) node["enabled"] = body.Enabled.Value;
        if (index < 0) list.Add(node); else list[index] = node;
        var serialized = list.ToJsonString();
        if (serialized.Length > 128 * 1024) throw new ArgumentException("来源列表过长");
        var updated = defaults.Copy(); updated.CustomApiList = serialized;
        var validated = BackendSources(updated, administrator, owner);
        // 找到新身份，地址变化会返回新 ID；整个列表先校验再提交原子存储。
        var single = updated.Copy(); single.CustomApiList = new JsonArray(node.DeepClone()).ToJsonString();
        var selectedId = BackendSources(single, administrator, owner).Single().Id;
        return (serialized, validated.Single(source => source.Id == selectedId));
    }
}
