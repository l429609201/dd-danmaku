namespace DD.Danmaku.Hosting;

using DD.Danmaku.Danmaku;
using DD.Danmaku.Matching;
using DD.Danmaku.Web.Api;

public sealed partial class DanmakuApiService
{
    /// <summary>验证候选媒体并调用后端匹配服务。</summary>
    public Task<object> Post(ResolveMatchHttpRequest request) => Execute(async (user, plugin, host) =>
    {
        var started = System.Diagnostics.Stopwatch.StartNew();
        _matchLogger.Info("匹配入口 #{0}：接收请求", _matchTrace);
        try
        {
            var body = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request,
                MatchRequestValidator.MaxBodyBytes, "application/json");
            var match = ApiHttpResult.Parse<ResolveMatchRequest>(body);
            _matchLogger.Info("匹配入口 #{0}：请求字节数={1}，候选数={2}",
                _matchTrace, body.Length, match.Candidates?.Count ?? 0);
            // 授权上下文独立于客户端输入；关联号只用于服务端诊断。
            match = match with { AiAuthorized = EmbyAccessControl.CanUseAi(user, plugin.Configuration), TraceId = _matchTrace };
            if (match.Target?.ItemId is { Length: > 0 } itemId) _access.RequireVideo(user, itemId);
            var result = await host.Matches.ResolveAsync(match, Request.CancellationToken);
            // 业务层会把异常转换为结果，因此必须记录结果中的错误码而非只依赖 catch。
            _matchLogger.Info("匹配入口 #{0}：响应关联号={1}，响应状态={2}，错误码={3}，耗时={4}ms",
                _matchTrace, result.Body.TraceId, result.StatusCode, result.Body.ErrorCode ?? "无", started.ElapsedMilliseconds);
            return ApiHttpResult.Json(result.Body, result.StatusCode);
        }
        catch (Exception error)
        {
            // 不记录异常消息或上游正文，避免凭据、路径和提示词泄露。
            var code = error is MatchRequestException matchError ? matchError.ErrorCode : error.GetType().Name;
            _matchLogger.Warn("匹配入口 #{0}：失败或取消，错误={1}，耗时={2}ms", _matchTrace, code, started.ElapsedMilliseconds);
            throw;
        }
    });

    /// <summary>读取已授权媒体的本地弹幕 XML。</summary>
    public Task<object> Get(ReadDanmakuRequest request) => Execute(async (user, plugin, host) =>
    {
        var id = _access.RequireVideo(user, request.ItemId);
        // XML 与 JSON 播放查询共用授权读取编排，保持与保存/删除相同的锁顺序。
        var playback = await host.Playback.QueryAsync(id, Request.CancellationToken, request.Source);
        // 播放查询返回 API DTO；导出 XML 前转换为内部模型，避免跨层传递 DTO。
        var comments = playback.Comments.Select(c => new DanmakuComment(
            c.Text, c.Time, c.Mode, c.Color, c.UserId,
            c.FontSize, c.Timestamp, c.Pool, c.Cid, c.Weight)).ToArray();
        using var stream = new MemoryStream();
        await DanmakuXml.WriteAsync(stream, comments, Request.CancellationToken);
        return new ApiHttpResult(200, stream.ToArray(), "application/xml; charset=utf-8");
    });

    /// <summary>管理员验证并保存媒体旁车弹幕 XML。</summary>
    public Task<object> Put(SaveDanmakuRequest request) => Execute(async (user, plugin, host) =>
    {
        DanmakuWritePolicy.Require(user, plugin.Configuration, DanmakuWritePolicy.Operation.UploadShared);
        var id = _access.RequireVideo(user, request.ItemId);
        await host.RequireLocalFileAsync(id, Request.CancellationToken);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request,
            (int)DanmakuXml.MaxBytes, "application/xml", "text/xml");
        using var stream = new MemoryStream(bytes, writable: false);
        var report = await DanmakuXml.ReadReportAsync(stream, Request.CancellationToken);
        var comments = report.Comments;
        // 上游集 ID 仅在上传来源与目标来源一致时保留；上传身份字段不作为授权依据。
        var sourceMatches = !string.IsNullOrWhiteSpace(request.Source)
            && string.Equals(report.Metadata?.SourceId, request.Source.Trim(), StringComparison.Ordinal);
        var metadata = new DanmakuXmlMetadata
        {
            SourceEpisodeId = sourceMatches ? report.Metadata?.SourceEpisodeId : null,
            SourceAnimeId = sourceMatches ? report.Metadata?.SourceAnimeId : null,
            UpdatedByUserId = user.Id.ToString("N"), WriteMethod = "upload",
            // 上传不是重新抓取，不采用上传文件声称的可信上游配置指纹。
            FetchedAt = report.Metadata?.FetchedAt
        };
        void Authorize(DanmakuWritePolicy.Operation operation)
        {
            var current = _access.Authenticate(Request);
            if (current.Id != user.Id) throw new ApiAccessException(403, "USER_CHANGED", "用户身份已变化");
            _access.RequireVideo(current, id);
            DanmakuWritePolicy.Require(current, plugin.Configuration, operation);
        }
        await host.Playback.SaveUploadAsync(id, request.Source, comments, metadata, request.Overwrite,
            Request.QueryString["ExpectedHash"], Authorize, Request.CancellationToken);
        return ApiHttpResult.Success(new { Saved = true, CommentCount = comments.Count });
    });

    /// <summary>管理员删除已授权媒体的弹幕文件。</summary>
    public Task<object> Delete(DeleteDanmakuRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var id = _access.RequireVideo(user, request.ItemId);
        await host.Playback.DeleteAsync(id, Request.CancellationToken, request.Source);
        return ApiHttpResult.Success(new { Deleted = true });
    });

    /// <summary>查询已授权媒体及来源的播放弹幕。</summary>
    public Task<object> Get(PlaybackHttpRequest request) => Execute(async (user, plugin, host) =>
    {
        var id = _access.RequireVideo(user, request.ItemId);
        // 默认播放先读取本人选择；过期临时正文仅在本次播放尝试刷新。
        return ApiHttpResult.Success(await QueryUserPlaybackAsync(id, request.Source, user, plugin, host));
    });

    /// <summary>管理员查询已管理的弹幕记录。</summary>
    public Task<object> Get(RecordsHttpRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return await ListManagedRecords(user, host, request);
    });
}
