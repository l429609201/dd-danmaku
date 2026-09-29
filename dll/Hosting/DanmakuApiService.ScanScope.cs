namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

/// <summary>媒体库的可选扫描范围。</summary>
/// <param name="Id">媒体库标识。</param>
/// <param name="Name">媒体库名称。</param>
public sealed record LibraryOption(string Id, string Name);
/// <summary>要扫描的媒体库标识列表；空列表表示全部。</summary>
/// <param name="LibraryIds">媒体库标识列表。</param>
public sealed record ScanScopeBody(string[] LibraryIds);
// 扫描范围不使用 dashboard 子路径，避免宿主返回旧网页迁移 HTML。
/// <summary>读取扫描范围的请求。</summary>
[Route("/dd-danmaku/api/library-scan/scope", "GET")]
public sealed class ScanScopeRequest { }
/// <summary>保存扫描范围的请求。</summary>
[Route("/dd-danmaku/api/library-scan/scope", "PUT")]
public sealed class SaveScanScopeRequest : IRequiresRequestStream
{
    /// <summary>包含媒体库列表的 JSON 请求体。</summary>
    public Stream RequestStream { get; set; } = Stream.Null;
}

public sealed partial class DanmakuApiService
{
    /// <summary>管理员查询媒体库扫描范围和可选媒体库。</summary>
    public Task<object> Get(ScanScopeRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return Task.FromResult(ApiHttpResult.Success(new
        {
            Libraries = host.Scan.LibraryOptions(), LibraryIds = plugin.Configuration.ScanLibraryIds ?? []
        }));
    });

    /// <summary>管理员保存已验证的媒体库扫描范围。</summary>
    public Task<object> Put(SaveScanScopeRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 65536, "application/json");
        var body = ApiHttpResult.Parse<ScanScopeBody>(bytes);
        if (body.LibraryIds is null) throw new ArgumentException("必须明确提交扫描范围");
        var ids = body.LibraryIds.Distinct(StringComparer.Ordinal).ToArray();
        var available = host.Scan.LibraryOptions().Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        if (ids.Any(id => !available.Contains(id))) throw new ArgumentException("媒体库不存在，请刷新后重新选择");
        // 空数组明确表示全库；仅改扫描字段，避免覆盖其他管理员设置。
        lock (PluginConfigurationService.ConfigurationGate)
        {
            var copy = plugin.Configuration.CopyForUpdate();
            copy.ScanLibraryIds = ids;
            plugin.UpdateConfiguration(copy);
            return ApiHttpResult.Success(new { LibraryIds = ids });
        }
    });
}
