namespace DD.Danmaku.Persistence;

using System.Text.Json;

/// <summary>
/// 直接兼容原 ParameterPersistence 的 parameters.json。
/// </summary>
public sealed class ParameterFileStore : IParameterFileStore
{
    private readonly string _filePath;
    private readonly string? _legacyFilePath;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _jsonOptions = new() { PropertyNamingPolicy = null, WriteIndented = true };

    /// <summary>使用新的用户扁平文件，并保留旧目录格式作为只读回退。</summary>
    public ParameterFileStore(string filePath, string? legacyFilePath = null)
    {
        _filePath = filePath;
        _legacyFilePath = legacyFilePath;
        var directory = Path.GetDirectoryName(_filePath);
        if (string.IsNullOrWhiteSpace(directory)) throw new ArgumentException("参数文件路径无效", nameof(filePath));
        Directory.CreateDirectory(directory);
    }

    private readonly string[] _additionalLegacyPaths = [];

    /// <summary>支持依次读取多代旧路径，所有写入始终落到新路径。</summary>
    public ParameterFileStore(string filePath, string[] legacyPaths) : this(filePath)
    {
        _additionalLegacyPaths = legacyPaths;
    }


    /// <summary>按命名空间、键和关键词筛选用户参数。</summary>
    public async Task<IReadOnlyList<ParameterEntry>> QueryAsync(string? nameSpace, string? key, string? keyword, CancellationToken cancellationToken)
    {
        var store = await ReadAsync(cancellationToken);
        IEnumerable<ParameterEntry> result = store.Parameters;
        if (!string.IsNullOrWhiteSpace(nameSpace)) result = result.Where(x => x.Namespace == nameSpace);
        if (!string.IsNullOrWhiteSpace(key)) result = result.Where(x => x.Key == key);
        if (!string.IsNullOrWhiteSpace(keyword)) result = result.Where(x =>
            (x.Namespace?.Contains(keyword, StringComparison.OrdinalIgnoreCase) ?? false) ||
            (x.Key?.Contains(keyword, StringComparison.OrdinalIgnoreCase) ?? false) ||
            (x.Value?.Contains(keyword, StringComparison.OrdinalIgnoreCase) ?? false));
        return result.ToList();
    }

    /// <summary>增加或替换相同命名空间和键的参数。</summary>
    public async Task<ParameterEntry> CreateAsync(ParameterEntry parameter, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var store = await ReadUnlockedAsync(cancellationToken);
            var current = store.Parameters.FirstOrDefault(x => x.Namespace == parameter.Namespace && x.Key == parameter.Key);
            if (current is not null)
            {
                current.Value = parameter.Value;
                current.Type = parameter.Type;
                current.Description = parameter.Description ?? current.Description;
                current.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                parameter.CreatedAt = DateTime.UtcNow;
                parameter.UpdatedAt = parameter.CreatedAt;
                store.Parameters.Add(parameter);
                current = parameter;
            }
            await WriteUnlockedAsync(store, cancellationToken);
            return current;
        }
        finally { _gate.Release(); }
    }

    /// <summary>修改已存在参数的值与描述。</summary>
    public async Task<ParameterEntry?> UpdateAsync(string nameSpace, string key, string value, string? description, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var store = await ReadUnlockedAsync(cancellationToken);
            var current = store.Parameters.FirstOrDefault(x => x.Namespace == nameSpace && x.Key == key);
            if (current is null) return null;
            current.Value = value;
            current.Description = description ?? current.Description;
            current.UpdatedAt = DateTime.UtcNow;
            await WriteUnlockedAsync(store, cancellationToken);
            return current;
        }
        finally { _gate.Release(); }
    }

    /// <summary>删除指定命名空间和键对应的参数。</summary>
    public async Task<bool> DeleteAsync(string nameSpace, string key, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var store = await ReadUnlockedAsync(cancellationToken);
            var removed = store.Parameters.RemoveAll(x => x.Namespace == nameSpace && x.Key == key) > 0;
            if (removed) await WriteUnlockedAsync(store, cancellationToken);
            return removed;
        }
        finally { _gate.Release(); }
    }

    private async Task<ParameterDataStore> ReadAsync(CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try { return await ReadUnlockedAsync(token); }
        finally { _gate.Release(); }
    }


    /// <summary>首次访问时复制默认参数；旧个人字段优先，旧文件不触发浏览器配置覆盖。</summary>
    internal async Task<bool> InitializeAsync(IReadOnlyList<ParameterEntry> defaults, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            if (File.Exists(_filePath)) return false;
            var hadLegacy = new[] { _legacyFilePath }.Concat(_additionalLegacyPaths)
                .Any(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path));
            // 旧参数先读取并复制到新文件；其同名字段优先，默认值只补齐缺项。
            var store = await ReadUnlockedAsync(token);
            var existing = store.Parameters.Select(row => (row.Namespace, row.Key)).ToHashSet();
            foreach (var row in defaults.Where(row => !existing.Contains((row.Namespace, row.Key))))
                store.Parameters.Add(new ParameterEntry
                {
                    Namespace = row.Namespace, Key = row.Key, Value = row.Value,
                    Type = row.Type, Description = row.Description
                });
            // 在同一文件锁中检查并创建，避免两个页面首次访问互相覆盖。
            await WriteUnlockedAsync(store, token);
            return !hadLegacy;
        }
        finally { _gate.Release(); }
    }

    /// <summary>在文件锁内对参数集合执行操作并原子保存。</summary>
    public async Task<T> MutateAsync<T>(Func<List<ParameterEntry>, T> mutation, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            var store = await ReadUnlockedAsync(token);
            var result = mutation(store.Parameters);
            token.ThrowIfCancellationRequested();
            await WriteUnlockedAsync(store, token);
            return result;
        }
        finally { _gate.Release(); }
    }

    /// <summary>完整迁移旧存储：先原子创建新文件，成功后删除已迁移的旧文件。</summary>
    internal async Task<int> ConvertLegacyAsync(CancellationToken token)
    {
        await _gate.WaitAsync(token);
        string? temporary = null;
        try
        {
            if (File.Exists(_filePath))
                throw new ParameterStoreException(409, "NEW_STORE_EXISTS", "新格式文件已存在，不能重复转换或覆盖");
            var legacyPaths = new[] { _legacyFilePath }.Concat(_additionalLegacyPaths)
                .Where(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path))
                .Distinct(OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal).ToArray();
            if (legacyPaths.Length == 0)
                throw new ParameterStoreException(404, "LEGACY_NOT_FOUND", "未找到可转换的旧文件");
            // 不猜测不同版本的优先级，更不能只读取一份却删除全部旧文件。
            if (legacyPaths.Length > 1)
                throw new ParameterStoreException(409, "LEGACY_STORE_CONFLICT", "发现多份旧参数文件，请备份并处理冲突后再迁移");
            var store = await ReadUnlockedAsync(token);
            var bytes = JsonSerializer.SerializeToUtf8Bytes(store, _jsonOptions);
            if (bytes.Length > 16 * 1024 * 1024 || store.Parameters.Count > 10000)
                throw new ParameterStoreException(413, "PARAMETER_QUOTA_EXCEEDED", "转换结果超过存储配额");
            temporary = _filePath + ".tmp-" + Guid.NewGuid().ToString("N");
            await File.WriteAllBytesAsync(temporary, bytes, token);
            token.ThrowIfCancellationRequested();
            // 新文件成功发布后才删除唯一迁移源；提交后不再因请求取消跳过清理。
            File.Move(temporary, _filePath, false);
            try { File.Delete(legacyPaths[0]!); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                throw new ParameterStoreException(409, "LEGACY_CLEANUP_REQUIRED",
                    "新参数文件已创建并生效，但旧文件删除失败，请检查权限并手动清理旧文件；不要重复转换");
            }
            return store.Parameters.Count;
        }
        finally
        {
            if (temporary is not null)
            {
                try { File.Delete(temporary); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            _gate.Release();
        }
    }


    private async Task<ParameterDataStore> ReadUnlockedAsync(CancellationToken token)
    {
        try
        {
            FileStream? stream = null;
            // 仅“路径不存在”允许回退；损坏或权限错误不能静默读取陈旧数据。
            foreach (var path in new[] { _filePath, _legacyFilePath }.Concat(_additionalLegacyPaths))
            {
                if (string.IsNullOrWhiteSpace(path)) continue;
                try { stream = File.OpenRead(path); break; }
                catch (FileNotFoundException) { }
                catch (DirectoryNotFoundException) { }
            }
            if (stream is null) return new ParameterDataStore();
            await using (stream)
            {
                if (stream.Length > 16 * 1024 * 1024) throw CorruptStore();
                using var document = await JsonDocument.ParseAsync(stream, cancellationToken: token);
                var root = document.RootElement;
            // 必须存在精确的 Parameters 数组，不能由属性默认值把损坏文件变成空库。
            ValidateUniqueProperties(root);
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("Parameters", out var parameters)
                || parameters.ValueKind != JsonValueKind.Array || parameters.GetArrayLength() > 10000)
                throw CorruptStore();
            foreach (var entry in parameters.EnumerateArray())
            {
                // 身份字段和正文必须实际存在，避免缺失字段被模型默认值悄悄补齐。
                if (entry.ValueKind != JsonValueKind.Object
                    || !HasString(entry, "Namespace") || !HasString(entry, "Key") || !HasString(entry, "Value"))
                    throw CorruptStore();
            }
            var store = root.Deserialize<ParameterDataStore>(_jsonOptions);
            if (store?.Parameters is null || store.Parameters.Any(x => x is null
                || string.IsNullOrWhiteSpace(x.Namespace) || string.IsNullOrWhiteSpace(x.Key))
                || store.Parameters.Select(x => (x.Namespace, x.Key)).Distinct().Count() != store.Parameters.Count)
                throw CorruptStore();
            return store;
            }
        }
        catch (FileNotFoundException) { return new ParameterDataStore(); }
        catch (JsonException) { throw CorruptStore(); }
    }

    private static bool HasString(JsonElement entry, string name)
        => entry.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String;

    private static void ValidateUniqueProperties(JsonElement element)
    {
        // 拒绝重复字段及仅大小写不同的字段，防止解析顺序决定最终数据。
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw CorruptStore();
                ValidateUniqueProperties(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var child in element.EnumerateArray()) ValidateUniqueProperties(child);
    }

    private static ParameterStoreException CorruptStore()
        => new(500, "PARAMETER_STORE_CORRUPT", "服务器参数文件损坏或超出可读取范围");

    private async Task WriteUnlockedAsync(ParameterDataStore store, CancellationToken token)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(store, _jsonOptions);
        if (bytes.Length > 16 * 1024 * 1024 || store.Parameters.Count > 10000)
            throw new ParameterStoreException(413, "PARAMETER_QUOTA_EXCEEDED", "用户参数存储超过配额");
        var temp = _filePath + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            await File.WriteAllBytesAsync(temp, bytes, token);
            token.ThrowIfCancellationRequested();
            File.Move(temp, _filePath, true);
        }
        finally
        {
            // 清理失败不能覆盖提交失败或取消的原始异常。
            try { File.Delete(temp); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}
