namespace DD.Danmaku.Matching;

using DD.Danmaku.Web.Api;

/// <summary>协调规则、排序及可选 AI 的无状态媒体匹配流程。</summary>
public interface IMatchService
{
    /// <summary>评估调用方提供的候选并返回选择结果及人工确认要求。</summary>
    Task<ResolveMatchResponse> ResolveAsync(ResolveMatchRequest request, CancellationToken cancellationToken);
}

/// <summary>携带候选评分和自动选择所需的安全约束。</summary>
/// <param name="Result">候选评分、冲突及理由。</param>
/// <param name="MetadataSufficient">候选元数据是否足以支持匹配判断。</param>
/// <param name="RequiresConfirmation">是否必须由用户确认。</param>
public sealed record CandidateAssessment(
    MatchCandidateDto Result, bool MetadataSufficient, bool RequiresConfirmation);

/// <summary>依据确定性元数据规则检查单个候选。</summary>
public interface IRuleMatcher
{
    /// <summary>比较目标与候选，并向警告集合追加编号映射等风险说明。</summary>
    CandidateAssessment Evaluate(TargetMediaDto target, MatchCandidateInput candidate,
        NumberingContextDto? numbering, ICollection<string> warnings);
}

/// <summary>对已经完成规则评估的候选排序。</summary>
public interface IIntelligentMatcher
{
    /// <summary>返回排序后的评估结果，不创建额外候选。</summary>
    IReadOnlyList<CandidateAssessment> Rank(IEnumerable<CandidateAssessment> candidates);
}

/// <summary>提供受服务端配置约束的可选 AI 重评分能力。</summary>
public interface IAiMatchService
{
    /// <summary>AI 配置和提供者是否已就绪。</summary>
    bool IsAvailable { get; }
    /// <summary>AI 模式允许自动选择的最低排序分阈值，不代表概率。</summary>
    decimal MatchThreshold { get; }
    /// <summary>重评候选分数，保留规则冲突、完整性及人工确认约束。</summary>
    Task<IReadOnlyList<CandidateAssessment>> RerankAsync(ResolveMatchRequest request,
        IReadOnlyList<CandidateAssessment> candidates, CancellationToken cancellationToken);
}

// 仅宿主注入提供者；请求 DTO 不能选择 URL、密钥或模型。
/// <summary>封装由宿主配置的 AI 结构化生成调用。</summary>
public interface IAiProvider
{
    /// <summary>提供者是否具备执行请求的配置。</summary>
    bool IsAvailable { get; }
    /// <summary>根据提示词请求结构化文本，返回值仍须由业务层验证。</summary>
    Task<string> CompleteStructuredAsync(string prompt, CancellationToken cancellationToken);
}

/// <summary>携带可向客户端返回的匹配错误码与 HTTP 状态。</summary>
public sealed class MatchRequestException : Exception
{
    /// <summary>对应的 HTTP 响应状态码。</summary>
    public int StatusCode { get; }
    /// <summary>供客户端分类处理的稳定错误码。</summary>
    public string ErrorCode { get; }
    /// <summary>使用脱敏消息、业务错误码及 HTTP 状态创建匹配异常。</summary>
    public MatchRequestException(string message, string errorCode = "INVALID_MATCH_REQUEST", int statusCode = 400)
        : base(message) { ErrorCode = errorCode; StatusCode = statusCode; }
}
