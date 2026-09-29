namespace DD.Danmaku.Hosting;

using DD.Danmaku.Injection;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Services;
using System.Text;

/// <summary>接管播放页 videoosd.js，在不修改宿主文件的前提下注入 DD 启动段。</summary>
[Unauthenticated]
public sealed class VideoOsdResourceHttpService : IService, IRequiresRequest
{
    private readonly IServerApplicationPaths _paths;
    private readonly IHttpResultFactory _resultFactory;

    /// <summary>宿主当前请求上下文。</summary>
    public IRequest Request { get; set; } = null!;

    /// <summary>注入宿主路径与标准响应工厂。</summary>
    public VideoOsdResourceHttpService(IServerApplicationPaths paths, IHttpResultFactory resultFactory)
    {
        _paths = paths;
        _resultFactory = resultFactory;
    }

    /// <summary>返回原始 videoosd.js，并在自动注入开启时追加 DD 启动段。</summary>
    public object Get(VideoOsdResourceRequest request)
    {
        var path = Path.Combine(_paths.ApplicationResourcesPath, "dashboard-ui", "videoosd", "videoosd.js");
        if (!File.Exists(path))
            throw new FileNotFoundException("宿主 videoosd.js 不存在。", path);

        var original = File.ReadAllText(path, Encoding.UTF8);
        var enabled = Plugin.Instance?.Configuration.AutoInjectionEnabled == true
            && Plugin.Instance.Configuration.EdeResourceEnabled;
        var content = enabled
            ? BootstrapInjector.Append(original, "/dd-danmaku/api/resource/ede.js")
            : original;
        return _resultFactory.GetResult(Request, Encoding.UTF8.GetBytes(content), "application/javascript");
    }
}

/// <summary>Emby Web 播放页 videoosd.js 请求。</summary>
[Route("/{Web}/videoosd/videoosd.js", "GET", IsHidden = true)]
[Unauthenticated]
public sealed class VideoOsdResourceRequest
{
    /// <summary>Web 根目录名称，由宿主路由绑定。</summary>
    public string Web { get; set; } = "";
}
