namespace DD.Danmaku.Persistence;

using System.Text.Json;
using System.Globalization;

/// <summary>管理员编辑使用协议类型校验，避免无效值写入后破坏播放器同步。</summary>
internal static class ParameterValueValidator
{
    internal static void Validate(ParameterEntry entry)
    {
        if (entry.Type == "boolean")
        {
            if (entry.Value is not ("true" or "false")) throw new ArgumentException("布尔参数无效");
        }
        else if (entry.Type == "number")
        {
            if (!double.TryParse(entry.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
                || !double.IsFinite(number)) throw new ArgumentException("数字参数无效");
        }
        else if (entry.Type == "json")
        {
            // 密码框空值表示保留原敏感数据，不参与 JSON 校验。
            if (ParameterPrivacy.IsSensitive(entry.Key) && entry.Value.Length == 0) return;
            using var document = JsonDocument.Parse(entry.Value);
            if (document.RootElement.ValueKind is not (JsonValueKind.Array or JsonValueKind.Object))
                throw new ArgumentException("JSON 参数必须是数组或对象");
        }
        else if (entry.Type != "string") throw new ArgumentException("参数类型无效");
    }
}
