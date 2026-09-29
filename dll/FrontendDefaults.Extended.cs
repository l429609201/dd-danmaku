namespace DD.Danmaku;

/// <summary>扩展可继承默认值；只包含播放器实际使用的非敏感参数。</summary>
public sealed partial class FrontendDefaults
{
    /// <summary>简繁转换方式。</summary>
    public int? ChConvert { get; set; }
    /// <summary>弹幕字体名称。</summary>
    public string? FontFamily { get; set; }
    /// <summary>弹幕渲染引擎名称。</summary>
    public string? Engine { get; set; }
    /// <summary>自动屏蔽的弹幕数量阈值。</summary>
    public int? AutoFilterCount { get; set; }
    /// <summary>是否合并相似弹幕。</summary>
    public bool? MergeSimilarEnable { get; set; }
    /// <summary>相似弹幕合并的相似度百分比。</summary>
    public int? MergeSimilarPercent { get; set; }
    /// <summary>相似弹幕合并的时间窗口。</summary>
    public int? MergeSimilarTime { get; set; }
    /// <summary>屏蔽关键词文本。</summary>
    public string? FilterKeywords { get; set; }
    /// <summary>是否启用关键词屏蔽。</summary>
    public bool? FilterKeywordsEnable { get; set; }
    /// <summary>是否显示播放器弹幕标题。</summary>
    public bool? OsdTitleEnable { get; set; }
    /// <summary>是否显示弹幕折线图。</summary>
    public bool? OsdLineChartEnable { get; set; }
    /// <summary>折线图是否跳过已过滤弹幕。</summary>
    public bool? OsdLineChartSkipFilter { get; set; }
    /// <summary>折线图统计的时间间隔。</summary>
    public int? OsdLineChartTime { get; set; }
    /// <summary>是否显示播放器顶部时钟。</summary>
    public bool? OsdHeaderClockEnable { get; set; }

    private void ValidateExtended()
    {
        Check(ChConvert, 0, 2); Check(AutoFilterCount, 0, 10000);
        Check(MergeSimilarPercent, 20, 100); Check(MergeSimilarTime, 1, 60);
        Check(OsdLineChartTime, 1, 60);
        if (Engine is not null && Engine is not ("canvas" or "dom"))
            throw new ArgumentException("不支持的弹幕引擎");
        if (FontFamily is not null && (FontFamily.Length > 256 || FontFamily.Any(char.IsControl)))
            throw new ArgumentException("字体名称无效");
        if (FilterKeywords?.Length > 8192) throw new ArgumentException("屏蔽词过长");
    }

    private static void MergeExtended(FrontendDefaults result, FrontendDefaults global, FrontendDefaults user)
    {
        result.ChConvert = user.ChConvert ?? global.ChConvert;
        result.FontFamily = user.FontFamily ?? global.FontFamily;
        result.Engine = user.Engine ?? global.Engine;
        result.AutoFilterCount = user.AutoFilterCount ?? global.AutoFilterCount;
        result.MergeSimilarEnable = user.MergeSimilarEnable ?? global.MergeSimilarEnable;
        result.MergeSimilarPercent = user.MergeSimilarPercent ?? global.MergeSimilarPercent;
        result.MergeSimilarTime = user.MergeSimilarTime ?? global.MergeSimilarTime;
        result.FilterKeywords = user.FilterKeywords ?? global.FilterKeywords;
        result.FilterKeywordsEnable = user.FilterKeywordsEnable ?? global.FilterKeywordsEnable;
        result.OsdTitleEnable = user.OsdTitleEnable ?? global.OsdTitleEnable;
        result.OsdLineChartEnable = user.OsdLineChartEnable ?? global.OsdLineChartEnable;
        result.OsdLineChartSkipFilter = user.OsdLineChartSkipFilter ?? global.OsdLineChartSkipFilter;
        result.OsdLineChartTime = user.OsdLineChartTime ?? global.OsdLineChartTime;
        result.OsdHeaderClockEnable = user.OsdHeaderClockEnable ?? global.OsdHeaderClockEnable;
    }
}
