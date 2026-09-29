namespace DD.Danmaku.Persistence;

/// <summary>参数 JSON 文件的根数据结构。</summary>
public sealed class ParameterDataStore
{
    /// <summary>文件中保存的参数条目集合。</summary>
    public List<ParameterEntry> Parameters { get; set; } = [];
}

/// <summary>以命名空间和键定位的持久化参数条目。</summary>
public sealed class ParameterEntry
{
    /// <summary>条目唯一标识，新建时自动生成。</summary>
    public string Id { get; set; } = Guid.NewGuid().ToString();
    /// <summary>用于隔离参数用途的命名空间。</summary>
    public string Namespace { get; set; } = "default";
    /// <summary>命名空间内的参数键。</summary>
    public string Key { get; set; } = string.Empty;
    /// <summary>参数值的字符串表示。</summary>
    public string Value { get; set; } = string.Empty;
    /// <summary>参数值类型的协议标识。</summary>
    public string Type { get; set; } = "string";
    /// <summary>可选的参数用途说明。</summary>
    public string? Description { get; set; }
    /// <summary>条目的 UTC 创建时间。</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>条目的 UTC 最近更新时间。</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>提供文件参数查询及原子持久化修改能力。</summary>
public interface IParameterFileStore
{
    /// <summary>按命名空间、精确键及关键词筛选参数。</summary>
    Task<IReadOnlyList<ParameterEntry>> QueryAsync(string? nameSpace, string? key, string? keyword, CancellationToken cancellationToken);
    /// <summary>创建参数并返回保存后的条目。</summary>
    Task<ParameterEntry> CreateAsync(ParameterEntry parameter, CancellationToken cancellationToken);
    /// <summary>更新指定参数的值及说明；参数不存在时返回空值。</summary>
    Task<ParameterEntry?> UpdateAsync(string nameSpace, string key, string value, string? description, CancellationToken cancellationToken);
    /// <summary>删除指定参数，返回是否找到并删除了条目。</summary>
    Task<bool> DeleteAsync(string nameSpace, string key, CancellationToken cancellationToken);
    // 回调仅修改本次读取的内存副本；成功后整批写入一次。
    /// <summary>在内存副本上执行批量修改，成功后一次性保存并返回回调结果。</summary>
    /// <typeparam name="T">修改回调的返回类型。</typeparam>
    Task<T> MutateAsync<T>(Func<List<ParameterEntry>, T> mutation, CancellationToken cancellationToken);
}
