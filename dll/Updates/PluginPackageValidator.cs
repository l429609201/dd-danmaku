namespace DD.Danmaku.Updates;

using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;

/// <summary>只解析 PE 元数据，不把下载的程序集加载到宿主进程。</summary>
internal static class PluginPackageValidator
{
    internal static void Validate(string path, GitHubReleaseClient.Release release)
    {
        using var file = File.OpenRead(path);
        // GitHub 提供摘要时必须匹配；没有摘要时依赖固定 HTTPS 发布源，不宣称签名验证。
        if (!string.IsNullOrEmpty(release.Digest))
        {
            if (!release.Digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase)
                || !string.Equals(Convert.ToHexString(SHA256.HashData(file)), release.Digest[7..],
                    StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("DLL SHA-256 摘要不匹配。");
            file.Position = 0;
        }
        using var pe = new PEReader(file);
        if (!pe.HasMetadata) throw new InvalidDataException("更新文件不是有效托管程序集。");
        var metadata = pe.GetMetadataReader();
        if (!metadata.IsAssembly) throw new InvalidDataException("更新文件不是程序集。");
        var assembly = metadata.GetAssemblyDefinition();
        if (metadata.GetString(assembly.Name) != "DD.Danmaku"
            || GitHubReleaseClient.Normalize(assembly.Version) != release.Version)
            throw new InvalidDataException("DLL 名称或程序集版本与发布不符。");
        var directory = pe.PEHeaders.CorHeader?.ResourcesDirectory
            ?? throw new InvalidDataException("DLL 缺少资源目录。");
        var block = pe.GetSectionData(directory.RelativeVirtualAddress);
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var handle in metadata.ManifestResources)
        {
            var resource = metadata.GetManifestResource(handle);
            if (!resource.Implementation.IsNil) continue;
            if (resource.Offset < 0 || resource.Offset > directory.Size - 4)
                throw new InvalidDataException("DLL 资源偏移无效。");
            var reader = block.GetReader(checked((int)resource.Offset), 4);
            var length = reader.ReadInt32();
            if (length <= 0 || (long)length + resource.Offset + 4 > directory.Size
                || (long)length + resource.Offset + 4 > block.Length)
                throw new InvalidDataException("DLL 内嵌资源为空或损坏。");
            names.Add(metadata.GetString(resource.Name));
        }
        const string prefix = "DD.Danmaku.Resources/";
        if (!names.Contains(prefix + "ede.js") || !names.Contains(prefix + "Admin/index.html")
            || !names.Any(n => n.StartsWith(prefix + "Admin/assets/", StringComparison.Ordinal)
                && n.EndsWith(".js", StringComparison.Ordinal))
            || !names.Any(n => n.StartsWith(prefix + "Admin/assets/", StringComparison.Ordinal)
                && n.EndsWith(".css", StringComparison.Ordinal)))
            throw new InvalidDataException("DLL 缺少管理页面、样式、脚本或 ede.js，拒绝更新。");
    }
}
