namespace DD.Danmaku.Hosting;

using System.Globalization;
using System.Xml;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

/// <summary>单个媒体库的只读旁车统计；缺失、跳过和访问失败分别计数。</summary>
public sealed class LibraryScanRow
{
    public string Name { get; set; } = "";
    public int Total { get; set; }
    public int Present { get; set; }
    public int Missing { get; set; }
    public int Skipped { get; set; }
    public int Errors { get; set; }
    public int Valid { get; set; }
    public int Invalid { get; set; }
    public int Empty { get; set; }
    public long Comments { get; set; }
    public long Bytes { get; set; }
    public double Coverage => Present + Missing == 0 ? 0 : Math.Round(100d * Present / (Present + Missing), 1);
}

/// <summary>从媒体库分页枚举，只读本地视频或 STRM 旁边的同名 XML。</summary>
internal sealed class LibraryScanner(ILibraryManager library)
{
    internal List<LibraryScanRow> Scan(bool deep, CancellationToken token, Action<int> progress,
        Action<ScanRecordEntry> discovered, IProgress<double>? taskProgress = null)
    {
        var rows = new List<LibraryScanRow>();
        // 在任务启动时捕获范围；旧配置为空时保持全库扫描，失效选择不得回退全库。
        var selected = (Plugin.Instance?.Configuration.ScanLibraryIds ?? []).ToHashSet(StringComparer.Ordinal);
        var folders = library.GetVirtualFolders()
            .Where(folder => selected.Count == 0 || selected.Contains(folder.ItemId)).ToArray();
        if (selected.Count > 0 && folders.Length != selected.Count)
            throw new InvalidOperationException("所选媒体库已变更，请重新保存扫描范围");
        for (var index = 0; index < folders.Length; index++)
        {
            var folder = folders[index];
            token.ThrowIfCancellationRequested();
            if (!long.TryParse(folder.ItemId, out var id)) continue;
            var row = new LibraryScanRow { Name = folder.Name };
            rows.Add(row);
            for (var start = 0; ; start += 200)
            {
                token.ThrowIfCancellationRequested();
                var page = library.GetItemsResult(new InternalItemsQuery
                {
                    Recursive = true, AncestorIds = [id], MediaTypes = ["Video"],
                    IsFolder = false, StartIndex = start, Limit = 200
                });
                foreach (var item in page.Items)
                {
                    token.ThrowIfCancellationRequested();
                    row.Total++;
                    Inspect(item, row, deep, token, discovered);
                    progress(rows.Sum(x => x.Total));
                }
                // 媒体库等权、库内按分页计数估算；快照落盘前不报告完成。
                var fraction = page.TotalRecordCount > 0
                    ? Math.Min(1d, (start + page.Items.Length) / (double)page.TotalRecordCount) : 0d;
                taskProgress?.Report(99d * (index + fraction) / folders.Length);
                if (page.Items.Length < 200) break;
            }
            taskProgress?.Report(99d * (index + 1) / folders.Length);
        }
        return rows;
    }

    private static void Inspect(BaseItem item, LibraryScanRow row, bool deep, CancellationToken token,
        Action<ScanRecordEntry> discovered)
    {
        var path = item.Path;
        if (item is not Video || string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path)
            || Uri.TryCreate(path, UriKind.Absolute, out var uri) && !uri.IsFile)
        { row.Skipped++; return; }
        try
        {
            // 不追踪符号链接或 STRM 内容，不将访问失败伪报为缺少弹幕。
            var full = Path.GetFullPath(path);
            if ((File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0)
            { row.Skipped++; return; }
            for (var dir = Directory.GetParent(full); dir is not null; dir = dir.Parent)
                if ((dir.Attributes & FileAttributes.ReparsePoint) != 0)
                { row.Skipped++; return; }
            var mediaStem = Path.GetFileNameWithoutExtension(full);
            var directory = Path.GetDirectoryName(full)!;
            // 同时识别精确同名 XML 和来源后缀 XML，例如 _BilibiliDX.xml、_TencentDX.xml。
            // 不把媒体名放入通配符；精确匹配大小写，确保 Linux 上可按来源重新寻址。
            var xmlFiles = Directory.EnumerateFiles(directory, "*.xml", SearchOption.TopDirectoryOnly)
                .Where(path => string.Equals(Path.GetFileNameWithoutExtension(path), mediaStem, StringComparison.Ordinal)
                    || Path.GetFileNameWithoutExtension(path).StartsWith(mediaStem + "_", StringComparison.Ordinal))
                .Distinct(StringComparer.Ordinal).ToArray();
            if (xmlFiles.Length == 0) { row.Missing++; return; }
            foreach (var xml in xmlFiles)
            {
                token.ThrowIfCancellationRequested();
                FileAttributes attributes;
                try { attributes = File.GetAttributes(xml); }
                catch (FileNotFoundException) { continue; }
                if ((attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0) { row.Skipped++; continue; }
                row.Present++;
                var stem = Path.GetFileNameWithoutExtension(xml);
                var source = stem.Length == mediaStem.Length ? null : stem[(mediaStem.Length + 1)..];
                // 来源必须能由既有旁车接口准确寻址，不通过修剪改变实际文件名。
                if (source is not null && (source.Length is 0 or > 64 || source != source.Trim()
                    || source.Any(c => char.IsControl(c) || "<>:\"/\\|?*".Contains(c))))
                { row.Skipped++; continue; }
                var entry = new ScanRecordEntry(item.Id.ToString(), source, xml, null);
                discovered(entry);
                if (!deep) continue;
                var info = new FileInfo(xml);
                row.Bytes += info.Length;
                if (info.Length > 32 * 1024 * 1024) { row.Invalid++; continue; }
                try
                {
                    using var reader = XmlReader.Create(xml, new XmlReaderSettings
                    { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 32 * 1024 * 1024 });
                    reader.MoveToContent();
                    if (reader.Name != "i") { row.Invalid++; continue; }
                    long count = 0;
                    while (reader.Read())
                    {
                        token.ThrowIfCancellationRequested();
                        if (reader.NodeType != XmlNodeType.Element || reader.Name != "d") continue;
                        var fields = (reader.GetAttribute("p") ?? "").Split(',');
                        if (fields.Length < 4 || !double.TryParse(fields[0], NumberStyles.Float,
                            CultureInfo.InvariantCulture, out var time) || !double.IsFinite(time) || time < 0)
                            throw new XmlException("弹幕属性无效");
                        count++;
                        if (count > Danmaku.DanmakuXml.MaxComments) throw new XmlException("弹幕条数超过限制");
                    }
                    // 只有完整解析成功才发布实际条数；无效 XML 保持未校验状态。
                    discovered(entry with { Count = (int)count });
                    row.Valid++; row.Comments += count;
                    if (count == 0) row.Empty++;
                }
                // 单份 XML 格式错误仅计为无效，继续扫描其他来源文件。
                catch (XmlException) { row.Invalid++; }
            }
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { row.Errors++; }
    }
}
