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

    public JsonPluginConfigurationStore(string configurationDirectory)
    {
        Directory.CreateDirectory(configurationDirectory);
        _filePath = Path.Combine(configurationDirectory, "DD.Danmaku.json");
    }

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
