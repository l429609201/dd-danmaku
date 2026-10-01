namespace DD.Danmaku.Hosting;

using System.Security.Cryptography;
using DD.Danmaku.Danmaku;
using MediaBrowser.Model.Services;

/// <summary>读取共享正文版本供显式覆盖确认，不返回文件路径。</summary>
[Route("/dd-danmaku/api/items/{ItemId}/shared-version", "GET")]
public sealed class SharedVersionRequest
{
    /// <summary>媒体标识。</summary>
    public string ItemId { get; set; } = "";
    /// <summary>共享来源。</summary>
    public string? Source { get; set; }
}

public sealed partial class DanmakuApiService
{
    /// <summary>拥有上传权限才可申请覆盖版本；最终操作仍再次检查独立覆盖授权。</summary>
    public Task<object> Get(SharedVersionRequest request) => Execute(async (user, plugin, host) =>
    {
        var id = _access.RequireVideo(user, request.ItemId);
        DanmakuWritePolicy.Require(user, plugin.Configuration, DanmakuWritePolicy.Operation.UploadShared);
        var hash = await host.Playback.SharedVersionAsync(id, request.Source, Request.CancellationToken);
        return ApiHttpResult.Success(new { Exists = hash is not null, ExpectedHash = hash });
    });
}

internal sealed partial class LocalPlaybackService
{
    internal async Task<string?> SharedVersionAsync(string id, string? source, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            var path = await RequirePathAsync(id, token, source);
            try
            {
                await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                if (input.Length > DanmakuXml.MaxBytes) throw new IOException("共享 XML 超过限制");
                return Convert.ToHexString(await SHA256.HashDataAsync(input, token));
            }
            catch (FileNotFoundException) { return null; }
            catch (DirectoryNotFoundException) { return null; }
        }
        finally { _gate.Release(); }
    }
}
