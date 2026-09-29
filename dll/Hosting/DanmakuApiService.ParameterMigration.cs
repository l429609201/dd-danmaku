namespace DD.Danmaku.Hosting;

using MediaBrowser.Model.Services;

/// <summary>管理员显式转换当前用户旧参数；不接受客户端参数正文。</summary>
[Route("/dd-danmaku/api/parameter-files/{UserId}/convert", "POST")]
public sealed class ConvertParameterFileRequest
{
    public string UserId { get; set; } = "";
}

public sealed partial class DanmakuApiService
{
    public Task<object> Post(ConvertParameterFileRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        // 已删除用户的旧文件同样允许迁移，不创建或修改 Emby 账号。
        var id = DefaultUserId(request.UserId, false);
        var count = await plugin.Parameters.StoreFor(id).ConvertLegacyAsync(Request.CancellationToken);
        return ApiHttpResult.Success(new { Converted = true, Count = count });
    });
}
