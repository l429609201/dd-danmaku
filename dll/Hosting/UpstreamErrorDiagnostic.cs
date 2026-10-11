namespace DD.Danmaku.Hosting;

using System.Text.Json;

/// <summary>仅提取上游错误诊断字段，禁止把任意正文或请求凭据写入日志。</summary>
internal static class UpstreamErrorDiagnostic
{
    internal static string Describe(ApiAccessException error)
    {
        // 用户可见详情不读取上游英文 message/reason，业务判定仍使用异常保存的原响应。
        var fields = new Dictionary<string, object?>
        {
            ["httpStatus"] = error.Status,
            ["errorCode"] = error.Code,
            ["message"] = FrontendLogStore.Sanitize(error.Message)
        };
        return "上游请求失败：\n" + JsonSerializer.Serialize(fields, new JsonSerializerOptions
        { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
    }
}
