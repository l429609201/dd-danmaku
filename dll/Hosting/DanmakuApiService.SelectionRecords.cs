namespace DD.Danmaku.Hosting;

using MediaBrowser.Model.Services;

/// <summary>管理员分页查询用户选择，允许按保留状态筛选。</summary>
[Route("/dd-danmaku/api/selections", "GET")]
public sealed class SelectionRecordsRequest
{
    /// <summary>页码。</summary>
    public int Page { get; set; } = 1;
    /// <summary>每页条数。</summary>
    public int PageSize { get; set; } = 20;
    /// <summary>all、temporary、forever、expired。</summary>
    public string Retention { get; set; } = "all";
}

/// <summary>管理员批量保留操作。</summary>
[Route("/dd-danmaku/api/selections/retention", "POST")]
public sealed class SelectionRetentionRequest : IRequiresRequestStream
{
    /// <summary>受限请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>选择版本快照，禁止盲目更新变化后的记录。</summary>
public sealed record SelectionRetentionTarget(string SelectionId, long Revision);
/// <summary>仅批量修改选中引用的保留状态。</summary>
public sealed record SelectionRetentionDto(bool KeepForever, SelectionRetentionTarget[] Items);

public sealed partial class DanmakuApiService
{
    /// <summary>可见性检查后分页，不暴露无权访问媒体的其他用户选择。</summary>
    public Task<object> Get(SelectionRecordsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        if (request.Page < 1 || request.PageSize is < 1 or > 100
            || request.Retention is not ("all" or "temporary" or "forever" or "expired"))
            throw new ArgumentException("选择记录分页或筛选无效");
        var now = DateTimeOffset.UtcNow;
        var rows = new List<object>();
        foreach (var row in (await host.Selections.ListAsync(Request.CancellationToken)).OrderByDescending(x => x.SelectedAt))
        {
            if (request.Retention == "forever" && !row.KeepForever
                || request.Retention == "temporary" && (row.KeepForever || !row.IsActive(now))
                || request.Retention == "expired" && row.IsActive(now)) continue;
            try { _access.RequireVideo(user, row.Content.ItemId); }
            catch (ApiAccessException) { continue; }
            rows.Add(new { row.SelectionId, row.UserId, row.Content.ItemId, row.Content.SourceId,
                row.Content.SourceEpisodeId, row.SelectedAt, row.ExpiresAt, row.KeepForever, row.Revision,
                Expired = !row.IsActive(now), StorageLocation = "temporary" });
        }
        var skip = Math.Min((long)(request.Page - 1) * request.PageSize, rows.Count);
        return ApiHttpResult.Success(new { Total = rows.Count, Items = rows.Skip((int)skip).Take(request.PageSize).ToArray() });
    });

    /// <summary>逐项鉴权及版本校验，单项失败不回滚其他已完成项。</summary>
    public Task<object> Post(SelectionRetentionRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 65536, "application/json");
        var input = ApiHttpResult.Parse<SelectionRetentionDto>(bytes);
        if (input.Items is null || input.Items.Length is < 1 or > 100
            || input.Items.Any(x => x is null || !Guid.TryParseExact(x.SelectionId, "N", out _) || x.Revision < 1)
            || input.Items.Select(x => x.SelectionId).Distinct().Count() != input.Items.Length)
            throw new ArgumentException("批量选择目标无效或超过100项");
        var rows = (await host.Selections.ListAsync(Request.CancellationToken)).ToDictionary(x => x.SelectionId);
        var results = new List<object>();
        foreach (var target in input.Items)
        {
            Request.CancellationToken.ThrowIfCancellationRequested();
            try
            {
                if (!rows.TryGetValue(target.SelectionId, out var row)) throw new KeyNotFoundException();
                void Authorize()
                {
                    var current = _access.Authenticate(Request);
                    if (current.Id != user.Id) throw new ApiAccessException(403, "USER_CHANGED", "用户身份已变化");
                    EmbyAccessControl.RequireAdministrator(current);
                    _access.RequireVideo(current, row.Content.ItemId);
                    DanmakuWritePolicy.Require(current, plugin.Configuration, DanmakuWritePolicy.Operation.Selection);
                }
                await host.Selections.SetRetentionAsync(target.SelectionId, target.Revision, input.KeepForever,
                    user.Id.ToString("N"), Authorize, Request.CancellationToken);
                results.Add(new { target.SelectionId, Success = true, Code = "UPDATED" });
            }
            catch (Exception error) when (error is ApiAccessException or KeyNotFoundException or InvalidOperationException
                or IOException or UnauthorizedAccessException)
            {
                results.Add(new { target.SelectionId, Success = false, Code = error is ApiAccessException access
                    ? access.Code : error is InvalidOperationException ? "REVISION_CONFLICT" : "UPDATE_FAILED" });
            }
        }
        return ApiHttpResult.Success(new { Results = results });
    });
}
