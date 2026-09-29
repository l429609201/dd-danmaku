namespace DD.Danmaku.Danmaku;

/// <summary>独立弹幕 XML 文件读写；路径必须由宿主解析并授权，不接受 HTTP 客户端路径。</summary>
public interface IDanmakuFileService
{
    /// <summary>读取已授权的 XML 文件；文件不存在时返回空集合。</summary>
    Task<IReadOnlyList<DanmakuComment>> ReadAsync(string filePath, CancellationToken cancellationToken);
    /// <summary>验证弹幕后通过同目录临时文件替换目标 XML。</summary>
    Task SaveAsync(string filePath, IReadOnlyList<DanmakuComment> comments, CancellationToken cancellationToken);
    /// <summary>删除已授权的 XML 文件。</summary>
    Task DeleteAsync(string filePath, CancellationToken cancellationToken);
}

/// <summary>执行限长 XML 读写及文件链接检查，不接受客户端任意路径。</summary>
public sealed class DanmakuFileService : IDanmakuFileService
{
    /// <inheritdoc/>
    public async Task<IReadOnlyList<DanmakuComment>> ReadAsync(string filePath, CancellationToken cancellationToken)
    {
        ValidatePath(filePath);
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            await using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read,
                8192, FileOptions.Asynchronous | FileOptions.SequentialScan);
            if (stream.Length > DanmakuXml.MaxBytes) throw new InvalidDataException("弹幕 XML 超过 64 MiB 限制");
            return await DanmakuXml.ReadAsync(stream, cancellationToken);
        }
        catch (FileNotFoundException) { return []; }
        catch (DirectoryNotFoundException) { return []; }
        // 本地文件损坏属于服务端存储错误；仅包装读取路径，上传校验仍返回客户端错误。
        catch (System.Xml.XmlException ex) { throw new IOException("服务器弹幕 XML 文件格式无效", ex); }
        catch (InvalidDataException ex) { throw new IOException("服务器弹幕 XML 文件内容无效或超出限制", ex); }
        catch (ArgumentException ex) { throw new IOException("服务器弹幕 XML 文件字段无效", ex); }
    }

    /// <inheritdoc/>
    public Task SaveAsync(string filePath, IReadOnlyList<DanmakuComment> comments,
        CancellationToken cancellationToken) => SaveAsync(filePath, comments, cancellationToken, true);

    /// <summary>创建模式在最终移动时禁止覆盖，避免并发请求覆盖已有弹幕。</summary>
    public async Task SaveAsync(string filePath, IReadOnlyList<DanmakuComment> comments,
        CancellationToken cancellationToken, bool overwrite)
    {
        ValidatePath(filePath);
        ArgumentNullException.ThrowIfNull(comments);
        cancellationToken.ThrowIfCancellationRequested();
        if (comments.Count > DanmakuXml.MaxComments) throw new ArgumentOutOfRangeException(nameof(comments));
        // 快照避免调用者在异步写入期间修改集合；正文错误不能损坏已有文件。
        var snapshot = comments.ToArray();
        foreach (var comment in snapshot) DanmakuXml.Validate(comment);
        var directory = Path.GetDirectoryName(filePath);
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory))
            throw new DirectoryNotFoundException("媒体目录不存在");
        var tempPath = filePath + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            await using (var stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                8192, FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                // 获取时间属于文件级元数据，不混入每条弹幕的发送时间。
                await DanmakuXml.WriteAsync(stream, snapshot, cancellationToken, DateTimeOffset.UtcNow);
                await stream.FlushAsync(cancellationToken);
            }
            cancellationToken.ThrowIfCancellationRequested();
            ValidatePath(filePath);
            File.Move(tempPath, filePath, overwrite);
        }
        finally
        {
            try { File.Delete(tempPath); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    /// <inheritdoc/>
    public Task DeleteAsync(string filePath, CancellationToken cancellationToken)
    {
        ValidatePath(filePath);
        cancellationToken.ThrowIfCancellationRequested();
        File.Delete(filePath);
        return Task.CompletedTask;
    }

    private static void ValidatePath(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath) || !Path.IsPathFullyQualified(filePath)
            || filePath.Any(char.IsControl) || !string.Equals(Path.GetExtension(filePath), ".xml", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("弹幕文件必须为已授权的绝对 XML 路径", nameof(filePath));
        var info = new FileInfo(filePath);
        if (info.LinkTarget is not null || info.Exists && (info.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new UnauthorizedAccessException("不允许通过文件链接访问弹幕");
    }
}
