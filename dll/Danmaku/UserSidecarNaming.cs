namespace DD.Danmaku.Danmaku;

using System.Text;

/// <summary>个人旁车命名：身份只接受宿主认证结果，不接受客户端文件名。</summary>
internal static class UserSidecarNaming
{
    internal static string CreatePath(string sharedPath, Guid userId, string userName)
    {
        if (userId == Guid.Empty) throw new ArgumentException("用户标识无效");
        if (!Path.IsPathFullyQualified(sharedPath)
            || !string.Equals(Path.GetExtension(sharedPath), ".xml", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("个人旁车需要已验证的共享 XML 路径");
        // 名称仅供辨识；完整稳定 ID 防止同名用户冲突，不使用名称作为权限依据。
        var label = new string((userName ?? "").Normalize(NormalizationForm.FormC)
            .Where(c => !char.IsControl(c) && !"<>:\"/\\|?*".Contains(c)
                && !Path.GetInvalidFileNameChars().Contains(c)).Take(32).ToArray()).Trim().Trim('.');
        if (label.Length == 0) label = "user";
        return Path.Combine(Path.GetDirectoryName(sharedPath)!,
            Path.GetFileNameWithoutExtension(sharedPath) + "_user_" + label + "_" + userId.ToString("N") + ".xml");
    }

    internal static bool IsOwnedFileName(string sharedPath, string candidatePath, Guid userId)
    {
        if (userId == Guid.Empty) return false;
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        // 用父目录、媒体前缀与完整身份后缀联合识别，兼容用户改名后的旧旁车。
        return string.Equals(Path.GetDirectoryName(sharedPath), Path.GetDirectoryName(candidatePath), comparison)
            && Path.GetFileName(candidatePath).StartsWith(Path.GetFileNameWithoutExtension(sharedPath) + "_user_", comparison)
            && Path.GetFileName(candidatePath).EndsWith("_" + userId.ToString("N") + ".xml", comparison);
    }
}
