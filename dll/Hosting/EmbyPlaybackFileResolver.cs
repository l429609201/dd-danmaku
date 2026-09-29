namespace DD.Danmaku.Hosting;

using System.Globalization;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.IO;

/// <summary>
/// 只从 Emby 媒体库解析视频文件；此内部适配器不承担 HTTP 身份认证或用户媒体授权。
/// 调用方须先完成权限检查；不得将返回的物理路径直接暴露给客户端。
/// </summary>
internal sealed class EmbyPlaybackFileResolver
{
    private readonly ILibraryManager _libraryManager;
    private readonly IFileSystem _fileSystem;

    internal EmbyPlaybackFileResolver(ILibraryManager libraryManager, IFileSystem fileSystem)
    {
        _libraryManager = libraryManager ?? throw new ArgumentNullException(nameof(libraryManager));
        _fileSystem = fileSystem ?? throw new ArgumentNullException(nameof(fileSystem));
    }

    internal Task<string?> ResolveAsync(string itemId, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(itemId) || itemId.Length > 64 || itemId.Any(char.IsControl))
            throw new ArgumentException("媒体标识无效", nameof(itemId));

        BaseItem? item;
        if (itemId.All(c => c is >= '0' and <= '9')
            && long.TryParse(itemId, NumberStyles.None, CultureInfo.InvariantCulture, out var numericId)
            && numericId > 0)
            item = _libraryManager.GetItemById(numericId);
        else if ((Guid.TryParseExact(itemId, "N", out var guid) || Guid.TryParseExact(itemId, "D", out guid))
            && guid != Guid.Empty)
            item = _libraryManager.GetItemById(guid);
        else
            throw new ArgumentException("媒体标识须为正整数或 GUID", nameof(itemId));

        token.ThrowIfCancellationRequested();
        if (item is not Video video || video.IsFolder || video.IsPlaceHolder)
            return Task.FromResult<string?>(null);

        // 只以条目本身的本地文件为锚点，不读取 STRM 正文或解析远程播放地址。
        var path = video.Path;
        if (string.IsNullOrWhiteSpace(path) || path.Any(char.IsControl) || !Path.IsPathFullyQualified(path))
            return Task.FromResult<string?>(null);
        var extension = Path.GetExtension(path);
        var isStrm = extension.Equals(".strm", StringComparison.OrdinalIgnoreCase);
        // STRM 可能被宿主标为快捷方式或远程条目，但仍必须通过后续本地文件存在与链接检查。
        if (!isStrm && (video.IsShortcut || video.LocationType != LocationType.FileSystem))
            return Task.FromResult<string?>(null);
        if (string.IsNullOrEmpty(extension) || extension.Equals(".xml", StringComparison.OrdinalIgnoreCase))
            return Task.FromResult<string?>(null);
        var fullPath = Path.GetFullPath(path);
        if (!_fileSystem.FileExists(fullPath)) return Task.FromResult<string?>(null);
        token.ThrowIfCancellationRequested();
        // 后续 MediaSidecarPathResolver 再检查真实文件与父目录的重解析点。
        return Task.FromResult<string?>(fullPath);
    }
}
