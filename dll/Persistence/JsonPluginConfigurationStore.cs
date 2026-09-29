namespace DD.Danmaku.Persistence;

using System.Text.Json;

/// <summary>
/// DLL 自有配置的最小 JSON 持久化实现。实际 Emby 配置保存适配器接入后可替换。
/// </summary>
public sealed class JsonPluginConfigurationStore
{
    private readonly string _filePath;
    private readonly JsonSerializerOptions _options = new() { PropertyNamingPolicy = null, WriteIndented = true };
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>在指定目录创建独立 JSON 配置文件。</summary>
    public JsonPluginConfigurationStore(string configurationDirectory)
    {
        Directory.CreateDirectory(configurationDirectory);
        _filePath = Path.Combine(configurationDirectory, "DD.Danmaku.json");
    }

    /// <summary>读取已保存配置；文件不存在时返回默认配置。</summary>
    public async Task<PluginConfiguration> LoadAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_filePath)) return new PluginConfiguration();
            await using var stream = File.OpenRead(_filePath);
            return await JsonSerializer.DeserializeAsync<PluginConfiguration>(stream, _options, cancellationToken)
                ?? new PluginConfiguration();
        }
        finally { _gate.Release(); }
    }

    /// <summary>保存配置到临时文件后替换旧文件。</summary>
    public async Task SaveAsync(PluginConfiguration configuration, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var tempPath = _filePath + ".tmp";
            await using (var stream = File.Create(tempPath))
            {
                await JsonSerializer.SerializeAsync(stream, configuration, _options, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }
            File.Move(tempPath, _filePath, true);
        }
        finally { _gate.Release(); }
    }
}
