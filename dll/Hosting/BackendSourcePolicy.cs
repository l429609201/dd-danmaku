namespace DD.Danmaku.Hosting;

using System.Net;
using System.Net.Http;
using System.Net.Sockets;

/// <summary>校验配置目标并直连已校验地址，避免 DNS 重绑定和隐式代理绕过。</summary>
internal static class BackendSourcePolicy
{
    internal static readonly HttpRequestOptionsKey<bool> AllowPrivateOption = new("DD.Danmaku.AllowPrivateTarget");

    internal static SocketsHttpHandler CreateHandler() => new()
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        UseProxy = false,
        AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
        ConnectTimeout = TimeSpan.FromSeconds(15),
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        ConnectCallback = ConnectAsync
    };

    internal static bool IsApprovedPrivateBase(Uri target, PluginConfiguration configuration)
    {
        var prefix = target.AbsoluteUri.TrimEnd('/');
        var approved = (configuration.BackendPrivateSourcePrefixes ?? []).AsEnumerable();
        if (configuration.DanmakuProxyEnabled) approved = approved.Append(configuration.DanmakuProxyBaseUrl);
        return approved.Any(value => Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && string.Equals(prefix, uri.AbsoluteUri.TrimEnd('/'), StringComparison.Ordinal));
    }

    internal static async Task RequireSafeTargetAsync(Uri target, bool allowPrivate, CancellationToken token)
    {
        ValidateTarget(target);
        await ResolveAsync(target.DnsSafeHost, allowPrivate, token);
    }

    private static void ValidateTarget(Uri target)
    {
        if (!target.IsAbsoluteUri || target.Scheme is not ("http" or "https")
            || target.UserInfo.Length != 0 || target.Fragment.Length != 0 || target.Port is < 1 or > 65535
            || target.Host.Length == 0 || target.Host.Contains('%'))
            throw new ApiAccessException(400, "SOURCE_TARGET_INVALID", "来源地址格式无效");
    }

    private static async ValueTask<Stream> ConnectAsync(SocketsHttpConnectionContext context, CancellationToken token)
    {
        var target = context.InitialRequestMessage.RequestUri
            ?? throw new ApiAccessException(400, "SOURCE_TARGET_INVALID", "来源地址缺失");
        ValidateTarget(target);
        var allowPrivate = context.InitialRequestMessage.Options.TryGetValue(AllowPrivateOption, out var allowed) && allowed;
        var addresses = await ResolveAsync(context.DnsEndPoint.Host, allowPrivate, token);
        SocketException? lastError = null;
        foreach (var address in addresses)
        {
            token.ThrowIfCancellationRequested();
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), token);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch (SocketException error) { socket.Dispose(); lastError = error; }
            catch { socket.Dispose(); throw; }
        }
        throw lastError ?? new SocketException((int)SocketError.HostUnreachable);
    }

    private static async Task<IPAddress[]> ResolveAsync(string host, bool allowPrivate, CancellationToken token)
    {
        IPAddress[] addresses;
        if (IPAddress.TryParse(host.Trim('[', ']'), out var literal)) addresses = [literal];
        else
        {
            try { addresses = await Dns.GetHostAddressesAsync(host, token); }
            catch (SocketException) { throw new ApiAccessException(502, "SOURCE_DNS_FAILED", "来源域名无法解析"); }
        }
        if (addresses.Length is 0 or > 16 || addresses.Any(address => !IsAllowed(address, allowPrivate)))
            throw new ApiAccessException(403, "SOURCE_TARGET_DENIED", "来源解析到未授权的网络地址");
        return addresses.Distinct().ToArray();
    }

    internal static bool IsAllowed(IPAddress address, bool allowPrivate)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = address.GetAddressBytes();
            // 元数据服务、链路本地、组播及特殊用途网段始终拒绝。
            if (b[0] == 0 || b[0] >= 224 || b[0] == 169 && b[1] == 254
                || b[0] == 100 && b[1] is >= 64 and <= 127
                || b[0] == 192 && b[1] == 0 && b[2] is 0 or 2
                || b[0] == 198 && b[1] is 18 or 19
                || b[0] == 198 && b[1] == 51 && b[2] == 100
                || b[0] == 203 && b[1] == 0 && b[2] == 113) return false;
            var privateAddress = b[0] is 10 or 127 || b[0] == 172 && b[1] is >= 16 and <= 31
                || b[0] == 192 && b[1] == 168;
            return !privateAddress || allowPrivate;
        }
        if (address.AddressFamily != AddressFamily.InterNetworkV6 || address.ScopeId != 0
            || address.Equals(IPAddress.IPv6Any) || address.IsIPv6LinkLocal || address.IsIPv6Multicast) return false;
        var bytes = address.GetAddressBytes();
        if (address.Equals(IPAddress.IPv6Loopback)) return allowPrivate;
        if ((bytes[0] & 0xfe) == 0xfc) return allowPrivate;
        // 只接受全球单播；拒绝 NAT64、隧道和文档地址，避免嵌入 IPv4 绕过。
        return (bytes[0] & 0xe0) == 0x20 && !(bytes[0] == 0x20 && bytes[1] == 0x01
            && (bytes[2] == 0x0d && bytes[3] == 0xb8 || bytes[2] == 0 || bytes[2] == 2))
            && !(bytes[0] == 0x20 && bytes[1] == 0x02);
    }
}
