namespace DD.Danmaku.Danmaku;

using System.Security.Cryptography;
using System.Text.Json;

/// <summary>只访问专用缓存目录内的散列文件；引用保护和容量淘汰由上层同一协调锁控制。</summary>
internal sealed class SelectionBodyStore(string directory)
{
    private readonly string _directory = Path.GetFullPath(directory);

    internal static string Key(SelectionContentIdentity identity)
        => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(identity)));

    // 先序列化得到准确大小，再由协调层批准容量；正文版本独立，索引提交失败不破坏旧正文。
    internal static async Task<byte[]> SerializeAsync(SelectionContentIdentity identity,
        IReadOnlyList<DanmakuComment> comments, DateTimeOffset fetchedAt, CancellationToken token)
    {
        if (comments.Count > DanmakuXml.MaxComments) throw new ArgumentException("临时弹幕条数超过限制");
        await using var output = new MemoryStream();
        await DanmakuXml.WriteAsync(output, comments, token, fetchedAt, new DanmakuXmlMetadata
        {
            EmbyItemId = identity.ItemId, SourceId = identity.SourceId,
            SourceEpisodeId = identity.SourceEpisodeId, FetchedAt = fetchedAt, WriteMethod = "temporary"
        });
        if (output.Length > DanmakuXml.MaxBytes) throw new IOException("临时正文超过容量限制");
        return output.ToArray();
    }

    internal async Task WriteAsync(string key, byte[] bytes, Action authorize, CancellationToken token)
    {
        if (bytes.Length > DanmakuXml.MaxBytes) throw new IOException("临时正文超过容量限制");
        var path = RequirePath(key);
        Directory.CreateDirectory(_directory);
        var temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            await using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                await output.WriteAsync(bytes, token);
                await output.FlushAsync(token);
                output.Flush(true);
            }
            token.ThrowIfCancellationRequested();
            authorize();
            RequirePath(key);
            // 版本键不可覆盖，避免正文已更新但索引仍描述旧版本。
            File.Move(temp, path, false);
        }
        finally
        {
            try { File.Delete(temp); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    internal async Task<IReadOnlyList<DanmakuComment>?> ReadAsync(string key, CancellationToken token)
    {
        var path = RequirePath(key);
        try
        {
            await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (input.Length > DanmakuXml.MaxBytes) throw new IOException("临时正文超过容量限制");
            return await DanmakuXml.ReadAsync(input, token);
        }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }

    internal void Delete(string key)
    {
        // 不接受外部路径、通配符或索引中声称的文件位置。
        File.Delete(RequirePath(key));
    }

    /// <summary>只枚举本插件生成的正文与暂存文件，不递归目录，不跟随链接。</summary>
    internal IReadOnlyList<(string Path, string? Key, long Bytes)> Inventory(CancellationToken token)
    {
        RequirePath(new string('0', 64));
        var result = new List<(string Path, string? Key, long Bytes)>();
        if (!Directory.Exists(_directory)) return result;
        foreach (var path in Directory.EnumerateFiles(_directory))
        {
            token.ThrowIfCancellationRequested();
            var name = Path.GetFileName(path);
            var body = name.Length == 68 && name.EndsWith(".xml", StringComparison.Ordinal);
            // .xml.tmp- 共九个字符，随后为32位暂存标识。
            var temp = name.Length == 105 && name.Substring(64, 9) == ".xml.tmp-"
                && name.Substring(73).All(char.IsAsciiHexDigit);
            if ((!body && !temp) || !name.Take(64).All(char.IsAsciiHexDigit)) continue;
            var info = new FileInfo(path);
            if (info.LinkTarget is not null || (info.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("缓存正文不允许使用链接");
            result.Add((path, body ? name.Substring(0, 64).ToUpperInvariant() : null, info.Length));
        }
        return result;
    }

    // 调用方必须持有选择协调锁，避免回收尚未提交索引的新正文。
    internal void ReclaimOrphans(IReadOnlySet<string> referenced, CancellationToken token)
    {
        foreach (var file in Inventory(token))
        {
            token.ThrowIfCancellationRequested();
            if (file.Key is not null && referenced.Contains(file.Key)) continue;
            RequirePath(file.Key ?? new string('0', 64));
            var info = new FileInfo(file.Path);
            if (info.LinkTarget is not null || info.Exists && (info.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("缓存正文不允许使用链接");
            File.Delete(file.Path);
        }
    }

    private string RequirePath(string key)
    {
        if (key.Length != 64 || key.Any(c => !char.IsAsciiHexDigit(c)))
            throw new ArgumentException("缓存键无效");
        var path = Path.Combine(_directory, key.ToUpperInvariant() + ".xml");
        // 拒绝链接目录和文件，避免缓存清理触及媒体旁车或其他目录。
        for (var parent = new DirectoryInfo(_directory); parent is not null; parent = parent.Parent)
            if (parent.Exists && (parent.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new IOException("缓存目录不允许使用链接");
        var info = new FileInfo(path);
        if (info.LinkTarget is not null || info.Exists && (info.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new IOException("缓存正文不允许使用链接");
        return path;
    }
}
