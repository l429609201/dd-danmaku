namespace DD.Danmaku.Hosting;

using System.Text.Json;
using System.Text.Json.Serialization;
using DD.Danmaku.Persistence;
using DD.Danmaku.Web.Api;
using DD.Danmaku.Web.ParameterPersistence;

public sealed partial class DanmakuApiService
{
    private static readonly JsonSerializerOptions ParameterJson = new()
    {
        PropertyNameCaseInsensitive = false, MaxDepth = 16,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    private sealed class ParameterBody
    {
        public string? Namespace { get; set; }
        public string? Key { get; set; }
        public string? Value { get; set; }
        public string? Type { get; set; }
        public string? Description { get; set; }
        public ParameterItem[]? Parameters { get; set; }
        public string[]? Keys { get; set; }
        [JsonPropertyName("userid")]
        public string? UserId { get; set; }
    }

    /// <summary>查询当前认证用户的参数。</summary>
    public Task<object> Get(QueryUserParameters request) => Execute(async (user, plugin, host) =>
    {
        ValidateParameterText(request.Namespace, 256);
        ValidateParameterText(request.Key, 512);
        ValidateParameterText(request.Keyword, 512);
        // 指定 Key 但省略 Namespace 时与原插件一致，只查询 default 命名空间。
        var ns = !string.IsNullOrWhiteSpace(request.Key) && string.IsNullOrWhiteSpace(request.Namespace)
            ? "default" : request.Namespace;
        // 查询当前用户前先按默认模板建立独立文件；旧个人文件始终优先。
        var initialized = await InitializeParameters(plugin, user.Id, Request.CancellationToken);
        var result = await plugin.Parameters.ForUser(user.Id).QueryAsync(
            new ParameterQueryRequest(ns, request.Key, request.Keyword), Request.CancellationToken);
        if (initialized && result.Success && string.IsNullOrWhiteSpace(request.Key))
            return ParameterResult(result with { Message = "INITIALIZED_DEFAULTS" });
        return ParameterResult(result);
    });

    /// <summary>为当前认证用户创建参数。</summary>
    public Task<object> Post(CreateUserParameters request) => MutateParameters(request.RequestStream, "create");
    /// <summary>更新当前认证用户的参数。</summary>
    public Task<object> Post(UpdateUserParameters request) => MutateParameters(request.RequestStream, "update");
    /// <summary>删除当前认证用户的参数。</summary>
    public Task<object> Post(DeleteUserParameters request) => MutateParameters(request.RequestStream, "delete");

    private Task<object> MutateParameters(Stream stream, string operation) => Execute(async (user, plugin, host) =>
    {
        var bytes = await ApiHttpResult.ReadBodyAsync(stream, Request, 2 * 1024 * 1024, "application/json");
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16 });
        MatchJson.RejectDuplicateProperties(document.RootElement);
        var body = document.RootElement.Deserialize<ParameterBody>(ParameterJson) ?? throw new JsonException();
        // 新文件优先；请求体中的 UserId 仅用于校验，实际用户仍以宿主认证身份为准。
        var suppliedUserId = body.UserId;
        if (!string.IsNullOrWhiteSpace(suppliedUserId)
            && (!Guid.TryParse(suppliedUserId, out var parsedUserId) || parsedUserId != user.Id))
            throw new ArgumentException("UserId 与当前认证用户不匹配");
        ValidateParameterText(body.Namespace, 256);
        ValidateParameterText(body.Key, 512);
        ValidateParameterText(body.Description, 2048);
        ValidateParameterText(body.Type, 32);
        if (body.Value?.Length > 256 * 1024 || body.Parameters?.Length > 500 || body.Keys?.Length > 500)
            throw new ArgumentException("参数超过限制");
        // 先校验整个批次再写入，防止恶意字段位于后半批时已经产生前半批副作用。
        foreach (var item in body.Parameters ?? [])
        {
            if (item is null || string.IsNullOrWhiteSpace(item.Key)) throw new ArgumentException("参数 Key 为空");
            ValidateParameterText(item.Namespace, 256);
            ValidateParameterText(item.Key, 512);
            ValidateParameterText(item.Description, 2048);
            ValidateParameterText(item.Type, 32);
            if (item.Value?.Length > 256 * 1024) throw new ArgumentException("参数值超过限制");
        }
        foreach (var key in body.Keys ?? [])
        {
            if (string.IsNullOrWhiteSpace(key)) throw new ArgumentException("参数 Key 为空");
            ValidateParameterText(key, 512);
        }
        // 直接创建或更新参数的旧客户端也需先继承默认模板，不能跳过首次初始化。
        await InitializeParameters(plugin, user.Id, Request.CancellationToken);
        var service = plugin.Parameters.ForUser(user.Id);
        var mutation = new ParameterMutationRequest(body.Namespace, body.Key, body.Value, body.Type, body.Description);
        var result = operation switch
        {
            "create" => await service.CreateAsync(mutation, body.Parameters, Request.CancellationToken),
            "update" => await service.UpdateAsync(mutation, body.Parameters, Request.CancellationToken),
            _ => await service.DeleteAsync(body.Namespace, body.Key, body.Keys, body.Parameters, Request.CancellationToken)
        };
        // 自动个人参数保存也按认证用户启动；只关心元数据字段，避免播放滑块写入反复重测。
        static bool MetadataKey(string? key)
        {
            if (key is null) return false;
            if (key.StartsWith("danmaku", StringComparison.OrdinalIgnoreCase)) key = key[7..];
            return new[] { "TmdbApiKey", "TmdbApiBaseUrl", "TmdbEpisodeMappingEnable", "BangumiToken",
                "BangumiApiPrefix", "BangumiEnable", "BgmSearchFallbackEnable" }.Contains(key, StringComparer.OrdinalIgnoreCase);
        }
        if (result.Success && (body.Namespace is null or "dd-danmaku")
            && (MetadataKey(body.Key) || (body.Keys ?? []).Any(MetadataKey)
            || (body.Parameters ?? []).Any(item => (item.Namespace is null or "dd-danmaku") && MetadataKey(item.Key))))
            await MetadataSavedAsync(plugin, user.Id);
        return ParameterResult(result);
    });

    private static void ValidateParameterText(string? value, int limit)
    {
        if (value is not null && (value.Length > limit || value.Any(char.IsControl)))
            throw new ArgumentException("参数字段无效");
    }

    // 旧客户端读取 Success/DataList 等 PascalCase 字段，不能套用新 API 的 camelCase。
    private static ApiHttpResult ParameterResult(ParameterResponse response)
        => new(200, JsonSerializer.SerializeToUtf8Bytes(response, ParameterJson), "application/json; charset=utf-8");
}
