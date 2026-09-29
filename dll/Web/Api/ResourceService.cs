namespace DD.Danmaku.Web.Api;

/// <summary>
/// DLL 自有资源服务。只允许访问白名单目录，避免把物理路径暴露给 HTTP 层。
/// </summary>
public sealed class ResourceService : IResourceService
{
    private readonly string? _rootPath;

    // 默认读取随 DLL 发布的资源，不要求额外部署 Resources 目录。
    /// <summary>仅从 DLL 内嵌资源中读取管理页面及脚本。</summary>
    public ResourceService() { }

    // 保留显式目录入口，兼容原有独立使用方式。
    /// <summary>设置内嵌资源缺失时的受限磁盘回退目录。</summary>
    public ResourceService(string rootPath)
    {
        _rootPath = Path.GetFullPath(rootPath);
    }

    /// <summary>仅打开白名单内的内嵌或回退资源。</summary>
    public Task<Stream?> OpenAsync(string resourcePath, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        // 统一路径分隔符，资源清单名称在所有平台保持一致。
        var relative = resourcePath.Replace((char)92, '/').TrimStart('/');
        if (relative.Contains("..", StringComparison.Ordinal)
            || !(relative == "Resources/ede.js"
                || relative.StartsWith("Resources/Admin/", StringComparison.Ordinal)))
            return Task.FromResult<Stream?>(null);
        // 优先使用当前程序集资源，避免升级后误读旧版本的磁盘副本。
        var embedded = typeof(ResourceService).Assembly
            .GetManifestResourceStream("DD.Danmaku." + relative);
        if (embedded is not null) return Task.FromResult<Stream?>(embedded);
        if (_rootPath is null) return Task.FromResult<Stream?>(null);
        var fullPath = ResolvePath(relative);
        if (fullPath is null || !File.Exists(fullPath)) return Task.FromResult<Stream?>(null);
        Stream stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, useAsync: true);
        return Task.FromResult<Stream?>(stream);
    }

    /// <summary>根据白名单资源的扩展名返回 MIME 类型。</summary>
    public string GetContentType(string resourcePath)
    {
        var extension = Path.GetExtension(resourcePath).ToLowerInvariant();
        return extension switch
        {
            ".js" => "application/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".html" => "text/html; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".png" => "image/png",
            ".woff2" => "font/woff2",
            _ => "application/octet-stream"
        };
    }

    private string? ResolvePath(string resourcePath)
    {
        // 未配置磁盘回退目录时，只使用程序集内嵌资源。
        if (_rootPath is null) return null;
        var relative = resourcePath.Replace('\\', '/').TrimStart('/');
        if (relative.Contains("..", StringComparison.Ordinal) ||
            !relative.StartsWith("Resources/", StringComparison.OrdinalIgnoreCase)) return null;
        var fullPath = Path.GetFullPath(Path.Combine(_rootPath, relative["Resources/".Length..]));
        return fullPath.StartsWith(_rootPath + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            ? fullPath
            : null;
    }
}
