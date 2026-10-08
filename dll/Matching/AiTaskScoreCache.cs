namespace DD.Danmaku.Matching;

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// 只由单次任务持有；分区不共享结果，但共享成功条数与内存预算，绝不提升为全局缓存。
internal sealed class AiTaskScoreCache
{
    private sealed class Budget
    {
        internal readonly object Sync = new();
        internal int Count;
        internal int Bytes;
    }

    private readonly Budget _budget;
    private readonly Dictionary<string, string> _outputs = new(StringComparer.Ordinal);
    internal AiTaskScoreCache() : this(new Budget()) { }
    private AiTaskScoreCache(Budget budget) => _budget = budget;
    internal AiTaskScoreCache CreatePartition() => new(_budget);

    // 键只保留哈希；最终提示词包含证据、范围、目标、评分ID和规则完整性，不记录模型凭据。
    internal static string CreateKey(string prompt, PluginConfiguration config)
    {
        var endpoint = config.GetAiEndpoint();
        var identity = JsonSerializer.Serialize(new
        {
            Version = "ai-task-score-v1", Prompt = prompt,
            endpoint.Url, endpoint.Model, endpoint.Key,
            config.AiEnabled, config.AiConfidenceThreshold, config.AiTimeoutSeconds, config.AiMaxCandidates
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)));
    }

    internal bool TryRead(string key, out string output)
    {
        lock (_budget.Sync) return _outputs.TryGetValue(key, out output!);
    }

    // 仅结构与候选校验成功后写入；超过预算继续正常调用，不淘汰、不缓存失败。
    internal void TryStore(string key, string output)
    {
        var bytes = Encoding.UTF8.GetByteCount(key) + Encoding.UTF8.GetByteCount(output);
        lock (_budget.Sync)
        {
            if (_outputs.ContainsKey(key) || _budget.Count >= 64 || bytes > 2 * 1024 * 1024 - _budget.Bytes) return;
            _outputs.Add(key, output);
            _budget.Count++;
            _budget.Bytes += bytes;
        }
    }
}
