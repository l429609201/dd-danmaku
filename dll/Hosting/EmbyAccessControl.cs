namespace DD.Danmaku.Hosting;

using System.Globalization;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Services;

/// <summary>宿主负责验证令牌，本层补充真实用户、管理员和媒体可见性边界。</summary>
internal sealed class EmbyAccessControl
{
    private readonly IAuthService _authentication;
    private readonly IAuthorizationContext _authorization;
    private readonly ILibraryManager _library;
    internal EmbyAccessControl(IAuthService authentication, IAuthorizationContext authorization,
        ILibraryManager library) => (_authentication, _authorization, _library) = (authentication, authorization, library);

    internal User Authenticate(IRequest request)
    {
        // 使用宿主自身的接口实现，避免旧 SDK 自定义类型在新版接口增加成员后加载失败。
        // 仍由宿主校验令牌；禁止本地请求和启动向导绕过认证。
        try
        {
            _authentication.Authenticate(request, new AuthenticatedAttribute
            {
                AllowBeforeStartupWizard = false, AllowLocal = false, AllowLocalOnly = false
            });
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception) { throw new ApiAccessException(401, "AUTH_REQUIRED", "需要有效的 Emby 用户令牌"); }
        var info = _authorization.GetAuthorizationInfo(request);
        var user = info?.User;
        if (user is null || info!.UserId <= 0 || string.IsNullOrWhiteSpace(info.Token)
            || user.InternalId != info.UserId || user.Policy is null || user.Policy.IsDisabled || user.IsLockedOut)
            throw new ApiAccessException(401, "AUTH_REQUIRED", "需要有效的 Emby 用户身份");
        return user;
    }

    // 从宿主认证上下文取令牌，不能信任客户端另外提供的混淆密钥。
    internal string AdministratorToken(IRequest request)
    {
        var user = Authenticate(request);
        RequireAdministrator(user);
        return _authorization.GetAuthorizationInfo(request).Token;
    }

    internal static void RequireAdministrator(User user)
    {
        if (!user.Policy.IsAdministrator) throw new ApiAccessException(403, "ADMIN_REQUIRED", "仅管理员可操作");
    }

    internal static bool CanUseAi(User user, PluginConfiguration config)
        => config.AiEnabled && (user.Policy.IsAdministrator || config.AiUserAccessEnabled
            && (config.AiAllowedUserIds ?? []).Any(id => Guid.TryParse(id, out var guid) && guid == user.Id));

    internal string RequireVideo(User user, string itemId) => RequireVideoItem(user, itemId).Id.ToString("N");

    // 管理记录复用相同媒体可见性检查，不直接序列化宿主实体。
    internal BaseItem RequireVideoItem(User user, string itemId)
    {
        BaseItem? item;
        if (string.IsNullOrWhiteSpace(itemId) || itemId.Length > 64)
            throw new ApiAccessException(400, "INVALID_ITEM_ID", "媒体标识无效");
        if (itemId.All(c => c is >= '0' and <= '9')
            && long.TryParse(itemId, NumberStyles.None, CultureInfo.InvariantCulture, out var numeric) && numeric > 0)
            item = _library.GetItemById(numeric);
        else if ((Guid.TryParseExact(itemId, "N", out var guid) || Guid.TryParseExact(itemId, "D", out guid))
            && guid != Guid.Empty) item = _library.GetItemById(guid);
        else throw new ApiAccessException(400, "INVALID_ITEM_ID", "媒体标识无效");
        if (item is not Video || !item.IsVisible(user) || !item.IsVisibleStandalone(user))
            throw new ApiAccessException(404, "ITEM_NOT_FOUND", "媒体不存在或不可访问");
        if (item.Id == Guid.Empty) throw new ApiAccessException(500, "INVALID_HOST_ITEM", "宿主媒体标识无效");
        return item;
    }

    // 按媒体库配置的位置边界关联名称，不将服务器路径暴露到列表。
    internal Func<string?, string> LibraryNameResolver()
    {
        var folders = _library.GetVirtualFolders().ToArray();
        return path => string.IsNullOrEmpty(path) ? "未关联媒体库" : string.Join("、", folders
            .Where(folder => (folder.Locations ?? []).Any(location => !string.IsNullOrEmpty(location)
                && path.StartsWith(location.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    + Path.DirectorySeparatorChar, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal)))
            .Select(folder => folder.Name).Distinct());
    }
}

internal sealed class ApiAccessException(int status, string code, string message) : Exception(message)
{
    internal int Status { get; } = status;
    internal string Code { get; } = code;
}
