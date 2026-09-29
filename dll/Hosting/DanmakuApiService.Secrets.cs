namespace DD.Danmaku.Hosting;

using System.Text;
using System.Text.Json;
using DD.Danmaku.Web.Api;

public sealed partial class DanmakuApiService
{
    // 仅已认证管理员入口调用。XOR 是可逆混淆，不是加密，仍必须使用 HTTPS。
    private ApiHttpResult SecretSuccess<T>(T data)
    {
        var key = Encoding.UTF8.GetBytes(_access.AdministratorToken(Request));
        var bytes = JsonSerializer.SerializeToUtf8Bytes(data, MatchJson.Options);
        for (var index = 0; index < bytes.Length; index++) bytes[index] ^= key[index % key.Length];
        return ApiHttpResult.Success(new { SecretEncoding = "xor-utf8-base64-v1", Payload = Convert.ToBase64String(bytes) });
    }
}
