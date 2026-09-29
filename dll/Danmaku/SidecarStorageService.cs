namespace DD.Danmaku.Danmaku;

/// <summary>记录旁车适配器，统一委托独立 XML 文件方法；解析器须检查开关和媒体授权。</summary>
public sealed class SidecarStorageService : ISidecarStorageService
{
    private readonly Func<string, CancellationToken, Task<string?>> _pathResolver;
    private readonly IDanmakuFileService _files;
    public SidecarStorageService(Func<string, CancellationToken, Task<string?>> pathResolver,
        IDanmakuFileService? files = null)
        => (_pathResolver, _files) = (pathResolver, files ?? new DanmakuFileService());

    public Task<string?> ResolveAuthorizedPathAsync(string itemId, CancellationToken cancellationToken)
        => _pathResolver(itemId, cancellationToken);

    public async Task<IReadOnlyList<DanmakuComment>> ReadAsync(DanmakuRecord record, CancellationToken cancellationToken)
    {
        var path = await ResolveRecordPathAsync(record, cancellationToken);
        return path is null ? [] : await _files.ReadAsync(path, cancellationToken);
    }

    public async Task WriteAtomicallyAsync(DanmakuRecord record, IReadOnlyList<DanmakuComment> comments,
        CancellationToken cancellationToken)
    {
        var path = await ResolveRecordPathAsync(record, cancellationToken);
        if (path is null) throw new InvalidOperationException("本地化关闭或媒体旁车路径不可用");
        await _files.SaveAsync(path, comments, cancellationToken);
    }

    public async Task DeleteAsync(DanmakuRecord record, CancellationToken cancellationToken)
    {
        var path = await ResolveRecordPathAsync(record, cancellationToken);
        if (path is not null) await _files.DeleteAsync(path, cancellationToken);
    }

    public async Task<bool> ValidatePathFingerprintAsync(DanmakuRecord record, CancellationToken cancellationToken)
    {
        var path = await ResolveRecordPathAsync(record, cancellationToken);
        return path is not null && File.Exists(path);
    }

    private async Task<string?> ResolveRecordPathAsync(DanmakuRecord record, CancellationToken token)
    {
        var path = await _pathResolver(record.ItemId, token);
        if (path is null) return null;
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (!Path.IsPathFullyQualified(path) || !Path.IsPathFullyQualified(record.StorageLocation)
            || !string.Equals(Path.GetExtension(path), ".xml", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(Path.GetFullPath(path), Path.GetFullPath(record.StorageLocation), comparison))
            throw new UnauthorizedAccessException("记录路径与媒体库当前 XML 旁车路径不符");
        return path;
    }
}
