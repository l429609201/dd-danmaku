namespace DD.Danmaku.Danmaku;

/// <summary>服务端媒体库路径解析与独立弹幕文件读写的门面。</summary>
public sealed class DanmakuStorageService
{
    private readonly MediaSidecarPathResolver _paths;
    private readonly IDanmakuFileService _files;
    public DanmakuStorageService(MediaSidecarPathResolver paths, IDanmakuFileService files)
        => (_paths, _files) = (paths, files);

    public async Task<IReadOnlyList<DanmakuComment>> ReadForItemAsync(string itemId, CancellationToken token)
    {
        var path = await _paths.ResolveAsync(itemId, token);
        return path is null ? [] : await _files.ReadAsync(path, token);
    }

    public async Task SaveForItemAsync(string itemId, IReadOnlyList<DanmakuComment> comments,
        CancellationToken token)
    {
        var path = await _paths.ResolveAsync(itemId, token);
        if (path is null) throw new InvalidOperationException("旁车保存未启用，或媒体没有可写的本地播放文件");
        ValidateComments(comments);
        await _files.SaveAsync(path, comments, token);
    }

    public async Task DeleteForItemAsync(string itemId, CancellationToken token)
    {
        var path = await _paths.ResolveAsync(itemId, token);
        if (path is not null) await _files.DeleteAsync(path, token);
    }

    private static void ValidateComments(IReadOnlyList<DanmakuComment> comments)
    {
        ArgumentNullException.ThrowIfNull(comments);
        if (comments.Count > DanmakuXml.MaxComments) throw new ArgumentOutOfRangeException(nameof(comments));
        foreach (var comment in comments) DanmakuXml.Validate(comment);
    }
}
