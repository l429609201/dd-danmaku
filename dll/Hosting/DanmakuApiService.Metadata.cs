namespace DD.Danmaku.Hosting;

using DD.Danmaku.Persistence;

public sealed partial class DanmakuApiService
{
    // 用户参数文件初始化后是唯一有效配置来源；不读取浏览器传入的密钥或地址。
    internal static async Task<FrontendDefaults> ReadMetadataDefaultsAsync(Plugin plugin, Guid userId,
        CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        await InitializeParameters(plugin, userId, token).ConfigureAwait(false);
        var entries = await plugin.Parameters.StoreFor(userId).QueryAsync(null, null, null, token)
            .ConfigureAwait(false);
        return FrontendParameterMap.FromEntries(entries);
    }
}
