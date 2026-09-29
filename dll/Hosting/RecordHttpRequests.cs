namespace DD.Danmaku.Hosting;

using MediaBrowser.Model.Services;

// 记录标识通过查询参数传递，文件路径和来源只从已存索引解析。
[Route("/dd-danmaku/api/records/detail", "GET")]
public sealed class RecordDetailRequest { public string RecordId { get; set; } = ""; }
[Route("/dd-danmaku/api/records/verify", "POST")]
public sealed class VerifyRecordRequest { public string RecordId { get; set; } = ""; }
[Route("/dd-danmaku/api/records/remove", "DELETE")]
public sealed class RemoveRecordRequest
{
    public string RecordId { get; set; } = "";
    public bool DeleteFile { get; set; }
}
[Route("/dd-danmaku/api/records/download", "GET")]
public sealed class DownloadRecordRequest { public string RecordId { get; set; } = ""; }
