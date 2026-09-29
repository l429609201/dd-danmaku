namespace DD.Danmaku;

/// <summary>服务器提供的显示默认值；null 表示继承，不代表强制用户使用。</summary>
public sealed partial class FrontendDefaults
{
    /// <summary>弹幕显示开关，空值表示继承。</summary>
    public bool? Switch { get; set; }
    /// <summary>自动加载弹幕开关，空值表示继承。</summary>
    public bool? AutoLoadSwitch { get; set; }
    /// <summary>是否避免弹幕重叠，空值表示继承。</summary>
    public bool? AntiOverlap { get; set; }
    /// <summary>过滤等级，范围为 0 至 3。</summary>
    public int? FilterLevel { get; set; }
    /// <summary>弹幕区域高度百分比，范围为 3 至 100。</summary>
    public int? HeightPercent { get; set; }
    /// <summary>字体缩放百分比，范围为 50 至 300。</summary>
    public int? FontSizeRate { get; set; }
    /// <summary>字体不透明度百分比，范围为 20 至 100。</summary>
    public int? FontOpacity { get; set; }
    /// <summary>前端弹幕速度参数，范围为 10 至 300。</summary>
    public int? Speed { get; set; }
    /// <summary>字体粗细参数，范围为 100 至 1000。</summary>
    public int? FontWeight { get; set; }
    /// <summary>前端字体样式编码，范围为 0 至 2。</summary>
    public int? FontStyle { get; set; }

    internal FrontendDefaults Copy()
    {
        var copy = (FrontendDefaults)MemberwiseClone();
        copy.TypeFilter = TypeFilter?.ToArray();
        copy.SourceFilter = SourceFilter?.ToArray();
        copy.ShowSource = ShowSource?.ToArray();
        return copy;
    }

    internal void Validate()
    {
        Check(FilterLevel, 0, 3); Check(HeightPercent, 3, 100);
        Check(FontSizeRate, 50, 300); Check(FontOpacity, 20, 100);
        Check(Speed, 10, 300); Check(FontWeight, 100, 1000); Check(FontStyle, 0, 2);
        ValidateExtended();
        ValidateFilters();
        ValidateApi();
    }

    private static void Check(int? value, int min, int max)
    {
        if (value is not null && (value < min || value > max))
            throw new ArgumentException("前端默认参数超出允许范围");
    }

    // 仅合并允许共享的播放器配置，不引入插件管理凭据。
    internal static FrontendDefaults Merge(FrontendDefaults global, FrontendDefaults user)
    {
        var result = new FrontendDefaults
        {
            Switch = user.Switch ?? global.Switch,
            AutoLoadSwitch = user.AutoLoadSwitch ?? global.AutoLoadSwitch,
            AntiOverlap = user.AntiOverlap ?? global.AntiOverlap,
            FilterLevel = user.FilterLevel ?? global.FilterLevel,
            HeightPercent = user.HeightPercent ?? global.HeightPercent,
            FontSizeRate = user.FontSizeRate ?? global.FontSizeRate,
            FontOpacity = user.FontOpacity ?? global.FontOpacity,
            Speed = user.Speed ?? global.Speed,
            FontWeight = user.FontWeight ?? global.FontWeight,
            FontStyle = user.FontStyle ?? global.FontStyle
        };
        MergeExtended(result, global, user);
        MergeFilters(result, global, user);
        MergeApi(result, global, user);
        return result;
    }
}

/// <summary>使用 XML 可序列化条目数组，避免 Dictionary 与宿主序列化器不兼容。</summary>
public sealed class UserFrontendDefaults
{
    /// <summary>默认值所适用的 Emby 用户标识。</summary>
    public string UserId { get; set; } = "";
    /// <summary>该用户覆盖的显示默认值；其中空字段继承全局值。</summary>
    public FrontendDefaults Values { get; set; } = new();
}
