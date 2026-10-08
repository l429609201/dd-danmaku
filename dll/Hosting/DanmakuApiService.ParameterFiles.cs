namespace DD.Danmaku.Hosting;

using DD.Danmaku.Persistence;
using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>管理员列出已有用户参数文件。</summary>
[Route("/dd-danmaku/api/parameter-files", "GET")]
public sealed class ParameterFilesRequest { }
/// <summary>管理员读取、保存或清空指定用户的参数文件。</summary>
[Route("/dd-danmaku/api/parameter-files/{UserId}", "GET,PUT,DELETE")]
public sealed class ParameterFileRequest : IRequiresRequestStream
{
    /// <summary>参数文件所属用户的标识。</summary>
    public string UserId { get; set; } = "";
    /// <summary>保存参数时提交的 JSON 请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>管理员从指定用户复制可共享的参数。</summary>
[Route("/dd-danmaku/api/parameter-files/{UserId}/copy", "POST")]
public sealed class CopyParameterFileRequest : IRequiresRequestStream
{
    /// <summary>源参数文件所属用户的标识。</summary>
    public string UserId { get; set; } = "";
    /// <summary>目标用户及覆盖选项的 JSON 请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

public sealed partial class DanmakuApiService
{
    private sealed class FileEditBody
    {
        public ParameterEntry[] Parameters { get; set; } = [];
        public string[] ClearSecrets { get; set; } = [];
        public string Namespace { get; set; } = "dd-danmaku";
    }
    private sealed class FileCopyBody
    {
        public string TargetUserId { get; set; } = "";
        public bool Overwrite { get; set; }
    }

    /// <summary>列出已有参数文件及其更新时间。</summary>
    public Task<object> Get(ParameterFilesRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var files = plugin.Parameters.ExistingUsers().Select(id =>
        {
            var current = plugin.Parameters.PathFor(id);
            var path = File.Exists(current) ? current : plugin.Parameters.LegacyPaths(id).FirstOrDefault(File.Exists);
            var info = path is null ? null : new FileInfo(path);
            return new { UserId = id.ToString("N"), Name = _users.GetUserById(id)?.Name ?? "已删除用户",
                FileName = $"{id:N}.json", Legacy = path != current, Size = info?.Length ?? 0,
                UpdatedAt = info?.LastWriteTimeUtc };
        }).ToArray();
        return Task.FromResult(ApiHttpResult.Success(files));
    });

    /// <summary>读取指定用户参数并保护敏感字段。</summary>
    public Task<object> Get(ParameterFileRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var id = DefaultUserId(request.UserId, false);
        var rows = await plugin.Parameters.StoreFor(id).QueryAsync(null, null, null, Request.CancellationToken);
        // 管理响应统一混淆，播放器本人读取协议不变；空输入仍表示保留。
        return SecretSuccess(rows.Select(x => new { x.Namespace, x.Key, x.Type, x.Description,
            x.Value, Sensitive = ParameterPrivacy.IsSensitive(x.Key), HasValue = !string.IsNullOrEmpty(x.Value) }));
    });

    /// <summary>验证输入并原子更新指定用户参数。</summary>
    public Task<object> Put(ParameterFileRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var id = DefaultUserId(request.UserId, true);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 2 * 1024 * 1024, "application/json");
        var body = ApiHttpResult.Parse<FileEditBody>(bytes);
        if (body.Parameters is null || body.ClearSecrets is null || body.Parameters.Length > 1000
            || string.IsNullOrWhiteSpace(body.Namespace) || body.Namespace.Length > 256)
            throw new ArgumentException("参数数量或命名空间无效");
        foreach (var entry in body.Parameters)
            if (entry is null || string.IsNullOrWhiteSpace(entry.Key) || entry.Key.Length > 512
                || entry.Value is null || entry.Value.Length > 262144 || entry.Type is null || entry.Type.Length > 32
                || entry.Description?.Length > 2048) throw new ArgumentException("参数格式无效");
        if (body.Parameters.Select(x => x.Key).Distinct().Count() != body.Parameters.Length)
            throw new ArgumentException("参数键重复");
        // 校验完成后才进入原子提交，避免部分写入。
        foreach (var entry in body.Parameters) ParameterValueValidator.Validate(entry);
        await plugin.Parameters.StoreFor(id).MutateAsync(rows =>
        {
            foreach (var entry in body.Parameters)
            {
                var existing = rows.FirstOrDefault(x => x.Namespace == body.Namespace && x.Key == entry.Key);
                if (ParameterPrivacy.IsSensitive(entry.Key) && entry.Value.Length == 0
                    && !body.ClearSecrets.Contains(entry.Key)) continue;
                if (existing is null)
                {
                    existing = ParameterPrivacy.Copy(entry);
                    existing.Namespace = body.Namespace;
                    rows.Add(existing);
                }
                existing.Value = body.ClearSecrets.Contains(entry.Key) && ParameterPrivacy.IsSensitive(entry.Key) ? "" : entry.Value;
                existing.Type = entry.Type;
                existing.Description = entry.Description;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            return true;
        }, Request.CancellationToken);
        await MetadataSavedAsync(plugin, id);
        return ApiHttpResult.Success(new { Saved = true });
    });

    /// <summary>清空用户参数并保留阻止旧文件回退的存储屏障。</summary>
    public Task<object> Delete(ParameterFileRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var id = DefaultUserId(request.UserId, false);
        // 空文件作为持久化删除屏障，保留旧文件但永不回退；后续同步可重新写入。
        await plugin.Parameters.StoreFor(id).MutateAsync(rows => { rows.Clear(); return true; }, Request.CancellationToken);
        await MetadataSavedAsync(plugin, id);
        return ApiHttpResult.Success(new { Deleted = true });
    });

    /// <summary>复制可共享参数，跳过不允许复制的敏感字段。</summary>
    public Task<object> Post(CopyParameterFileRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var source = DefaultUserId(request.UserId, false);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 4096, "application/json");
        var body = ApiHttpResult.Parse<FileCopyBody>(bytes);
        var target = DefaultUserId(body.TargetUserId, true);
        if (source == target) throw new ArgumentException("不能复制到同一用户");
        var snapshot = await plugin.Parameters.StoreFor(source).QueryAsync(null, null, null, Request.CancellationToken);
        var copies = snapshot.Where(x => ParameterPrivacy.CanCopy(x.Key)).Select(ParameterPrivacy.Copy).ToArray();
        // 源快照与目标提交分别加锁，避免两个反向复制请求互锁。
        await plugin.Parameters.StoreFor(target).MutateAsync(rows =>
        {
            if (rows.Count > 0 && !body.Overwrite)
                throw new ApiAccessException(409, "OVERWRITE_REQUIRED", "目标已有参数，请确认覆盖");
            rows.Clear(); rows.AddRange(copies); return true;
        }, Request.CancellationToken);
        await MetadataSavedAsync(plugin, target);
        return ApiHttpResult.Success(new { Copied = copies.Length, Skipped = snapshot.Count - copies.Length });
    });
}
