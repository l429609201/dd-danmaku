namespace DD.Danmaku.Persistence;

using System.Collections.Concurrent;
using DD.Danmaku.Web.ParameterPersistence;

/// <summary>按用户共享文件锁；播放器和管理员必须复用同一个存储实例。</summary>
internal sealed class UserParameterServices(string pluginConfigurationsPath, string? dataDirectory = null,
    string? legacyDataDirectory = null)
{
    private readonly ConcurrentDictionary<Guid, Lazy<ParameterFileStore>> _stores = new();
    private string DirectoryPath => dataDirectory ?? Path.Combine(pluginConfigurationsPath, "DD.Danmaku", "Users");
    private static StringComparer PathComparer => OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    // 旧路径由宿主显式传入；枚举和读取复用同一组目录，避免能读但后台找不到。
    private IEnumerable<string> LegacyFlatDirectories => new[]
    {
        legacyDataDirectory, Path.Combine(pluginConfigurationsPath, "ParameterPersistence", "Users")
    }.OfType<string>();
    private IEnumerable<string> LegacyNestedDirectories => new[]
    {
        Path.Combine(pluginConfigurationsPath, "ParameterPersistence"), pluginConfigurationsPath
    };

    internal string PathFor(Guid id) => Path.Combine(DirectoryPath, $"{id:N}.json");
    internal string[] LegacyPaths(Guid id) => LegacyFlatDirectories.Select(path => Path.Combine(path, $"{id:N}.json"))
        .Concat(LegacyNestedDirectories.Select(path => Path.Combine(path, id.ToString("N"), "parameters.json")))
        .Where(path => !PathComparer.Equals(path, PathFor(id))).Distinct(PathComparer).ToArray();

    internal ParameterCompatibilityService ForUser(Guid userId) => new(StoreFor(userId));

    private readonly Lazy<ParameterFileStore> _defaults = new(() => new ParameterFileStore(
        Path.Combine(dataDirectory ?? Path.Combine(pluginConfigurationsPath, "DD.Danmaku", "Users"), "Defaults.json")));
    internal ParameterFileStore Defaults => _defaults.Value;

    // 旧用户文件只作读取回退；默认模板不允许按用户 ID 解析。
    internal Task<bool> InitializeForAsync(Guid id, IReadOnlyList<ParameterEntry> defaults, CancellationToken token)
        => StoreFor(id).InitializeAsync(defaults, token);


    internal ParameterFileStore StoreFor(Guid userId)
    {
        if (userId == Guid.Empty) throw new ArgumentException("缺少认证用户标识");
        var store = _stores.GetOrAdd(userId, id => new Lazy<ParameterFileStore>(() =>
            new ParameterFileStore(PathFor(id), LegacyPaths(id))));
        try { return store.Value; }
        catch
        {
            // 失败只移除当前实例；下次请求可以重新初始化。
            ((ICollection<KeyValuePair<Guid, Lazy<ParameterFileStore>>>)_stores)
                .Remove(new KeyValuePair<Guid, Lazy<ParameterFileStore>>(userId, store));
            throw;
        }
    }

    internal IEnumerable<Guid> ExistingUsers()
    {
        var ids = new HashSet<Guid>();
        foreach (var directory in new[] { DirectoryPath }.Concat(LegacyFlatDirectories).Distinct(PathComparer))
            if (Directory.Exists(directory))
                foreach (var path in Directory.EnumerateFiles(directory, "*.json"))
                    if (Guid.TryParseExact(Path.GetFileNameWithoutExtension(path), "N", out var id) && id != Guid.Empty)
                        ids.Add(id);
        foreach (var legacy in LegacyNestedDirectories)
            if (Directory.Exists(legacy))
                foreach (var path in Directory.EnumerateDirectories(legacy))
                    if (Guid.TryParseExact(Path.GetFileName(path), "N", out var id) && id != Guid.Empty
                        && File.Exists(Path.Combine(path, "parameters.json"))) ids.Add(id);
        return ids;
    }
}
