namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>播放策略不包含管理员配置或用户清单。</summary>
[Route("/dd-danmaku/api/playback-policy", "GET")]
public sealed class PlaybackPolicyRequest { }

[Route("/dd-danmaku/api/config/playback", "GET")]
public sealed class PlaybackSettingsRequest { }

[Route("/dd-danmaku/api/config/playback", "PUT")]
public sealed class SavePlaybackSettingsRequest : IRequiresRequestStream
{
    public Stream RequestStream { get; set; } = Stream.Null;
}

public sealed record PlaybackSettingsDto(bool Enabled, bool ReadEnabled, bool WriteEnabled,
    bool PreferLocal, bool AutoSave);

public sealed partial class DanmakuApiService
{
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

    public Task<object> Get(PlaybackSettingsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return Task.FromResult(ApiHttpResult.Success(PlaybackSettingsView(plugin.Configuration)));
    });

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
