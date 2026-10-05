namespace DD.Danmaku.Hosting;

using MediaBrowser.Controller.Entities;

/// <summary>集中计算操作授权；媒体权限与写入提交前复查仍由调用入口负责。</summary>
internal static class DanmakuWritePolicy
{
    internal enum Operation { Selection, CreateShared, RefreshShared, ReplaceShared, UploadShared }

    internal static string? AutoSaveBlockReason(User user, PluginConfiguration config)
    {
        // 阻断码只描述安全边界，不暴露用户清单或管理员配置详情。
        if (!config.FilePersistenceEnabled) return "FILE_PERSISTENCE_DISABLED";
        if (!config.FilePersistenceWriteEnabled) return "XML_WRITE_DISABLED";
        if (!Can(user, config, Operation.UploadShared) || !Can(user, config, Operation.CreateShared))
            return "WRITE_NOT_AUTHORIZED";
        if (!config.AutoSaveDanmaku) return "AUTO_SAVE_DISABLED";
        return null;
    }

    internal static bool Can(User user, PluginConfiguration config, Operation operation)
    {
        // 未知操作、停用身份和文件总开关都不能被管理员身份绕过。
        if (!Enum.IsDefined(typeof(Operation), operation) || user.Policy is null
            || user.Policy.IsDisabled || user.IsLockedOut || !config.FilePersistenceEnabled
            || !config.FilePersistenceWriteEnabled) return false;
        // 选择仅影响本人缓存，不受 XML 保存身份开关或普通用户白名单限制。
        if (operation == Operation.Selection) return true;

        // 管理员只由专属开关授权，不能借普通用户白名单绕过关闭状态。
        var canSave = user.Policy.IsAdministrator
            ? config.XmlAdministratorSaveEnabled
            : SaveUserIds(config).Any(value => Guid.TryParse(value, out var id)
                && id != Guid.Empty && id == user.Id);
        if (!canSave) return false;

        // 刷新与替换都会覆盖已有 XML；自动保存创建缺失文件不受此开关影响。
        return operation is not (Operation.RefreshShared or Operation.ReplaceShared)
            || config.XmlOverwriteEnabled;
    }

    internal static string[] SaveUserIds(PluginConfiguration config)
    {
        // 显式空名单即撤权；仅未配置新字段时兼容旧创建与上传权限的安全交集。
        if (config.XmlSaveUserIds is not null) return config.XmlSaveUserIds;
        return NormalizeUserIds(config.DanmakuCreateSharedUserIds)
            .Intersect(NormalizeUserIds(config.DanmakuUploadSharedUserIds))
            .Distinct()
            .Select(id => id.ToString("N"))
            .ToArray();

        static IEnumerable<Guid> NormalizeUserIds(string[]? values) => (values ?? [])
            .Select(value => Guid.TryParse(value, out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty);
    }

    internal static void Require(User user, PluginConfiguration config, Operation operation)
    {
        if (!Can(user, config, operation))
            throw new ApiAccessException(403, "DANMAKU_WRITE_FORBIDDEN", "当前用户未获此弹幕操作授权或写入已关闭");
    }
}
