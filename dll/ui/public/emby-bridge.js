define([], function () {
    'use strict';
    return function (view) {
        var frame = view.querySelector('.dd-admin-frame');
        var error = view.querySelector('.dd-error');
        view.addEventListener('viewshow', function () {
            error.hidden = true;
            try {
                // 使用宿主地址保留反向代理前缀；令牌只由 iframe 内 API 请求通过请求头发送。
                var client = window.ApiClient;
                if (!client || !client.accessToken()) throw new Error('请先登录 Emby 管理员账号');
                var base = client.serverAddress().replace(/\/$/, '');
                var url = new URL(base + '/dd-danmaku/admin/index.html', window.location.href);
                if (url.origin !== window.location.origin) throw new Error('管理页面必须与当前 Emby 页面同源');
                frame.src = url.href;
            } catch (e) {
                error.textContent = e.message || '无法打开弹幕管理页面';
                error.hidden = false;
            }
        });
        // 离开页面销毁子页面，避免遗留请求与旧账号界面。
        view.addEventListener('viewbeforehide', function () { frame.src = 'about:blank'; });
    };
});
