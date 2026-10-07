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
public sealed record SaveUserSelectionDto(string SourceId, string SourceEpisodeId, int ChConvert,
    string? SelectionTaskId = null);

public sealed partial class DanmakuApiService
{
    /// <summary>重搜只更新本人临时选择，不创建或覆盖共享旁车。</summary>
    public Task<object> Put(SaveUserSelectionRequest request) => Execute(async (user, plugin, host) =>
    {
        var id = _access.RequireVideo(user, request.ItemId);
        DanmakuWritePolicy.Require(user, plugin.Configuration, DanmakuWritePolicy.Operation.Selection);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 8192, "application/json");
        var input = ApiHttpResult.Parse<SaveUserSelectionDto>(bytes);
        // 旧选择入口不能凭集 ID 直接保存；必须绑定本人已经完成的手动分集任务。
        if (string.IsNullOrWhiteSpace(input.SelectionTaskId))
            throw new ApiAccessException(409, "MANUAL_SELECTION_REQUIRED", "保存需要手动搜索并明确选择分集");
        await host.BackendTasks.AuthorizeResultAsync(user.Id, input.SelectionTaskId, Request.CancellationToken);
        var proofTask = host.BackendTasks.Read(user.Id, input.SelectionTaskId);
        if (proofTask.ItemId != id || proofTask.Kind != "search" || proofTask.Status != "succeeded")
            throw new ApiAccessException(409, "MANUAL_SELECTION_REQUIRED", "保存需要本人已完成的手动分集任务");
        var proof = host.BackendTasks.Result(user.Id, input.SelectionTaskId);
        using var proofDocument = System.Text.Json.JsonDocument.Parse(proof.Body);
        var sourceId = proofDocument.RootElement.TryGetProperty("data", out var proofData)
            ? OnlineString(proofData, "sourceId") : null;
        if (sourceId is null) throw new ApiAccessException(409, "EPISODE_NOT_CONFIRMED", "手动任务没有明确分集结果");
        VerifyDownloadEpisode(proof.Body, id, sourceId, ProxyIdentifier(input.SourceEpisodeId));
        var defaults = await BackendDefaultsAsync(plugin, user.Id, Request.CancellationToken);
        var source = DownloadSource(defaults, plugin.Configuration, user.Id, sourceId);
        var config = source.Configuration;
        if (source.XmlSource != input.SourceId || string.IsNullOrWhiteSpace(input.SourceId) || input.ChConvert is < 0 or > 2)
            throw new ArgumentException("所选弹幕来源或简繁参数无效");
        var identity = new SelectionContentIdentity(id, input.SourceId, ProxyIdentifier(input.SourceEpisodeId),
            input.ChConvert, SelectionUpstreamRevision(input.SourceId, config));
        var intent = await host.Selections.ReserveIntentAsync(user.Id.ToString("N"), id, Request.CancellationToken);
        var download = new BackendDownloadRecord("", user.Id, id, source.Id, input.SourceEpisodeId,
            input.ChConvert, "selection", DownloadRevision(source, input.ChConvert), DateTimeOffset.UtcNow,
            SelectionIntent: intent);
        void Authorize()
        {
            var current = _access.Authenticate(Request);
            if (current.Id != user.Id) throw new ApiAccessException(403, "USER_CHANGED", "用户身份已变化");
            _access.RequireVideo(current, id);
            DanmakuWritePolicy.Require(current, plugin.Configuration, DanmakuWritePolicy.Operation.Selection);
            DownloadAuthorizeAsync(download, plugin, Request.CancellationToken).GetAwaiter().GetResult();
        }
        var comments = await FetchSelectionCommentsAsync(identity, user.Id, config, Request.CancellationToken);
        var saved = await host.Selections.SaveAsync(user.Id.ToString("N"), identity, comments,
            Authorize, Request.CancellationToken, selectionIntent: intent);
        return ApiHttpResult.Success(new { saved.SelectionId, saved.Revision, saved.ExpiresAt,
            saved.KeepForever, CommentCount = comments.Count });
    });
}
