namespace DD.Danmaku.Hosting;

public sealed partial class DanmakuApiService
{
    /// <summary>逐项执行管理员明确选择的记录操作，失败不回滚其他项。</summary>
    public Task<object> Post(BatchRecordsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        if (request.RecordIds is null || request.RecordIds.Count is < 1 or > 100
            || request.RecordIds.Any(id => string.IsNullOrWhiteSpace(id) || id.Length > 160)
            || request.Action is not ("verify" or "normalize" or "remove" or "delete"))
            throw new ArgumentException("每批需提供 1–100 个有效记录标识及支持的操作");
        var results = new List<object>();
        var succeeded = 0;
        var failed = 0;
        var skipped = 0;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var id in request.RecordIds)
        {
            Request.CancellationToken.ThrowIfCancellationRequested();
            if (!seen.Add(id))
            {
                skipped++;
                results.Add(new { RecordId = id, Status = "skipped", Message = "重复标识已跳过" });
                continue;
            }
            try
            {
                // 每项重新检查策略；服务层每项独立持锁并重新解析已授权媒体路径。
                EmbyAccessControl.RequireAdministrator(user);
                if (request.Action is "verify" or "normalize") RequireRecordRead(user, plugin);
                if (request.Action is "normalize" or "delete"
                    && (!plugin.Configuration.FilePersistenceEnabled || !plugin.Configuration.FilePersistenceWriteEnabled))
                    throw new ApiAccessException(409, "XML_WRITE_DISABLED", "服务器 XML 写入未启用");
                var detail = await host.Playback.ManageRecordAsync(id, request.Action,
                    itemId => _access.RequireVideo(user, itemId), Request.CancellationToken);
                succeeded++;
                results.Add(new { RecordId = id, Status = "succeeded", Message = "操作完成", Detail = detail });
            }
            catch (OperationCanceledException) { throw; }
            catch (ApiAccessException error)
            {
                failed++;
                results.Add(new { RecordId = id, Status = "failed", Message = error.Message });
            }
            catch (Exception)
            {
                // 不向管理响应泄漏底层文件路径；不将部分写入失败包装成成功。
                failed++;
                results.Add(new { RecordId = id, Status = "failed", Message = "操作失败，请刷新校验状态后重试" });
            }
        }
        return ApiHttpResult.Success(new { OperationId = Guid.NewGuid().ToString("N"),
            Total = request.RecordIds.Count, Succeeded = succeeded, Failed = failed, Skipped = skipped, Results = results });
    });
}
