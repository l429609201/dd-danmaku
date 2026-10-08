namespace DD.Danmaku.Matching;

using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

/// <summary>服务端配置驱动的兼容提供者；实例由宿主持有并在卸载时释放。</summary>
public sealed class OpenAiCompatibleProvider : IAiProvider, IDisposable
{
    private readonly Func<PluginConfiguration> _configuration;
    // 禁止自动重定向，避免向另一主机发送匹配内容或凭据。
    private readonly HttpClient _client;
    private readonly Action<string, long>? _diagnostic;
    /// <summary>使用服务端配置创建不自动重定向的 AI 客户端。</summary>
    public OpenAiCompatibleProvider(Func<PluginConfiguration> configuration)
        : this(configuration, new HttpClientHandler { AllowAutoRedirect = false }) { }
    /// <summary>注入传输及脱敏耗时观察器，测试与运行使用同一请求解析逻辑。</summary>
    public OpenAiCompatibleProvider(Func<PluginConfiguration> configuration, HttpMessageHandler handler,
        Action<string, long>? diagnostic = null)
    {
        _configuration = configuration;
        _client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        _diagnostic = diagnostic;
    }
    /// <summary>兼容提供者的标识名称。</summary>
    public string Name => "openai-compatible";
    /// <summary>是否存在可用的服务端 AI 端点。</summary>
    public bool IsAvailable => GetEndpoint(_configuration()) is not null;

    private sealed record Endpoint(Uri BaseUrl, string Model, string? Key);
    private static Endpoint? GetEndpoint(PluginConfiguration config)
    {
        var (address, model, key) = config.GetAiEndpoint();
        if (!config.AiEnabled || !PluginConfiguration.ValidAiEndpoint(address, model, key)) return null;
        return new Endpoint(new Uri(address!.TrimEnd('/')), model!,
            string.IsNullOrWhiteSpace(key) ? null : key);
    }

    /// <summary>按地址显式路径优先，否则先尝试 Responses，失败后兼容 Chat Completions。</summary>
    internal static Uri BuildEndpoint(Uri baseUrl, bool responses)
    {
        var path = baseUrl.AbsolutePath.TrimEnd('/');
        if (path.EndsWith("/responses", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase)) return baseUrl;
        return new UriBuilder(baseUrl) { Path = path + "/" + (responses ? "responses" : "chat/completions"), Query = "", Fragment = "" }.Uri;
    }

    /// <summary>向兼容端点请求结构化的匹配结果。</summary>
    public async Task<string> CompleteStructuredAsync(string prompt, CancellationToken cancellationToken)
    {
        var config = _configuration();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Clamp(config.AiTimeoutSeconds, 1, 120)));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        var endpoint = GetEndpoint(config)
            ?? throw new MatchRequestException("AI 提供者未配置", "AI_UNAVAILABLE", 503);
        var elapsed = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var path = endpoint.BaseUrl.AbsolutePath;
            var explicitResponses = path.EndsWith("/responses", StringComparison.OrdinalIgnoreCase);
            var explicitChat = path.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase);
            if (!explicitChat)
            {
                try { return await SendAsync(endpoint, prompt, true, linked.Token); }
                // 仅接口/参数不兼容时切换协议；认证、限流和网络错误不能靠重复请求解决。
                catch (HttpRequestException error) when (!explicitResponses
                    && error.StatusCode is System.Net.HttpStatusCode.BadRequest or System.Net.HttpStatusCode.NotFound
                        or System.Net.HttpStatusCode.MethodNotAllowed or System.Net.HttpStatusCode.UnprocessableEntity
                        or System.Net.HttpStatusCode.NotImplemented) { }
            }
            return await SendAsync(endpoint, prompt, false, linked.Token);
        }
        catch (OperationCanceledException)
        {
            try { _diagnostic?.Invoke("request:cancelled-or-timeout", elapsed.ElapsedMilliseconds); } catch { }
            if (cancellationToken.IsCancellationRequested) throw;
            throw new MatchRequestException("AI 服务请求超时", "AI_TIMEOUT", 504);
        }
        catch (HttpRequestException error)
        {
            // 只公开固定分类和 HTTP 数字，不返回上游正文、地址或认证头。
            var status = (int?)error.StatusCode;
            var code = status switch
            {
                401 or 403 => "AI_AUTH_FAILED",
                404 or 405 or 501 => "AI_ENDPOINT_UNSUPPORTED",
                400 or 422 => "AI_REQUEST_REJECTED",
                429 => "AI_RATE_LIMITED",
                null => "AI_CONNECTION_FAILED",
                _ => "AI_UPSTREAM_HTTP_ERROR"
            };
            var message = status is null ? "AI 服务连接失败，请检查服务器网络和服务地址"
                : $"AI 上游返回 HTTP {status}，请根据错误码检查凭据、接口协议或服务状态";
            throw new MatchRequestException(message, code, 502);
        }
        catch (IOException)
        { throw new MatchRequestException("AI 响应读取失败", "AI_RESPONSE_READ_FAILED", 502); }
    }

    private async Task<string> SendAsync(Endpoint endpoint, string prompt, bool responses, CancellationToken token)
    {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var protocol = responses ? "responses" : "chat-completions";
        var requestId = Guid.NewGuid().ToString("N")[..8];
        var phase = "构造请求";
        var requestBytes = 0;
        long responseBytes = 0;
        int? httpStatus = null;
        void Observe(string stage) { try { _diagnostic?.Invoke(protocol + ":" + stage + $"，请求={requestId}，阶段={phase}，请求字节={requestBytes}，已读响应字节={responseBytes}，HTTP={httpStatus?.ToString() ?? "未收到"}", clock.ElapsedMilliseconds); } catch { } }
        Observe("started");
        try
        {
        using var request = new HttpRequestMessage(HttpMethod.Post, BuildEndpoint(endpoint.BaseUrl, responses));
        if (endpoint.Key is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", endpoint.Key);
        var json = responses
            ? JsonSerializer.Serialize(new { model = endpoint.Model, input = prompt, store = false, text = new { format = new { type = "json_object" } } })
            : JsonSerializer.Serialize(new { model = endpoint.Model, stream = false, store = false, response_format = new { type = "json_object" }, messages = new[] { new { role = "user", content = prompt } } });
        requestBytes = Encoding.UTF8.GetByteCount(json);
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        phase = "等待响应头（连接、服务排队或生成）";
        Observe("sending");
        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        httpStatus = (int)response.StatusCode;
        Observe("http-" + (int)response.StatusCode);
        response.EnsureSuccessStatusCode();
        const int limit = 512 * 1024;
        if (response.Content.Headers.ContentLength > limit) throw InvalidResponse();
        phase = "读取响应正文";
        await using var stream = await response.Content.ReadAsStreamAsync(token);
        using var bodyStream = new MemoryStream();
        var buffer = new byte[8192]; int read;
        while ((read = await stream.ReadAsync(buffer.AsMemory(), token)) > 0)
        {
            if (bodyStream.Length + read > limit) throw InvalidResponse();
            bodyStream.Write(buffer, 0, read);
            var firstChunk = responseBytes == 0;
            responseBytes = bodyStream.Length;
            // 分离上游生成等待与正文传输耗时，便于真实宿主性能复测。
            if (firstChunk) Observe("first-body-byte");
        }
        phase = "解析协议响应";
        try
        {
            using var document = JsonDocument.Parse(bodyStream.ToArray(), new JsonDocumentOptions { MaxDepth = 32 });
            var root = document.RootElement;
            string? output = responses ? ReadResponseText(root) : ReadChatText(root);
            if (string.IsNullOrWhiteSpace(output) || output.Length > 65536) throw InvalidResponse();
            Observe("parsed");
            return output;
        }
        catch (JsonException) { throw InvalidResponse(); }
        }
        catch (OperationCanceledException) { Observe("中止：取消或到达总超时"); throw; }
        catch (HttpRequestException) { Observe("失败：HTTP或连接错误"); throw; }
        catch (IOException) { Observe("失败：正文读取错误"); throw; }
        catch (MatchRequestException error) { Observe("失败：" + error.ErrorCode); throw; }
    }

    private static string? ReadChatText(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) throw InvalidResponse();
        if (!root.TryGetProperty("choices", out var choices) || choices.ValueKind != JsonValueKind.Array || choices.GetArrayLength() != 1) throw InvalidResponse();
        var choice = choices[0];
        if (choice.ValueKind != JsonValueKind.Object || !choice.TryGetProperty("message", out var message)
            || message.ValueKind != JsonValueKind.Object || !message.TryGetProperty("content", out var content)
            || content.ValueKind != JsonValueKind.String) throw InvalidResponse();
        return content.GetString();
    }

    private static string? ReadResponseText(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("output", out var output)
            || output.ValueKind != JsonValueKind.Array) throw InvalidResponse();
        var texts = new List<string>();
        foreach (var item in output.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) throw InvalidResponse();
            if (!item.TryGetProperty("content", out var content)) continue; // 合法 reasoning 条目没有正文。
            if (content.ValueKind != JsonValueKind.Array) throw InvalidResponse();
            foreach (var part in content.EnumerateArray())
            {
                if (part.ValueKind != JsonValueKind.Object || !part.TryGetProperty("type", out var type)
                    || type.ValueKind != JsonValueKind.String) throw InvalidResponse();
                if (type.GetString() != "output_text") continue;
                if (!part.TryGetProperty("text", out var text) || text.ValueKind != JsonValueKind.String) throw InvalidResponse();
                texts.Add(text.GetString()!);
            }
        }
        return string.Join("", texts);
    }

    /// <summary>使用已保存配置请求模型列表，不向客户端暴露密钥。</summary>
    public async Task<IReadOnlyList<string>> GetModelsAsync(CancellationToken token, PluginConfiguration? draft = null)
    {
        // 查询模型只需要地址和凭据，不依赖匹配总开关或已选模型。
        var config = draft ?? _configuration();
        var (address, _, key) = config.GetAiEndpoint();
        if (!PluginConfiguration.ValidAiEndpoint(address, "models", key))
            throw new MatchRequestException("请填写有效的 AI 地址和凭据后刷新模型列表", "AI_MODELS_CONFIG_INVALID", 400);
        var endpoint = new Endpoint(new Uri(address!.TrimEnd('/')), "", string.IsNullOrWhiteSpace(key) ? null : key);
        // 模型列表也必须有超时和大小上限，避免无限等待或无界读取。
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(Math.Clamp(config.AiTimeoutSeconds, 1, 120)));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, BuildModelsEndpoint(endpoint.BaseUrl));
            if (endpoint.Key is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", endpoint.Key);
            using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                var message = status is 401 or 403 ? "AI 上游认证失败，请检查已保存的 API Key 和权限"
                    : status == 404 ? "AI 上游没有模型列表接口，请检查 Base URL；也可手动填写模型"
                    : status == 429 ? "AI 上游请求受限，请稍后重试"
                    : $"AI 上游模型接口返回 HTTP {status}，请检查服务状态";
                throw new MatchRequestException(message, "AI_MODELS_UPSTREAM_ERROR", 502);
            }
            const int limit = 2 * 1024 * 1024;
            if (response.Content.Headers.ContentLength > limit) throw InvalidResponse();
            await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192]; int read;
            while ((read = await stream.ReadAsync(chunk.AsMemory(), deadline.Token)) > 0)
            {
                if (buffer.Length + read > limit) throw InvalidResponse();
                buffer.Write(chunk, 0, read);
            }
            using var document = JsonDocument.Parse(buffer.ToArray(), new JsonDocumentOptions { MaxDepth = 32 });
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
                throw InvalidResponse();
            var models = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in data.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("id", out var id)
                    || id.ValueKind != JsonValueKind.String) throw InvalidResponse();
                var name = id.GetString();
                if (!string.IsNullOrWhiteSpace(name)) models.Add(name);
                if (models.Count >= 500) break;
            }
            return models.ToArray();
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        { throw new MatchRequestException("AI 模型列表请求超时", "AI_TIMEOUT", 504); }
        catch (HttpRequestException)
        { throw new MatchRequestException("AI 模型接口连接失败，请检查服务器网络与服务地址", "AI_PROVIDER_ERROR", 502); }
        catch (IOException)
        { throw new MatchRequestException("AI 模型列表响应读取失败", "AI_PROVIDER_ERROR", 502); }
        catch (JsonException) { throw InvalidResponse(); }
    }

    private static Uri BuildModelsEndpoint(Uri baseUrl)
    {
        var path = baseUrl.AbsolutePath.TrimEnd('/');
        if (path.EndsWith("/responses", StringComparison.OrdinalIgnoreCase)) path = path[..^10];
        if (path.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase)) path = path[..^17];
        return new UriBuilder(baseUrl) { Path = path + "/models", Query = "", Fragment = "" }.Uri;
    }
    private static MatchRequestException InvalidResponse()
        => new("AI 上游响应格式无效或超出大小限制", "AI_INVALID_RESPONSE", 502);
    /// <summary>释放上游 AI 请求使用的 HTTP 客户端。</summary>
    public void Dispose() => _client.Dispose();
}
