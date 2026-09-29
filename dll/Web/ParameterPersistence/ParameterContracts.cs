namespace DD.Danmaku.Web.ParameterPersistence;

using DD.Danmaku.Persistence;

/// <summary>参数持久化兼容接口的查询条件。</summary>
/// <param name="Namespace">参数命名空间筛选条件。</param>
/// <param name="Key">精确参数键。</param>
/// <param name="Keyword">模糊查询关键词。</param>
public sealed record ParameterQueryRequest(string? Namespace, string? Key, string? Keyword);
/// <summary>单项参数创建或更新请求。</summary>
/// <param name="Namespace">参数所属命名空间。</param>
/// <param name="Key">参数键。</param>
/// <param name="Value">待保存的序列化值。</param>
/// <param name="Type">值的类型标识。</param>
/// <param name="Description">参数用途说明。</param>
public sealed record ParameterMutationRequest(string? Namespace, string? Key, string? Value, string? Type, string? Description);
/// <summary>批量参数操作中的一项输入。</summary>
/// <param name="Namespace">条目所属命名空间。</param>
/// <param name="Key">条目键。</param>
/// <param name="Value">序列化值。</param>
/// <param name="Type">值的类型标识。</param>
/// <param name="Description">条目用途说明。</param>
public sealed record ParameterItem(string? Namespace, string? Key, string? Value, string? Type, string? Description);

/// <summary>兼容参数持久化协议的单项或列表响应。</summary>
/// <param name="Success">操作是否成功。</param>
/// <param name="Message">结果说明或脱敏错误信息。</param>
/// <param name="Data">单项查询结果。</param>
/// <param name="DataList">列表查询结果。</param>
/// <param name="Total">结果或受影响条目的数量。</param>
public sealed record ParameterResponse(
    bool Success,
    string? Message = null,
    ParameterEntry? Data = null,
    IReadOnlyList<ParameterEntry>? DataList = null,
    int Total = 0);

/// <summary>将旧参数持久化协议转换为插件参数存储操作。</summary>
public interface IParameterCompatibilityService
{
    /// <summary>按命名空间、键或关键词查询参数。</summary>
    Task<ParameterResponse> QueryAsync(ParameterQueryRequest request, CancellationToken cancellationToken);
    /// <summary>创建单项或批量参数，并返回兼容格式结果。</summary>
    Task<ParameterResponse> CreateAsync(ParameterMutationRequest request, IReadOnlyList<ParameterItem>? items, CancellationToken cancellationToken);
    /// <summary>更新单项或批量参数，并返回兼容格式结果。</summary>
    Task<ParameterResponse> UpdateAsync(ParameterMutationRequest request, IReadOnlyList<ParameterItem>? items, CancellationToken cancellationToken);
    /// <summary>按单键、键集合或条目集合删除参数。</summary>
    Task<ParameterResponse> DeleteAsync(string? nameSpace, string? key, IReadOnlyList<string>? keys, IReadOnlyList<ParameterItem>? items, CancellationToken cancellationToken);
}
