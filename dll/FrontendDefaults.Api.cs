namespace DD.Danmaku;

using System.Text.Json;

// 仅包含播放器直连所需的 API 默认值；全局源凭据会共享给继承者。
public sealed partial class FrontendDefaults
{
    // 本地读取由 DLL 播放策略控制，不下发旧 XML 开关。
    /// <summary>是否启用弹弹 Play 官方接口。</summary>
    public bool? UseOfficialApi { get; set; }
    /// <summary>是否启用自定义弹幕接口。</summary>
    public bool? UseCustomApi { get; set; }
    /// <summary>是否启用自定义接口的匹配 API。</summary>
    public bool? MatchApiEnable { get; set; }
    /// <summary>搜索文件名时是否拼接季集号。</summary>
    public bool? AppendSeasonEpisode { get; set; }
    /// <summary>官方源返回跨季累计集号时，按季首集归一化。</summary>
    public bool? NormalizeSeasonEpisode { get; set; }
    /// <summary>自定义弹幕来源列表的 JSON 文本。</summary>
    public string? CustomApiList { get; set; }
    /// <summary>前端搜索所使用的匹配模式。</summary>
    public string? MatchMode { get; set; }
    /// <summary>官方与自定义接口优先级的 JSON 数组。</summary>
    public string? ApiPriority { get; set; }
    /// <summary>自定义 API 的基础地址。</summary>
    public string? CustomApiPrefix { get; set; }
    /// <summary>自定义跨域代理地址。</summary>
    public string? CustomeCorsProxyUrl { get; set; }
    /// <summary>普通弹幕请求的自定义地址模板。</summary>
    public string? CustomeGetCommentUrl { get; set; }
    /// <summary>扩展弹幕请求的自定义地址模板。</summary>
    public string? CustomeGetExtcommentUrl { get; set; }
    /// <summary>海报请求的自定义地址模板。</summary>
    public string? CustomePosterImgUrl { get; set; }
    /// <summary>弹幕请求的自定义地址模板。</summary>
    public string? CustomeDanmakuUrl { get; set; }

    private void ValidateApi()
    {
        if (MatchMode is not null && MatchMode is not ("fileNameOnly" or "hashAndFileName"))
            throw new ArgumentException("匹配模式无效");
        foreach (var value in new[] { CustomApiPrefix, CustomeCorsProxyUrl, CustomeGetCommentUrl,
            CustomeGetExtcommentUrl, CustomePosterImgUrl, CustomeDanmakuUrl })
            if (value?.Length > 8192) throw new ArgumentException("接口地址或模板过长");
        ValidateApiArray(ApiPriority, false);
        ValidateApiArray(CustomApiList, true);
    }

    private static void ValidateApiArray(string? value, bool sources)
    {
        if (value is null) return;
        if (value.Length > 128 * 1024) throw new ArgumentException("API 列表过长");
        try
        {
            using var document = JsonDocument.Parse(value);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Array || root.GetArrayLength() > 100)
                throw new ArgumentException("API 配置必须是最多 100 项的数组");
            foreach (var item in root.EnumerateArray())
            {
                if (!sources)
                {
                    if (item.ValueKind != JsonValueKind.String || item.GetString() is not ("official" or "custom"))
                        throw new ArgumentException("API 优先级只能包含 official 和 custom");
                    continue;
                }
                var url = item.ValueKind == JsonValueKind.String ? item.GetString()
                    : item.ValueKind == JsonValueKind.Object && item.TryGetProperty("url", out var address)
                    && address.ValueKind == JsonValueKind.String ? address.GetString() : null;
                var isProxy = item.ValueKind == JsonValueKind.Object
                    && item.TryGetProperty("type", out var sourceType)
                    && sourceType.ValueKind == JsonValueKind.String && sourceType.GetString() == "emby-proxy";
                if (isProxy)
                {
                    if (url != "emby-proxy://custom") throw new ArgumentException("Emby 中转来源地址无效");
                }
                else if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
                    throw new ArgumentException("自定义源地址必须是 HTTP 或 HTTPS 地址");
                if (item.ValueKind != JsonValueKind.Object) continue;
                foreach (var key in new[] { "name", "appId", "appSecret", "serverName", "serverVersion" })
                    if (item.TryGetProperty(key, out var text) && text.ValueKind != JsonValueKind.String)
                        throw new ArgumentException("自定义源文本字段格式无效");
                if (item.TryGetProperty("enabled", out var enabled) && enabled.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    throw new ArgumentException("自定义源启用状态无效");
            }
        }
        catch (JsonException) { throw new ArgumentException("API 列表 JSON 格式无效"); }
    }

    private static void MergeApi(FrontendDefaults result, FrontendDefaults global, FrontendDefaults user)
    {
        // null 继承；空字符串和 [] 都是明确覆盖，不按空值回退。

        result.UseOfficialApi = user.UseOfficialApi ?? global.UseOfficialApi;
        result.UseCustomApi = user.UseCustomApi ?? global.UseCustomApi;
        result.MatchApiEnable = user.MatchApiEnable ?? global.MatchApiEnable;
        result.AppendSeasonEpisode = user.AppendSeasonEpisode ?? global.AppendSeasonEpisode;
        result.MatchMode = user.MatchMode ?? global.MatchMode;
        result.NormalizeSeasonEpisode = user.NormalizeSeasonEpisode ?? global.NormalizeSeasonEpisode;
        result.CustomApiList = user.CustomApiList ?? global.CustomApiList;
        result.ApiPriority = user.ApiPriority ?? global.ApiPriority;
        result.CustomApiPrefix = user.CustomApiPrefix ?? global.CustomApiPrefix;
        result.CustomeCorsProxyUrl = user.CustomeCorsProxyUrl ?? global.CustomeCorsProxyUrl;
        result.CustomeGetCommentUrl = user.CustomeGetCommentUrl ?? global.CustomeGetCommentUrl;
        result.CustomeGetExtcommentUrl = user.CustomeGetExtcommentUrl ?? global.CustomeGetExtcommentUrl;
        result.CustomePosterImgUrl = user.CustomePosterImgUrl ?? global.CustomePosterImgUrl;
        result.CustomeDanmakuUrl = user.CustomeDanmakuUrl ?? global.CustomeDanmakuUrl;
    }
}
