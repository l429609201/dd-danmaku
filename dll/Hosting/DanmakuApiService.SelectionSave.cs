namespace DD.Danmaku.Hosting;

using DD.Danmaku.Danmaku;
using MediaBrowser.Model.Services;

/// <summary>明确选择来源集；正文由后端取回，不信任客户端提交的上游配置身份。</summary>
[Route("/dd-danmaku/api/items/{ItemId}/selection", "PUT")]
public sealed class SaveUserSelectionRequest : IRequiresRequestStream
{
    /// <summary>宿主媒体标识。</summary>
    public string ItemId { get; set; } = "";
    /// <summary>受限 JSON 正文。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

/// <summary>临时选择只接受来源、来源集 ID 和转换参数。</summary>
public sealed record SaveUserSelectionDto(string SourceId, string SourceEpisodeId, int ChConvert);

public sealed partial class DanmakuApiService
{
    /// <summary>重搜只更新本人临时选择，不创建或覆盖共享旁车。</summary>
    public Task<object> Put(SaveUserSelectionRequest request) => Execute(async (user, plugin, host) =>
    {
        var id = _access.RequireVideo(user, request.ItemId);
        DanmakuWritePolicy.Require(user, plugin.Configuration, DanmakuWritePolicy.Operation.Selection);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 8192, "application/json");
        var input = ApiHttpResult.Parse<SaveUserSelectionDto>(bytes);
        var config = plugin.Configuration;
        if (string.IsNullOrWhiteSpace(input.SourceId) || input.ChConvert is < 0 or > 2
            || input.SourceId != DanmakuXmlMetadata.OfficialSource && input.SourceId != config.DanmakuProxySourceId)
            throw new ArgumentException("所选弹幕来源或简繁参数无效");
        var identity = new SelectionContentIdentity(id, input.SourceId, ProxyIdentifier(input.SourceEpisodeId),
            input.ChConvert, SelectionUpstreamRevision(input.SourceId, config));
        void Authorize()
        {
            var current = _access.Authenticate(Request);
            if (current.Id != user.Id) throw new ApiAccessException(403, "USER_CHANGED", "用户身份已变化");
            _access.RequireVideo(current, id);
            DanmakuWritePolicy.Require(current, plugin.Configuration, DanmakuWritePolicy.Operation.Selection);
            if (identity.UpstreamRevision != SelectionUpstreamRevision(identity.SourceId, plugin.Configuration))
                throw new ApiAccessException(409, "UPSTREAM_CHANGED", "弹幕上游配置已变化，请重新选择");
        }
        var comments = await FetchSelectionCommentsAsync(identity, user.Id, config, Request.CancellationToken);
        var saved = await host.Selections.SaveAsync(user.Id.ToString("N"), identity, comments,
            Authorize, Request.CancellationToken);
        return ApiHttpResult.Success(new { saved.SelectionId, saved.Revision, saved.ExpiresAt,
            saved.KeepForever, CommentCount = comments.Count });
    });
}
