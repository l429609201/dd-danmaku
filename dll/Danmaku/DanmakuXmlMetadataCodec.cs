namespace DD.Danmaku.Danmaku;

using System.Globalization;
using System.Xml;

/// <summary>插件 XML 元数据的显式字段映射；不反序列化任意类型，不信任文件内身份授权。</summary>
internal static class DanmakuXmlMetadataCodec
{
    internal static async Task<DanmakuXmlMetadata> ReadAsync(XmlReader reader, CancellationToken token)
    {
        var fields = new Dictionary<string, string>(StringComparer.Ordinal);
        if (reader.IsEmptyElement) { await reader.ReadAsync(); return new(); }
        var depth = reader.Depth;
        await reader.ReadAsync();
        while (!reader.EOF && !(reader.NodeType == XmlNodeType.EndElement && reader.Depth == depth))
        {
            token.ThrowIfCancellationRequested();
            if (reader.NodeType == XmlNodeType.Element && reader.Depth == depth + 1 && reader.NamespaceURI.Length == 0)
            {
                var key = reader.Name;
                var value = await reader.ReadElementContentAsStringAsync();
                if (value.Length > 4096 || fields.Count >= 32 || !fields.TryAdd(key, value))
                    throw new InvalidDataException("XML 元数据字段过长、过多或重复");
                continue;
            }
            await reader.ReadAsync();
        }
        await reader.ReadAsync();
        string? Text(string key) => fields.TryGetValue(key, out var value) && value.Length > 0 ? value : null;
        int? Number(string key) => Text(key) is { } value ? int.Parse(value, CultureInfo.InvariantCulture) : null;
        DateTimeOffset? Date(string key) => Text(key) is { } value
            ? XmlConvert.ToDateTimeOffset(value).ToUniversalTime() : null;
        return new DanmakuXmlMetadata
        {
            Version = Number("Version") ?? 1,
            SourceId = Text("SourceId"), SourceEpisodeId = Text("SourceEpisodeId"), SourceAnimeId = Text("SourceAnimeId"),
            EmbyItemId = Text("EmbyItemId"), EmbySeriesId = Text("EmbySeriesId"), EmbySeasonId = Text("EmbySeasonId"),
            SeasonNumber = Number("SeasonNumber"), EpisodeNumber = Number("EpisodeNumber"),
            OwnerUserId = Text("OwnerUserId"), OwnerUserName = Text("OwnerUserName"),
            UpdatedByUserId = Text("UpdatedByUserId"), WriteMethod = Text("WriteMethod"),
            UpdatedAt = Date("UpdatedAt"), FetchedAt = Date("FetchedAt"),
            UpstreamRevision = Text("UpstreamRevision"), ChConvert = Number("ChConvert")
        };
    }

    internal static async Task WriteAsync(XmlWriter writer, DanmakuXmlMetadata metadata, CancellationToken token)
    {
        // 来源集 ID 不能脱离来源单独写入；本地媒体 ID 始终独立。
        if (!string.IsNullOrEmpty(metadata.SourceEpisodeId) && string.IsNullOrWhiteSpace(metadata.SourceId))
            throw new InvalidDataException("来源集 ID 必须同时指定来源");
        await writer.WriteStartElementAsync(null, "ddDanmaku", null);
        var fields = new (string Name, object? Value)[]
        {
            // 指纹只用于后端绑定，不包含原始上游密钥。
            ("UpstreamRevision", metadata.UpstreamRevision), ("ChConvert", metadata.ChConvert),
            ("Version", metadata.Version), ("SourceId", metadata.SourceId),
            ("SourceEpisodeId", metadata.SourceEpisodeId), ("SourceAnimeId", metadata.SourceAnimeId),
            ("EmbyItemId", metadata.EmbyItemId), ("EmbySeriesId", metadata.EmbySeriesId),
            ("EmbySeasonId", metadata.EmbySeasonId), ("SeasonNumber", metadata.SeasonNumber),
            ("EpisodeNumber", metadata.EpisodeNumber), ("OwnerUserId", metadata.OwnerUserId),
            ("OwnerUserName", metadata.OwnerUserName), ("UpdatedByUserId", metadata.UpdatedByUserId),
            ("WriteMethod", metadata.WriteMethod),
            // 写入时间不可由上传文件或客户端指定；内容获取时间则保留未知或已知值。
            ("UpdatedAt", DateTimeOffset.UtcNow), ("FetchedAt", metadata.FetchedAt)
        };
        foreach (var (name, value) in fields)
        {
            token.ThrowIfCancellationRequested();
            if (value is null) continue;
            var text = value is DateTimeOffset date ? XmlConvert.ToString(date.ToUniversalTime())
                : Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
            if (text.Length > 4096) throw new InvalidDataException("XML 元数据字段过长");
            await writer.WriteElementStringAsync(null, name, null, text);
        }
        await writer.WriteEndElementAsync();
    }
}
