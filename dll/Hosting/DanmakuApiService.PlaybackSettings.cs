namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;
using System.Text.Json.Serialization;

/// <summary>播放策略不包含管理员配置或用户清单。</summary>
[Route("/dd-danmaku/api/playback-policy", "GET")]
public sealed class PlaybackPolicyRequest { }

/// <summary>读取管理员设置的播放与弹幕持久化策略。</summary>
[Route("/dd-danmaku/api/config/playback", "GET")]
public sealed class PlaybackSettingsRequest { }

/// <summary>保留旧播放保存路由，仅返回退役提示，不再接受配置更新。</summary>
[Route("/dd-danmaku/api/config/playback", "PUT")]
public sealed class SavePlaybackSettingsRequest : IRequiresRequestStream
{
    /// <summary>包含播放策略的 JSON 请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

/// <summary>服务端弹幕文件读取和写入策略。</summary>
/// <param name="Enabled">文件持久化总开关。</param>
/// <param name="ReadEnabled">是否允许读取文件。</param>
/// <param name="WriteEnabled">是否允许写入文件。</param>
/// <param name="PreferLocal">是否优先读取本地弹幕。</param>
/// <param name="AutoSave">是否自动保存获取的弹幕。</param>
// 完整存储策略必须显式提交每个布尔值，缺失字段不能被解释为关闭。
public sealed record PlaybackSettingsDto(
    [property: JsonRequired] bool Enabled,
    [property: JsonRequired] bool ReadEnabled,
    [property: JsonRequired] bool WriteEnabled,
    [property: JsonRequired] bool PreferLocal,
    [property: JsonRequired] bool AutoSave);

public sealed partial class DanmakuApiService
{
    /// <summary>读取当前用户可用的播放策略，不暴露管理员设置细节。</summary>
    public Task<object> Get(PlaybackPolicyRequest request) => Execute((user, plugin, host) =>
    {
        var c = plugin.Configuration;
        // 能力仅作界面提示；实际 XML 请求仍必须重新认证与检查写入开关。
        var canWrite = DanmakuWritePolicy.Can(user, c, DanmakuWritePolicy.Operation.UploadShared)
            && DanmakuWritePolicy.Can(user, c, DanmakuWritePolicy.Operation.CreateShared);
        var autoSaveBlockReason = DanmakuWritePolicy.AutoSaveBlockReason(user, c);
        return Task.FromResult(ApiHttpResult.Success(new
        {
            ReadEnabled = c.FilePersistenceEnabled && c.FilePersistenceReadEnabled,
            PreferLocal = c.PreferLocalDanmaku, CanWrite = canWrite,
            AutoSave = autoSaveBlockReason is null, AutoSaveBlockReason = autoSaveBlockReason,
            IsAdministrator = user.Policy.IsAdministrator
        }));
    });

    /// <summary>管理员读取完整的弹幕文件读写策略。</summary>
    public Task<object> Get(PlaybackSettingsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return Task.FromResult(ApiHttpResult.Success(PlaybackSettingsView(plugin.Configuration)));
    });

    /// <summary>旧播放保存入口已退役；完整存储策略由带版本校验的统一接口提交。</summary>
    public Task<object> Put(SavePlaybackSettingsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        // 不解析或写回旧草稿，避免绕过统一存储接口的版本校验。
        return Task.FromResult(ApiHttpResult.Error(410, "PLAYBACK_SETTINGS_RETIRED",
            "此保存接口已停用，请重新读取并通过 /dd-danmaku/api/config/storage 保存完整存储策略"));
    });

    // 统一存储入口显式更新五个字段，尊重迁移后管理员主动关闭自动保存的值。
    private static void ApplyPlaybackSettings(PluginConfiguration copy, PlaybackSettingsDto settings)
    {
        copy.FilePersistenceEnabled = settings.Enabled;
        copy.FilePersistenceReadEnabled = settings.ReadEnabled;
        copy.FilePersistenceWriteEnabled = settings.WriteEnabled;
        copy.PreferLocalDanmaku = settings.PreferLocal;
        copy.AutoSaveDanmaku = settings.AutoSave;
    }

    private static PlaybackSettingsDto PlaybackSettingsView(PluginConfiguration c) => new(
        c.FilePersistenceEnabled, c.FilePersistenceReadEnabled, c.FilePersistenceWriteEnabled,
        c.PreferLocalDanmaku, c.AutoSaveDanmaku);
}
