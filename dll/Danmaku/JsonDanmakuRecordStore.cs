namespace DD.Danmaku.Danmaku;

using System.Text.Json;

/// <summary>
/// JSON 记录索引，避免每次管理页请求扫描媒体库或旁车正文。
/// </summary>
public sealed class JsonDanmakuRecordStore
{
    private readonly string _filePath;
    private readonly JsonSerializerOptions _options = new() { PropertyNamingPolicy = null, WriteIndented = true };
    private readonly SemaphoreSlim _gate = new(1, 1);

    public JsonDanmakuRecordStore(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        _filePath = Path.Combine(dataDirectory, "records.json");
    }

    public async Task<IReadOnlyList<DanmakuRecord>> LoadAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try { return await ReadUnlockedAsync(cancellationToken); }
        finally { _gate.Release(); }
    }

    public async Task SaveAsync(IReadOnlyList<DanmakuRecord> records, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try { await WriteUnlockedAsync(records, cancellationToken); }
        finally { _gate.Release(); }
    }

    // 新业务使用整次读改写事务；不能将 Load/Save 分开调用当作事务。
    public async Task MutateAsync(Action<List<DanmakuRecord>> mutation, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            var records = await ReadUnlockedAsync(token);
            mutation(records);
            await WriteUnlockedAsync(records, token);
        }
        finally { _gate.Release(); }
    }

    private async Task<List<DanmakuRecord>> ReadUnlockedAsync(CancellationToken token)
    {
        try
        {
            await using var stream = File.OpenRead(_filePath);
            if (stream.Length > 16 * 1024 * 1024) throw Corrupt();
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: token);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Array || root.GetArrayLength() > 10000) throw Corrupt();
            // 逐字段检查完整性，防止构造函数默认值掩盖缺失字段或重复字段覆盖。
            var required = typeof(DanmakuRecord).GetProperties().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
            foreach (var entry in root.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object) throw Corrupt();
                var names = new HashSet<string>(StringComparer.Ordinal);
                foreach (var property in entry.EnumerateObject())
                    if (!required.Contains(property.Name) || !names.Add(property.Name)) throw Corrupt();
                if (!names.SetEquals(required)) throw Corrupt();
            }
            var records = root.Deserialize<List<DanmakuRecord>>(_options);
            Validate(records);
            return records!;
        }
        catch (FileNotFoundException) { return []; }
        catch (JsonException ex) { throw new IOException("弹幕记录索引格式无效", ex); }
    }

    private static void Validate(IReadOnlyList<DanmakuRecord>? records)
    {
        // 索引不存储真实路径；损坏数据拒绝覆盖，不当作空集合恢复。
        if (records is null || records.Count > 10000 || records.Any(r => r is null
            // Emby 使用正整数条目 ID，同时兼容已有 GUID 索引。
            || !(long.TryParse(r.ItemId, System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture, out var numericId) && numericId > 0
                || (Guid.TryParseExact(r.ItemId, "N", out var id)
                    || Guid.TryParseExact(r.ItemId, "D", out id)) && id != Guid.Empty)
            || (r.Source is null && r.RecordId != r.ItemId)
            || (r.Source is not null && r.Source != "upload" && r.RecordId != r.ItemId + "|" + r.Source)
            || (r.Source == "upload" && r.RecordId != r.ItemId && r.RecordId != r.ItemId + "|upload")
            || r.CommentCount < 0 || r.CommentCount > DanmakuXml.MaxComments
            || r.FormatVersion != 1 || r.StorageLocation != "sidecar"
            || r.StoredAt == default || r.UpdatedAt == default)
            || records.Select(r => (r.ItemId, Source: GetEffectiveSource(r))).Distinct().Count() != records.Count)
            throw Corrupt();
    }

    // 只有旧格式 upload 代表固定同名 XML；新格式 ItemId|upload 保留独立来源语义。
    internal static string? GetEffectiveSource(DanmakuRecord record)
        => record.Source == "upload" && record.RecordId == record.ItemId
            ? null : string.IsNullOrWhiteSpace(record.Source) ? null : record.Source.Trim();

    private static IOException Corrupt() => new("弹幕记录索引损坏或超出限制");

    private async Task WriteUnlockedAsync(IReadOnlyList<DanmakuRecord> records, CancellationToken token)
    {
        Validate(records);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(records, _options);
        if (bytes.Length > 16 * 1024 * 1024) throw Corrupt();
        var tempPath = _filePath + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            await File.WriteAllBytesAsync(tempPath, bytes, token);
            token.ThrowIfCancellationRequested();
            File.Move(tempPath, _filePath, true);
        }
        finally
        {
            // 清理失败不能遮蔽原始异常。
            try { File.Delete(tempPath); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}
