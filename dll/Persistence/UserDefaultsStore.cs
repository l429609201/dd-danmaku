namespace DD.Danmaku.Persistence;

using System.Text.Json;

/// <summary>用户默认值归属插件目录；旧数据目录与 XML 只作为读取回退。</summary>
internal sealed class UserDefaultsStore(string directory, string? legacyDirectory = null)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _options = new() { WriteIndented = true };

    private string FilePath(Guid id)
    {
        if (id == Guid.Empty) throw new ArgumentException("用户标识无效");
        return Path.Combine(directory, $"{id:N}.json");
    }

    internal async Task<FrontendDefaults> ReadAsync(Guid id, FrontendDefaults legacy)
    {
        await _gate.WaitAsync();
        try
        {
            var current = await ReadFileAsync(FilePath(id));
            if (current is not null) return current;
            if (legacyDirectory is null) return legacy.Copy();
            var oldPath = Path.Combine(legacyDirectory, $"{id:N}.json");
            var old = await ReadFileAsync(oldPath);
            if (old is null) return legacy.Copy();
            // 旧文件仅作为回退读取，统一参数文件写入成功前不移动或删除源文件。
            return old;
        }
        finally { _gate.Release(); }
    }

    private async Task<FrontendDefaults?> ReadFileAsync(string path)
    {
        try
        {
            await using var stream = File.OpenRead(path);
            if (stream.Length > 256 * 1024) throw new InvalidDataException("用户默认配置文件超过限制");
            var result = await JsonSerializer.DeserializeAsync<FrontendDefaults>(stream, _options)
                ?? throw new InvalidDataException("用户默认配置文件为空");
            result.Validate();
            return result;
        }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }

    internal async Task SaveAsync(Guid id, FrontendDefaults values)
    {
        values.Validate();
        await _gate.WaitAsync();
        try { await WriteUnlockedAsync(id, values, true); }
        finally { _gate.Release(); }
    }

    private async Task WriteUnlockedAsync(Guid id, FrontendDefaults values, bool overwrite)
    {
        var path = FilePath(id);
        Directory.CreateDirectory(directory);
        var temporary = path + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(values, _options);
            if (bytes.Length > 256 * 1024) throw new ArgumentException("用户默认配置超过限制");
            await File.WriteAllBytesAsync(temporary, bytes);
            File.Move(temporary, path, overwrite);
        }
        finally
        {
            // 清理异常不覆盖实际保存错误。
            try { File.Delete(temporary); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    private static void DeleteLegacyFile(string path)
    {
        try { File.Delete(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ParameterStoreException(409, "LEGACY_DEFAULTS_CLEANUP_REQUIRED",
                "新默认配置已创建并生效，但旧文件删除失败，请检查权限并手动清理旧文件");
        }
    }

    // 写入空覆盖而非物理删除，避免重置后旧 XML 默认值再次生效。
    internal Task ResetAsync(Guid id) => SaveAsync(id, new FrontendDefaults());
}
