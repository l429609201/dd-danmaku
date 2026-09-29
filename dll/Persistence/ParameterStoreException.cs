namespace DD.Danmaku.Persistence;

/// <summary>参数领域错误；不携带文件路径或参数值。</summary>
/// <param name="status">向客户端返回的 HTTP 状态码。</param>
/// <param name="code">用于分类处理的稳定业务错误码。</param>
/// <param name="message">不含路径及参数值的脱敏错误消息。</param>
public sealed class ParameterStoreException(int status, string code, string message) : Exception(message)
{
    /// <summary>对应的 HTTP 状态码。</summary>
    public int Status { get; } = status;
    /// <summary>参数领域错误码。</summary>
    public string Code { get; } = code;
}
