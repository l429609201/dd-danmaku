namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>播放策略不包含管理员配置或用户清单。</summary>
[Route("/dd-danmaku/api/playback-policy", "GET")]
public sealed class PlaybackPolicyRequest { }

/// <summary>读取管理员设置的播放与弹幕持久化策略。</summary>
[Route("/dd-danmaku/api/config/playback", "GET")]
public sealed class PlaybackSettingsRequest { }

/// <summary>保存管理员播放与弹幕持久化策略。</summary>
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
public sealed record PlaybackSettingsDto(bool Enabled, bool ReadEnabled, bool WriteEnabled,
    bool PreferLocal, bool AutoSave);

public sealed partial class DanmakuApiService
{
    /// <summary>读取当前用户可用的播放策略，不暴露管理员设置细节。</summary>
    public Task<object> Get(PlaybackPolicyRequest request) => Execute((user, plugin, host) =>
    {
        var c = plugin.Configuration;
        // 能力仅作界面提示；实际 XML 请求仍必须重新认证与检查写入开关。
        var canWrite = user.Policy.IsAdministrator && c.FilePersistenceEnabled && c.FilePersistenceWriteEnabled;
        return Task.FromResult(ApiHttpResult.Success(new
        {
            ReadEnabled = c.FilePersistenceEnabled && c.FilePersistenceReadEnabled,
            PreferLocal = c.PreferLocalDanmaku, CanWrite = canWrite,
            AutoSave = canWrite && c.AutoSaveDanmaku, IsAdministrator = user.Policy.IsAdministrator
        }));
    });

    /// <summary>管理员读取完整的弹幕文件读写策略。</summary>
    public Task<object> Get(PlaybackSettingsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return Task.FromResult(ApiHttpResult.Success(PlaybackSettingsView(plugin.Configuration)));
    });

    /// <summary>管理员更新弹幕文件读写策略。</summary>
    public Task<object> Put(SavePlaybackSettingsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 4096, "application/json");
        var settings = ApiHttpResult.Parse<PlaybackSettingsDto>(bytes);
        lock (PluginConfigurationService.ConfigurationGate)
        {
            var copy = plugin.Configuration.CopyForUpdate();
            copy.FilePersistenceEnabled = settings.Enabled;
            copy.FilePersistenceReadEnabled = settings.ReadEnabled;
            copy.FilePersistenceWriteEnabled = settings.WriteEnabled;
            copy.PreferLocalDanmaku = settings.PreferLocal;
            copy.AutoSaveDanmaku = settings.AutoSave;
            plugin.UpdateConfiguration(copy);
            return ApiHttpResult.Success(PlaybackSettingsView(copy));
        }
    });

    private static PlaybackSettingsDto PlaybackSettingsView(PluginConfiguration c) => new(
        c.FilePersistenceEnabled, c.FilePersistenceReadEnabled, c.FilePersistenceWriteEnabled,
        c.PreferLocalDanmaku, c.AutoSaveDanmaku);
}
