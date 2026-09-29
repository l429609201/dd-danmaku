namespace DD.Danmaku;

using System.Text.Json;

// 仅包含播放器直连所需的 API 默认值；全局源凭据会共享给继承者。
public sealed partial class FrontendDefaults
{
    // 本地读取由 DLL 播放策略控制，不下发旧 XML 开关。
    public bool? UseOfficialApi { get; set; }
    public bool? UseCustomApi { get; set; }
    public bool? MatchApiEnable { get; set; }
    public bool? AppendSeasonEpisode { get; set; }
    public string? MatchMode { get; set; }
    public string? CustomApiList { get; set; }
    public string? ApiPriority { get; set; }
    public string? CustomApiPrefix { get; set; }
    public string? CustomeCorsProxyUrl { get; set; }
    public string? CustomeGetCommentUrl { get; set; }
    public string? CustomeGetExtcommentUrl { get; set; }
    public string? CustomePosterImgUrl { get; set; }
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
                if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
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
