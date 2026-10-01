namespace DD.Danmaku.Hosting;

/// <summary>仅在扫描任务内传递文件路径，持久化索引与 API 不暴露路径。</summary>
internal sealed record ScanRecordEntry(string ItemId, string? Source, string Path, int? Count, bool IsCanonical = true)
{
    // 仅完整解析后传递元数据；快速扫描不能猜测所有者或获取时间。
    internal Danmaku.DanmakuXmlMetadata? Metadata { get; init; }
}
