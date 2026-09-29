namespace DD.Danmaku.Danmaku;

using System.Globalization;
using System.Text;
using System.Xml;

/// <summary>按 Bilibili 弹幕 XML 约定读写 i 根节点、d 文本节点及九段 p 属性。</summary>
internal static class DanmakuXml
{
    internal const int MaxComments = 500_000;
    internal const long MaxBytes = 64L * 1024 * 1024;
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;

    /// <summary>XML 检查结果；根节点额外元数据不影响规范性，p 非九段时标记为需规范化。</summary>
    internal sealed record ReadReport(IReadOnlyList<DanmakuComment> Comments, bool IsCanonical,
        IReadOnlyList<string> Issues);

    internal static void Validate(DanmakuComment comment)
    {
        if (comment is null || string.IsNullOrWhiteSpace(comment.Text) || comment.Text.Length > 4096
            || !double.IsFinite(comment.Time) || comment.Time < 0 || comment.Mode is < 1 or > 9
            || comment.Color is < 0 or > 0xFFFFFF || comment.FontSize is < 0 or > 100
            || comment.Timestamp < 0 || comment.Pool < 0 || comment.Weight < 0
            || comment.UserId?.Length > 256 || comment.Cid?.Length > 256
            || comment.UserId?.Contains(',') == true || comment.UserId?.Any(char.IsControl) == true)
            throw new InvalidDataException("弹幕字段无效（Mode 应使用 XML 原始编号）");
        XmlConvert.VerifyXmlChars(comment.Text);
        if (comment.UserId is not null) XmlConvert.VerifyXmlChars(comment.UserId);
        if (comment.Cid is not null) XmlConvert.VerifyXmlChars(comment.Cid);
    }

    internal static async Task<IReadOnlyList<DanmakuComment>> ReadAsync(Stream stream, CancellationToken token)
        => (await ReadReportAsync(stream, token)).Comments;

    /// <summary>容错读取并收集规范性问题；内部标准格式严格采用 Bilibili 的九段 p 属性。</summary>
    internal static async Task<ReadReport> ReadReportAsync(Stream stream, CancellationToken token)
    {
        using var reader = XmlReader.Create(stream, new XmlReaderSettings
        {
            Async = true, DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
            MaxCharactersInDocument = MaxBytes, IgnoreComments = true, CloseInput = false
        });
        token.ThrowIfCancellationRequested();
        if (await reader.MoveToContentAsync() != XmlNodeType.Element || reader.Name != "i"
            || reader.NamespaceURI.Length != 0) throw new InvalidDataException("不是弹幕 XML：缺少 i 根节点");
        var comments = new List<DanmakuComment>();
        var issues = new List<string>();
        await reader.ReadAsync();
        while (!reader.EOF)
        {
            token.ThrowIfCancellationRequested();
            if (reader.Depth > 32) throw new InvalidDataException("XML 嵌套过深");
            if (reader.NodeType == XmlNodeType.Element && reader.Depth == 1 && reader.Name == "d"
                && reader.NamespaceURI.Length == 0)
            {
                if (comments.Count >= MaxComments) throw new InvalidDataException("弹幕条数超过限制");
                var parts = (reader.GetAttribute("p") ?? "").Split(',');
                // Bilibili 标准 p 属性为九段；缺失或追加字段均需规范化。
                if (parts.Length != 9) issues.Add($"第 {comments.Count + 1} 条弹幕 p 字段数量为 {parts.Length}，Bilibili 标准应为 9");
                if (parts.Length < 2 || !double.TryParse(parts[0], NumberStyles.Float, Culture, out var time)
                    || !int.TryParse(parts[1], NumberStyles.Integer, Culture, out var mode))
                { issues.Add($"第 {comments.Count + 1} 条弹幕时间或模式无效，已跳过"); await reader.SkipAsync(); continue; }
                var color = 0xFFFFFF;
                if (parts.Length > 3 && !string.IsNullOrWhiteSpace(parts[3])
                    && !int.TryParse(parts[3], NumberStyles.Integer, Culture, out color))
                { issues.Add($"第 {comments.Count + 1} 条弹幕颜色无效，已使用白色"); color = 0xFFFFFF; }
                if (parts.Length < 4) issues.Add($"第 {comments.Count + 1} 条弹幕缺少颜色，已使用白色");
                var text = await reader.ReadElementContentAsStringAsync();
                var userId = parts.Length > 6 && parts[6] != "" ? parts[6] : null;
                var fontSize = ParseInt(parts, 2, 25, issues, comments.Count + 1, "字号");
                var timestamp = ParseLong(parts, 4, 0, issues, comments.Count + 1, "发送时间戳");
                var pool = ParseInt(parts, 5, 0, issues, comments.Count + 1, "弹幕池");
                var cid = parts.Length > 7 && parts[7] != "" ? parts[7] : null;
                var weight = ParseInt(parts, 8, 0, issues, comments.Count + 1, "权重");
                var comment = new DanmakuComment(text, time, mode, color, userId,
                    fontSize, timestamp, pool, cid, weight);
                try { Validate(comment); comments.Add(comment); }
                catch (InvalidDataException) { issues.Add($"第 {comments.Count + 1} 条弹幕字段超出范围，已跳过"); }
                // ReadElementContentAsStringAsync 已定位至下一节点，不再额外 Read 跳过相邻弹幕。
                continue;
            }
            await reader.ReadAsync();
        }
        return new ReadReport(comments, issues.Count == 0, issues);
    }

    private static int ParseInt(string[] parts, int index, int fallback, List<string> issues, int number, string name)
    {
        if (parts.Length <= index || string.IsNullOrWhiteSpace(parts[index])) return fallback;
        if (int.TryParse(parts[index], NumberStyles.Integer, Culture, out var value)) return value;
        issues.Add($"第 {number} 条弹幕{name}无效，已使用默认值");
        return fallback;
    }

    private static long ParseLong(string[] parts, int index, long fallback, List<string> issues, int number, string name)
    {
        if (parts.Length <= index || string.IsNullOrWhiteSpace(parts[index])) return fallback;
        if (long.TryParse(parts[index], NumberStyles.Integer, Culture, out var value)) return value;
        issues.Add($"第 {number} 条弹幕{name}无效，已使用默认值");
        return fallback;
    }

    internal static async Task WriteAsync(Stream stream, IReadOnlyList<DanmakuComment> comments,
        CancellationToken token)
    {
        // 仅持久化新内容时记录获取入库时间，读取与格式转换不会刷新时间。
        await WriteAsync(stream, comments, token, null);
    }

    internal static async Task WriteAsync(Stream stream, IReadOnlyList<DanmakuComment> comments,
        CancellationToken token, DateTimeOffset? fetchedAt)
    {
        using var writer = XmlWriter.Create(stream, new XmlWriterSettings
        {
            Async = true, Encoding = new UTF8Encoding(false), Indent = false,
            CloseOutput = false, NewLineHandling = NewLineHandling.Entitize
        });
        await writer.WriteStartDocumentAsync();
        await writer.WriteStartElementAsync(null, "i", null);
        if (fetchedAt is { } timestamp)
            await writer.WriteAttributeStringAsync(null, "fetchedAt", null, timestamp.ToUniversalTime().ToString("O", Culture));
        for (var index = 0; index < comments.Count; index++)
        {
            token.ThrowIfCancellationRequested();
            var c = comments[index];
            Validate(c);
            // 按 Bilibili 九段格式输出，并保留读取到的来源扩展字段。
            var p = string.Join(",", c.Time.ToString("R", Culture), c.Mode.ToString(Culture),
                c.FontSize.ToString(Culture), c.Color.ToString(Culture), c.Timestamp.ToString(Culture),
                c.Pool.ToString(Culture), c.UserId ?? "", c.Cid ?? "0", c.Weight.ToString(Culture));
            await writer.WriteStartElementAsync(null, "d", null);
            await writer.WriteAttributeStringAsync(null, "p", null, p);
            await writer.WriteStringAsync(c.Text);
            await writer.WriteEndElementAsync();
            if ((index + 1) % 256 == 0)
            {
                await writer.FlushAsync();
                if (stream.Position > MaxBytes) throw new InvalidDataException("弹幕 XML 超过 64 MiB 限制");
            }
        }
        await writer.WriteEndElementAsync();
        await writer.WriteEndDocumentAsync();
        await writer.FlushAsync();
        if (stream.Position > MaxBytes) throw new InvalidDataException("弹幕 XML 超过 64 MiB 限制");
    }
}
