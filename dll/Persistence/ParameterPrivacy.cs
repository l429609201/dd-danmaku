namespace DD.Danmaku.Persistence;

/// <summary>管理响应与跨用户复制的敏感字段策略，不改变播放器本人读取协议。</summary>
internal static class ParameterPrivacy
{
    internal static bool IsSensitive(string key) =>
        key.Contains("token", StringComparison.OrdinalIgnoreCase)
        || key.Contains("apikey", StringComparison.OrdinalIgnoreCase)
        || key.Contains("secret", StringComparison.OrdinalIgnoreCase)
        || key.Contains("password", StringComparison.OrdinalIgnoreCase)
        // 自定义源可能嵌入认证头或 URL 凭据，整体按敏感配置处理。
        || key.Equals("danmakuCustomApiList", StringComparison.OrdinalIgnoreCase)
        || key.Contains("url", StringComparison.OrdinalIgnoreCase)
        || key.Contains("prefix", StringComparison.OrdinalIgnoreCase);

    internal static bool CanCopy(string key) => !IsSensitive(key)
        && !key.Contains("userid", StringComparison.OrdinalIgnoreCase)
        && !key.Contains("namespace", StringComparison.OrdinalIgnoreCase)
        && !key.Contains("bangumi", StringComparison.OrdinalIgnoreCase)
        && !key.Contains("excludedLibraries", StringComparison.OrdinalIgnoreCase);

    internal static ParameterEntry Copy(ParameterEntry entry) => new()
    {
        Namespace = entry.Namespace, Key = entry.Key, Value = entry.Value,
        Type = entry.Type, Description = entry.Description
    };
}
