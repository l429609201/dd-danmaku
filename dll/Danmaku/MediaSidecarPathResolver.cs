namespace DD.Danmaku.Danmaku;

/// <summary>只接受宿主已授权解析的实际本地播放文件；不能使用客户端路径或 STRM 远程 URL。</summary>
public sealed class MediaSidecarPathResolver
{
    private readonly Func<string, CancellationToken, Task<string?>> _resolvePlaybackFile;
    private readonly Func<PluginConfiguration> _configuration;
    /// <summary>绑定已授权媒体文件解析器与插件配置。</summary>
    public MediaSidecarPathResolver(Func<string, CancellationToken, Task<string?>> resolvePlaybackFile,
        Func<PluginConfiguration> configuration)
        => (_resolvePlaybackFile, _configuration) = (resolvePlaybackFile, configuration);

    /// <summary>来源标识为空时使用媒体固定同名 XML；非空时使用媒体名_来源.xml。</summary>
    public async Task<string?> ResolveAsync(string itemId, CancellationToken token, string? source = null)
    {
        if (!_configuration().FilePersistenceEnabled) return null;
        if (string.IsNullOrWhiteSpace(itemId) || itemId.Length > 256 || itemId.Any(char.IsControl))
            throw new ArgumentException("媒体标识无效", nameof(itemId));
        var mediaPath = await _resolvePlaybackFile(itemId, token);
        // 本地视频和 STRM 均使用自身同目录旁车；绝不使用 STRM 正文中的远程地址。
        if (string.IsNullOrWhiteSpace(mediaPath) || !Path.IsPathFullyQualified(mediaPath)
            || !File.Exists(mediaPath))
            return null;
        var fullPath = Path.GetFullPath(mediaPath);
        if ((File.GetAttributes(fullPath) & FileAttributes.ReparsePoint) != 0) return null;
        for (var directory = Directory.GetParent(fullPath); directory is not null; directory = directory.Parent)
            if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) return null;
        var target = Path.ChangeExtension(fullPath, ".xml");
        if (string.IsNullOrWhiteSpace(source)) return target;
        // 拒绝非法字符而不是删除，避免不同来源被静默映射到同一文件；跨平台采用相同限制。
        var safeSource = source.Trim();
        if (safeSource.Length is 0 or > 64 || safeSource.Any(c => char.IsControl(c)
            || "<>:\"/\\|?*".Contains(c) || Path.GetInvalidFileNameChars().Contains(c)))
            throw new ArgumentException("弹幕来源标识无效", nameof(source));
        return Path.Combine(Path.GetDirectoryName(target)!,
            Path.GetFileNameWithoutExtension(target) + "_" + safeSource + ".xml");
    }
}
