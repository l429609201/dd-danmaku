namespace DD.Danmaku.Hosting;

/// <summary>已知旧插件存在时拒绝本插件参数读写；不能阻止宿主把请求分派给旧插件。</summary>
internal static class ParameterRouteGuard
{
    internal static bool IsAvailable => !AppDomain.CurrentDomain.GetAssemblies().Any(assembly =>
    {
        var name = assembly.GetName().Name ?? "";
        return name.Contains("ParameterPersistence", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Parameter_persistence", StringComparison.OrdinalIgnoreCase);
    });

    internal static void RequireAvailable()
    {
        if (!IsAvailable)
            throw new ApiAccessException(503, "PARAMETER_ROUTE_CONFLICT", "请先移除原参数持久化插件并重启 Emby");
    }
}
