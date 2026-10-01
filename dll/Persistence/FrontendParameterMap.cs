namespace DD.Danmaku.Persistence;

using System.Reflection;
using System.Text.Json;

/// <summary>在播放器默认值与用户参数条目之间转换；只处理前端允许继承的字段。</summary>
internal static class FrontendParameterMap
{
    private const string Namespace = "dd-danmaku";
    private static readonly Dictionary<string, string> Keys = new(StringComparer.Ordinal)
    {
        ["Speed"] = "danmakuBaseSpeed",
        ["Switch"] = "danmakuSwitch", ["AutoLoadSwitch"] = "danmakuAutoLoadSwitch",
        ["AntiOverlap"] = "danmakuAntiOverlap", ["FilterLevel"] = "danmakuFilterLevel",
        ["HeightPercent"] = "danmakuHeightPercent", ["FontSizeRate"] = "danmakuFontSizeRate",
        ["FontOpacity"] = "danmakuFontOpacity", ["FontWeight"] = "danmakuFontWeight",
        ["FontStyle"] = "danmakuFontStyle", ["ChConvert"] = "danmakuChConvert",
        ["FontFamily"] = "danmakuFontFamily", ["Engine"] = "danmakuEngine",
        ["AutoFilterCount"] = "danmakuAutoFilterCount", ["MergeSimilarEnable"] = "danmakuMergeSimilarEnable",
        ["MergeSimilarPercent"] = "danmakuMergeSimilarPercent", ["MergeSimilarTime"] = "danmakuMergeSimilarTime",
        ["FilterKeywords"] = "danmakuFilterKeywords", ["FilterKeywordsEnable"] = "danmakuFilterKeywordsEnable",
        ["OsdTitleEnable"] = "danmakuOsdTitleEnable", ["OsdLineChartEnable"] = "danmakuOsdLineChartEnable",
        ["OsdLineChartSkipFilter"] = "danmakuOsdLineChartSkipFilter", ["OsdLineChartTime"] = "danmakuOsdLineChartTime",
        ["OsdHeaderClockEnable"] = "danmakuOsdHeaderClockEnable", ["TypeFilter"] = "danmakuTypeFilter",
        ["SourceFilter"] = "danmakuSourceFilter", ["ShowSource"] = "danmakuShowSource",
        ["ConvertTopTo"] = "danmakuConvertTopTo", ["ConvertBottomTo"] = "danmakuConvertBottomTo",
        ["UseOfficialApi"] = "danmakuUseOfficialApi", ["UseCustomApi"] = "danmakuUseCustomApi",
        ["MatchApiEnable"] = "danmakuMatchApiEnable", ["AppendSeasonEpisode"] = "danmakuAppendSeasonEpisode",
        ["MatchMode"] = "danmakuMatchMode", ["CustomApiList"] = "danmakuCustomApiList",
        ["ApiPriority"] = "danmakuApiPriority", ["CustomApiPrefix"] = "danmakuCustomApiPrefix",
        ["CustomeCorsProxyUrl"] = "danmakuCustomeCorsProxyUrl",
        ["CustomeGetCommentUrl"] = "danmakuCustomeGetCommentUrl",
        ["CustomeGetExtcommentUrl"] = "danmakuCustomeGetExtcommentUrl",
        ["CustomePosterImgUrl"] = "danmakuCustomePosterImgUrl", ["CustomeDanmakuUrl"] = "danmakuCustomeDanmakuUrl",
        ["TimelineOffset"] = "danmakuTimelineOffset",
        ["DanmuList"] = "danmakuDanmuList",
        ["TimeoutCallbackUnit"] = "danmakuTimeoutCallbackUnit",
        ["TimeoutCallbackValue"] = "danmakuTimeoutCallbackValue",
        ["BangumiEnable"] = "danmakuBangumiEnable",
        ["BangumiToken"] = "danmakuBangumiToken",
        ["BangumiPostPercent"] = "danmakuBangumiPostPercent",
        ["BangumiApiPrefix"] = "danmakuBangumiApiPrefix",
        ["BgmSearchFallbackEnable"] = "danmakuBgmSearchFallbackEnable",
        ["BangumiImageDomain"] = "danmakuBangumiImageDomain",
        ["TmdbApiKey"] = "danmakuTmdbApiKey",
        ["TmdbApiBaseUrl"] = "danmakuTmdbApiBaseUrl",
        ["TmdbEpisodeMappingEnable"] = "danmakuTmdbEpisodeMappingEnable",
        ["CacheDanmakuToServer"] = "danmakuCacheDanmakuToServer",
        ["EpisodeOffsetRules"] = "danmakuEpisodeOffsetRules",
        ["ExcludedLibraries"] = "danmakuExcludedLibraries",
        ["AnimeTitleBlacklist"] = "danmakuAnimeTitleBlacklist",
        ["EpisodeTitleBlacklist"] = "danmakuEpisodeTitleBlacklist",
        ["BlacklistApplyToCustomApi"] = "danmakuBlacklistApplyToCustomApi",
        ["ConfigPersistenceEnable"] = "danmakuConfigPersistenceEnable",
        ["ConfigPersistenceAutoSync"] = "danmakuConfigPersistenceAutoSync",
        ["ConfigPersistenceNamespace"] = "danmakuConfigPersistenceNamespace",
        ["ConsoleLogEnable"] = "danmakuConsoleLogEnable",
        ["LogLevel"] = "danmakuLogLevel",
        ["DebugShowDanmakuWrapper"] = "danmakuDebugShowDanmakuWrapper",
        ["DebugShowDanmakuCtrWrapper"] = "danmakuDebugShowDanmakuCtrWrapper",
        ["DebugReverseDanmu"] = "danmakuDebugReverseDanmu",
        ["DebugRandomDanmuColor"] = "danmakuDebugRandomDanmuColor",
        ["DebugForceDanmuWhite"] = "danmakuDebugForceDanmuWhite",
        ["DebugGenerateLarge"] = "danmakuDebugGenerateLarge",
        ["DebugDialogHyalinize"] = "danmakuDebugDialogHyalinize",
        ["DebugDialogWindow"] = "danmakuDebugDialogWindow",
        ["DebugDialogRight"] = "danmakuDebugDialogRight",
        ["DebugTabIframeEnable"] = "danmakuDebugTabIframeEnable",
        ["DebugH5VideoAdapterEnable"] = "danmakuDebugH5VideoAdapterEnable",
        ["QuickDebugOn"] = "danmakuQuickDebugOn"
    };
    private static readonly PropertyInfo[] Properties = typeof(FrontendDefaults).GetProperties();


    internal static HashSet<string> ManagedKeys { get; } = Keys.Values.ToHashSet(StringComparer.Ordinal);

    internal static List<ParameterEntry> ToEntries(FrontendDefaults values) => Properties
        .Where(property => Keys.ContainsKey(property.Name) && property.GetValue(values) is not null)
        .Select(property =>
        {
            var value = property.GetValue(values)!;
            var json = value is Array || property.Name is "CustomApiList" or "ApiPriority" or "EpisodeOffsetRules" or "ExcludedLibraries";
            return new ParameterEntry { Namespace = Namespace, Key = Keys[property.Name],
                Value = value is Array ? JsonSerializer.Serialize(value)
                    : value is bool flag ? (flag ? "true" : "false")
                    : value is int number ? number.ToString(System.Globalization.CultureInfo.InvariantCulture)
                    : value is double fraction ? fraction.ToString(System.Globalization.CultureInfo.InvariantCulture)
                    : value.ToString()!,
                Type = json ? "json" : value is bool ? "boolean" : value is int or double ? "number" : "string" };
        }).ToList();

    internal static FrontendDefaults FromEntries(IEnumerable<ParameterEntry> entries)
    {
        var values = new FrontendDefaults();
        var index = entries.Where(row => row.Namespace == Namespace)
            .GroupBy(row => row.Key).ToDictionary(group => group.Key, group => group.Last().Value);
        foreach (var property in Properties)
        {
            if (!Keys.TryGetValue(property.Name, out var key) || !index.TryGetValue(key, out var text)) continue;
            try
            {
                object? value = property.PropertyType == typeof(string[]) ? JsonSerializer.Deserialize<string[]>(text)
                    : property.PropertyType == typeof(bool?) ? bool.Parse(text)
                    : property.PropertyType == typeof(int?) ? int.Parse(text, System.Globalization.CultureInfo.InvariantCulture)
                    : property.PropertyType == typeof(double?) ? double.Parse(text, System.Globalization.CultureInfo.InvariantCulture)
                    : text;
                if (property.Name is "CustomApiList" or "ApiPriority" or "EpisodeOffsetRules" or "ExcludedLibraries" && !string.IsNullOrEmpty(text))
                {
                    using var document = JsonDocument.Parse(text);
                    if (document.RootElement.ValueKind != JsonValueKind.Array) continue;
                }
                property.SetValue(values, value);
            }
            catch (Exception e) when (e is JsonException or FormatException or OverflowException or ArgumentException)
            {
                // 旧参数文件可能包含超出默认值契约的值，跳过单项而不破坏个人原文件。
            }
        }
        return values;
    }
}
