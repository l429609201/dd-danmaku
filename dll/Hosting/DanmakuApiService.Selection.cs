namespace DD.Danmaku.Hosting;

using MediaBrowser.Model.Services;

/// <summary>查询当前认证用户对媒体的选择，不返回其他用户或上游内部配置指纹。</summary>
[Route("/dd-danmaku/api/items/{ItemId}/selection", "GET")]
public sealed class ReadSelectionRequest
{
    /// <summary>宿主媒体标识。</summary>
    public string ItemId { get; set; } = "";
}

/// <summary>移除当前用户选择，后续播放恢复共享弹幕。</summary>
[Route("/dd-danmaku/api/items/{ItemId}/selection", "DELETE")]
public sealed class RestoreSharedSelectionRequest
{
    /// <summary>宿主媒体标识。</summary>
    public string ItemId { get; set; } = "";
}

public sealed partial class DanmakuApiService
{
    /// <summary>仅查询本人选择；播放不会延长选择保留期。</summary>
    public Task<object> Get(ReadSelectionRequest request) => Execute(async (user, plugin, host) =>
    {
        var id = _access.RequireVideo(user, request.ItemId);
        var selection = await host.Selections.FindAsync(user.Id.ToString("N"), id, Request.CancellationToken);
        return ApiHttpResult.Success(new
        {
            HasSelection = selection is not null,
            Selection = selection is null ? null : new
            {
                selection.SelectionId, selection.Content.ItemId, selection.Content.SourceId,
                selection.Content.SourceEpisodeId, selection.Content.ChConvert,
                selection.SelectedAt, selection.ExpiresAt, selection.KeepForever, selection.Revision
            },
            CanSelect = DanmakuWritePolicy.Can(user, plugin.Configuration, DanmakuWritePolicy.Operation.Selection)
        });
    });

    /// <summary>恢复共享只修改本人选择；在提交前重新认证和检查媒体访问权。</summary>
    public Task<object> Delete(RestoreSharedSelectionRequest request) => Execute(async (user, plugin, host) =>
    {
        var id = _access.RequireVideo(user, request.ItemId);
        void Authorize()
        {
            var current = _access.Authenticate(Request);
            if (current.Id != user.Id) throw new ApiAccessException(403, "USER_CHANGED", "用户身份已变化");
            _access.RequireVideo(current, id);
            DanmakuWritePolicy.Require(current, plugin.Configuration, DanmakuWritePolicy.Operation.Selection);
        }
        Authorize();
        await host.Selections.RestoreSharedAsync(user.Id.ToString("N"), id, Authorize, Request.CancellationToken);
        return ApiHttpResult.Success(new { RestoredShared = true });
    });
}
