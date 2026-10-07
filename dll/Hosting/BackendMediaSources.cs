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
        // 仅支持既有四参数或增加可选尾参数的契约，不猜测新的必填参数。
        var methods = typeof(IMediaSourceManager).GetMethods().Where(method => method.Name == "GetStaticMediaSources")
            .Select(method => (Method: method, Parameters: method.GetParameters()))
            .Where(candidate => candidate.Parameters.Length >= 4
                && candidate.Parameters[0].ParameterType.IsInstanceOfType(item)
                && candidate.Parameters[1].ParameterType == typeof(bool)
                && candidate.Parameters[2].ParameterType.FullName == "MediaBrowser.Model.Dlna.DeviceProfile"
                && candidate.Parameters[3].ParameterType.IsInstanceOfType(user)
                && candidate.Parameters.Skip(4).All(parameter => parameter.IsOptional))
            .OrderBy(candidate => candidate.Parameters.Length).ToArray();
        if (methods.Length == 0)
            throw new ApiAccessException(503, "MEDIA_SOURCE_API_UNAVAILABLE", "宿主媒体源接口签名不兼容");
        var selected = methods[0];
        var arguments = new object?[selected.Parameters.Length];
        arguments[0] = item; arguments[1] = true; arguments[2] = null; arguments[3] = user;
        for (var index = 4; index < arguments.Length; index++) arguments[index] = selected.Parameters[index].DefaultValue;
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
}
