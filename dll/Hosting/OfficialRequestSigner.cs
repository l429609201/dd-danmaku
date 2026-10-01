namespace DD.Danmaku.Hosting;

using System.Globalization;
using System.Security.Cryptography;
using System.Text;

/// <summary>与现有 WASM 协议一致的内部签名器，不提供对外签名接口。</summary>
internal sealed class OfficialRequestSigner(string secret, string brandMark, string obfuscationKey)
{
    // HMAC 只需要签名密钥；用户混淆是独立的可选兼容协议。
    internal bool IsConfigured => !string.IsNullOrWhiteSpace(secret);

    internal IReadOnlyDictionary<string, string> CreateHeaders(Guid authenticatedUserId, string apiPath)
    {
        if (!IsConfigured) throw new ApiAccessException(503, "OFFICIAL_SIGNING_UNAVAILABLE", "官方代理签名尚未配置");
        if (authenticatedUserId == Guid.Empty) throw new ArgumentException("认证用户标识无效");
        // 路径必须先由代理白名单生成；这里只接受官方 API 路径，不签查询串或任意 URL。
        if (!apiPath.StartsWith("/api/v2/", StringComparison.Ordinal)
            || apiPath.IndexOfAny(['?', '#', '\r', '\n']) >= 0)
            throw new ArgumentException("官方 API 签名路径无效");
        var hasBrand = !string.IsNullOrWhiteSpace(brandMark);
        var hasObfuscation = !string.IsNullOrWhiteSpace(obfuscationKey);
        // 配了一半时明确报错，不能静默改变已选择的用户标记协议。
        if (hasBrand != hasObfuscation)
            throw new ApiAccessException(503, "OFFICIAL_USER_MARK_INCOMPLETE", "可选用户标记参数必须同时配置或同时留空");
        var markedUser = authenticatedUserId.ToString("N");
        if (hasBrand)
        {
            var payload = Encoding.UTF8.GetBytes(brandMark + ":" + markedUser);
            var seed = SHA256.HashData(Encoding.UTF8.GetBytes(obfuscationKey));
            for (var index = 0; index < payload.Length; index++) payload[index] ^= seed[index % seed.Length];
            markedUser = Convert.ToHexString(payload).ToLowerInvariant();
        }
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        var raw = Encoding.UTF8.GetBytes($"{markedUser}:{timestamp}:{apiPath}");
        var signature = Convert.ToBase64String(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), raw));
        return new Dictionary<string, string>
        {
            ["X-Ddd-User"] = markedUser,
            ["X-Ddd-Ts"] = timestamp,
            ["X-Ddd-Sign"] = signature
        };
    }
}
