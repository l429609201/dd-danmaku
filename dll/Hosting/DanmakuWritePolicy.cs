namespace DD.Danmaku.Hosting;

using MediaBrowser.Controller.Entities;

/// <summary>集中计算操作授权；媒体权限与写入提交前复查仍由调用入口负责。</summary>
internal static class DanmakuWritePolicy
{
    internal enum Operation { Selection, CreateShared, RefreshShared, ReplaceShared, UploadShared }

    internal static bool Can(User user, PluginConfiguration config, Operation operation)
    {
        // 未知操作、停用身份和文件总开关都不能被管理员身份绕过。
        if (!Enum.IsDefined(typeof(Operation), operation) || user.Policy is null
            || user.Policy.IsDisabled || user.IsLockedOut || !config.FilePersistenceEnabled
            || !config.FilePersistenceWriteEnabled) return false;
        if (user.Policy.IsAdministrator) return true;
        var allowed = operation switch
        {
            Operation.Selection => config.DanmakuSelectionUserIds,
            Operation.CreateShared => config.DanmakuCreateSharedUserIds,
            Operation.RefreshShared => config.DanmakuRefreshSharedUserIds,
            Operation.ReplaceShared => config.DanmakuReplaceSharedUserIds,
            Operation.UploadShared => config.DanmakuUploadSharedUserIds,
            _ => []
        };
        return (allowed ?? []).Any(value => Guid.TryParse(value, out var id)
            && id != Guid.Empty && id == user.Id);
    }

    internal static void Require(User user, PluginConfiguration config, Operation operation)
    {
        if (!Can(user, config, operation))
            throw new ApiAccessException(403, "DANMAKU_WRITE_FORBIDDEN", "当前用户未获此弹幕操作授权或写入已关闭");
    }
}
