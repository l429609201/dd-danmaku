namespace DD.Danmaku.Updates;

using System.Net;
using System.Text.Json;

/// <summary>只读取固定仓库正式发布，限制响应大小及下载重定向目标。</summary>
internal sealed class GitHubReleaseClient : IDisposable
{
    internal const string Repository = "l429609201/dd-danmaku";
    internal const string FileName = "DD.Danmaku.dll";
    internal const int MaxDllBytes = 64 * 1024 * 1024;
    private readonly HttpClient _client = new(new HttpClientHandler { AllowAutoRedirect = false })
    { Timeout = Timeout.InfiniteTimeSpan };

    internal GitHubReleaseClient()
    {
        _client.DefaultRequestHeaders.UserAgent.ParseAdd("DD-Danmaku-Updater/1.0");
        _client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
    }

    internal async Task<Release?> LatestAsync(string channel, CancellationToken token)
    {
        var isTest = channel == "test";
        var endpoint = isTest
            ? $"https://api.github.com/repos/{Repository}/releases/tags/test-release"
            : $"https://api.github.com/repos/{Repository}/releases/latest";
        using var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
        var credential = Plugin.Instance?.Configuration.GitHubToken;
        if (!string.IsNullOrWhiteSpace(credential))
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", credential);
        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();
        using var buffer = new MemoryStream();
        await CopyBoundedAsync(response, buffer, 1024 * 1024, token).ConfigureAwait(false);
        using var json = JsonDocument.Parse(buffer.ToArray());
        var root = json.RootElement;
        if (root.GetProperty("draft").GetBoolean() || !isTest && root.GetProperty("prerelease").GetBoolean()) return null;
        var tag = root.GetProperty("tag_name").GetString() ?? "";
        var version = isTest ? new Version(0, 0, 0, 0) : ParseReleaseVersion(tag);
        var assets = root.GetProperty("assets").EnumerateArray()
            .Where(a => a.GetProperty("name").GetString() == FileName).ToArray();
        if (assets.Length == 0) return null;
        if (assets.Length != 1) throw new InvalidDataException("发布中存在重复 DLL 附件。");
        var asset = assets[0];
        var size = asset.GetProperty("size").GetInt64();
        var url = new Uri(asset.GetProperty("browser_download_url").GetString() ?? "");
        if (size <= 0 || size > MaxDllBytes || url.Scheme != "https" || url.Host != "github.com"
            || !url.IsDefaultPort || url.UserInfo.Length != 0
            || !url.AbsolutePath.StartsWith($"/{Repository}/releases/download/", StringComparison.Ordinal))
            throw new InvalidDataException("发布附件地址或大小无效。");
        var digest = asset.TryGetProperty("digest", out var field) ? field.GetString() : null;
        return new Release(version, url, size, digest, isTest);
    }

    private static Version ParseReleaseVersion(string tag)
    {
        var versionText = tag.StartsWith('v') ? tag[1..] : tag;
        if (!Version.TryParse(versionText, out var parsed) || parsed.Build < 0)
            throw new InvalidDataException("正式发布标签必须为 v主.次.修订[.构建]。");
        return Normalize(parsed);
    }

    internal async Task DownloadAsync(Release release, string path, CancellationToken token)
    {
        var url = release.Url;
        for (var redirects = 0; redirects <= 5; redirects++)
        {
            if (url.Scheme != "https" || !url.IsDefaultPort || url.UserInfo.Length != 0
                || !(url.Host == "github.com" || url.Host == "release-assets.githubusercontent.com"
                    || url.Host == "objects.githubusercontent.com" || url.Host == "github-releases.githubusercontent.com"))
                throw new InvalidDataException("更新下载重定向到不受信任的地址。");
            using var response = await _client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token)
                .ConfigureAwait(false);
            if ((int)response.StatusCode is 301 or 302 or 303 or 307 or 308)
            {
                url = new Uri(url, response.Headers.Location ?? throw new InvalidDataException("缺少重定向地址。"));
                continue;
            }
            response.EnsureSuccessStatusCode();
            await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                81920, FileOptions.Asynchronous);
            await CopyBoundedAsync(response, file, release.Size, token).ConfigureAwait(false);
            if (file.Length != release.Size) throw new InvalidDataException("更新下载不完整。");
            await file.FlushAsync(token).ConfigureAwait(false);
            file.Flush(flushToDisk: true);
            return;
        }
        throw new InvalidDataException("更新下载重定向次数过多。");
    }

    private static async Task CopyBoundedAsync(HttpResponseMessage response, Stream target, long limit,
        CancellationToken token)
    {
        if (response.Content.Headers.ContentLength > limit) throw new InvalidDataException("更新响应超出大小限制。");
        await using var source = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false);
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await source.ReadAsync(buffer.AsMemory(), token).ConfigureAwait(false)) > 0)
        {
            total += read;
            if (total > limit) throw new InvalidDataException("更新响应超出大小限制。");
            await target.WriteAsync(buffer.AsMemory(0, read), token).ConfigureAwait(false);
        }
    }

    internal static Version Normalize(Version version)
        => new(version.Major, version.Minor, Math.Max(0, version.Build), Math.Max(0, version.Revision));
    public void Dispose() => _client.Dispose();
    internal sealed record Release(Version Version, Uri Url, long Size, string? Digest, bool IsTest);
}
