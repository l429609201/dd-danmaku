namespace DD.Danmaku.Persistence;

/// <summary>
/// 原 parameters.json 的备份、格式校验和幂等迁移契约。
/// 当前格式已与原插件一致，因此首版不转换字段，只做安全检查。
/// </summary>
public interface IParameterMigration
{
    /// <summary>检查旧参数文件是否可迁移。</summary>
    Task<ParameterMigrationResult> InspectAsync(CancellationToken cancellationToken);
    /// <summary>备份迁移前的参数文件。</summary>
    Task<ParameterMigrationResult> BackupAsync(CancellationToken cancellationToken);
    /// <summary>从指定备份恢复参数文件。</summary>
    Task<ParameterMigrationResult> RestoreAsync(string backupPath, CancellationToken cancellationToken);
}

/// <summary>参数迁移操作的结果及备份位置。</summary>
/// <param name="Success">操作是否成功。</param>
/// <param name="FilePath">目标参数文件路径。</param>
/// <param name="ParameterCount">检查或迁移的参数数量。</param>
/// <param name="Message">操作说明或失败原因。</param>
/// <param name="BackupPath">生成或使用的备份路径。</param>
public sealed record ParameterMigrationResult(
    bool Success,
    string? FilePath,
    int ParameterCount,
    string? Message,
    string? BackupPath);
