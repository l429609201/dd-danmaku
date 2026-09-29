namespace DD.Danmaku.Hosting;

using DD.Danmaku.Updates;
using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>读取管理员配置的 GitHub 凭据状态。</summary>
[Route("/dd-danmaku/api/config/github", "GET")]
public sealed class GitHubSettingsRequest { }
/// <summary>保存或清除 GitHub 访问凭据。</summary>
[Route("/dd-danmaku/api/config/github", "PUT")]
public sealed class SaveGitHubSettingsRequest : IRequiresRequestStream
{
    /// <summary>包含凭据变更的 JSON 请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}
/// <summary>手动检查最新的正式版 DLL 更新。</summary>
[Route("/dd-danmaku/api/updates/check", "GET")]
public sealed class CheckGitHubUpdateRequest { }
/// <summary>管理员提交的 GitHub 凭据变更。</summary>
/// <param name="Token">新凭据；空值表示保留旧值。</param>
/// <param name="ClearToken">是否明确清除现有凭据。</param>
public sealed record GitHubSettingsBody(string? Token, bool ClearToken);

public sealed partial class DanmakuApiService
{
    /// <summary>读取管理员 GitHub 配置，回包使用会话凭据保护。</summary>
    public Task<object> Get(GitHubSettingsRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        // 读取和保存回包都使用同一管理员会话混淆。
        return Task.FromResult(SecretSuccess(new { HasToken = !string.IsNullOrEmpty(plugin.Configuration.GitHubToken), Token = plugin.Configuration.GitHubToken }));
    });

    /// <summary>保存或清除管理员 GitHub 访问凭据。</summary>
    public Task<object> Put(SaveGitHubSettingsRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 8192, "application/json");
        var body = ApiHttpResult.Parse<GitHubSettingsBody>(bytes);
        var value = body.Token?.Trim();
        if (value is { Length: > 4096 } || value?.Any(c => c <= 32 || c >= 127) == true
            || body.ClearToken && !string.IsNullOrEmpty(value)) throw new ArgumentException("Token 格式无效");
        // 留空不改变凭据，删除必须明确提交；其他设置保存不触碰此字段。
        lock (PluginConfigurationService.ConfigurationGate)
        {
            var copy = plugin.Configuration.CopyForUpdate();
            if (body.ClearToken) copy.GitHubToken = null;
            else if (!string.IsNullOrEmpty(value)) copy.GitHubToken = value;
            plugin.UpdateConfiguration(copy);
            return SecretSuccess(new { HasToken = !string.IsNullOrEmpty(copy.GitHubToken), Token = copy.GitHubToken });
        }
    });

    /// <summary>检查公开发行版中的 DLL 更新，不执行安装。</summary>
    public Task<object> Get(CheckGitHubUpdateRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(Request.CancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        using var client = new GitHubReleaseClient();
        try
        {
            var channel = plugin.Configuration.UpdateChannel is "test" ? "test" : "main";
            var release = await client.LatestAsync(channel, deadline.Token);
            // 只提供选定频道的发行版与公开附件链接，绝不调用下载替换安装流程。
            return ApiHttpResult.Success(new
            {
                Channel = channel,
                CurrentVersion = ScriptVersion.Current,
                LatestVersion = release is { IsTest: true } ? "test" : release?.Version.ToString(3),
                DownloadUrl = release?.Url.AbsoluteUri,
                ReleaseUrl = $"https://github.com/{GitHubReleaseClient.Repository}/releases",
                Message = release is null ? $"未找到 {channel} 频道的 DLL 附件" : "检查完成；下载后请手动安装"
            });
        }
        catch (HttpRequestException)
        { throw new ApiAccessException(502, "GITHUB_REQUEST_FAILED", "GitHub 请求失败，请检查网络、Token 权限或 API 限流"); }
        catch (OperationCanceledException) when (!Request.CancellationToken.IsCancellationRequested)
        { throw new ApiAccessException(504, "GITHUB_TIMEOUT", "GitHub 检查超时，请稍后重试"); }
    });
}
