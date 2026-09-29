namespace DD.Danmaku.Matching;

using System.Text;
using System.Text.RegularExpressions;

internal static class MatchMetadata
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMilliseconds(100);
    private static readonly Regex Season = new(
        @"(?<![\p{L}\p{N}])(?:s|season\s*)(?<n>[0-9]{1,3})(?=e[0-9]|[^\p{L}\p{N}]|$)|第\s*(?<n>[零〇一二两三四五六七八九十百0-9]+)\s*[季部期]",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout);
    private static readonly Regex Episode = new(
        @"(?<![\p{L}\p{N}])(?:episode|ep|e)\s*(?<n>[0-9]{1,5})(?![\p{L}\p{N}])|第\s*(?<n>[零〇一二两三四五六七八九十百0-9]+)\s*[集话話]",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout);
    private static readonly Regex Roman = new(
        @"\s+(?<n>VIII|VII|VI|IV|IX|III|II|V|X|I)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, Timeout);
    private static readonly string[] Romans = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

    public static string Normalize(string? text)
        => new((text ?? "").Normalize(NormalizationForm.FormKC).ToLowerInvariant()
            .Where(char.IsLetterOrDigit).ToArray());

    public static string FileTitle(string? fileName)
    {
        var name = fileName ?? "";
        var dot = name.LastIndexOf('.');
        return dot >= 0 && new[] { ".mkv", ".mp4", ".avi", ".ts", ".m2ts", ".strm", ".mov", ".wmv" }
            .Contains(name[dot..], StringComparer.OrdinalIgnoreCase) ? name[..dot] : name;
    }

    public static (string Title, int? Season, int? Episode) Parse(string? text, bool episodic)
    {
        var title = text ?? "";
        if (!episodic) return (title, null, null);
        var season = Season.Match(title);
        int? s = season.Success ? Number(season.Groups["n"].Value) : null;
        // Replace with a space so S02E03 becomes E03 with a valid left boundary.
        if (season.Success) title = title.Remove(season.Index, season.Length).Insert(season.Index, " ");
        var episode = Episode.Match(title);
        int? e = episode.Success ? Number(episode.Groups["n"].Value) : null;
        if (episode.Success) title = title.Remove(episode.Index, episode.Length);
        if (s is null)
        {
            var roman = Roman.Match(title);
            if (roman.Success)
            {
                s = Array.FindIndex(Romans, r => r.Equals(roman.Groups["n"].Value, StringComparison.OrdinalIgnoreCase)) + 1;
                title = title[..roman.Index];
            }
        }
        return (title.Trim(' ', '.', '_', '-'), s, e);
    }

    private static int? Number(string value)
    {
        if (int.TryParse(value, out var n)) return n;
        var total = 0;
        var digit = 0;
        foreach (var c in value)
        {
            if (c is '十' or '百') { total += (digit == 0 ? 1 : digit) * (c == '十' ? 10 : 100); digit = 0; }
            else
            {
                digit = "零一二三四五六七八九".IndexOf(c);
                if (c == '〇') digit = 0;
                if (c == '两') digit = 2;
                if (digit < 0) return null;
            }
        }
        return total + digit;
    }

    public static decimal Similarity(string? a, string? b)
    {
        var left = Normalize(a); var right = Normalize(b);
        if (left.Length == 0 || right.Length == 0) return 0;
        if (left == right) return 1;
        var previous = Enumerable.Range(0, right.Length + 1).ToArray();
        for (var i = 1; i <= left.Length; i++)
        {
            var current = new int[right.Length + 1]; current[0] = i;
            for (var j = 1; j <= right.Length; j++)
                current[j] = Math.Min(Math.Min(current[j - 1], previous[j]) + 1,
                    previous[j - 1] + (left[i - 1] == right[j - 1] ? 0 : 1));
            previous = current;
        }
        return 1m - (decimal)previous[right.Length] / Math.Max(left.Length, right.Length);
    }
}
