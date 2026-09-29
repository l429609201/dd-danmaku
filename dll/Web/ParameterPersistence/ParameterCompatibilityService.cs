namespace DD.Danmaku.Web.ParameterPersistence;

using DD.Danmaku.Persistence;

/// <summary>
/// 保持原 ParameterPersistence 的查询、创建、更新和删除语义。
/// </summary>
public sealed class ParameterCompatibilityService : IParameterCompatibilityService
{
    private readonly IParameterFileStore _store;

    public ParameterCompatibilityService(IParameterFileStore store)
    {
        _store = store;
    }

    public async Task<ParameterResponse> QueryAsync(ParameterQueryRequest request, CancellationToken cancellationToken)
    {
        var items = await _store.QueryAsync(request.Namespace, request.Key, request.Keyword, cancellationToken);
        if (!string.IsNullOrWhiteSpace(request.Key))
        {
            var item = items.FirstOrDefault();
            return item is null
                ? new ParameterResponse(false, "参数不存在")
                : new ParameterResponse(true, Data: item);
        }

        return new ParameterResponse(true, DataList: items, Total: items.Count);
    }

    public Task<ParameterResponse> CreateAsync(ParameterMutationRequest request,
        IReadOnlyList<ParameterItem>? items, CancellationToken cancellationToken)
        => SaveBatchAsync(request, items, false, cancellationToken);

    public Task<ParameterResponse> UpdateAsync(ParameterMutationRequest request,
        IReadOnlyList<ParameterItem>? items, CancellationToken cancellationToken)
        => SaveBatchAsync(request, items, true, cancellationToken);

    private Task<ParameterResponse> SaveBatchAsync(ParameterMutationRequest request,
        IReadOnlyList<ParameterItem>? items, bool updateOnly, CancellationToken token)
    {
        var input = Expand(request, items).Select(ToEntry).ToArray();
        if (input.Length == 0 || input.Any(x => string.IsNullOrWhiteSpace(x.Key)))
            throw new ArgumentException("请提供有效参数");
        if (input.Select(x => (x.Namespace, x.Key)).Distinct().Count() != input.Length)
            throw new ArgumentException("同批次参数重复");
        return _store.MutateAsync(entries =>
        {
            var index = entries.ToDictionary(x => (x.Namespace, x.Key));
            // 所有更新目标先核对，缺失任一项不修改文件。
            if (updateOnly && input.Any(x => !index.ContainsKey((x.Namespace, x.Key))))
                throw new ParameterStoreException(409, "PARAMETER_NOT_FOUND", "部分更新目标不存在，整批未提交");
            var results = new List<ParameterEntry>();
            var now = DateTime.UtcNow;
            foreach (var item in input)
            {
                token.ThrowIfCancellationRequested();
                if (index.TryGetValue((item.Namespace, item.Key), out var current))
                {
                    current.Value = item.Value;
                    if (!updateOnly) current.Type = item.Type;
                    current.Description = item.Description ?? current.Description;
                    current.UpdatedAt = now;
                }
                else
                {
                    current = item;
                    current.CreatedAt = current.UpdatedAt = now;
                    entries.Add(current);
                }
                results.Add(current);
            }
            return new ParameterResponse(true, "参数批量保存成功", DataList: results, Total: results.Count);
        }, token);
    }

    public Task<ParameterResponse> DeleteAsync(string? nameSpace, string? key,
        IReadOnlyList<string>? keys, IReadOnlyList<ParameterItem>? items, CancellationToken cancellationToken)
    {
        var targets = items?.Where(x => !string.IsNullOrWhiteSpace(x.Key))
            .Select(x => (Namespace: NormalizeNamespace(x.Namespace), Key: x.Key!)).ToList()
            ?? new List<(string Namespace, string Key)>();
        if (!string.IsNullOrWhiteSpace(key)) targets.Add((NormalizeNamespace(nameSpace), key));
        if (keys is not null) targets.AddRange(keys.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => (NormalizeNamespace(nameSpace), x)));
        if (targets.Count == 0) throw new ArgumentException("请提供删除目标");
        var unique = targets.ToHashSet();
        return _store.MutateAsync(entries =>
        {
            var deleted = entries.RemoveAll(x => unique.Contains((x.Namespace, x.Key)));
            return new ParameterResponse(deleted > 0, $"成功删除 {deleted} 个参数", Total: deleted);
        }, cancellationToken);
    }

    private static List<ParameterItem> Expand(ParameterMutationRequest request, IReadOnlyList<ParameterItem>? items)
    {
        if (items is { Count: > 0 }) return items.ToList();
        return string.IsNullOrWhiteSpace(request.Key) ? [] :
        [new ParameterItem(request.Namespace, request.Key, request.Value, request.Type, request.Description)];
    }

    private static ParameterEntry ToEntry(ParameterItem item) => new()
    {
        Namespace = NormalizeNamespace(item.Namespace),
        Key = item.Key ?? string.Empty,
        Value = item.Value ?? string.Empty,
        Type = string.IsNullOrWhiteSpace(item.Type) ? "string" : item.Type,
        Description = item.Description
    };

    private static string NormalizeNamespace(string? value) => string.IsNullOrWhiteSpace(value) ? "default" : value;
}
