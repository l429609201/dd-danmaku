namespace DD.Danmaku.Hosting;

using MediaBrowser.Model.Services;

// Emby 自行提供 /emby 前缀；声明不重复包含前缀。旧插件必须先停用。
/// <summary>查询当前认证用户参数的兼容协议请求。</summary>
[Route("/ParameterPersistence/Query", "GET", Summary = "查询当前用户参数")]
public sealed class QueryUserParameters
{
    /// <summary>可选的参数命名空间筛选条件。</summary>
    public string? Namespace { get; set; }
    /// <summary>可选的精确参数键。</summary>
    public string? Key { get; set; }
    /// <summary>可选的模糊查询关键词。</summary>
    public string? Keyword { get; set; }
}
/// <summary>创建当前认证用户参数的兼容协议请求。</summary>
[Route("/ParameterPersistence/Create", "POST", Summary = "创建当前用户参数")]
public sealed class CreateUserParameters : IRequiresRequestStream
{
    /// <summary>认证后限长解析的单项或批量参数请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>更新当前认证用户参数的兼容协议请求。</summary>
[Route("/ParameterPersistence/Update", "POST", Summary = "更新当前用户参数")]
public sealed class UpdateUserParameters : IRequiresRequestStream
{
    /// <summary>认证后限长解析的参数修改请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>删除当前认证用户参数的兼容协议请求。</summary>
[Route("/ParameterPersistence/Delete", "POST", Summary = "删除当前用户参数")]
public sealed class DeleteUserParameters : IRequiresRequestStream
{
    /// <summary>认证后限长解析的参数删除条件。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
