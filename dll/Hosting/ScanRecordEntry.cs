namespace DD.Danmaku.Hosting;

/// <summary>仅在扫描任务内传递文件路径，持久化索引与 API 不暴露路径。</summary>
internal sealed record ScanRecordEntry(string ItemId, string? Source, string Path, int? Count);
