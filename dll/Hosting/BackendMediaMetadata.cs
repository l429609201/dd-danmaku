namespace DD.Danmaku.Hosting;

using System.Text.Json;
using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;

internal sealed record BackendMediaMetadata(TargetMediaDto Target, MetadataEpisodeInput Mapping,
    string SeriesName, int? Duration);

internal static class BackendMediaMetadataReader
{
    internal static BackendMediaMetadata Read(BaseItem authorizedItem)
    {
        if (authorizedItem is not Video video) throw new ApiAccessException(404, "ITEM_NOT_FOUND", "视频不存在");
        var episode = video as Episode;
        var series = episode?.Series;
        var title = Clean(series?.Name ?? episode?.SeriesName ?? video.Name, 200);
        if (string.IsNullOrEmpty(title)) throw new ApiAccessException(409, "MEDIA_METADATA_INCOMPLETE", "媒体缺少可匹配标题");
        var season = episode?.ParentIndexNumber;
        var number = episode?.IndexNumber;
        if (season is < 0 or > 999 || number is < 0 or > 99999 || episode is not null && number is null)
            throw new ApiAccessException(409, "EPISODE_NUMBER_REQUIRED", "媒体季集号无效或缺失");
        var filePath = video.Path;
        // 可信远程路径也可能携带签名查询；匹配文件名绝不包含这些凭据。
        if (Uri.TryCreate(filePath, UriKind.Absolute, out var remote) && remote.Scheme is "http" or "https")
            filePath = remote.AbsolutePath;
        var fileName = Clean(Path.GetFileName(filePath), 256)?.Replace(':', ' ');
        var providers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in video.ProviderIds ?? []) providers[entry.Key] = entry.Value;
        // 系列级元数据优先，不能把当前单集的 TMDB ID 当作电视剧 ID。
        if (series is not null) foreach (var entry in series.ProviderIds ?? []) providers[entry.Key] = entry.Value;
        var seriesProviders = new Dictionary<string, string>(series?.ProviderIds ?? [], StringComparer.OrdinalIgnoreCase);
        var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Tmdb", "TmdbEg", "Imdb", "Tvdb", "Bangumi", "Bgm" };
        var ids = providers.Where(entry => known.Contains(entry.Key) && entry.Value is { Length: > 0 and <= 256 }
            && !entry.Value.Any(char.IsControl)).Select(entry => new ProviderIdDto(entry.Key,
                episode is null ? "movie" : seriesProviders.ContainsKey(entry.Key) ? "series" : "episode", entry.Value)).ToArray();
        var year = series?.ProductionYear ?? video.ProductionYear;
        if (year is < 1 or > 9999) year = null;
        var target = new TargetMediaDto(video.Id.ToString("N"), title, fileName,
            episode is null ? "movie" : "episode", season, number, year, ids);
        var mapping = new MetadataEpisodeInput(episode is not null, season, number,
            episode is null ? providers.GetValueOrDefault("Tmdb") : seriesProviders.GetValueOrDefault("Tmdb"),
            episode is null ? null : seriesProviders.GetValueOrDefault("TmdbEg"));
        int? duration = video.RunTimeTicks is { } ticks && ticks > 0
            ? (int)Math.Min(864000, ticks / TimeSpan.TicksPerSecond) : null;
        return new(target, mapping, title, duration);
    }

    internal static MetadataMappingResult? ManualMapping(BackendMediaMetadata media, string? rulesText)
    {
        if (!media.Mapping.IsEpisode || string.IsNullOrWhiteSpace(rulesText)) return null;
        if (rulesText.Length > 128 * 1024) throw new ApiAccessException(409, "MATCH_MAPPING_INVALID", "集数偏移规则过长");
        using var document = JsonDocument.Parse(rulesText, new JsonDocumentOptions { MaxDepth = 8 });
        if (document.RootElement.ValueKind != JsonValueKind.Array || document.RootElement.GetArrayLength() > 100)
            throw new ApiAccessException(409, "MATCH_MAPPING_INVALID", "集数偏移规则格式无效");
        foreach (var rule in document.RootElement.EnumerateArray())
        {
            if (rule.ValueKind != JsonValueKind.Object || !rule.TryGetProperty("seriesName", out var name)
                || name.ValueKind != JsonValueKind.String || name.GetString() is not { Length: > 0 and <= 200 } seriesName
                || !rule.TryGetProperty("fromSeason", out var from) || from.ValueKind != JsonValueKind.Number || !from.TryGetInt32(out var fromSeason)
                || !rule.TryGetProperty("toSeason", out var to) || to.ValueKind != JsonValueKind.Number || !to.TryGetInt32(out var toSeason)
                || fromSeason is < 0 or > 999 || toSeason is < 0 or > 999)
                throw new ApiAccessException(409, "MATCH_MAPPING_INVALID", "集数偏移规则内容无效");
            var offset = 0;
            if (rule.TryGetProperty("episodeOffset", out var value) && (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out offset) || offset is < -99999 or > 99999))
                throw new ApiAccessException(409, "MATCH_MAPPING_INVALID", "集数偏移超出允许范围");
            if (fromSeason != media.Mapping.Season || !media.SeriesName.Contains(seriesName, StringComparison.Ordinal)) continue;
            var mapped = media.Mapping.Episode + offset;
            if (mapped is null or < 0 or > 99999)
                throw new ApiAccessException(409, "MATCH_MAPPING_INVALID", "映射后的集号无效");
            return new("manual", toSeason, mapped, media.Mapping.Season, media.Mapping.Episode);
        }
        return null;
    }

    private static string? Clean(string? text, int length)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var clean = new string(text.Where(character => !char.IsControl(character)).ToArray()).Trim();
        return clean.Length <= length ? clean : clean[..length];
    }
}
