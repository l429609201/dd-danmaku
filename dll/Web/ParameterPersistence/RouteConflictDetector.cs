namespace DD.Danmaku.Web.ParameterPersistence;

/// <summary>
/// 宿主路由冲突检测抽象。具体 Emby 版本适配层负责提供已注册路由集合。
/// </summary>
public interface IRouteRegistryProbe
{
    /// <summary>检查指定路径和 HTTP 方法是否已被宿主注册。</summary>
    bool IsRouteRegistered(string path, string method);
}

/// <summary>避免与其他参数持久化插件注册相同兼容路由。</summary>
public sealed class RouteConflictDetector
{
    private readonly IRouteRegistryProbe _probe;

    /// <summary>使用宿主路由探针创建冲突检测器。</summary>
    public RouteConflictDetector(IRouteRegistryProbe probe)
    {
        _probe = probe;
    }

    /// <summary>仅当四个兼容接口均未注册时允许注册整组路由。</summary>
    public bool ShouldRegisterCompatibilityRoutes()
    {
        var routes = new[]
        {
            ("/emby/ParameterPersistence/Query", "GET"),
            ("/emby/ParameterPersistence/Create", "POST"),
            ("/emby/ParameterPersistence/Update", "POST"),
            ("/emby/ParameterPersistence/Delete", "POST")
        };
        return routes.All(route => !_probe.IsRouteRegistered(route.Item1, route.Item2));
    }
}
