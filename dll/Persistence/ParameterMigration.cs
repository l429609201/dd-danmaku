namespace DD.Danmaku.Persistence;

/// <summary>
/// 原 parameters.json 的备份、格式校验和幂等迁移契约。
/// 当前格式已与原插件一致，因此首版不转换字段，只做安全检查。
/// </summary>
public interface IParameterMigration
{
    Task<ParameterMigrationResult> InspectAsync(CancellationToken cancellationToken);
    Task<ParameterMigrationResult> BackupAsync(CancellationToken cancellationToken);
    Task<ParameterMigrationResult> RestoreAsync(string backupPath, CancellationToken cancellationToken);
}

public sealed record ParameterMigrationResult(
    bool Success,
    string? FilePath,
    int ParameterCount,
    string? Message,
    string? BackupPath);
