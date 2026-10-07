namespace DD.Danmaku.Hosting;

using System.Runtime.CompilerServices;

/// <summary>用户来源配置副本的网络权限，不把临时授权写入持久化配置。</summary>
internal static class BackendSourceAuthorization
{
    private sealed record Permission(bool AllowPrivate);
    private static readonly ConditionalWeakTable<PluginConfiguration, Permission> Permissions = new();
    internal static void Register(PluginConfiguration configuration, bool allowPrivate) =>
        Permissions.Add(configuration, new Permission(allowPrivate));
    // 缺少来源授权标记时拒绝内网访问；旧管理员入口由调用方单独核验。
    internal static bool AllowPrivate(PluginConfiguration configuration) =>
        Permissions.TryGetValue(configuration, out var permission) && permission.AllowPrivate;
}
