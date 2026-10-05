namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>管理员查询 XML、保存授权及缓存的同一配置快照。</summary>
[Route("/dd-danmaku/api/config/storage", "GET")]
public sealed class StorageSettingsRequest { }

/// <summary>一次保存完整存储策略，不接受跨接口的部分提交。</summary>
[Route("/dd-danmaku/api/config/storage", "PUT")]
public sealed class SaveStorageSettingsRequest : IRequiresRequestStream
{
    /// <summary>包含完整存储配置的受限 JSON 正文。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

/// <summary>缓存期限与容量，不再夹带五类共享 XML 操作授权。</summary>
public sealed record RetentionSettingsDto(int SharedFreshHours, int TemporaryHours, int SelectionDays,
    int CacheLimitMiB, int SelectionLimitPerUser);

/// <summary>保存身份与覆盖范围；布尔值必须显式提交，缺失不能被解释为关闭。</summary>
public sealed record SaveAuthorizationDto(
    [property: JsonRequired] bool AdministratorEnabled,
    [property: JsonRequired] string[] UserIds,
    [property: JsonRequired] bool AllowOverwrite);

/// <summary>统一表单；不包含旧授权数组、运行设置或接入凭据。</summary>
public sealed record StorageSettingsDto(PlaybackSettingsDto Playback, RetentionSettingsDto Retention,
    SaveAuthorizationDto Authorization, string Revision);

public sealed partial class DanmakuApiService
{
    /// <summary>捕获同一实例，避免读出不同时刻的开关和授权组合。</summary>
    public Task<object> Get(StorageSettingsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return Task.FromResult(ApiHttpResult.Success(StorageSettingsView(plugin.Configuration)));
    });

    /// <summary>全部校验通过后一次提交；旧授权数组仅保留为兼容数据，不作为新名单的写入入口。</summary>
    public Task<object> Put(SaveStorageSettingsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 256 * 1024, "application/json");
        var input = ApiHttpResult.Parse<StorageSettingsDto>(body);
        if (input.Playback is null || input.Retention is null || input.Authorization is null)
            throw new ArgumentException("XML 策略、保存授权或缓存配置缺失");
        ValidateRetentionSettings(input.Retention);
        var ids = NormalizeGrantIds(input.Authorization.UserIds);
        lock (PluginConfigurationService.ConfigurationGate)
        {
            if (string.IsNullOrEmpty(input.Revision)
                || input.Revision != StorageSettingsView(plugin.Configuration).Revision)
                throw new ApiAccessException(409, "CONFIG_CHANGED", "存储策略已被修改，请重新读取后保存");
            var copy = plugin.Configuration.CopyForUpdate();
            ApplyPlaybackSettings(copy, input.Playback);
            ApplyRetentionSettings(copy, input.Retention);
            // 空数组显式撤销普通用户授权；不再回退或合并旧的细粒度名单。
            copy.XmlAdministratorSaveEnabled = input.Authorization.AdministratorEnabled;
            copy.XmlSaveUserIds = ids;
            copy.XmlOverwriteEnabled = input.Authorization.AllowOverwrite;
            plugin.UpdateConfiguration(copy);
            return ApiHttpResult.Success(StorageSettingsView(copy));
        }
    });

    private static RetentionSettingsDto RetentionSettingsView(PluginConfiguration current) => new(
        current.SharedDanmakuFreshHours, current.TemporaryDanmakuHours, current.DanmakuSelectionDays,
        current.TemporaryDanmakuLimitMiB, current.DanmakuSelectionLimitPerUser);

    private static void ValidateRetentionSettings(RetentionSettingsDto input)
    {
        if (input.SharedFreshHours is < 1 or > 8760 || input.TemporaryHours is < 1 or > 8760
            || input.SelectionDays is < 1 or > 3650 || (long)input.SelectionDays * 24 < input.TemporaryHours
            || input.CacheLimitMiB is < 32 or > 1048576 || input.SelectionLimitPerUser is < 1 or > 10000)
            throw new ArgumentException("缓存期限或容量无效，选择期限不能短于正文期限");
    }

    private static void ApplyRetentionSettings(PluginConfiguration copy, RetentionSettingsDto input)
    {
        copy.SharedDanmakuFreshHours = input.SharedFreshHours;
        copy.TemporaryDanmakuHours = input.TemporaryHours;
        copy.DanmakuSelectionDays = input.SelectionDays;
        copy.TemporaryDanmakuLimitMiB = input.CacheLimitMiB;
        copy.DanmakuSelectionLimitPerUser = input.SelectionLimitPerUser;
    }

    private static StorageSettingsDto StorageSettingsView(PluginConfiguration current)
    {
        var playback = PlaybackSettingsView(current);
        var retention = RetentionSettingsView(current);
        var authorization = new SaveAuthorizationDto(current.XmlAdministratorSaveEnabled,
            DanmakuWritePolicy.SaveUserIds(current), current.XmlOverwriteEnabled);
        // 版本覆盖有效保存权限，阻止旧表单恢复已撤销的名单或覆盖开关。
        var revision = Convert.ToHexString(SHA256.HashData(
            JsonSerializer.SerializeToUtf8Bytes(new { Playback = playback, Retention = retention, Authorization = authorization })));
        return new StorageSettingsDto(playback, retention, authorization, revision);
    }
}
