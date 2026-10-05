namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>管理员查询用户选择、缓存与独立授权配置。</summary>
[Route("/dd-danmaku/api/config/selection", "GET")]
public sealed class SelectionSettingsRequest { }

/// <summary>管理员保存完整选择策略，不接受局部含糊的权限更新。</summary>
[Route("/dd-danmaku/api/config/selection", "PUT")]
public sealed class SaveSelectionSettingsRequest : IRequiresRequestStream
{
    /// <summary>受限 JSON 请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

/// <summary>缓存期限和五类独立授权；清单缺失时拒绝保存，空数组表示撤销。</summary>
public sealed record SelectionSettingsDto(int SharedFreshHours, int TemporaryHours, int SelectionDays,
    int CacheLimitMiB, int SelectionLimitPerUser, string[] SelectionUserIds,
    string[] CreateSharedUserIds, string[] RefreshSharedUserIds,
    string[] ReplaceSharedUserIds, string[] UploadSharedUserIds);

public sealed partial class DanmakuApiService
{
    /// <summary>只有管理员可读取用户授权清单。</summary>
    public Task<object> Get(SelectionSettingsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return Task.FromResult(ApiHttpResult.Success(SelectionSettingsView(plugin.Configuration)));
    });

    /// <summary>先完整校验再原子提交配置副本；不修改当前实例数组。</summary>
    public Task<object> Put(SaveSelectionSettingsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 256 * 1024, "application/json");
        var input = ApiHttpResult.Parse<SelectionSettingsDto>(body);
        var selection = ValidateSelectionSettings(input);
        lock (PluginConfigurationService.ConfigurationGate)
        {
            var copy = plugin.Configuration.CopyForUpdate();
            ApplySelectionSettings(copy, selection);
            plugin.UpdateConfiguration(copy);
            return ApiHttpResult.Success(SelectionSettingsView(copy));
        }
    });

    // 新旧接口共用完整校验；无效缓存或任一授权清单均不能提交其他字段。
    private static SelectionSettingsDto ValidateSelectionSettings(SelectionSettingsDto input)
    {
        ValidateRetentionSettings(new RetentionSettingsDto(input.SharedFreshHours, input.TemporaryHours,
            input.SelectionDays, input.CacheLimitMiB, input.SelectionLimitPerUser));
        return input with
        {
            SelectionUserIds = NormalizeGrantIds(input.SelectionUserIds),
            CreateSharedUserIds = NormalizeGrantIds(input.CreateSharedUserIds),
            RefreshSharedUserIds = NormalizeGrantIds(input.RefreshSharedUserIds),
            ReplaceSharedUserIds = NormalizeGrantIds(input.ReplaceSharedUserIds),
            UploadSharedUserIds = NormalizeGrantIds(input.UploadSharedUserIds)
        };
    }

    private static void ApplySelectionSettings(PluginConfiguration copy, SelectionSettingsDto input)
    {
        ApplyRetentionSettings(copy, new RetentionSettingsDto(input.SharedFreshHours, input.TemporaryHours,
            input.SelectionDays, input.CacheLimitMiB, input.SelectionLimitPerUser));
        copy.DanmakuSelectionUserIds = input.SelectionUserIds;
        copy.DanmakuCreateSharedUserIds = input.CreateSharedUserIds;
        copy.DanmakuRefreshSharedUserIds = input.RefreshSharedUserIds;
        copy.DanmakuReplaceSharedUserIds = input.ReplaceSharedUserIds;
        copy.DanmakuUploadSharedUserIds = input.UploadSharedUserIds;
    }

    private static string[] NormalizeGrantIds(string[]? values)
    {
        // 限制清单数量并统一宿主 GUID 表示；不把名字或客户端声明当认证身份。
        if (values is null || values.Length > 1000) throw new ArgumentException("授权用户清单缺失或超过限制");
        return values.Select(value => Guid.TryParse(value, out var id) && id != Guid.Empty
            ? id.ToString("N") : throw new ArgumentException("授权用户标识无效"))
            .Distinct(StringComparer.Ordinal).ToArray();
    }

    private static SelectionSettingsDto SelectionSettingsView(PluginConfiguration c) => new(
        c.SharedDanmakuFreshHours, c.TemporaryDanmakuHours, c.DanmakuSelectionDays,
        c.TemporaryDanmakuLimitMiB, c.DanmakuSelectionLimitPerUser,
        c.DanmakuSelectionUserIds ?? [], c.DanmakuCreateSharedUserIds ?? [],
        c.DanmakuRefreshSharedUserIds ?? [], c.DanmakuReplaceSharedUserIds ?? [],
        c.DanmakuUploadSharedUserIds ?? []);
}
