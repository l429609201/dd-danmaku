namespace DD.Danmaku.Matching;

using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

/// <summary>服务端配置驱动的兼容提供者；实例由宿主持有并在卸载时释放。</summary>
public sealed class OpenAiCompatibleProvider : IAiProvider, IDisposable
{
    private readonly Func<PluginConfiguration> _configuration;
    // 禁止自动重定向，避免向另一主机发送匹配内容或凭据。
    private readonly HttpClient _client = new(new HttpClientHandler { AllowAutoRedirect = false })
    { Timeout = Timeout.InfiniteTimeSpan };
    public OpenAiCompatibleProvider(Func<PluginConfiguration> configuration) => _configuration = configuration;
    public string Name => "openai-compatible";
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

    public async Task<string> CompleteStructuredAsync(string prompt, CancellationToken cancellationToken)
    {
        var config = _configuration();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Clamp(config.AiTimeoutSeconds, 1, 120)));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        var endpoint = GetEndpoint(config)
            ?? throw new MatchRequestException("AI 提供者未配置", "AI_UNAVAILABLE", 503);
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
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { throw new MatchRequestException("AI 服务请求超时", "AI_TIMEOUT", 504); }
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
        using var request = new HttpRequestMessage(HttpMethod.Post, BuildEndpoint(endpoint.BaseUrl, responses));
        if (endpoint.Key is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", endpoint.Key);
        var json = responses
            ? JsonSerializer.Serialize(new { model = endpoint.Model, input = prompt, store = false, text = new { format = new { type = "json_object" } } })
            : JsonSerializer.Serialize(new { model = endpoint.Model, stream = false, store = false, response_format = new { type = "json_object" }, messages = new[] { new { role = "user", content = prompt } } });
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        response.EnsureSuccessStatusCode();
        const int limit = 512 * 1024;
        if (response.Content.Headers.ContentLength > limit) throw InvalidResponse();
        await using var stream = await response.Content.ReadAsStreamAsync(token);
        using var bodyStream = new MemoryStream();
        var buffer = new byte[8192]; int read;
        while ((read = await stream.ReadAsync(buffer.AsMemory(), token)) > 0)
        {
            if (bodyStream.Length + read > limit) throw InvalidResponse();
            bodyStream.Write(buffer, 0, read);
        }
        try
        {
            using var document = JsonDocument.Parse(bodyStream.ToArray(), new JsonDocumentOptions { MaxDepth = 32 });
            var root = document.RootElement;
            string? output = responses ? ReadResponseText(root) : ReadChatText(root);
            if (string.IsNullOrWhiteSpace(output) || output.Length > 65536) throw InvalidResponse();
            return output;
        }
        catch (JsonException) { throw InvalidResponse(); }
    }

    private static string? ReadChatText(JsonElement root)
    {
        if (!root.TryGetProperty("choices", out var choices) || choices.ValueKind != JsonValueKind.Array || choices.GetArrayLength() != 1) throw InvalidResponse();
        var choice = choices[0];
        if (!choice.TryGetProperty("message", out var message) || !message.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.String) throw InvalidResponse();
        return content.GetString();
    }

    private static string? ReadResponseText(JsonElement root)
    {
        if (!root.TryGetProperty("output", out var output) || output.ValueKind != JsonValueKind.Array) throw InvalidResponse();
        var texts = output.EnumerateArray().SelectMany(item => item.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array
            ? content.EnumerateArray().Where(x => x.TryGetProperty("type", out var type) && type.GetString() == "output_text").Select(x => x.TryGetProperty("text", out var text) ? text.GetString() : null)
            : []);
        return string.Join("", texts.Where(x => !string.IsNullOrEmpty(x)));
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
    public void Dispose() => _client.Dispose();
}
