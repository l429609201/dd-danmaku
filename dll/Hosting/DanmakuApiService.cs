namespace DD.Danmaku.Hosting;

using System.Text.Json;
using System.Xml;
using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Model.Services;

/// <summary>由 Emby 自动发现；所有入口先认证，业务错误统一脱敏。</summary>
public sealed partial class DanmakuApiService : IService, IRequiresRequest
{
    private readonly EmbyAccessControl _access;
    private readonly IUserManager _users;
    private readonly MediaBrowser.Model.Tasks.ITaskManager _tasks;
    /// <summary>由 Emby 请求管线设置的当前请求上下文。</summary>
    public IRequest Request { get; set; } = null!;
    private readonly MediaBrowser.Model.Logging.ILogger _matchLogger;
    // 关联号由宿主生成，不接受客户端提供的日志内容。
    private readonly string _matchTrace = Guid.NewGuid().ToString("N")[..8];
    /// <summary>接收宿主认证、授权、媒体库、用户和原生日志服务。</summary>
    public DanmakuApiService(IAuthService authentication, IAuthorizationContext authorization,
        ILibraryManager library, IUserManager users, MediaBrowser.Model.Tasks.ITaskManager tasks,
        MediaBrowser.Model.Logging.ILogManager logs)
    {
        _access = new EmbyAccessControl(authentication, authorization, library);
        _users = users;
        _tasks = tasks;
        _matchLogger = logs.GetLogger("DD.Danmaku");
    }

    private async Task<object> Execute(Func<User, Plugin, EmbyHostServices, Task<ApiHttpResult>> action)
    {
        // 根据宿主已绑定的请求类型选协议，不能依赖客户端提供的任意标记。
        var parameters = Request.Dto is QueryUserParameters or CreateUserParameters or UpdateUserParameters or DeleteUserParameters;
        ApiHttpResult Error(int status, string code, string message) => parameters
            ? new ApiHttpResult(status, JsonSerializer.SerializeToUtf8Bytes(
                new Web.ParameterPersistence.ParameterResponse(false, message)), "application/json; charset=utf-8")
            : ApiHttpResult.Error(status, code, message);
        try
        {
            var user = _access.Authenticate(Request);
            if (parameters) ParameterRouteGuard.RequireAvailable();
            var plugin = Plugin.Instance;
            if (plugin?.Host is not { } host)
                return Error(503, "HOST_UNAVAILABLE", "插件宿主尚未就绪");
            // 普通用户仅可读取授权媒体的弹幕，写入和删除始终保留管理员边界。
            if (Request.Dto is SaveDanmakuRequest or DeleteDanmakuRequest)
            {
                // 写操作必须明确选择来源；空值表示旧无来源文件，不接受省略参数。
                if (Request.QueryString["source"] is null)
                    throw new ArgumentException("保存或删除弹幕必须指定 source 参数");
                EmbyAccessControl.RequireAdministrator(user);
                if (!plugin.Configuration.FilePersistenceEnabled || !plugin.Configuration.FilePersistenceWriteEnabled)
                    throw new ApiAccessException(409, "XML_WRITE_DISABLED", "服务器 XML 写入未启用");
            }
            // 兼容读取入口与原生读取入口使用相同开关，不能绕过管理员策略。
            if (Request.Dto is ReadDanmakuRequest or PlaybackHttpRequest or CompatibleDanmuRequest)
            {
                if (!plugin.Configuration.FilePersistenceEnabled || !plugin.Configuration.FilePersistenceReadEnabled)
                    throw new ApiAccessException(409, "XML_READ_DISABLED", "服务器 XML 读取未启用");
            }
            return await action(user, plugin, host);
        }
        catch (OperationCanceledException) when (Request.CancellationToken.IsCancellationRequested) { throw; }
        catch (ApiAccessException e) { return Error(e.Status, e.Code, e.Message); }
        // AI 领域错误已有脱敏消息，保留状态码，不能全部降为内部错误。
        catch (Matching.MatchRequestException e) { return Error(e.StatusCode, e.ErrorCode, e.Message); }
        // 领域异常先分类，服务端损坏文件不能伪装成客户端 JSON 错误。
        catch (Persistence.ParameterStoreException e) { return Error(e.Status, e.Code, e.Message); }
        catch (JsonException) { return Error(400, "INVALID_JSON", "JSON 格式或字段无效"); }
        catch (XmlException) { return Error(400, "INVALID_XML", "弹幕 XML 格式无效"); }
        catch (ArgumentException) { return Error(400, "INVALID_REQUEST", "请求参数无效"); }
        catch (InvalidDataException) { return Error(400, "INVALID_DATA", "数据格式无效或超出限制"); }
        catch (IOException) { return Error(500, "STORAGE_ERROR", "服务器文件操作失败"); }
        catch (UnauthorizedAccessException) { return Error(500, "STORAGE_DENIED", "服务器没有文件操作权限"); }
        catch (Exception) { return Error(500, "INTERNAL_ERROR", "插件处理请求失败"); }
    }

    public Task<object> Get(ConfigRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return Task.FromResult(ApiHttpResult.Success(host.Configuration.Get()));
    });

    public Task<object> Put(UpdateConfigRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 512 * 1024, "application/json");
        var config = ApiHttpResult.Parse<PluginConfigDto>(body);
        // 新增授权须对应现有用户；已删除的旧条目允许保留，以便管理员显式取消。
        var previous = plugin.Configuration.AiAllowedUserIds ?? [];
        foreach (var id in config.AiAllowedUserIds ?? [])
        {
            if (!Guid.TryParse(id, out var guid) || guid == Guid.Empty)
                throw new ArgumentException("用户标识无效");
            if (_users.GetUserById(guid) is null && !previous.Contains(guid.ToString("N"), StringComparer.OrdinalIgnoreCase))
                throw new ArgumentException("授权用户不存在");
        }
        return ApiHttpResult.Success(host.Configuration.Update(config));
    });

    public Task<object> Get(UserOptionsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        // 使用 SDK 查询接口替代废弃 Users 属性；保留管理员及禁用用户供现有授权界面展示。
        // 仅返回复选控件必要字段，绝不直接序列化宿主 User 或策略对象。
        var items = _users.GetUserList(new MediaBrowser.Model.Querying.UserQuery
        { EnableTotalRecordCount = false }).Select(u => new
        {
            Id = u.Id.ToString("N"), u.Name,
            IsAdministrator = u.Policy.IsAdministrator, IsDisabled = u.Policy.IsDisabled || u.IsLockedOut
        }).OrderBy(u => u.Name).ToArray();
        return Task.FromResult(ApiHttpResult.Success(items));
    });

    public Task<object> Get(StatusRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return Task.FromResult(ApiHttpResult.Success(plugin.Service.Snapshot(plugin.Configuration)));
    });

    public Task<object> Get(CapabilitiesRequest request) => Execute((user, plugin, host) =>
    {
        var ready = new BackendReadiness(ApiReady: true, LocalDanmaku: plugin.Configuration.FilePersistenceEnabled, Sidecar: true,
            MediaMatch: true, AiProviderReady: host.AiProviderReady && EmbyAccessControl.CanUseAi(user, plugin.Configuration),
            ParameterPersistence: ParameterRouteGuard.IsAvailable);
        var data = new CapabilitiesService(() => ready).Create(plugin.Configuration, plugin.Service.Snapshot(plugin.Configuration));
        return Task.FromResult(ApiHttpResult.Success(data));
    });
}
