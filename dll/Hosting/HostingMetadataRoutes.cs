namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>读取本人健康状态；仅管理员可明确选择其他存在用户。</summary>
[Route("/dd-danmaku/api/metadata/health", "GET,POST")]
public sealed class HostingMetadataHealthRequest
{
    /// <summary>可选管理员目标用户，不传时始终使用本人身份。</summary>
    public string? UserId { get; set; }
}

public sealed partial class DanmakuApiService
{
    /// <summary>非阻塞读取已保存元数据配置的健康状态。</summary>
    public Task<object> Get(HostingMetadataHealthRequest request) => MetadataHealth(request, false);
    /// <summary>取消旧探测并异步重测，失败仍保留原配置。</summary>
    public Task<object> Post(HostingMetadataHealthRequest request) => MetadataHealth(request, true);
    private Task<object> MetadataHealth(HostingMetadataHealthRequest request, bool force) => Execute(async (user, plugin, host) =>
    {
        var owner = user.Id;
        if (!string.IsNullOrEmpty(request.UserId))
        {
            EmbyAccessControl.RequireAdministrator(user);
            owner = DefaultUserId(request.UserId, true);
        }
        var selected = _users.GetUserById(owner);
        if (selected is null || selected.Policy is null || selected.Policy.IsDisabled || selected.IsLockedOut)
            throw new ApiAccessException(409, "METADATA_OWNER_UNAVAILABLE", "目标用户不可用");
        var defaults = await BackendDefaultsAsync(plugin, owner, Request.CancellationToken).ConfigureAwait(false);
        return ApiHttpResult.Success(host.Metadata.EnsureStarted(owner, defaults, plugin.Configuration, force));
    });

    // 保存成功后失效旧缓存，再按实际有效配置启动；自检失败不回滚已保存参数。
    private static async Task MetadataSavedAsync(Plugin plugin, Guid? owner)
    {
        plugin.Host?.Metadata.Invalidate(owner);
        if (owner is { } id)
        {
            try { await BackendDefaultsAsync(plugin, id, CancellationToken.None).ConfigureAwait(false); }
            catch (Exception) { /* 已保存配置不能因异步健康初始化失败被误报为保存失败。 */ }
        }
    }
}
