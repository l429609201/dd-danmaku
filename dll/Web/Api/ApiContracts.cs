namespace DD.Danmaku.Web.Api;

/// <summary>统一 API 响应信封。</summary>
/// <typeparam name="T">业务数据类型。</typeparam>
/// <param name="Success">操作是否成功。</param>
/// <param name="Message">结果说明。</param>
/// <param name="ErrorCode">稳定错误码。</param>
/// <param name="Data">业务响应数据。</param>
/// <param name="TraceId">请求跟踪标识。</param>
public sealed record ApiResponse<T>(
    bool Success,
    string? Message,
    string? ErrorCode,
    T? Data,
    string? TraceId);

/// <summary>携带页码及总数的列表响应。</summary>
/// <typeparam name="T">列表条目类型。</typeparam>
/// <param name="Success">查询是否成功。</param>
/// <param name="Message">结果说明。</param>
/// <param name="ErrorCode">错误分类码。</param>
/// <param name="Items">当前页条目。</param>
/// <param name="Page">当前页码。</param>
/// <param name="PageSize">每页条数。</param>
/// <param name="Total">符合条件的总条数。</param>
/// <param name="HasMore">是否还有下一页。</param>
/// <param name="TraceId">请求跟踪标识。</param>
public sealed record PageResponse<T>(
    bool Success,
    string? Message,
    string? ErrorCode,
    IReadOnlyList<T> Items,
    int Page,
    int PageSize,
    long Total,
    bool HasMore,
    string? TraceId);

/// <summary>服务端向当前客户端声明的插件能力。</summary>
/// <param name="PluginId">插件协议标识。</param>
/// <param name="Version">程序集版本。</param>
/// <param name="ApiVersion">API 协议版本。</param>
/// <param name="Mode">后端工作模式。</param>
/// <param name="Capabilities">各项功能的实际可用性。</param>
/// <param name="Enabled">API 是否就绪。</param>
/// <param name="FilePersistenceEnabled">旁路持久化是否可用。</param>
/// <param name="RefreshOnNextPlayback">下次播放刷新策略是否生效。</param>
public sealed record CapabilitiesDto(
    string PluginId,
    string Version,
    int ApiVersion,
    string Mode,
    IReadOnlyDictionary<string, bool> Capabilities,
    bool Enabled,
    bool FilePersistenceEnabled,
    bool RefreshOnNextPlayback);

/// <summary>目标媒体的本地弹幕和刷新信息。</summary>
/// <param name="ItemId">媒体标识。</param>
/// <param name="Found">是否找到可用弹幕。</param>
/// <param name="Comments">返回的弹幕集合。</param>
/// <param name="CommentCount">弹幕数量。</param>
/// <param name="StoredAt">首次保存时间。</param>
/// <param name="UpdatedAt">最近更新时间。</param>
/// <param name="Source">弹幕来源。</param>
/// <param name="RefreshRequired">是否需要刷新。</param>
/// <param name="RefreshReason">刷新原因。</param>
/// <param name="StorageLocation">存储位置描述。</param>
/// <param name="Match">可选的匹配摘要。</param>
public sealed record PlaybackQueryDto(
    string ItemId,
    bool Found,
    IReadOnlyList<DanmakuCommentDto> Comments,
    int CommentCount,
    DateTimeOffset? StoredAt,
    DateTimeOffset? UpdatedAt,
    string? Source,
    bool RefreshRequired,
    string? RefreshReason,
    string? StorageLocation,
    MatchSummaryDto? Match);

/// <summary>传递给前端的单条弹幕。</summary>
/// <param name="Text">正文。</param>
/// <param name="Time">视频时间轴位置，单位为秒。</param>
/// <param name="Mode">显示模式编码。</param>
/// <param name="Color">颜色整数编码。</param>
/// <param name="UserId">来源提供的发送者标识，可为空。</param>
/// <param name="FontSize">Bilibili p 属性中的字号。</param>
/// <param name="Timestamp">Bilibili p 属性中的发送时间戳。</param>
/// <param name="Pool">Bilibili p 属性中的弹幕池编号。</param>
/// <param name="Cid">来源弹幕 ID。</param>
/// <param name="Weight">来源权重字段。</param>
public sealed record DanmakuCommentDto(string Text, double Time, int Mode, int Color, string? UserId,
    int FontSize = 25, long Timestamp = 0, int Pool = 0, string? Cid = null, int Weight = 0);
/// <summary>播放响应中的匹配摘要。</summary>
/// <param name="AnimeId">作品标识。</param>
/// <param name="EpisodeId">剧集标识。</param>
/// <param name="Title">匹配标题。</param>
/// <param name="Confidence">匹配评分，不保证是校准概率。</param>
/// <param name="Mode">匹配模式。</param>
public sealed record MatchSummaryDto(string? AnimeId, string? EpisodeId, string? Title, decimal Confidence, string Mode);

/// <summary>前端上报的弹幕加载结果。</summary>
/// <param name="Success">加载是否成功。</param>
/// <param name="CommentCount">加载的弹幕数量。</param>
/// <param name="DurationMilliseconds">处理耗时，单位为毫秒。</param>
/// <param name="ErrorCode">失败分类码。</param>
/// <param name="SessionSummary">可选的会话摘要。</param>
public sealed record PlaybackResultDto(
    bool Success,
    int CommentCount,
    long DurationMilliseconds,
    string? ErrorCode,
    string? SessionSummary);

// 无状态匹配：ItemId 仅用于关联，候选由调用方提供。
/// <summary>由调用方提供全部候选的无状态匹配请求。</summary>
/// <param name="Mode">请求的匹配模式。</param>
/// <param name="Target">目标媒体元数据。</param>
/// <param name="Candidates">待评估候选集合。</param>
/// <param name="ResultLimit">最多返回的候选数量。</param>
/// <param name="NumberingContext">调用方声明的编号映射上下文。</param>
/// <param name="CandidatesTruncated">候选是否已被调用方截断。</param>
/// <param name="SelectionScope">选择作品或分集的匹配范围。</param>
public sealed record ResolveMatchRequest(
    string Mode,
    TargetMediaDto? Target,
    IReadOnlyList<MatchCandidateInput>? Candidates,
    int ResultLimit = 10,
    NumberingContextDto? NumberingContext = null,
    // 作品选择与旧版分集判断显式区分，兼容现有调用者。
    bool CandidatesTruncated = false,
    string SelectionScope = "episode")
{
    // 只允许宿主注入授权结果，JSON 不能声明或覆盖权限；非宿主调用默认拒绝 AI。
    [System.Text.Json.Serialization.JsonIgnore]
    internal bool AiAuthorized { get; init; }
    // 仅在服务端传递日志关联号，客户端 JSON 不可覆盖。
    [System.Text.Json.Serialization.JsonIgnore]
    internal string? TraceId { get; init; }
}

/// <summary>具有提供者和作用范围的外部元数据标识。</summary>
/// <param name="Provider">元数据提供者名称。</param>
/// <param name="Scope">标识适用的媒体层级或范围。</param>
/// <param name="Id">外部标识值。</param>
public sealed record ProviderIdDto(string Provider, string Scope, string Id);

/// <summary>调用方声明的待匹配媒体信息。</summary>
/// <param name="ItemId">仅用于关联的媒体标识。</param>
/// <param name="Title">标题。</param>
/// <param name="FileName">供规则提取信息的文件名。</param>
/// <param name="MediaType">媒体类型。</param>
/// <param name="SeasonNumber">季编号。</param>
/// <param name="EpisodeNumber">集编号。</param>
/// <param name="Year">发行年份。</param>
/// <param name="ProviderIds">带作用范围的外部标识。</param>
public sealed record TargetMediaDto(
    string? ItemId = null,
    string? Title = null,
    string? FileName = null,
    string? MediaType = null,
    int? SeasonNumber = null,
    int? EpisodeNumber = null,
    int? Year = null,
    IReadOnlyList<ProviderIdDto>? ProviderIds = null);

/// <summary>调用方提供的单个弹幕匹配候选。</summary>
/// <param name="CandidateId">本请求内唯一的候选标识。</param>
/// <param name="SourceId">候选来源标识。</param>
/// <param name="AnimeId">来源作品标识。</param>
/// <param name="EpisodeId">来源剧集标识。</param>
/// <param name="Title">候选标题。</param>
/// <param name="Aliases">候选别名集合。</param>
/// <param name="MediaType">媒体类型。</param>
/// <param name="SeasonNumber">季编号。</param>
/// <param name="EpisodeNumber">集编号。</param>
/// <param name="Year">发行年份。</param>
/// <param name="ProviderIds">外部元数据标识集合。</param>
public sealed record MatchCandidateInput(
    string CandidateId,
    string SourceId,
    string? AnimeId = null,
    string? EpisodeId = null,
    string? Title = null,
    IReadOnlyList<string>? Aliases = null,
    string? MediaType = null,
    int? SeasonNumber = null,
    int? EpisodeNumber = null,
    int? Year = null,
    IReadOnlyList<ProviderIdDto>? ProviderIds = null);

// Basis: manual / tmdb / filename。均为调用方声明，不代表后端独立核验。
/// <summary>针对指定来源的季集编号映射声明。</summary>
/// <param name="SourceId">映射适用的来源。</param>
/// <param name="Basis">映射依据：manual、tmdb 或 filename。</param>
/// <param name="OriginalSeasonNumber">原始季编号。</param>
/// <param name="OriginalEpisodeNumber">原始集编号。</param>
/// <param name="MappedSeasonNumber">映射后季编号。</param>
/// <param name="MappedEpisodeNumber">映射后集编号。</param>
public sealed record NumberingContextDto(
    string SourceId,
    string Basis,
    int? OriginalSeasonNumber,
    int? OriginalEpisodeNumber,
    int? MappedSeasonNumber,
    int? MappedEpisodeNumber);

// Score 是排序分，不是校准概率；Eligible 仅表示未发现硬冲突。
/// <summary>候选评估结果及可解释的评分依据。</summary>
/// <param name="CandidateId">原始候选标识。</param>
/// <param name="SourceId">候选来源。</param>
/// <param name="AnimeId">作品标识。</param>
/// <param name="EpisodeId">剧集标识。</param>
/// <param name="Title">候选标题。</param>
/// <param name="Score">排序评分，不是正确概率。</param>
/// <param name="Eligible">是否未发现规则硬冲突。</param>
/// <param name="Reasons">评分理由。</param>
/// <param name="Conflicts">发现的硬冲突。</param>
public sealed record MatchCandidateDto(
    string CandidateId,
    string SourceId,
    string? AnimeId,
    string? EpisodeId,
    string? Title,
    decimal Score,
    bool Eligible,
    IReadOnlyList<string> Reasons,
    IReadOnlyList<string> Conflicts);

/// <summary>无状态匹配的最终响应。</summary>
/// <param name="ModeUsed">实际使用的匹配模式。</param>
/// <param name="Status">匹配状态标识。</param>
/// <param name="SelectedCandidateId">已选候选标识，未自动选择时为空。</param>
/// <param name="NeedsConfirmation">是否需要用户确认。</param>
/// <param name="Candidates">按评分排序的候选结果。</param>
/// <param name="Warnings">匹配过程中的风险或降级说明。</param>
public sealed record ResolveMatchResponse(
    string ModeUsed,
    string Status,
    string? SelectedCandidateId,
    bool NeedsConfirmation,
    IReadOnlyList<MatchCandidateDto> Candidates,
    IReadOnlyList<string> Warnings);
