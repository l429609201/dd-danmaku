namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

// 管理接口与当前用户读取接口分离，普通用户不能指定其他用户身份。
/// <summary>当前用户读取生效的播放器默认参数。</summary>
[Route("/dd-danmaku/api/frontend-defaults", "GET")]
public sealed class EffectiveFrontendDefaultsRequest { }
/// <summary>管理员读取全局播放器默认参数。</summary>
[Route("/dd-danmaku/api/config/frontend-defaults", "GET")]
public sealed class GlobalFrontendDefaultsRequest { }
/// <summary>管理员保存全局播放器默认参数。</summary>
[Route("/dd-danmaku/api/config/frontend-defaults", "PUT")]
public sealed class SaveGlobalFrontendDefaultsRequest : IRequiresRequestStream
{
    /// <summary>待保存参数的 JSON 请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>管理员读取指定用户的播放器默认参数。</summary>
[Route("/dd-danmaku/api/config/frontend-defaults/users/{UserId}", "GET")]
public sealed class UserFrontendDefaultsRequest
{
    /// <summary>待查询用户的标识。</summary>
    public string UserId { get; set; } = "";
}
/// <summary>管理员保存指定用户的播放器默认参数。</summary>
[Route("/dd-danmaku/api/config/frontend-defaults/users/{UserId}", "PUT")]
public sealed class SaveUserFrontendDefaultsRequest : IRequiresRequestStream
{
    /// <summary>待保存用户的标识。</summary>
    public string UserId { get; set; } = "";
    /// <summary>待保存参数的 JSON 请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>管理员重置指定用户的播放器默认参数。</summary>
[Route("/dd-danmaku/api/config/frontend-defaults/users/{UserId}", "DELETE")]
public sealed class ResetUserFrontendDefaultsRequest
{
    /// <summary>待重置用户的标识。</summary>
    public string UserId { get; set; } = "";
}

public sealed partial class DanmakuApiService
{
    /// <summary>读取当前用户生效的播放器默认参数。</summary>
    public Task<object> Get(EffectiveFrontendDefaultsRequest request) => Execute(async (user, plugin, host) =>
        ApiHttpResult.Success(await DefaultView(plugin, user.Id)));

    /// <summary>读取管理员设置的全局播放器默认参数。</summary>
    public Task<object> Get(GlobalFrontendDefaultsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        lock (PluginConfigurationService.ConfigurationGate)
            return Task.FromResult(ApiHttpResult.Success((plugin.Configuration.GlobalFrontendDefaults ?? new()).Copy()));
    });

    /// <summary>管理员读取指定用户的播放器默认参数。</summary>
    public Task<object> Get(UserFrontendDefaultsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return ApiHttpResult.Success(await DefaultView(plugin, DefaultUserId(request.UserId, true)));
    });

    /// <summary>管理员保存全局播放器默认参数。</summary>
    public Task<object> Put(SaveGlobalFrontendDefaultsRequest request) => SaveDefaults(request.RequestStream, null);
    /// <summary>管理员保存指定用户的播放器默认参数。</summary>
    public Task<object> Put(SaveUserFrontendDefaultsRequest request) => SaveDefaults(request.RequestStream, request.UserId);

    private Task<object> SaveDefaults(Stream stream, string? userId) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        Guid? id = userId is null ? null : DefaultUserId(userId, true);
        var bytes = await ApiHttpResult.ReadBodyAsync(stream, Request, 256 * 1024, "application/json");
        var values = ApiHttpResult.Parse<FrontendDefaults>(bytes);
        values.Validate();
        if (id.HasValue)
        {
            // 先提交 Data 文件，再清理 XML 旧条目；中途失败仍以新文件为准。
            await plugin.UserDefaults.SaveAsync(id.Value, values);
            RemoveLegacyDefaults(plugin, id.Value);
        }
        else lock (PluginConfigurationService.ConfigurationGate)
        {
            var copy = plugin.Configuration.CopyForUpdate();
            copy.GlobalFrontendDefaults = values.Copy();
            plugin.UpdateConfiguration(copy);
        }
        return ApiHttpResult.Success(new { Saved = true });
    });

    /// <summary>管理员重置指定用户的播放器默认参数。</summary>
    public Task<object> Delete(ResetUserFrontendDefaultsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var id = DefaultUserId(request.UserId, false);
        await plugin.UserDefaults.ResetAsync(id);
        RemoveLegacyDefaults(plugin, id);
        return ApiHttpResult.Success(new { Reset = true });
    });

    private static void RemoveLegacyDefaults(Plugin plugin, Guid id)
    {
        lock (PluginConfigurationService.ConfigurationGate)
        {
            if (!(plugin.Configuration.UserFrontendDefaults ?? []).Any(x => x is not null && SameUser(x.UserId, id))) return;
            var copy = plugin.Configuration.CopyForUpdate();
            copy.UserFrontendDefaults = (copy.UserFrontendDefaults ?? [])
                .Where(x => x is not null && !SameUser(x.UserId, id)).ToArray();
            plugin.UpdateConfiguration(copy);
        }
    }

    private Guid DefaultUserId(string value, bool requireExists)
    {
        if (!(Guid.TryParseExact(value, "N", out var id) || Guid.TryParseExact(value, "D", out id)) || id == Guid.Empty)
            throw new ArgumentException("用户标识无效");
        if (requireExists && _users.GetUserById(id) is null)
            throw new ApiAccessException(404, "USER_NOT_FOUND", "用户不存在");
        return id;
    }

    private static bool SameUser(string value, Guid id) => Guid.TryParse(value, out var parsed) && parsed == id;

    private static async Task<object> DefaultView(Plugin plugin, Guid id)
    {
        FrontendDefaults global, legacy;
        lock (PluginConfigurationService.ConfigurationGate)
        {
            global = (plugin.Configuration.GlobalFrontendDefaults ?? new()).Copy();
            legacy = (plugin.Configuration.UserFrontendDefaults ?? [])
                .FirstOrDefault(x => x is not null && SameUser(x.UserId, id))?.Values?.Copy() ?? new();
        }
        // 文件读取不占用全局配置锁，避免阻塞其他管理员配置请求。
        var personal = await plugin.UserDefaults.ReadAsync(id, legacy);
        return new { Global = global, User = personal, Effective = FrontendDefaults.Merge(global, personal) };
    }
}
