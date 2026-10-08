namespace DD.Danmaku.Hosting;

using System.Text.Json;

/// <summary>仅提取上游错误诊断字段，禁止把任意正文或请求凭据写入日志。</summary>
internal static class UpstreamErrorDiagnostic
{
    internal static string Describe(ApiAccessException error)
    {
        var fields = new Dictionary<string, object?> { ["errorCode"] = error.Code };
        if (error.UpstreamReply is { } reply)
        {
            fields["httpStatus"] = reply.StatusCode;
            try
            {
                using var json = JsonDocument.Parse(reply.Body);
                if (json.RootElement.ValueKind == JsonValueKind.Object)
                    foreach (var name in new[] { "status", "errorCode", "type", "message", "errorMessage", "reason" })
                        if (json.RootElement.TryGetProperty(name, out var value))
                        {
                            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number))
                                fields["upstream" + char.ToUpperInvariant(name[0]) + name[1..]] = number;
                            else if (value.ValueKind == JsonValueKind.String)
                                fields["upstream" + char.ToUpperInvariant(name[0]) + name[1..]] = FrontendLogStore.Sanitize(
                                    new string((value.GetString() ?? "").Where(character => !char.IsControl(character)).Take(512).ToArray()));
                        }
            }
            catch (JsonException) { fields["responseFormat"] = "non-json"; }
        }
        else fields["message"] = FrontendLogStore.Sanitize(error.Message);
        return "上游请求失败：\n" + JsonSerializer.Serialize(fields, new JsonSerializerOptions
        { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
    }
}
