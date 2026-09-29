namespace DD.Danmaku.Constants;

/// <summary>集中定义插件 API、静态资源及参数持久化兼容接口的路径。</summary>
public static class RouteNames
{
    /// <summary>插件原生 API 的公共路径前缀。</summary>
    public const string ApiPrefix = "/dd-danmaku/api";
    /// <summary>查询服务端功能可用性的接口路径。</summary>
    public const string Capabilities = ApiPrefix + "/capabilities";
    /// <summary>查询媒体播放弹幕信息的接口路径。</summary>
    public const string Playback = ApiPrefix + "/playback";
    /// <summary>查询统计摘要的接口路径。</summary>
    public const string StatisticsSummary = ApiPrefix + "/statistics/summary";
    /// <summary>读取和保存插件配置的接口路径。</summary>
    public const string Config = ApiPrefix + "/config";
    /// <summary>查询弹幕持久化记录的接口路径。</summary>
    public const string Records = ApiPrefix + "/records";
    /// <summary>提交媒体候选并解析匹配结果的接口路径。</summary>
    public const string ResolveMatch = ApiPrefix + "/matches/resolve";
    /// <summary>兼容参数持久化协议的查询路径。</summary>
    public const string ParameterQuery = "/emby/ParameterPersistence/Query";
    /// <summary>兼容参数持久化协议的创建路径。</summary>
    public const string ParameterCreate = "/emby/ParameterPersistence/Create";
    /// <summary>兼容参数持久化协议的更新路径。</summary>
    public const string ParameterUpdate = "/emby/ParameterPersistence/Update";
    /// <summary>兼容参数持久化协议的删除路径。</summary>
    public const string ParameterDelete = "/emby/ParameterPersistence/Delete";
    /// <summary>提供内嵌弹幕前端脚本的接口路径。</summary>
    public const string EdeResource = ApiPrefix + "/resource/ede.js";
}
