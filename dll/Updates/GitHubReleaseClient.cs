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
        EnsureSuccess(response, "检查更新", !string.IsNullOrWhiteSpace(credential));
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

    // 仅使用状态码和受限响应头判断，不把上游正文、地址或凭据写入任务错误。
    private static void EnsureSuccess(HttpResponseMessage response, string operation, bool authenticated)
    {
        if (response.IsSuccessStatusCode) return;
        var status = (int)response.StatusCode;
        var remaining = response.Headers.TryGetValues("X-RateLimit-Remaining", out var values)
            && values.Contains("0", StringComparer.Ordinal);
        var limited = status == 429 || status == 403 && (remaining
            || response.Headers.RetryAfter is not null
            || string.Equals(response.ReasonPhrase, "rate limit exceeded", StringComparison.OrdinalIgnoreCase));
        if (limited)
        {
            var retry = response.Headers.RetryAfter;
            DateTimeOffset? retryAt = retry?.Date;
            if (retry?.Delta is { } delay && delay >= TimeSpan.Zero && delay <= TimeSpan.FromDays(7))
                retryAt = DateTimeOffset.UtcNow.Add(delay);
            if (retryAt is null && response.Headers.TryGetValues("X-RateLimit-Reset", out var resets)
                && long.TryParse(resets.FirstOrDefault(), out var seconds) && seconds is >= 0 and <= 253402300799)
                retryAt = DateTimeOffset.FromUnixTimeSeconds(seconds);
            var when = retryAt is { } at && at > DateTimeOffset.UtcNow
                ? $"建议在 {at:yyyy-MM-dd HH:mm:ss} UTC 后重试。" : "请稍后重试，避免连续执行更新任务。";
            var advice = authenticated
                ? "已使用 GitHub Token，请检查该 Token 的额度或共享出口限流情况。"
                : "可在插件更新设置中配置 GitHub Token，提高 API 请求额度；共享公网出口也可能被其他设备耗尽额度。";
            throw new UpdateRequestException($"{operation}失败：GitHub 请求被限流（HTTP {status}）。{when}{advice}");
        }
        var reason = status switch
        {
            401 => "GitHub 凭据无效或已过期，请检查更新设置中的 GitHub Token。",
            403 => "GitHub 拒绝访问，请检查 Token 权限或网络访问限制；此状态不一定是限流。",
            404 => "发布附件不存在或已被移除，请稍后重新检查版本。",
            >= 500 => "GitHub 服务暂时不可用，请稍后重试。",
            _ => "GitHub 请求未成功，请检查网络及更新配置。"
        };
        throw new UpdateRequestException($"{operation}失败（HTTP {status}）：{reason}");
    }

    internal sealed class UpdateRequestException : Exception
    {
        internal UpdateRequestException(string message) : base(message) { }
    }

    private static Version ParseReleaseVersion(string tag)
    {
        var versionText = tag.StartsWith('v') ? tag[1..] : tag;
        if (!Version.TryParse(versionText, out var parsed) || parsed.Build < 0)
            throw new InvalidDataException("正式发布标签必须为 v主.次.修订[.构建]。");
        return Normalize(parsed);
    }

    internal async Task DownloadAsync(Release release, string path, CancellationToken token,
        Action<long>? onDownloaded = null)
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
            EnsureSuccess(response, "下载更新", false);
            await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                81920, FileOptions.Asynchronous);
            await CopyBoundedAsync(response, file, release.Size, token, onDownloaded).ConfigureAwait(false);
            if (file.Length != release.Size) throw new InvalidDataException("更新下载不完整。");
            await file.FlushAsync(token).ConfigureAwait(false);
            file.Flush(flushToDisk: true);
            return;
        }
        throw new InvalidDataException("更新下载重定向次数过多。");
    }

    private static async Task CopyBoundedAsync(HttpResponseMessage response, Stream target, long limit,
        CancellationToken token, Action<long>? onDownloaded = null)
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
            // 在实际写入后同步报告字节数，避免异步回调迟到覆盖任务完成状态。
            onDownloaded?.Invoke(total);
        }
    }

    internal static Version Normalize(Version version)
        => new(version.Major, version.Minor, Math.Max(0, version.Build), Math.Max(0, version.Revision));
    public void Dispose() => _client.Dispose();
    internal sealed record Release(Version Version, Uri Url, long Size, string? Digest, bool IsTest);
}
