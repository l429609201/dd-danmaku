namespace DD.Danmaku.Danmaku;

using System.Text.Json;

/// <summary>选择与正文索引统一事务存储；损坏时拒绝覆盖，不当作空缓存恢复。</summary>
internal sealed class DanmakuSelectionStore
{
    internal sealed record Snapshot(int Version, List<UserDanmakuSelection> Selections,
        List<SelectionContentEntry> Contents);
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private const int MaxBytes = 16 * 1024 * 1024;

    internal DanmakuSelectionStore(string directory)
    {
        _path = Path.Combine(Path.GetFullPath(directory), "selection-index.json");
    }

    internal async Task<Snapshot> ReadAsync(CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try { return await ReadUnlockedAsync(token); }
        finally { _gate.Release(); }
    }

    internal async Task MutateAsync(Action<Snapshot> mutation, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            var snapshot = await ReadUnlockedAsync(token);
            mutation(snapshot);
            Validate(snapshot);
            var bytes = JsonSerializer.SerializeToUtf8Bytes(snapshot);
            if (bytes.Length > MaxBytes) throw new IOException("选择索引超过容量限制");
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var temp = _path + ".tmp-" + Guid.NewGuid().ToString("N");
            try
            {
                await using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    await output.WriteAsync(bytes, token);
                    await output.FlushAsync(token);
                    output.Flush(true);
                }
                token.ThrowIfCancellationRequested();
                File.Move(temp, _path, true);
            }
            finally
            {
                try { File.Delete(temp); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
        finally { _gate.Release(); }
    }

    private async Task<Snapshot> ReadUnlockedAsync(CancellationToken token)
    {
        try
        {
            await using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length > MaxBytes) throw new IOException("选择索引超过容量限制");
            var snapshot = await JsonSerializer.DeserializeAsync<Snapshot>(stream, cancellationToken: token);
            Validate(snapshot);
            return snapshot!;
        }
        catch (FileNotFoundException) { return EmptyOnlyWithoutBodies(); }
        catch (DirectoryNotFoundException) { return EmptyOnlyWithoutBodies(); }
        catch (JsonException error) { throw new IOException("选择索引格式损坏", error); }
    }

    private Snapshot EmptyOnlyWithoutBodies()
    {
        // 正文仍存在却丢失索引时不能视为首次启动，否则清理会误删长期保留内容。
        var directory = Path.Combine(Path.GetDirectoryName(_path)!, "bodies");
        if (Directory.Exists(directory) && Directory.EnumerateFileSystemEntries(directory).Any())
            throw new IOException("选择索引缺失但正文缓存非空，已停止写入和清理，请恢复索引");
        return new(1, [], []);
    }

    private static void Validate(Snapshot? snapshot)
    {
        if (snapshot is null || snapshot.Version != 1 || snapshot.Selections is null || snapshot.Contents is null
            || snapshot.Selections.Count > 10000 || snapshot.Contents.Count > 10000)
            throw new IOException("选择索引版本或规模无效");
        foreach (var selection in snapshot.Selections)
        {
            if (selection is null || !ValidGuid(selection.SelectionId) || !ValidGuid(selection.UserId)
                || !ValidGuid(selection.UpdatedByUserId) || !ValidIdentity(selection.Content)
                || selection.Revision < 1 || selection.SelectedAt == default
                || (selection.KeepForever ? selection.ExpiresAt is not null : selection.ExpiresAt is null)
                || selection.ExpiresAt == default(DateTimeOffset))
                throw new IOException("用户选择记录无效");
        }
        foreach (var content in snapshot.Contents)
        {
            if (content is null || content.CacheKey is null || content.CacheKey.Length != 64
                || content.CacheKey.Any(ch => !char.IsAsciiHexDigit(ch)) || !ValidIdentity(content.Identity)
                || content.FetchedAt == default || content.RetainUntil < content.FetchedAt
                || content.LastAccessAt == default || content.ByteLength is < 0 or > DanmakuXml.MaxBytes
                || content.CommentCount is < 0 or > DanmakuXml.MaxComments)
                throw new IOException("临时正文索引无效");
        }
        // 选择引用可在正文被清理后存在；禁止重复身份以保证单用户单媒体唯一。
        if (snapshot.Selections.Select(x => x.SelectionId).Distinct(StringComparer.Ordinal).Count() != snapshot.Selections.Count
            || snapshot.Selections.Select(x => (x.UserId, x.Content.ItemId)).Distinct().Count() != snapshot.Selections.Count
            || snapshot.Contents.Select(x => x.CacheKey).Distinct(StringComparer.Ordinal).Count() != snapshot.Contents.Count
            || snapshot.Contents.Select(x => x.Identity).Distinct().Count() != snapshot.Contents.Count)
            throw new IOException("选择索引含重复身份");
    }

    private static bool ValidGuid(string? value) => Guid.TryParseExact(value, "N", out var id) && id != Guid.Empty;
    private static bool ValidIdentity(SelectionContentIdentity? identity) => identity is not null
        && ValidGuid(identity.ItemId) && ValidText(identity.SourceId, 64)
        && ValidText(identity.SourceEpisodeId, 160) && ValidText(identity.UpstreamRevision, 128)
        && identity.ChConvert is >= 0 and <= 2;
    private static bool ValidText(string? value, int limit) => !string.IsNullOrWhiteSpace(value)
        && value.Length <= limit && !value.Any(char.IsControl);
}
