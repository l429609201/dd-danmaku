namespace DD.Danmaku;

/// <summary>类型和来源等常用默认值，不包含个人凭据。</summary>
public sealed partial class FrontendDefaults
{
    /// <summary>按弹幕类型屏蔽的类型列表；空值继承上级配置。</summary>
    public string[]? TypeFilter { get; set; }
    /// <summary>按来源屏蔽的来源列表。</summary>
    public string[]? SourceFilter { get; set; }
    /// <summary>需要显示来源标识的来源列表。</summary>
    public string[]? ShowSource { get; set; }
    /// <summary>顶部弹幕转换后的显示方式。</summary>
    public string? ConvertTopTo { get; set; }
    /// <summary>底部弹幕转换后的显示方式。</summary>
    public string? ConvertBottomTo { get; set; }

    private void ValidateFilters()
    {
        foreach (var array in new[] { TypeFilter, SourceFilter, ShowSource })
            if (array is not null && (array.Length > 100 || array.Any(x => x is null || x.Length > 128)))
                throw new ArgumentException("类型或来源列表无效");
        if (ConvertTopTo is not null && ConvertTopTo is not ("default" or "bottom" or "rolling"))
            throw new ArgumentException("顶部转换类型无效");
        if (ConvertBottomTo is not null && ConvertBottomTo is not ("default" or "top" or "rolling"))
            throw new ArgumentException("底部转换类型无效");
    }

    private static void MergeFilters(FrontendDefaults result, FrontendDefaults global, FrontendDefaults user)
    {
        // 数组复制，避免配置副本共享可变集合。
        result.TypeFilter = (user.TypeFilter ?? global.TypeFilter)?.ToArray();
        result.SourceFilter = (user.SourceFilter ?? global.SourceFilter)?.ToArray();
        result.ShowSource = (user.ShowSource ?? global.ShowSource)?.ToArray();
        result.ConvertTopTo = user.ConvertTopTo ?? global.ConvertTopTo;
        result.ConvertBottomTo = user.ConvertBottomTo ?? global.ConvertBottomTo;
    }
}
