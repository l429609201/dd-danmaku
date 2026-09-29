namespace DD.Danmaku;

/// <summary>扩展可继承默认值；只包含播放器实际使用的非敏感参数。</summary>
public sealed partial class FrontendDefaults
{
    public int? ChConvert { get; set; }
    public string? FontFamily { get; set; }
    public string? Engine { get; set; }
    public int? AutoFilterCount { get; set; }
    public bool? MergeSimilarEnable { get; set; }
    public int? MergeSimilarPercent { get; set; }
    public int? MergeSimilarTime { get; set; }
    public string? FilterKeywords { get; set; }
    public bool? FilterKeywordsEnable { get; set; }
    public bool? OsdTitleEnable { get; set; }
    public bool? OsdLineChartEnable { get; set; }
    public bool? OsdLineChartSkipFilter { get; set; }
    public int? OsdLineChartTime { get; set; }
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
