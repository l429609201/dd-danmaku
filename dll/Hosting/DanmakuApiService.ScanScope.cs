namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;

public sealed record LibraryOption(string Id, string Name);
public sealed record ScanScopeBody(string[] LibraryIds);
// 扫描范围不使用 dashboard 子路径，避免宿主返回旧网页迁移 HTML。
[Route("/dd-danmaku/api/library-scan/scope", "GET")]
public sealed class ScanScopeRequest { }
[Route("/dd-danmaku/api/library-scan/scope", "PUT")]
public sealed class SaveScanScopeRequest : IRequiresRequestStream
{
    public Stream RequestStream { get; set; } = Stream.Null;
}

public sealed partial class DanmakuApiService
{
    public Task<object> Get(ScanScopeRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        return Task.FromResult(ApiHttpResult.Success(new
        {
            Libraries = host.Scan.LibraryOptions(), LibraryIds = plugin.Configuration.ScanLibraryIds ?? []
        }));
    });

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
