namespace DD.Danmaku.Hosting;

using DD.Danmaku.Constants;
using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Services;

/// <summary>仅提供公开的静态界面和脚本，不返回配置、用户信息或登录凭据。</summary>
[Unauthenticated]
public sealed class PluginResourceHttpService : IService, IRequiresRequest
{
    private readonly ResourceService _resources = new();

    /// <summary>宿主设置的当前资源请求。</summary>
    public IRequest Request { get; set; } = null!;

    /// <summary>提供管理页面入口与构建资源；业务 API 独立执行认证及管理员检查。</summary>
    public Task<object> Get(AdminResourceRequest request)
    {
        var path = request.Path ?? "";
        // 只允许入口及 Vite assets，禁止通过 HTTP 读取任意内嵌资源或路径穿越。
        if (path != "index.html" && path != "dd-icon.svg" && !(path.StartsWith("assets/", StringComparison.Ordinal)
            && path.Split('/').All(segment => segment.Length > 0 && segment is not "." and not "..")
            && !path.Contains('\\') && !path.Contains('%')))
            return Task.FromResult<object>(ApiHttpResult.Error(404, "RESOURCE_NOT_FOUND", "资源不存在"));
        return ReadAsync("Resources/Admin/" + path);
    }

    /// <summary>依据资源开关提供 ede.js；提供脚本不代表自动注入已启用。</summary>
    public Task<object> Get(EdeResourceRequest request)
    {
        if (Plugin.Instance?.Configuration.EdeResourceEnabled != true)
            return Task.FromResult<object>(ApiHttpResult.Error(404, "RESOURCE_DISABLED", "脚本资源未启用"));
        return ReadAsync("Resources/ede.js");
    }

    private async Task<object> ReadAsync(string path)
    {
        await using var stream = await _resources.OpenAsync(path, Request.CancellationToken);
        if (stream is null) return ApiHttpResult.Error(404, "RESOURCE_NOT_FOUND", "资源不存在");
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, Request.CancellationToken);
        // 复用禁止缓存及 nosniff 的响应，升级后不继续使用旧页面资源。
        return new ApiHttpResult(200, buffer.ToArray(), _resources.GetContentType(path));
    }
}

/// <summary>管理静态资源请求，通配路径只在服务端白名单内解析。</summary>
[Route("/dd-danmaku/admin/{Path*}", "GET")]
public sealed class AdminResourceRequest
{
    /// <summary>入口文件或构建资源的相对路径。</summary>
    public string? Path { get; set; }
}

/// <summary>DLL 内嵌弹幕脚本请求。</summary>
[Route(RouteNames.EdeResource, "GET")]
public sealed class EdeResourceRequest { }
