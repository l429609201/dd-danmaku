namespace DD.Danmaku.Hosting;

using System.Text.Json;
using DD.Danmaku.Web.Api;

/// <summary>绑定后台任务的弹幕生成与轮询，不接收客户端 URL 或凭据。</summary>
internal static class BackendCommentDownload
{
    /// <summary>恢复已受理任务或生成新正文；最终正文保存和选择意图核验由调用者负责。</summary>
    internal static async Task<byte[]> RunAsync(BackendTaskCoordinator.Context context, bool supportsAsync,
        int chConvert, string episodeId, Func<string, CancellationToken, Task<byte[]>> fetch,
        Func<CancellationToken, Task> authorize)
    {
        if (!Identifier(episodeId) || chConvert is < 0 or > 2) throw new ArgumentException("弹幕下载参数无效");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.Token);
        deadline.CancelAfter(TimeSpan.FromMinutes(10));
        var token = deadline.Token;
        var commentPath = "/comment/" + episodeId + "?withRelated=true&chConvert=" + chConvert;
        try
        {
            var record = context.Download;
            string? taskId = record?.UpstreamTaskId;
            if (taskId is not null && !Identifier(taskId)) throw Protocol();
            if (record?.State == "fetching" && taskId is null)
                throw new ApiAccessException(502, "UPSTREAM_ACCEPTANCE_UNKNOWN", "无法确认上游是否已受理，已停止重复创建任务");
            if (record?.State == "polling" && taskId is null) throw Protocol();
            if (record is not null && record.State is not ("accepted" or "fetching" or "polling" or "saving")) throw Protocol();
            if (taskId is null)
            {
                // saving 恢复只重取同步正文，绝不再次建立生成任务。
                var create = record?.State != "saving";
                await authorize(token);
                token.ThrowIfCancellationRequested();
                if (create) context.Checkpoint("fetching");
                context.Progress("fetch");
                var raw = await fetch(commentPath + (create && supportsAsync ? "&async=1" : ""), token);
                using var json = Parse(raw);
                var payload = TaskPayload(json.RootElement);
                var status = Status(payload);
                if (status is "failed" or "error" or "cancelled" or "canceled")
                    throw new ApiAccessException(502, "UPSTREAM_TASK_FAILED", "上游弹幕生成任务失败");
                if (status == "pending")
                {
                    if (!create || !supportsAsync || !payload.TryGetProperty("taskId", out var id)
                        || id.ValueKind != JsonValueKind.String || !Identifier(id.GetString())) throw Protocol();
                    taskId = id.GetString()!;
                    context.Checkpoint("polling", taskId);
                }
                else
                {
                    if (status is not null || !Comments(json.RootElement)) throw Protocol();
                    context.Checkpoint("saving");
                    return raw;
                }
            }
            var firstPoll = true;
            while (true)
            {
                // 已受理任务首次立即核验状态，后续仍保持一秒节流，避免人为增加首轮等待。
                if (!firstPoll) await Task.Delay(TimeSpan.FromSeconds(1), token);
                firstPoll = false;
                await authorize(token);
                token.ThrowIfCancellationRequested();
                context.Progress("poll");
                var raw = await fetch("/taskcomment/" + taskId, token);
                using var json = Parse(raw);
                var payload = TaskPayload(json.RootElement);
                var status = Status(payload);
                var progress = Progress(payload);
                if (progress.HasValue) context.Progress("poll", progress);
                if (status is "failed" or "error" or "cancelled" or "canceled")
                    throw new ApiAccessException(502, "UPSTREAM_TASK_FAILED", "上游弹幕生成任务失败");
                if (status is "completed" or "complete" or "success" or "succeeded" or "done" or "finished")
                {
                    context.Progress("authorize");
                    await authorize(token);
                    token.ThrowIfCancellationRequested();
                    // 生成100%不等于正文已到位，切换阶段避免一直显示轮询完成而实际仍等待下载。
                    context.Progress("fetch");
                    var finalRaw = await fetch(commentPath, token);
                    using var final = Parse(finalRaw);
                    if (Status(TaskPayload(final.RootElement)) is not null || !Comments(final.RootElement)) throw Protocol();
                    context.Checkpoint("saving");
                    return finalRaw;
                }
                if (status is not ("pending" or "running" or "processing" or "queued")) throw Protocol();
            }
        }
        catch (OperationCanceledException) when (!context.Token.IsCancellationRequested)
        { throw new ApiAccessException(504, "UPSTREAM_TIMEOUT", "上游弹幕生成超时"); }
    }

    private static JsonDocument Parse(byte[] raw)
    {
        try
        {
            var json = JsonDocument.Parse(raw, new JsonDocumentOptions { MaxDepth = 32 });
            try
            {
                MatchJson.RejectDuplicateProperties(json.RootElement);
                RejectFailure(json.RootElement);
                return json;
            }
            catch { json.Dispose(); throw; }
        }
        catch (JsonException) { throw Protocol(); }
    }

    private static void RejectFailure(JsonElement item)
    {
        if (item.ValueKind != JsonValueKind.Object) return;
        if (item.TryGetProperty("success", out var success))
        {
            if (success.ValueKind == JsonValueKind.False)
                throw new ApiAccessException(502, "UPSTREAM_BUSINESS_ERROR", "上游未返回成功弹幕结果");
            if (success.ValueKind != JsonValueKind.True) throw Protocol();
        }
        foreach (var key in new[] { "data", "result", "task" })
            if (item.TryGetProperty(key, out var nested)) RejectFailure(nested);
    }

    private static JsonElement TaskPayload(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return root;
        if (root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object) return data;
        if (root.TryGetProperty("task", out var task) && task.ValueKind == JsonValueKind.Object) return task;
        return root;
    }

    private static string? Status(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object) return null;
        if (!payload.TryGetProperty("status", out var status) && !payload.TryGetProperty("state", out status)) return null;
        if (status.ValueKind != JsonValueKind.String || status.GetString() is not { Length: > 0 and <= 32 } text) throw Protocol();
        return text.ToLowerInvariant();
    }

    private static int? Progress(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object) return null;
        if (!payload.TryGetProperty("progress", out var value) && !payload.TryGetProperty("percent", out value)) return null;
        // 不解析字符串或执行表达式；仅发布有限数值进度。
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number)
            || !double.IsFinite(number) || number is < 0 or > 100) return null;
        return (int)number;
    }

    private static bool Comments(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array) return true;
        if (root.ValueKind != JsonValueKind.Object) return false;
        if (root.TryGetProperty("commentMissing", out var missing) && missing.ValueKind != JsonValueKind.False) return false;
        if (root.TryGetProperty("comments", out var comments)) return comments.ValueKind == JsonValueKind.Array;
        foreach (var key in new[] { "data", "result" })
            if (root.TryGetProperty(key, out var nested) && Comments(nested)) return true;
        return false;
    }

    private static bool Identifier(string? text) => text is { Length: > 0 and <= 160 }
        && text.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');
    private static ApiAccessException Protocol() => new(502, "UPSTREAM_PROTOCOL_MISMATCH", "上游弹幕任务协议无效");
}
