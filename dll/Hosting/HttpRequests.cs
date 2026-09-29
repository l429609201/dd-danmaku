namespace DD.Danmaku.Hosting;

using DD.Danmaku.Constants;
using MediaBrowser.Model.Services;

// 请求体自行限长、解析；不让宿主在认证前无界反序列化 XML 或匹配候选。
/// <summary>查询认证用户当前可用的插件能力。</summary>
[Route(RouteNames.Capabilities, "GET", Summary = "查询当前用户可用能力")]
public sealed class CapabilitiesRequest { }
/// <summary>管理员读取插件配置的请求。</summary>
[Route(RouteNames.Config, "GET", Summary = "读取插件配置")]
public sealed class ConfigRequest { }
/// <summary>管理员保存插件配置的请求，认证后限长解析请求体。</summary>
[Route(RouteNames.Config, "PUT", Summary = "保存插件配置")]
public sealed class UpdateConfigRequest : IRequiresRequestStream
{
    /// <summary>宿主提供的原始配置请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>管理员查询 AI 授权界面用户选项的请求。</summary>
[Route(RouteNames.ApiPrefix + "/users", "GET", Summary = "读取授权用户选项")]
public sealed class UserOptionsRequest { }
/// <summary>管理员读取插件运行状态的请求。</summary>
[Route(RouteNames.ApiPrefix + "/status", "GET", Summary = "读取插件运行状态")]
public sealed class StatusRequest { }
/// <summary>提交目标媒体和候选进行无状态匹配的请求。</summary>
[Route(RouteNames.ResolveMatch, "POST", Summary = "无状态媒体匹配")]
public sealed class ResolveMatchHttpRequest : IRequiresRequestStream
{
    /// <summary>认证后进行限长读取和结构验证的匹配请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>读取已授权媒体旁路弹幕 XML 的请求。</summary>
[Route(RouteNames.ApiPrefix + "/items/{ItemId}/danmaku", "GET", Summary = "读取弹幕 XML")]
public sealed class ReadDanmakuRequest
{
    /// <summary>目标 Emby 媒体标识，不是文件路径。</summary>
    public string ItemId { get; set; } = "";
    /// <summary>可选弹幕来源；为空时使用媒体固定同名 XML。</summary>
    public string? Source { get; set; }
}
/// <summary>为已授权媒体保存弹幕 XML 的请求。</summary>
[Route("/api/danmu/{ItemId}", "PUT", Summary = "保存或更新来源弹幕")]
[Route("/plugin/danmu/{ItemId}", "PUT")]
public sealed class SaveDanmakuRequest : IRequiresRequestStream
{
    /// <summary>目标 Emby 媒体标识。</summary>
    public string ItemId { get; set; } = "";
    /// <summary>仅管理员显式确认覆盖时传入 true；自动保存同来源更新也使用此字段。</summary>
    public bool Overwrite { get; set; }
    /// <summary>可选弹幕来源；为空时使用媒体固定同名 XML。</summary>
    public string? Source { get; set; }
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>删除目标媒体旁路弹幕 XML 的请求。</summary>
[Route("/api/danmu/{ItemId}", "DELETE", Summary = "删除指定来源弹幕")]
[Route("/plugin/danmu/{ItemId}", "DELETE")]
public sealed class DeleteDanmakuRequest
{
    /// <summary>目标 Emby 媒体标识。</summary>
    public string ItemId { get; set; } = "";
    /// <summary>可选弹幕来源；为空时删除媒体固定同名 XML。</summary>
    public string? Source { get; set; }
}
/// <summary>查询目标媒体本地弹幕及刷新信息的请求。</summary>
[Route(RouteNames.ApiPrefix + "/playback/{ItemId}", "GET", Summary = "查询本地播放弹幕")]
public sealed class PlaybackHttpRequest
{
    /// <summary>需要检查访问权限的 Emby 媒体标识。</summary>
    public string ItemId { get; set; } = "";
    /// <summary>可选弹幕来源；为空时使用媒体固定同名 XML。</summary>
    public string? Source { get; set; }
}
/// <summary>管理员分页读取本插件弹幕索引的请求。</summary>
[Route(RouteNames.ApiPrefix + "/records", "GET", Summary = "查询本插件弹幕记录")]
public sealed class RecordsHttpRequest
{
    /// <summary>从 1 开始的页码。</summary>
    public int Page { get; set; } = 1;
    /// <summary>每页条数，服务端仍会检查允许范围。</summary>
    public int PageSize { get; set; } = 50;
    // 筛选在分页之前执行，状态指最近一次校验结果。
    public string? Keyword { get; set; }
    public string? Source { get; set; }
    public string? State { get; set; }
}
