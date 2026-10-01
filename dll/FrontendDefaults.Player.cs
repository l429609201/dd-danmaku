namespace DD.Danmaku;

using System.Text.Json;

/// <summary>完整播放器参数的可继承默认值；null 继承，空值明确覆盖。</summary>
public sealed partial class FrontendDefaults
{
    /// <summary>时间轴偏移（秒）</summary>
    public double? TimelineOffset { get; set; }
    /// <summary>弹幕列表设置</summary>
    public int? DanmuList { get; set; }
    /// <summary>定时单位索引</summary>
    public int? TimeoutCallbackUnit { get; set; }
    /// <summary>定时值</summary>
    public double? TimeoutCallbackValue { get; set; }
    /// <summary>启用 Bangumi</summary>
    public bool? BangumiEnable { get; set; }
    /// <summary>个人令牌</summary>
    public string? BangumiToken { get; set; }
    /// <summary>观看时长比（1–99）</summary>
    public int? BangumiPostPercent { get; set; }
    /// <summary>Bangumi API 地址</summary>
    public string? BangumiApiPrefix { get; set; }
    /// <summary>BGM 搜索兜底</summary>
    public bool? BgmSearchFallbackEnable { get; set; }
    /// <summary>Bangumi 图片域名</summary>
    public string? BangumiImageDomain { get; set; }
    /// <summary>TMDB API Key</summary>
    public string? TmdbApiKey { get; set; }
    /// <summary>TMDB API 域名</summary>
    public string? TmdbApiBaseUrl { get; set; }
    /// <summary>启用集数映射</summary>
    public bool? TmdbEpisodeMappingEnable { get; set; }
    /// <summary>缓存弹幕到服务器（需 DLL 在线及写入权限）</summary>
    public bool? CacheDanmakuToServer { get; set; }
    /// <summary>集数偏移规则（JSON 数组）</summary>
    public string? EpisodeOffsetRules { get; set; }
    /// <summary>排除媒体库（JSON 数组）</summary>
    public string? ExcludedLibraries { get; set; }
    /// <summary>标题黑名单正则</summary>
    public string? AnimeTitleBlacklist { get; set; }
    /// <summary>分集名称黑名单正则（未设置时沿用播放器内置）</summary>
    public string? EpisodeTitleBlacklist { get; set; }
    /// <summary>黑名单应用于自定义接口</summary>
    public bool? BlacklistApplyToCustomApi { get; set; }
    /// <summary>启用配置持久化</summary>
    public bool? ConfigPersistenceEnable { get; set; }
    /// <summary>实时同步</summary>
    public bool? ConfigPersistenceAutoSync { get; set; }
    /// <summary>同步标识符</summary>
    public string? ConfigPersistenceNamespace { get; set; }
    /// <summary>控制台日志</summary>
    public bool? ConsoleLogEnable { get; set; }
    /// <summary>日志级别</summary>
    public string? LogLevel { get; set; }
    /// <summary>弹幕容器边界</summary>
    public bool? DebugShowDanmakuWrapper { get; set; }
    /// <summary>按钮容器边界</summary>
    public bool? DebugShowDanmakuCtrWrapper { get; set; }
    /// <summary>反转弹幕方向</summary>
    public bool? DebugReverseDanmu { get; set; }
    /// <summary>随机弹幕颜色</summary>
    public bool? DebugRandomDanmuColor { get; set; }
    /// <summary>强制弹幕白色</summary>
    public bool? DebugForceDanmuWhite { get; set; }
    /// <summary>测试大量弹幕</summary>
    public bool? DebugGenerateLarge { get; set; }
    /// <summary>透明弹窗背景</summary>
    public bool? DebugDialogHyalinize { get; set; }
    /// <summary>弹窗窗口化</summary>
    public bool? DebugDialogWindow { get; set; }
    /// <summary>弹窗靠右布局</summary>
    public bool? DebugDialogRight { get; set; }
    /// <summary>打开内嵌网页</summary>
    public bool? DebugTabIframeEnable { get; set; }
    /// <summary>查看视频适配器</summary>
    public bool? DebugH5VideoAdapterEnable { get; set; }
    /// <summary>快速调试</summary>
    public bool? QuickDebugOn { get; set; }

    private void ValidatePlayer()
    {
        if (TimelineOffset is double offset && !double.IsFinite(offset))
            throw new ArgumentException("时间轴偏移必须是有限数字");
        Check(DanmuList, 0, int.MaxValue);
        Check(TimeoutCallbackUnit, 0, 2);
        if (TimeoutCallbackValue is double timeout && (!double.IsFinite(timeout) || timeout < 0))
            throw new ArgumentException("定时值必须是非负有限数字");
        Check(BangumiPostPercent, 1, 99);
        if (LogLevel is not null && LogLevel is not ("0" or "1" or "2" or "3" or "4"))
            throw new ArgumentException("日志级别无效");
        foreach (var text in new[] { BangumiToken, BangumiApiPrefix, BangumiImageDomain,
            TmdbApiKey, TmdbApiBaseUrl, AnimeTitleBlacklist, EpisodeTitleBlacklist })
            if (text?.Length > 8192) throw new ArgumentException("播放器默认文本过长");
        if (ConfigPersistenceNamespace?.Length > 256 || ConfigPersistenceNamespace?.Any(char.IsControl) == true)
            throw new ArgumentException("同步标识符无效");
        ValidatePlayerArray(EpisodeOffsetRules);
        ValidatePlayerArray(ExcludedLibraries);
    }

    private static void ValidatePlayerArray(string? value)
    {
        if (value is null) return;
        if (value.Length > 128 * 1024) throw new ArgumentException("播放器列表过长");
        try
        {
            using var document = JsonDocument.Parse(value);
            if (document.RootElement.ValueKind != JsonValueKind.Array || document.RootElement.GetArrayLength() > 1000)
                throw new ArgumentException("播放器列表必须是最多 1000 项的 JSON 数组");
        }
        catch (JsonException) { throw new ArgumentException("播放器列表 JSON 格式无效"); }
    }

    private static void MergePlayer(FrontendDefaults result, FrontendDefaults global, FrontendDefaults user)
    {
        result.TimelineOffset = user.TimelineOffset ?? global.TimelineOffset;
        result.DanmuList = user.DanmuList ?? global.DanmuList;
        result.TimeoutCallbackUnit = user.TimeoutCallbackUnit ?? global.TimeoutCallbackUnit;
        result.TimeoutCallbackValue = user.TimeoutCallbackValue ?? global.TimeoutCallbackValue;
        result.BangumiEnable = user.BangumiEnable ?? global.BangumiEnable;
        result.BangumiToken = user.BangumiToken ?? global.BangumiToken;
        result.BangumiPostPercent = user.BangumiPostPercent ?? global.BangumiPostPercent;
        result.BangumiApiPrefix = user.BangumiApiPrefix ?? global.BangumiApiPrefix;
        result.BgmSearchFallbackEnable = user.BgmSearchFallbackEnable ?? global.BgmSearchFallbackEnable;
        result.BangumiImageDomain = user.BangumiImageDomain ?? global.BangumiImageDomain;
        result.TmdbApiKey = user.TmdbApiKey ?? global.TmdbApiKey;
        result.TmdbApiBaseUrl = user.TmdbApiBaseUrl ?? global.TmdbApiBaseUrl;
        result.TmdbEpisodeMappingEnable = user.TmdbEpisodeMappingEnable ?? global.TmdbEpisodeMappingEnable;
        result.CacheDanmakuToServer = user.CacheDanmakuToServer ?? global.CacheDanmakuToServer;
        result.EpisodeOffsetRules = user.EpisodeOffsetRules ?? global.EpisodeOffsetRules;
        result.ExcludedLibraries = user.ExcludedLibraries ?? global.ExcludedLibraries;
        result.AnimeTitleBlacklist = user.AnimeTitleBlacklist ?? global.AnimeTitleBlacklist;
        result.EpisodeTitleBlacklist = user.EpisodeTitleBlacklist ?? global.EpisodeTitleBlacklist;
        result.BlacklistApplyToCustomApi = user.BlacklistApplyToCustomApi ?? global.BlacklistApplyToCustomApi;
        result.ConfigPersistenceEnable = user.ConfigPersistenceEnable ?? global.ConfigPersistenceEnable;
        result.ConfigPersistenceAutoSync = user.ConfigPersistenceAutoSync ?? global.ConfigPersistenceAutoSync;
        result.ConfigPersistenceNamespace = user.ConfigPersistenceNamespace ?? global.ConfigPersistenceNamespace;
        result.ConsoleLogEnable = user.ConsoleLogEnable ?? global.ConsoleLogEnable;
        result.LogLevel = user.LogLevel ?? global.LogLevel;
        result.DebugShowDanmakuWrapper = user.DebugShowDanmakuWrapper ?? global.DebugShowDanmakuWrapper;
        result.DebugShowDanmakuCtrWrapper = user.DebugShowDanmakuCtrWrapper ?? global.DebugShowDanmakuCtrWrapper;
        result.DebugReverseDanmu = user.DebugReverseDanmu ?? global.DebugReverseDanmu;
        result.DebugRandomDanmuColor = user.DebugRandomDanmuColor ?? global.DebugRandomDanmuColor;
        result.DebugForceDanmuWhite = user.DebugForceDanmuWhite ?? global.DebugForceDanmuWhite;
        result.DebugGenerateLarge = user.DebugGenerateLarge ?? global.DebugGenerateLarge;
        result.DebugDialogHyalinize = user.DebugDialogHyalinize ?? global.DebugDialogHyalinize;
        result.DebugDialogWindow = user.DebugDialogWindow ?? global.DebugDialogWindow;
        result.DebugDialogRight = user.DebugDialogRight ?? global.DebugDialogRight;
        result.DebugTabIframeEnable = user.DebugTabIframeEnable ?? global.DebugTabIframeEnable;
        result.DebugH5VideoAdapterEnable = user.DebugH5VideoAdapterEnable ?? global.DebugH5VideoAdapterEnable;
        result.QuickDebugOn = user.QuickDebugOn ?? global.QuickDebugOn;
    }
}
