namespace DD.Danmaku.Hosting;

using System.Reflection;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;

/// <summary>隔离不同 Emby 版本的媒体源方法签名，避免旧 SDK 调用在任务 JIT 时直接失败。</summary>
internal static class BackendMediaSources
{
    internal static List<MediaSourceInfo> Read(IMediaSourceManager manager, BaseItem item, User user)
    {
        // 4.8 使用四参数；4.9/4.10 在 DeviceProfile 前加入 fillChapters，不为哈希填充章节。
        var methods = typeof(IMediaSourceManager).GetMethods().Where(method => method.Name == "GetStaticMediaSources")
            .Select(method => (Method: method, Parameters: method.GetParameters()))
            .Where(candidate => typeof(IEnumerable<MediaSourceInfo>).IsAssignableFrom(candidate.Method.ReturnType)
                && SupportedParameters(candidate.Parameters, item, user))
            .OrderBy(candidate => candidate.Parameters.Length).ToArray();
        if (methods.Length == 0)
            throw new ApiAccessException(503, "MEDIA_SOURCE_API_UNAVAILABLE", "宿主媒体源接口签名不兼容");
        var selected = methods[0];
        var arguments = new object?[selected.Parameters.Length];
        var chapters = IsChapterShape(selected.Parameters);
        arguments[0] = item; arguments[1] = true;
        if (chapters) arguments[2] = false;
        var profileIndex = chapters ? 3 : 2;
        arguments[profileIndex] = null; arguments[profileIndex + 1] = user;
        for (var index = profileIndex + 2; index < arguments.Length; index++) arguments[index] = selected.Parameters[index].DefaultValue;
        try
        {
            return selected.Method.Invoke(manager, arguments) is IEnumerable<MediaSourceInfo> sources
                ? sources.ToList() : throw new ApiAccessException(503, "MEDIA_SOURCE_API_UNAVAILABLE", "宿主媒体源结果不兼容");
        }
        catch (TargetInvocationException error) when (error.InnerException is not null)
        {
            System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error.InnerException).Throw();
            throw;
        }
    }

    private static bool IsChapterShape(ParameterInfo[] parameters) => parameters.Length >= 5
        && parameters[2].ParameterType == typeof(bool) && parameters[2].Name == "fillChapters";

    private static bool SupportedParameters(ParameterInfo[] parameters, BaseItem item, User user)
    {
        if (parameters.Length < 4 || !parameters[0].ParameterType.IsInstanceOfType(item)
            || parameters[1].ParameterType != typeof(bool) || parameters[1].Name != "enablePathSubstitution") return false;
        var profileIndex = IsChapterShape(parameters) ? 3 : 2;
        return parameters.Length >= profileIndex + 2
            && parameters[profileIndex].ParameterType.FullName == "MediaBrowser.Model.Dlna.DeviceProfile"
            && parameters[profileIndex + 1].ParameterType.IsInstanceOfType(user)
            && parameters.Skip(profileIndex + 2).All(parameter => parameter.IsOptional);
    }
}
