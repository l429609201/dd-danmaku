namespace DD.Danmaku.Hosting;

using MediaBrowser.Model.Services;

// 记录标识通过查询参数传递，文件路径和来源只从已存索引解析。
/// <summary>读取指定弹幕记录详情。</summary>
[Route("/dd-danmaku/api/records/detail", "GET")]
public sealed class RecordDetailRequest
{
    /// <summary>记录标识。</summary>
    public string RecordId { get; set; } = "";
}
/// <summary>验证指定弹幕记录关联的文件。</summary>
[Route("/dd-danmaku/api/records/verify", "POST")]
public sealed class VerifyRecordRequest
{
    /// <summary>记录标识。</summary>
    public string RecordId { get; set; } = "";
}
/// <summary>规范化指定记录的 XML 文件。</summary>
[Route("/dd-danmaku/api/records/normalize", "POST")]
public sealed class NormalizeRecordRequest
{
    /// <summary>记录标识。</summary>
    public string RecordId { get; set; } = "";
}
/// <summary>移除记录索引或同时删除关联 XML 文件。</summary>
[Route("/dd-danmaku/api/records/remove", "DELETE")]
public sealed class RemoveRecordRequest
{
    /// <summary>待移除记录的标识。</summary>
    public string RecordId { get; set; } = "";
    /// <summary>是否同时删除已授权的 XML 文件。</summary>
    public bool DeleteFile { get; set; }
}
/// <summary>下载指定弹幕记录对应的 XML 文件。</summary>
[Route("/dd-danmaku/api/records/download", "GET")]
public sealed class DownloadRecordRequest
{
    /// <summary>记录标识。</summary>
    public string RecordId { get; set; } = "";
}
