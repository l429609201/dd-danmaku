namespace DD.Danmaku.Web.Api;

using DD.Danmaku.Runtime;

/// <summary>查询媒体弹幕加载信息并接收前端播放结果。</summary>
public interface IPlaybackService
{
    /// <summary>按媒体标识查询可用弹幕及加载策略。</summary>
    Task<PlaybackQueryDto> QueryAsync(string itemId, CancellationToken cancellationToken);
    /// <summary>记录指定媒体的前端弹幕加载或播放结果。</summary>
    Task RecordResultAsync(string itemId, PlaybackResultDto result, CancellationToken cancellationToken);
}

/// <summary>根据配置及运行状态生成客户端能力声明。</summary>
public interface ICapabilitiesService
{
    /// <summary>生成当前插件能力快照，不直接暴露内部可变状态。</summary>
    CapabilitiesDto Create(PluginConfiguration configuration, RuntimeSnapshot snapshot);
}

/// <summary>读取插件静态资源并确定其响应媒体类型。</summary>
public interface IResourceService
{
    /// <summary>打开允许访问的资源；资源不存在或路径不受支持时返回空值。</summary>
    Task<Stream?> OpenAsync(string resourcePath, CancellationToken cancellationToken);
    /// <summary>根据资源扩展名返回 HTTP Content-Type。</summary>
    string GetContentType(string resourcePath);
}

/// <summary>提供管理页面使用的运行统计摘要。</summary>
public interface IStatisticsService
{
    /// <summary>获取以字段名索引的统计值集合。</summary>
    Task<IReadOnlyDictionary<string, object>> GetSummaryAsync(CancellationToken cancellationToken);
}
