namespace DD.Danmaku.Hosting;

using DD.Danmaku.Persistence;
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

    /// <summary>读取管理员设置的公共默认参数文件。</summary>
    public Task<object> Get(GlobalFrontendDefaultsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return ApiHttpResult.Success(await GlobalDefaults(plugin));
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
            await InitializeParameters(plugin, id.Value, Request.CancellationToken);
            await plugin.Parameters.StoreFor(id.Value).MutateAsync(rows =>
            {
                // 管理页只覆盖受支持的默认字段，保留个人私密参数和其他命名空间。
                var managedKeys = FrontendParameterMap.ManagedKeys;
                rows.RemoveAll(row => row.Namespace == "dd-danmaku" && managedKeys.Contains(row.Key));
                rows.AddRange(FrontendParameterMap.ToEntries(values));
                return true;
            }, Request.CancellationToken);
            RemoveLegacyDefaults(plugin, id.Value);
        }
        else
        {
            await plugin.Parameters.Defaults.MutateAsync(rows =>
            {
                var managedKeys = FrontendParameterMap.ManagedKeys;
                rows.RemoveAll(row => row.Namespace == "dd-danmaku" && managedKeys.Contains(row.Key));
                rows.AddRange(FrontendParameterMap.ToEntries(values));
                return true;
            }, Request.CancellationToken);
        }
        return ApiHttpResult.Success(new { Saved = true });
    });

    /// <summary>管理员重置指定用户的播放器默认参数。</summary>
    public Task<object> Delete(ResetUserFrontendDefaultsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var id = DefaultUserId(request.UserId, false);
        await InitializeParameters(plugin, id, Request.CancellationToken);
        await plugin.Parameters.StoreFor(id).MutateAsync(rows =>
        {
            rows.RemoveAll(row => row.Namespace == "dd-danmaku" && FrontendParameterMap.ManagedKeys.Contains(row.Key));
            return true;
        }, Request.CancellationToken);
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

    private static async Task<FrontendDefaults> GlobalDefaults(Plugin plugin)
    {
        FrontendDefaults legacy;
        lock (PluginConfigurationService.ConfigurationGate)
            legacy = (plugin.Configuration.GlobalFrontendDefaults ?? new()).Copy();
        // 仅首次以旧全局值创建模板；已有 Defaults.json 始终是唯一权威。
        await plugin.Parameters.Defaults.InitializeAsync(FrontendParameterMap.ToEntries(legacy), CancellationToken.None);
        return FrontendParameterMap.FromEntries(await plugin.Parameters.Defaults.QueryAsync(null, null, null, CancellationToken.None));
    }

    private static async Task<bool> InitializeParameters(Plugin plugin, Guid id, CancellationToken token)
    {
        await GlobalDefaults(plugin);
        FrontendDefaults legacy;
        lock (PluginConfigurationService.ConfigurationGate)
            legacy = (plugin.Configuration.UserFrontendDefaults ?? [])
                .FirstOrDefault(x => x is not null && SameUser(x.UserId, id))?.Values?.Copy() ?? new();
        var personal = await plugin.UserDefaults.ReadAsync(id, legacy);
        var defaults = (await plugin.Parameters.Defaults.QueryAsync(null, null, null, token)).ToList();
        // 模板中的任意命名空间都要复制；旧用户播放器覆盖项仅替换对应字段。
        foreach (var row in FrontendParameterMap.ToEntries(personal))
        {
            defaults.RemoveAll(current => current.Namespace == row.Namespace && current.Key == row.Key);
            defaults.Add(row);
        }
        return await plugin.Parameters.InitializeForAsync(id, defaults, token);
    }

    private static async Task<object> DefaultView(Plugin plugin, Guid id)
    {
        var global = await GlobalDefaults(plugin);
        // 新参数文件一旦存在便是唯一用户配置来源；重置后不可回退到旧个人默认值。
        var personal = File.Exists(plugin.Parameters.PathFor(id))
            ? FrontendParameterMap.FromEntries(await plugin.Parameters.StoreFor(id)
                .QueryAsync(null, null, null, CancellationToken.None))
            : await LegacyDefaultView(plugin, id);
        return new { Global = global, User = personal, Effective = FrontendDefaults.Merge(global, personal) };
    }

    private static async Task<FrontendDefaults> LegacyDefaultView(Plugin plugin, Guid id)
    {
        FrontendDefaults legacy;
        lock (PluginConfigurationService.ConfigurationGate)
            legacy = (plugin.Configuration.UserFrontendDefaults ?? [])
                .FirstOrDefault(x => x is not null && SameUser(x.UserId, id))?.Values?.Copy() ?? new();
        return await plugin.UserDefaults.ReadAsync(id, legacy);
    }
}
