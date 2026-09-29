// ==UserScript==
// @name         Emby danmaku extension - Emby style
// @description  Emby弹幕插件 - Emby风格
// @namespace    https://github.com/l429609201/dd-danmaku
// @author       misaka10876, chen3861229
// @version      1.3.2
// @copyright    2024, misaka10876 (https://github.com/l429609201)
// @license      MIT; https://raw.githubusercontent.com/RyoLee/emby-danmaku/master/LICENSE
// @icon         https://github.githubassets.com/pinned-octocat.svg
// @grant        none
// @updateURL    https://github.com/l429609201/dd-danmaku/releases/latest/download/ede.js
// @match        *://*/web/index.html
// @match        *://*/web/
// ==/UserScript==

(async function () {
    'use strict';
    // [修复] 防止脚本被多次加载（index.html 引入 + CustomCssJS 注入等场景）
    if (window._ddDanmakuLoaded) {
        console.log('[dd-danmaku] 脚本已加载过，跳过重复执行');
        return;
    }
    // 宿主客户端可能不存在；纯脚本注入模式统一通过安全访问器降级。
    const getHostApiClient = () => typeof ApiClient !== 'undefined' ? ApiClient : null;

    // ------ 用户配置 start ------
    let requireDanmakuPath = 'https://danmu-api.misaka10876.top/tools/danmaku.min.js';
    // SparkMD5 库路径 (用于文件哈希计算)
    let requireSparkMD5Path = 'https://danmu-api.misaka10876.top/tools/spark-md5.min.js';
    // 跨域代理 cf_worker
    let corsProxy = 'https://danmu-api.misaka10876.top/cors/';
    // 用户代理标识
    let userAgent = 'misaka10876/v1.0.0';
    // 日志级别: 0=关闭, 1=ERROR, 2=WARN, 3=INFO, 4=DEBUG (默认 INFO)
    let logLevel = 3;
    // ------ 用户配置 end ------
    // note01: 部分 AndroidTV 仅支持最高 ES9 (支持 webview 内核版本 60 以上)
    // note02: url 禁止使用相对路径,非 web 环境的根路径为文件路径,非 http

    // ─── 自定义 API 服务器类型识别 ─────────────────────────────────────────────

    /**
     * 访问自定义API Get {URL}/api/v2/version 接口，获取弹幕服务器相关信息
     * 接口响应示例：
     * {
     *   "success": true,
     *   "errorCode": 0,
     *   "errorMessage": "",
     *   "serverName": "Misaka_Danmu_Server",
     *   "version": "2.8.7",
     *   "serverTime": "2026-08-19T14:51:34.838892"
     * }
     * 用于验证弹幕服务器类型，通过serverName匹配来判断
     * 已知服务器类型表，按 serverName 匹配。
     * badge: 展示在列表行的小卡片文字
     * color: 卡片背景色
     * supportsAsync: 是否支持 async=1 异步弹幕轮询接口，https://docs.misaka10876.top/类dandanplay接口#v2-7-0-改动
     */
    const knownApiServers = [
        {
            serverName: 'Misaka_Danmu_Server',
            badge: '御坂弹幕库',
            color: '#7b5ea7',
            supportsAsync: true,  // 支持 async=1 异步弹幕轮询接口
        },
        // 如需支持更多服务器类型，在此追加即可
    ];

    // ------ 程序内部使用,请勿更改 start ------
    const openSourceLicense = {
        self: { version: '1.3.2', name: 'Emby Danmaku Extension (misaka10876 Fork)', license: 'MIT License', url: 'https://github.com/l429609201/dd-danmaku' },
        chen3861229: { version: '1.45', name: 'Emby Danmaku Extension(Forked from original:1.11)', license: 'MIT License', url: 'https://github.com/chen3861229/dd-danmaku' },
        original: { version: '1.11', name: 'Emby Danmaku Extension', license: 'MIT License', url: 'https://github.com/RyoLee/emby-danmaku' },
        jellyfinFork: { version: '1.52', name: 'Jellyfin Danmaku Extension', license: 'MIT License', url: 'https://github.com/Izumiko/jellyfin-danmaku' },
        danmaku: { version: '2.0.8', name: 'Danmaku', license: 'MIT License', url: 'https://github.com/weizhenye/Danmaku' },
        dandanplayApi: { version: 'v2', name: '弹弹 play API', license: 'MIT License', url: 'https://github.com/kaedei/dandanplay-libraryindex' },
        bangumiApi: { version: '2025-02-5', name: 'Bangumi API', license: 'None', url: 'https://github.com/bangumi/api' },
        embyPluginDanmu: { version: '1.0.2', name: 'EmbyPluginDanmu', license: 'None', url: 'https://github.com/fengymi/emby-plugin-danmu' },
    };
    const dandanplayApi = {
        get prefix() {
            // [修改] 支持多源：使用第一个自定义源
            const customList = typeof getCustomApiList === 'function' ? getCustomApiList() : [];
            // [修复] customList[0] 是对象 {name, url, enabled}，需要取 .url；旧配置是字符串
            const customItem = customList.length > 0 ? customList[0] : null;
            const customUrl = customItem ? (typeof customItem === 'string' ? customItem : customItem.url) : lsGetItem(lsKeys.customApiPrefix.id);
            // [修复] 校验 URL 必须以 http:// 或 https:// 开头，防止不完整 URL 导致 Worker 报错
            if (customUrl && customUrl.length > 0 && (customUrl.startsWith('http://') || customUrl.startsWith('https://')) && !lsGetItem(lsKeys.useOfficialApi.id)) {
                return customUrl;
            }
            // 官方API强制走代理
            return corsProxy + 'https://api.dandanplay.net/api/v2';
        },
        getSearchEpisodes: (anime, episode) => `${dandanplayApi.prefix}/search/episodes?anime=${anime}${episode ? `&episode=${episode}` : ''}`,
        getComment: (episodeId, chConvert) => `${dandanplayApi.prefix}/comment/${episodeId}?withRelated=true&chConvert=${chConvert}`,
        getExtcomment: (url) => `${dandanplayApi.prefix}/extcomment?url=${encodeURI(url)}`,
        getBangumi: (animeId) => `${dandanplayApi.prefix}/bangumi/${animeId}`,
        // [降级] 用 bangumi.tv 的 subjectId 获取弹弹play番剧详情+分集（新接口，需签名，走代理）
        getBangumiByBgmId: (bgmtvSubjectId) => `${dandanplayApi.prefix}/bangumi/bgmtv/${bgmtvSubjectId}`,
        posterImg: (animeId) => `https://img.dandanplay.net/anime/${animeId}.jpg`,
    };
    const dandanplayApiCustom = {
        get prefix() {
            const customList = typeof getCustomApiList === 'function' ? getCustomApiList() : [];
            const customItem = customList.length > 0 ? customList[0] : null;
            const customUrl = customItem ? (typeof customItem === 'string' ? customItem : customItem.url) : lsGetItem(lsKeys.customApiPrefix.id);
            return customUrl && customUrl.length > 0 && (customUrl.startsWith('http://') || customUrl.startsWith('https://')) ? customUrl : dandanplayApi.prefix;
        },
        getMatchUrl: () => `${dandanplayApiCustom.prefix}/match`,
    }
    const bangumiApi = {
        get prefix() {
            const custom = lsGetItem(lsKeys.bangumiApiPrefix.id);
            const base = (custom && custom.length > 0) ? custom : 'https://api.bgm.tv';
            return base + '/v0';
        },
        get imageDomain() {
            const custom = lsGetItem(lsKeys.bangumiImageDomain.id);
            return (custom && custom.length > 0) ? custom : 'https://lain.bgm.tv';
        },
        accessTokenUrl: 'https://next.bgm.tv/demo/access-token',
        getCharacters: (subjectId) => `${bangumiApi.prefix}/subjects/${subjectId}/characters`,
        searchSubjects: () => `${bangumiApi.prefix}/search/subjects`,
        getMe: () => `${bangumiApi.prefix}/me`,
        getUserCollection: (userName, subjectId) => `${bangumiApi.prefix}/users/${userName}/collections/${subjectId}`,
        postUserCollection: (subjectId) => `${bangumiApi.prefix}/users/-/collections/${subjectId}`,
        patchUserCollection: (subjectId) => `${bangumiApi.prefix}/users/-/collections/${subjectId}`,
        getUserSubjectEpisodeCollection: (subjectId) => `${bangumiApi.prefix}/users/-/collections/${subjectId}/episodes?offset=0&limit=1000`,
        putUserEpisodeCollection: (episodeId ) => `${bangumiApi.prefix}/users/-/collections/-/episodes/${episodeId}`,
    };
    const check_interval = 200;
    const LOAD_TYPE = {
        CHECK: 'check',
        INIT: 'init',
        REFRESH: 'refresh',
        RELOAD: 'reload',
        SEARCH: 'search',
    };
    let isVersionOld = false;
    let mediaContainerQueryStr = '.graphicContentContainer';
    const notHide = ':not(.hide)';
    const mediaQueryStr = 'video';
    const _CONTAINER_SELECTORS = {
        new: '.graphicContentContainer',
        old: 'div[data-type="video-osd"]',
    };

    /**
     * [综合方案] 探测实际的媒体容器选择器
     * 三层保障：1. API 版本判断  2. DOM 实际探测  3. 交叉验证自动修正
     * 返回 { selector: string, isOld: boolean }
     */
    function detectMediaContainer() {
        // --- 第1层：API 版本判断 ---
        let apiSaysOld = false;
        try {
            const client = getHostApiClient();
            if (client?.isMinServerVersion) {
                apiSaysOld = !client.isMinServerVersion("4.8.0.0");
            } else {
                const sv = client?.serverVersion ? client.serverVersion() : '';
                const parts = sv.split('.').map(Number);
                apiSaysOld = (parts[0] || 0) < 4 || ((parts[0] || 0) === 4 && (parts[1] || 0) < 8);
            }
        } catch(e) {
            logger.warn('[容器探测] API 版本检测异常，回退到 DOM 探测:', e.message);
        }

        // --- 第2层：DOM 实际探测 ---
        const hasNewContainer = !!document.querySelector(_CONTAINER_SELECTORS.new);
        const hasOldContainer = !!document.querySelector(_CONTAINER_SELECTORS.old);

        // --- 第3层：交叉验证 & 自动修正 ---
        let finalIsOld = apiSaysOld;
        let source = 'API';

        if (apiSaysOld && hasNewContainer && !hasOldContainer) {
            // API 说旧版，但 DOM 里只有新版容器 → 修正为新版
            finalIsOld = false;
            source = 'DOM修正(API误判为旧版)';
        } else if (!apiSaysOld && !hasNewContainer && hasOldContainer) {
            // API 说新版，但 DOM 里只有旧版容器 → 修正为旧版
            finalIsOld = true;
            source = 'DOM修正(API误判为新版)';
        } else if (!hasNewContainer && !hasOldContainer) {
            // DOM 中两个都没找到（可能还没渲染），信任 API 结果
            source = 'API(DOM未就绪)';
        } else if (hasNewContainer && hasOldContainer) {
            // 两个都有，信任 API 结果
            source = 'API(DOM双存)';
        } else if (hasNewContainer) {
            finalIsOld = false;
            source = hasOldContainer ? 'API' : 'DOM确认新版';
        }

        const selector = finalIsOld ? _CONTAINER_SELECTORS.old : _CONTAINER_SELECTORS.new;
        logger.info(`[容器探测] 结果: ${finalIsOld ? '旧版' : '新版'} | 选择器: ${selector} | 来源: ${source} | API判断: ${apiSaysOld ? '旧' : '新'} | DOM新: ${hasNewContainer} | DOM旧: ${hasOldContainer}`);
        return { selector, isOld: finalIsOld };
    }

    // https://fonts.google.com/icons
    const iconKeys = {
        replay_30: 'replay_30',
        replay_10: 'replay_10',
        replay_5: 'replay_5',
        replay: 'replay',
        reset: 'repeat',
        forward_media: 'forward_media',
        drag_indicator: 'drag_indicator',
        forward_5: 'forward_5',
        forward_10: 'forward_10',
        forward_30: 'forward_30',
        comment: 'comment',
        comments_disabled: 'comments_disabled',
        switch_on: 'toggle_on',
        switch_off: 'toggle_off',
        setting: 'tune',
        search: 'search',
        done: 'done_all',
        done_disabled: 'remove_done',
        more: 'more_horiz',
        close: 'close',
        refresh: 'refresh',
        block: 'block',
        text_format: 'translate',
        person: 'person',
        sentiment_very_satisfied: 'sentiment_very_satisfied',
        check: 'check',
        edit: 'edit',
        layers_clear: 'layers_clear',
    };

    // 弹幕设置按钮自定义图标：圆形大框装"弹"字 + 右下角小齿轮角标
    const danmakuSettingIconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="2em" height="2em" fill="currentColor" style="vertical-align:middle;display:inline-block">'
        // 外圆圈
        + '<circle cx="11" cy="11" r="9.5" fill="none" stroke="currentColor" stroke-width="1.5"/>'
        // "弹"字，居中
        + '<text x="11" y="11" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="bold" font-family="sans-serif" fill="currentColor">弹</text>'
        // 右下角齿轮角标（viewBox 原始 24×24，缩放到 10×10 放在右下角）
        + '<g transform="translate(13.5,13.5) scale(0.42)">'
        + '<path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58'
        + 'c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96'
        + 'c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81C14.36,2.57,14.16,2.4,13.92,2.4H10.08'
        + 'c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33'
        + 'c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58'
        + 'C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61'
        + 'l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54'
        + 'c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54'
        + 'c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32'
        + 'c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z'
        + 'M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>'
        + '</g></svg>';
    // 此 id 等同于 danmakuTabOpts 内的弹幕信息的 id
    const currentDanmakuInfoContainerId = 'danmakuTab2';
    const tabIframeId = 'danmakuTab5';
    // 菜单 tabs, 为兼容控制器移动, 应避免使用左右布局
    const danmakuTabOpts = [
        { id: 'danmakuTab0', name: '弹幕设置', buildMethod: buildDanmakuSetting },
        { id: 'danmakuTab1', name: '手动匹配', buildMethod: buildSearchEpisode },
        { id: currentDanmakuInfoContainerId, name: '弹幕信息', buildMethod: buildCurrentDanmakuInfo },
        { id: 'danmakuTab3', name: '高级设置', buildMethod: buildProSetting },
        { id: 'danmakuTab4', name: '关于', buildMethod: buildAbout },
        { id: tabIframeId, name: '内嵌网页', hidden: true, buildMethod: buildEmbeddedPage },
    ];
    // 弹幕类型过滤
    const danmakuTypeFilterOpts = {
        bottom: { id: 'bottom', name: '底部弹幕', },
        top: { id: 'top', name: '顶部弹幕', },
        ltr: { id: 'ltr', name: '从左至右', },
        rtl: { id: 'rtl', name: '从右至左', },
        rolling: { id: 'rolling', name: '滚动弹幕', },
        onlyWhite: { id: 'onlyWhite', name: '彩色弹幕', },
        emoji: { id: 'emoji', name: 'emoji', },
    };
    const danmakuSource = {
        AcFun: { id: 'AcFun', name: 'A站(AcFun)' },
        BiliBili: { id: 'BiliBili', name: 'B站(BiliBili)' },
        DanDanPlay: { id: 'DanDanPlay', name: '弹弹(DanDanPlay)' },
        D: { id: 'D', name: 'D' },
        Gamer: { id: 'Gamer', name: '巴哈(Gamer)' },
        iqiyi: { id: 'iqiyi', name: '爱奇艺(iqiyi)' },
        QQ: { id: 'QQ', name: '腾讯视频(QQ)' },
        Youku: { id: 'Youku', name: '优酷(Youku)' },
        '5dm': { id: '5dm', name: 'D站(5dm)' },
        '异世界动漫': { id: '异世界动漫', name: '异世界动漫' },
    };
    const showSource = {
        source: { id: 'source', name: '来源平台' },
        originalUserId: { id: 'originalUserId', name: '用户ID' },
        cid: { id: 'cid', name: '弹幕CID' },
    };
    const danmakuEngineOpts = [
        { id: 'canvas', name: 'canvas' },
        { id: 'dom', name: 'dom' },
    ];
    const danmakuMatchModeOpts = [
        { id: 'hashAndFileName', name: '哈希+文件名' },
        { id: 'fileNameOnly', name: '仅文件名' },
    ];
    const danmakuChConverOpts = [
        { id: '0', name: '未启用' },
        { id: '1', name: '转换为简体' },
        { id: '2', name: '转换为繁体' },
    ];
    const logLevelOpts = [
        { id: '2', name: 'WARN' },
        { id: '3', name: 'INFO' },
        { id: '4', name: 'DEBUG' },
    ];
    const embyOffsetBtnStyle = 'margin: 0;padding: 0;';
    const timeOffsetBtns = [
        { label: '-30', valueOffset: '-30', iconKey: iconKeys.replay_30,  style: embyOffsetBtnStyle },
        { label: '-10', valueOffset: '-10', iconKey: iconKeys.replay_10,  style: embyOffsetBtnStyle },
        { label: '-5',  valueOffset: '-5',  iconKey: iconKeys.replay_5,   style: embyOffsetBtnStyle },
        { label: '-1',  valueOffset: '-1',  iconKey: iconKeys.replay,     style: embyOffsetBtnStyle },
        { label: '0',   valueOffset: '0',   iconKey: iconKeys.reset,      style: embyOffsetBtnStyle },
        { label: '+1',  valueOffset: '1',   iconKey: iconKeys.replay,     style: embyOffsetBtnStyle + ' transform: rotateY(180deg);' },
        { label: '+5',  valueOffset: '5',   iconKey: iconKeys.forward_5,  style: embyOffsetBtnStyle },
        { label: '+10', valueOffset: '10',  iconKey: iconKeys.forward_10, style: embyOffsetBtnStyle },
        { label: '+30', valueOffset: '30',  iconKey: iconKeys.forward_30, style: embyOffsetBtnStyle },
    ];
    const toastPrefixes = {
        system: '[系统通知] : ',
    };
    const hasToastPrefixes = (comment, prefixes) => Object.values(prefixes).some(prefix => comment.text.startsWith(prefix));
    const getDanmakuComments = (ede) => {
        if (ede.danmaku && ede.danmaku.comments) {
          return ede.danmaku.comments.filter(c => !hasToastPrefixes(c, toastPrefixes));
        }
        return [];
      };
    const danmuListOpts = [
        { id: '0', name: '不展示' , onChange: () => [] },
        { id: '1', name: '屏中', onChange: (ede) => ede.danmaku ? ede.danmaku._.runningList : [] },
        { id: '2', name: '所有', onChange: (ede) => ede.commentsParsed },
        { id: '3', name: '已加载', onChange: getDanmakuComments },
        { id: '4', name: '被过滤', onChange: (ede) => {
            // [优化] 使用 Set 优化差集计算性能，防止卡死
            const loadedComments = getDanmakuComments(ede);
            if (!loadedComments || loadedComments.length === 0) return ede.commentsParsed;

            // 将已加载弹幕的 cuid 存入 Set，查找速度极快
            const loadedCuids = new Set(loadedComments.map(c => c.cuid));

            // 只需要遍历一次即可
            return ede.commentsParsed.filter(p => !loadedCuids.has(p.cuid));
        } },
        { id: '5', name: '已相似合并', onChange: (ede) => {
        if (ede.danmaku && ede.danmaku.comments) {
            return ede.danmaku.comments.filter(p => p.xCount);
        }
        return [];
        }
    },
        { id: '100', name: '通知', onChange: (ede) => ede.danmaku ? ede.danmaku.comments.filter(c => hasToastPrefixes(c, toastPrefixes)) : [] },
    ];
    const timeoutCallbackUnitOpts = [
        { id: '0', name: '秒', msRate: 1000 },
        { id: '1', name: '分', msRate: 1000 * 60 },
        { id: '2', name: '时', msRate: 1000 * 60 * 60 },
    ];
    let timeoutCallbackId;
    const timeoutCallbackClear = () => timeoutCallbackId && clearTimeout(timeoutCallbackId);
    const timeoutCallbackTypeOpts = [
        { id: '0', name: '不启用' , onChange: () => timeoutCallbackClear() },
        { id: '1', name: '退出播放', onChange: (ms) => {
            timeoutCallbackClear(), timeoutCallbackId = setTimeout(() => { closeEmbyDialog(), Emby.InputManager.trigger('back') }, ms);
        } },
        { id: '2', name: '返回主页', onChange: (ms) => { // Native 播放器不支持.trigger('home'),虽底层一样,但原因未知
            timeoutCallbackClear(), timeoutCallbackId = setTimeout(() => { closeEmbyDialog(), Emby.Page.goHome() }, ms);
        } },
    ];
    const getApiTl = fn => fn.toString().match(/\=>\s*(.*)$/)[1].trim().replace(/`/g, '');
    const labels = {
        enable: '启用',
    };
    const lsKeys = { // id 统一使用 danmaku 前缀
        chConvert: { id: 'danmakuChConvert', defaultValue: 1, name: '简繁转换' },
        switch: { id: 'danmakuSwitch', defaultValue: true, name: '弹幕开关' },
        autoLoadSwitch: { id: 'danmakuAutoLoadSwitch', defaultValue: true, name: '自动加载弹幕' },
        antiOverlap: { id: 'danmakuAntiOverlap', defaultValue: false, name: '防重叠' },
        filterLevel: { id: 'danmakuFilterLevel', defaultValue: 0, name: '过滤强度', min: 0, max: 3, step: 1 },
        heightPercent: { id: 'danmakuHeightPercent', defaultValue: 70, name: '显示区域', min: 3, max: 100, step: 1 },
        fontSizeRate: { id: 'danmakuFontSizeRate', defaultValue: 140, name: '弹幕大小', min: 50, max: 300, step: 10 },
        fontOpacity: { id: 'danmakuFontOpacity', defaultValue: 60, name: '透明度', min: 20, max: 100, step: 10 },
        speed: { id: 'danmakuBaseSpeed', defaultValue: 200, name: '速度', min: 10, max: 300, step: 10 },
        timelineOffset: { id: 'danmakuTimelineOffset', defaultValue: 0, name: '轴偏秒' },
        fontWeight: { id: 'danmakuFontWeight', defaultValue: 400, name: '弹幕粗细', min: 100, max: 1000, step: 100 },
        fontStyle: { id: 'danmakuFontStyle', defaultValue: 0, name: '弹幕斜体', min: 0, max: 2, step: 1 },
        fontFamily: { id: 'danmakuFontFamily', defaultValue: 'sans-serif', name: '字体' },
        danmuList: { id: 'danmakuDanmuList', defaultValue: 0, name: '弹幕列表' },
        typeFilter: { id: 'danmakuTypeFilter', defaultValue: [], name: '屏蔽类型' },
        sourceFilter: { id: 'danmakuSourceFilter', defaultValue: [], name: '屏蔽来源平台' },
        showSource: { id: 'danmakuShowSource', defaultValue: [], name: '显示每条来源' },
        autoFilterCount: { id: 'danmakuAutoFilterCount', defaultValue: 0, name: '自动过滤弹幕数阈值', min: 0, max: 10000, step: 500 },
        mergeSimilarEnable: { id: 'danmakuMergeSimilarEnable', defaultValue: false, name: '合并相似弹幕' },
        mergeSimilarPercent: { id: 'danmakuMergeSimilarPercent', defaultValue: 80, name: '相似度百分比', min: 20, max: 100, step: 1 },
        mergeSimilarTime: { id: 'danmakuMergeSimilarTime', defaultValue: 10, name: '相似度时间窗口', min: 1, max: 60, step: 1 },
        filterKeywords: { id: 'danmakuFilterKeywords', defaultValue: '', name: '屏蔽关键词' },
        filterKeywordsEnable: { id: 'danmakuFilterKeywordsEnable', defaultValue: true, name: '屏蔽关键词启用' },
        // removeEmojiEnable: { id: 'danmakuRemoveEmojiEnable', defaultValue: false, name: '移除弹幕中的emoji' },
        engine: { id: 'danmakuEngine', defaultValue: 'canvas', name: '弹幕引擎' },
        osdTitleEnable: { id: 'danmakuOsdTitleEnable', defaultValue: false, name: '播放界面右下角显示弹幕信息' },
        osdLineChartEnable: { id: 'danmakuOsdLineChartEnable', defaultValue: false, name: '弹幕高能进度条' },
        osdLineChartSkipFilter: { id: 'danmakuOsdLineChartSkipFilter', defaultValue: false, name: '弹幕高能进度条免过滤' },
        osdLineChartTime: { id: 'danmakuOsdLineChartTime', defaultValue: 10, name: '弹幕高能进度条颗粒度', min: 1, max: 60, step: 1  },
        osdHeaderClockEnable: { id: 'danmakuOsdHeaderClockEnable', defaultValue: false, name: '播放界面头中显示时钟' },
        timeoutCallbackUnit: { id: 'danmakuTimeoutCallbackUnit', defaultValue: 1, name: '定时单位' },
        timeoutCallbackValue: { id: 'danmakuTimeoutCallbackValue', defaultValue: 0, name: '定时值' },
        bangumiEnable: { id: 'danmakuBangumiEnable', defaultValue: false, name: '启用并填写个人令牌' },
        bangumiToken: { id: 'danmakuBangumiToken', defaultValue: '', name: '个人令牌' },
        bangumiPostPercent: { id: 'danmakuBangumiPostPercent', defaultValue: 95, name: '时长比', min: 1, max: 99, step: 1 },
        bangumiApiPrefix: { id: 'danmakuBangumiApiPrefix', defaultValue: 'https://api.bgm.tv', name: 'Bangumi API 地址' },
        bgmSearchFallbackEnable: { id: 'danmakuBgmSearchFallbackEnable', defaultValue: false, name: 'BGM 搜索兜底（主源失败时用 Bangumi 搜索）' },
        bangumiImageDomain: { id: 'danmakuBangumiImageDomain', defaultValue: 'https://lain.bgm.tv', name: 'Bangumi 图片域名' },
        tmdbApiKey: { id: 'danmakuTmdbApiKey', defaultValue: '', name: 'TMDB API Key' },
        tmdbApiBaseUrl: { id: 'danmakuTmdbApiBaseUrl', defaultValue: 'https://api.themoviedb.org', name: 'TMDB API 域名' },
        tmdbEpisodeMappingEnable: { id: 'danmakuTmdbEpisodeMappingEnable', defaultValue: false, name: '启用集数映射' },
        consoleLogEnable: { id: 'danmakuConsoleLogEnable', defaultValue: false, name: '控制台日志' },
        logLevel: { id: 'danmakuLogLevel', defaultValue: '3', name: '日志级别' },
        // 缓存保存只控制网络结果落盘，不影响搜索前读取服务器已有弹幕。
        cacheDanmakuToServer: { id: 'danmakuCacheDanmakuToServer', defaultValue: false, name: '缓存弹幕到服务器' },

        useOfficialApi: { id: 'danmakuUseOfficialApi', defaultValue: true, name: '使用弹弹play' },
        useCustomApi: { id: 'danmakuUseCustomApi', defaultValue: false, name: '使用自定义API' },
        matchApiEnable: { id: 'danmakuMatchApiEnable', defaultValue: false, name: '启用 /match 匹配' },
        matchMode: { id: 'danmakuMatchMode', defaultValue: 'fileNameOnly', name: '匹配模式' },
        appendSeasonEpisode: { id: 'danmakuAppendSeasonEpisode', defaultValue: false, name: '文件名拼接季集号' },
        episodeOffsetRules: { id: 'danmakuEpisodeOffsetRules', defaultValue: [], name: '集数偏移规则' },
        debugShowDanmakuWrapper: { id: 'danmakuDebugShowDanmakuWrapper', defaultValue: false, name: '弹幕容器边界' },
        debugShowDanmakuCtrWrapper: { id: 'danmakuDebugShowDanmakuCtrWrapper', defaultValue: false, name: '按钮容器边界' },
        debugReverseDanmu: { id: 'danmakuDebugReverseDanmu', defaultValue: false, name: '反转弹幕方向' },
        debugRandomDanmuColor: { id: 'danmakuDebugRandomDanmuColor', defaultValue: false, name: '随机弹幕颜色' },
        debugForceDanmuWhite: { id: 'danmakuDebugForceDanmuWhite', defaultValue: false, name: '强制弹幕白色' },
        debugGenerateLarge: { id: 'danmakuDebugGenerateLarge', defaultValue: false, name: '测试大量弹幕' },
        debugDialogHyalinize: { id: 'danmakuDebugDialogHyalinize', defaultValue: false, name: '透明弹窗背景' },
        debugDialogWindow: { id: 'danmakuDebugDialogWindow', defaultValue: false, name: '弹窗窗口化' },
        debugDialogRight: { id: 'danmakuDebugDialogRight', defaultValue: false, name: '弹窗靠右布局' }, // Emby Android 上暂时存在 bug
        debugTabIframeEnable: { id: 'danmakuDebugTabIframeEnable', defaultValue: false, name: '打开内嵌网页' },
        debugH5VideoAdapterEnable: { id: 'danmakuDebugH5VideoAdapterEnable', defaultValue: false, name: '查看视频适配器情况' },
        quickDebugOn: { id: 'danmakuQuickDebugOn', defaultValue: false, name: '快速调试' },
        customeCorsProxyUrl: { id: 'danmakuCustomeCorsProxyUrl', defaultValue: corsProxy, name: '跨域代理前缀' },
        customeDanmakuUrl: { id: 'danmakuCustomeDanmakuUrl', defaultValue: requireDanmakuPath, name: '弹幕引擎依赖' },
        customeGetCommentUrl: { id: 'danmakuCustomeGetCommentUrl', defaultValue: getApiTl(dandanplayApi.getComment), name: '获取指定弹幕库的所有弹幕' },
        customeGetExtcommentUrl: { id: 'danmakuCustomeGetExtcommentUrl', defaultValue: getApiTl(dandanplayApi.getExtcomment), name: '获取指定第三方url的弹幕' },
        customePosterImgUrl: { id: 'danmakuCustomePosterImgUrl', defaultValue: getApiTl(dandanplayApi.posterImg), name: '媒体海报' },
        customApiPrefix: { id: 'danmakuCustomApiPrefix', defaultValue: '', name: '自定义弹弹play API地址' },
        customApiList: { id: 'danmakuCustomApiList', defaultValue: [], name: '自定义弹幕源列表' },
        apiPriority: { id: 'danmakuApiPriority', defaultValue: ['official', 'custom'], name: 'API 优先级' },
        excludedLibraries: { id: 'danmakuExcludedLibraries', defaultValue: [], name: '排除的媒体库' },
        animeTitleBlacklist: { id: 'danmakuAnimeTitleBlacklist', defaultValue: '', name: '标题黑名单正则' },
        episodeTitleBlacklist: { id: 'danmakuEpisodeTitleBlacklist', defaultValue: '^(.*?)(特番|特典|特辑|花絮|预告|PV|CM|NCED|NCOP|Opening|Ending|OP|ED|Menu|刊行.*記念|作曲家|音楽|BGM|OST|主题曲|片尾曲|插曲|C\\d+|S\\d+|OVA|OAD|SP|Special|番外|外传|衍生|制作花絮|幕后|访谈|采访|发布会|宣传|推广)(.*?)$', name: '分集名称黑名单正则' },
        blacklistApplyToCustomApi: { id: 'danmakuBlacklistApplyToCustomApi', defaultValue: false, name: '黑名单应用于自定义接口' },
        convertTopTo: { id: 'danmakuConvertTopTo', defaultValue: 'default', name: '顶部弹幕转换为' },
        convertBottomTo: { id: 'danmakuConvertBottomTo', defaultValue: 'default', name: '底部弹幕转换为' },
        configPersistenceEnable: { id: 'danmakuConfigPersistenceEnable', defaultValue: true, name: '启用配置持久化' },
        configPersistenceAutoSync: { id: 'danmakuConfigPersistenceAutoSync', defaultValue: true, name: '实时同步' },
        configPersistenceNamespace: { id: 'danmakuConfigPersistenceNamespace', defaultValue: 'dd-danmaku', name: '同步标识符' },
    };

    // DLL 联动适配层：能力探测成功才启用，失败时保持纯 JS 插件行为。
    const ddBackend = (() => {
        // API 默认仅限播放器直连字段，全局源凭据按管理员配置共享给继承者。
        const defaultKeys = new Set(['switch', 'autoLoadSwitch', 'antiOverlap', 'filterLevel',
            'heightPercent', 'fontSizeRate', 'fontOpacity', 'speed', 'fontWeight', 'fontStyle',
            'chConvert', 'fontFamily', 'engine', 'autoFilterCount', 'mergeSimilarEnable',
            'mergeSimilarPercent', 'mergeSimilarTime', 'filterKeywords', 'filterKeywordsEnable',
            'osdTitleEnable', 'osdLineChartEnable', 'osdLineChartSkipFilter', 'osdLineChartTime', 'osdHeaderClockEnable',
            'typeFilter', 'sourceFilter', 'showSource', 'convertTopTo', 'convertBottomTo',
            'useFetchPluginXml', 'useOfficialApi', 'useCustomApi', 'matchApiEnable', 'matchMode', 'appendSeasonEpisode',
            'customApiList', 'apiPriority', 'customApiPrefix', 'customeCorsProxyUrl', 'customeGetCommentUrl',
            'customeGetExtcommentUrl', 'customePosterImgUrl', 'customeDanmakuUrl']);
        let snapshot = null;
        let sessionKey = '';
        let defaults = null;
        let defaultsLoaded = false;
        let defaultsPromise = null;
        let probePromise = null;
        let probeCompleted = false;

        function resetIfSessionChanged() {
            // 外部单脚本注入器可能没有宿主 ApiClient；未定义时必须完整降级为纯 JS 模式。
            const client = typeof ApiClient !== 'undefined' ? ApiClient : null;
            const key = `${client?.serverAddress?.() || ''}|${client?.getCurrentUserId?.() || ''}`;
            if (key !== sessionKey) {
                sessionKey = key;
                snapshot = null;
                defaults = null;
                defaultsLoaded = false;
                defaultsPromise = null;
                probePromise = null;
                probeCompleted = false;
            }
            return key;
        }
        async function request(path, timeout = 2000) {
            const client = typeof ApiClient !== 'undefined' ? ApiClient : null;
            if (!client?.serverAddress) return null;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            try {
                const base = String(client.serverAddress?.() || '').replace(/\/$/, '');
                const response = await fetch(`${base}${path}`, {
                    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
                    signal: controller.signal,
                    headers: { 'Accept': 'application/json', 'X-Emby-Token': client.accessToken?.() || '' }
                });
                const body = await response.json().catch(() => null);
                if (!response.ok || body?.success === false || body?.Success === false) {
                    const error = new Error(body?.message || body?.Message || `DLL 请求失败（${response.status}）`);
                    error.status = response.status;
                    throw error;
                }
                return body?.data ?? body?.Data ?? body;
            } finally { clearTimeout(timer); }
        }
        async function probe() {
            const requestSessionKey = resetIfSessionChanged();
            if (snapshot) return snapshot;
            if (probeCompleted) return null;
            if (!probePromise) {
                let currentPromise;
                currentPromise = request('/dd-danmaku/api/capabilities').then(data => {
                    // 请求期间可能已切换服务器或用户，旧响应不能污染新会话缓存。
                    if (requestSessionKey !== resetIfSessionChanged()) return null;
                    const caps = data?.capabilities || data?.Capabilities || {};
                    const mode = data?.mode || data?.Mode;
                    const apiVersion = Number(data?.apiVersion ?? data?.ApiVersion);
                    snapshot = mode === 'dll' && apiVersion >= 1 && data?.enabled !== false
                        ? { ...data, capabilities: caps } : null;
                    probeCompleted = true;
                    return snapshot;
                }).catch(() => {
                    if (requestSessionKey === resetIfSessionChanged()) {
                        snapshot = null;
                        probeCompleted = true;
                    }
                    return null;
                }).finally(() => {
                    if (probePromise === currentPromise) probePromise = null;
                });
                probePromise = currentPromise;
            }
            return probePromise;
        }
        return {
            async prepare() {
                const requestSessionKey = resetIfSessionChanged();
                const state = await probe();
                if (!state || requestSessionKey !== resetIfSessionChanged()) return null;
                if (defaultsLoaded) return state;
                if (!defaultsPromise) {
                    const promiseSessionKey = requestSessionKey;
                    let currentPromise;
                    currentPromise = request('/dd-danmaku/api/frontend-defaults')
                        .then(data => {
                            if (promiseSessionKey !== resetIfSessionChanged()) return null;
                            defaults = data?.effective || data?.Effective || null;
                            defaultsLoaded = true;
                            // 默认值是会话级覆盖，失效目标字段但不触碰用户持久化内容。
                            for (const key of defaultKeys) lsCache.delete(localParameterKey(lsKeys[key].id));
                            return defaults;
                        })
                        .catch(() => null)
                        .finally(() => {
                            if (defaultsPromise === currentPromise) defaultsPromise = null;
                        });
                    defaultsPromise = currentPromise;
                }
                await defaultsPromise;
                return requestSessionKey === resetIfSessionChanged() ? state : null;
            },
            has(name) { return Boolean(snapshot?.capabilities?.[name]); },
            async queryPlayback(itemId, source) {
                const requestSessionKey = resetIfSessionChanged();
                if (!snapshot || !this.has('LocalDanmaku') || !itemId) return null;
                try {
                    // 读取独立于前端保存开关；仍遵守服务器读取策略。
                    const policy = await request('/dd-danmaku/api/playback-policy');
                    if (requestSessionKey !== resetIfSessionChanged() || !policy?.readEnabled || !policy?.preferLocal) return null;
                    const sourceQuery = source === undefined ? '' : `&source=${encodeURIComponent(source)}`;
                    // single 由服务端选择首个可读文件，避免 select 额外解析全部 XML。
                    const groups = await request(`/api/danmu/${encodeURIComponent(itemId)}?option=GetJsonById&mode=single${sourceQuery}`, 15000);
                    if (requestSessionKey !== resetIfSessionChanged() || !Array.isArray(groups)) return null;
                    const comments = groups.flatMap(group => (group.danmuEvents || []).map(event => {
                        const p = String(event.p || '').split(',');
                        return { text: event.m, time: Number(p[0]), mode: Number(p[1]), color: Number(p[3]), userId: p[6] || '' };
                    }));
                    // 保留本地文件来源供展示，不将其伪装成在线匹配结果。
                    return { found: comments.length > 0, comments, source: groups[0]?.sourceName || '本地 XML' };
                }
                catch (_) { return null; }
            },
            async resolveMatch(payload) {
                const requestSessionKey = resetIfSessionChanged();
                const client = typeof ApiClient !== 'undefined' ? ApiClient : null;
                // 与能力接口的 MediaMatch 契约一致，不将 AI 授权作为传统匹配门槛。
                if (!client?.serverAddress || !snapshot || !this.has('MediaMatch')) return null;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 130000);
                try {
                    const base = String(client?.serverAddress?.() || '').replace(/\/$/, '');
                    const response = await fetch(`${base}/dd-danmaku/api/matches/resolve`, {
                        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
                        signal: controller.signal,
                        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json',
                            'X-Emby-Token': client?.accessToken?.() || '' },
                        body: JSON.stringify(payload)
                    });
                    const body = await response.json().catch(() => null);
                    const trace = String(body?.traceId ?? body?.TraceId ?? '');
                    const safeTrace = /^[a-f0-9]{8,32}$/i.test(trace) ? trace : '无';
                    if (!response.ok || body?.success === false || body?.Success === false) {
                        // 代理 HTML、空响应和插件 JSON 分开报告，禁止输出原始正文或凭据。
                        const code = String(body?.error?.code ?? body?.errorCode ?? body?.ErrorCode ?? 'NON_PLUGIN_ERROR');
                        logger.warn(`[后端匹配] HTTP ${response.status}，错误码=${/^[A-Z0-9_]{1,80}$/.test(code) ? code : 'UNKNOWN_ERROR'}，关联号=${safeTrace}，JSON响应=${body !== null}`);
                        return null;
                    }
                    if (requestSessionKey !== resetIfSessionChanged()) return null;
                    const result = body?.data ?? body?.Data;
                    // 成功也验证业务契约，避免代理返回 HTTP 200 页面或畸形 JSON 被当成匹配结果。
                    if (body?.success !== true || !result || !Array.isArray(result.candidates)
                        || !['matched', 'unmatched', 'ambiguous', 'insufficient_metadata'].includes(result.status)) {
                        logger.warn(`[后端匹配] 响应协议无效，关联号=${safeTrace}`);
                        return null;
                    }
                    return result;
                } catch (error) {
                    logger.warn(`[后端匹配] ${error?.name === 'AbortError' ? '请求超时' : '网络或响应解析失败'}，不采用前端自动匹配`);
                    return null;
                }
                finally { clearTimeout(timer); }
            },
            defaultValue(key) {
                if (!defaultKeys.has(key)) return undefined;
                const value = defaults?.[key];
                // 宿主以字符串保存 API 数组；播放器始终消费数组。
                if (['customApiList', 'apiPriority'].includes(key) && typeof value === 'string') {
                    try { const list = JSON.parse(value); return Array.isArray(list) ? list : undefined; }
                    catch { return undefined; }
                }
                return value;
            },
            isDll() { return Boolean(snapshot); },
            resetCache() {
                defaults = null;
                defaultsLoaded = false;
                for (const key of defaultKeys) lsCache.delete(localParameterKey(lsKeys[key].id));
            }
        };
    })();

    const lsLocalKeys = {
        animePrefix: '_anime_id_rel_',
        animeSeasonPrefix: '_anime_season_rel_',
        animeEpisodePrefix: '_episode_id_rel_',
        bangumiEpInfoPrefix: '_bangumi_episode_id_rel_',
        bangumiMe: '_bangumi_me',
    };
    const eleIds = {
        danmakuSwitchBtn: 'danmakuSwitchBtn',
        danmakuCtr: 'danmakuCtr',
        danmakuWrapper: 'danmakuWrapper',
        h5VideoAdapter: 'h5VideoAdapter',
        dialogContainer: 'dialogContainer',
        danmakuSwitchDiv: 'danmakuSwitchDiv',
        autoLoadSwitchDiv: 'autoLoadSwitchDiv',
        autoLoadSwitchBtn: 'autoLoadSwitchBtn',
        danmakuSwitch: 'danmakuSwitch',
        filterLevelDiv: 'filterLevelDiv',
        danmakuSearchNameDiv: 'danmakuSearchNameDiv',
        danmakuSearchName: 'danmakuSearchName',
        danmakuEpisodeFlag: 'danmakuEpisodeFlag',
        danmakuAnimeDiv: 'danmakuAnimeDiv',
        danmakuSwitchEpisode: 'danmakuSwitchEpisode',
        danmakuEpisodeNumDiv: 'danmakuEpisodeNumDiv',
        danmakuEpisodeLoad: 'danmakuEpisodeLoad',
        danmakuRemark: 'danmakuRemark',
        danmakuAnimeSelect: 'danmakuAnimeSelect',
        danmakuEpisodeNumSelect: 'danmakuEpisodeNumSelect',
        searchImgDiv: 'searchImgDiv',
        searchImg: 'searchImg',
        searchApiSource: 'searchApiSource',
        apiSelectDiv: 'apiSelectDiv',
        extCommentSearchDiv: 'extCommentSearchDiv',
        extUrlsDiv: 'extUrlsDiv',
        currentMatchedDiv: 'currentMatchedDiv',
        filteringDanmaku: 'filteringDanmaku',
        danmakuTypeFilterDiv: 'danmakuTypeFilterDiv',
        danmakuTypeFilterSelectName: 'danmakuTypeFilterSelectName',
        danmakuSourceFilterDiv: 'danmakuSourceFilterDiv',
        danmakuSourceFilterSelectName: 'danmakuSourceFilterSelectName',
        danmakuShowSourceDiv: 'danmakuShowSourceDiv',
        danmakuShowSourceSelectName: 'danmakuShowSourceSelectName',
        danmakuAutoFilterCountDiv: 'danmakuAutoFilterCountDiv',
        danmakuFilterProDiv: 'danmakuFilterProDiv',
        mergeSimilarPercentDiv: "mergeSimilarPercentDiv",
        mergeSimilarTimeDiv: "mergeSimilarTimeDiv",
        posterImgDiv: 'posterImgDiv',
        danmuListDiv: 'danmuListDiv',
        danmuListText: 'danmakuListText',
        extInfoCtrlDiv: 'extInfoCtrlDiv',
        extInfoDiv: 'extInfoDiv',
        characterImgHeihtDiv: 'characterImgHeihtDiv',
        characterImgHeihtLabel: 'characterImgHeihtLabel',
        charactersDiv: 'charactersDiv',
        filterKeywordsDiv: 'filterKeywordsDiv',
        danmakuChConverDiv: 'danmakuChConverDiv',
        danmakuEngineDiv: 'danmakuEngineDiv',
        heightPercentDiv: 'heightPercentDiv',
        danmakuSizeDiv: 'danmakuSizeDiv',
        danmakuOpacityDiv: 'danmakuOpacityDiv',
        danmakuSpeedDiv: 'danmakuSpeedDiv',
        danmakuFontWeightDiv: 'danmakuFontWeightDiv',
        danmakuFontStyleDiv: 'danmakuFontStyleDiv',
        timelineOffsetDiv: 'timelineOffsetDiv',
        fontFamilyCtrl: 'fontFamilyCtrl',
        fontFamilyDiv: 'fontFamilyDiv',
        fontFamilyLabel: 'fontFamilyLabel',
        fontFamilySelect: 'fontFamilySelect',
        fontFamilyInput: 'fontFamilyInput',
        fontStylePreview: 'fontStylePreview',
        settingsCtrl: 'settingsCtrl',
        settingsText: 'settingsText',
        settingsImportBtn: 'settingsImportBtn',
        settingReloadBtn: 'settingReloadBtn',
        filterKeywordsEnableId: 'filterKeywordsEnableId',
        filterKeywordsId: 'filterKeywordsId',
        timeoutCallbackDiv: 'timeoutCallbackDiv',
        timeoutCallbackLabel: 'timeoutCallbackLabel',
        timeoutCallbackTypeDiv: 'timeoutCallbackTypeDiv',
        timeoutCallbackUnitDiv: 'timeoutCallbackUnitDiv',
        bangumiEnableLabel: 'bangumiEnableLabel',
        bgmSearchFallbackLabel: 'bgmSearchFallbackLabel',
        bangumiSettingsDiv: 'bangumiSettingsDiv',
        bangumiTokenInput: 'bangumiTokenInput',
        bangumiTokenInputDiv: 'bangumiTokenInputDiv',
        bangumiTokenLabel: 'bangumiTokenInputLabel',
        bangumiTokenLinkDiv: 'bangumiTokenLinkDiv',
        bangumiPostPercentDiv: 'bangumiPostPercentDiv',
        bangumiApiPrefixInputDiv: 'bangumiApiPrefixInputDiv',
        bangumiImageDomainInputDiv: 'bangumiImageDomainInputDiv',
        tmdbEnableLabel: 'tmdbEnableLabel',
        tmdbSettingsDiv: 'tmdbSettingsDiv',
        tmdbApiKeyInput: 'tmdbApiKeyInput',
        tmdbApiKeyInputDiv: 'tmdbApiKeyInputDiv',
        tmdbApiKeyLabel: 'tmdbApiKeyLabel',
        tmdbApiKeyLinkDiv: 'tmdbApiKeyLinkDiv',
        tmdbApiBaseUrlInput: 'tmdbApiBaseUrlInput',
        tmdbApiBaseUrlInputDiv: 'tmdbApiBaseUrlInputDiv',
        tmdbApiBaseUrlLabel: 'tmdbApiBaseUrlLabel',
        persistenceEnableLabel: 'persistenceEnableLabel',
        persistenceAutoSyncLabel: 'persistenceAutoSyncLabel',
        persistenceNamespaceInput: 'persistenceNamespaceInput',
        persistenceNamespaceLabel: 'persistenceNamespaceLabel',
        persistenceSettingsDiv: 'persistenceSettingsDiv',
        persistenceStatusLabel: 'persistenceStatusLabel',
        customeUrlsDiv: 'customeUrlsDiv',
        customeCorsProxyDiv: 'customeCorsProxyDiv',
        customeDanmakuDiv: 'customeDanmakuDiv',
        customeGetCommentDiv: 'customeGetCommentDiv',
        customeGetExtcommentDiv: 'customeGetExtcommentDiv',
        customePosterImgDiv: 'customePosterImgDiv',
        consoleLogCtrl: 'consoleLogCtrl',
        consoleLogCtrlLeft: 'consoleLogCtrlLeft',
        consoleLogInfo: 'consoleLogInfo',
        consoleLogText: 'consoleLogText',
        consoleLogTextInput: 'consoleLogTextInput',
        consoleLogCountLabel: 'consoleLogCountLabel',
        consoleLogSearchInput: 'consoleLogSearchInput', // 日志搜索框
        logLevelDiv: 'logLevelDiv',
        debugCheckbox: 'debugCheckbox',
        debugButton: 'debugButton',
        tabIframe: 'tabIframe',
        tabIframeHeightDiv: 'tabIframeHeightDiv',
        tabIframeHeightLabel: 'tabIframeHeightLabel',
        tabIframeCtrlDiv: 'tabIframeCtrlDiv',
        tabIframeSrcInputDiv: 'tabIframeSrcInputDiv',
        openSourceLicenseDiv: 'openSourceLicenseDiv',
        videoOsdDanmakuTitle: 'videoOsdDanmakuTitle',

        extCheckboxDiv: 'extCheckboxDiv',
        osdCheckboxDiv: 'osdCheckboxDiv',
        osdLineChartDiv: 'osdLineChartDiv',
        osdLineChartTimeDiv: "osdLineChartTimeDiv",

        danmakuSettingBtnDebug: 'danmakuSettingBtnDebug',
        progressBarLineChart: 'progressBarLineChart',
        antiOverlapBtn: 'antiOverlapBtn',
        antiOverlapDiv: 'antiOverlapDiv',
        excludedLibrariesDiv: 'excludedLibrariesDiv',
        excludedLibrariesInput: 'excludedLibrariesInput',
        currentLibraryInfo: 'currentLibraryInfo',
        searchBlacklistDiv: 'searchBlacklistDiv',
        animeTitleBlacklistInput: 'animeTitleBlacklistInput',
        episodeTitleBlacklistInput: 'episodeTitleBlacklistInput',
        blacklistApplyToCustomApiCheckbox: 'blacklistApplyToCustomApiCheckbox',
        matchApiEnableDiv: 'matchApiEnableDiv',
        matchModeDiv: 'matchModeDiv',
        appendSeasonEpisodeDiv: 'appendSeasonEpisodeDiv',
        episodeOffsetRulesDiv: 'episodeOffsetRulesDiv',
    };
    // 播放界面下方按钮
    // danmakuSwitchBtn 以"弹"文字替代图标，加载中由 CSS @keyframes 旋转动效提示状态
    const mediaBtnOpts = [
        { id: eleIds.danmakuSwitchBtn, label: '弹幕开关', danmakuTextBtn: true, onClick: doDanmakuSwitch },
        { label: '弹幕设置', svgHtml: danmakuSettingIconSvg, onClick: createDialog },
    ];
    const customeUrlMsg1 = '限弹弹 play API 兼容结构';
    const customeUrl = {
        init: () => customeUrl.mapping.map(obj => obj.rewrite(lsGetItem(obj.lsKey.id))),
        mapping: [
            { divId: eleIds.customeDanmakuDiv, lsKey: lsKeys.customeDanmakuUrl, rewrite: (tl) => {requireDanmakuPath = tl; }
                , msg1: `限 ${openSourceLicense.danmaku.url} 兼容结构`
                , msg2: `Danmaku 依赖路径,index.html 引入的和篡改猴环境不会使用到,依赖已内置,
                        仅在被 CustomCssJS 执行的特殊环境下使用,支持相对/绝对/网络路径,
                        默认是相对路径等同 https://emby/web/ 和 /system/dashboard-ui/ ,非浏览器客户端必须使用网络路径`  },
            { divId: eleIds.customeCorsProxyDiv, lsKey: lsKeys.customeCorsProxyUrl, rewrite: (tl) => { corsProxy = tl; }
                , msg1: '仅弹弹 play API 跨域使用,限 URL 前缀反代方式,例如 cf_worker'
                , msg2: '以下共用变量: { dandanplayApi.prefix: 反代前缀拼接的弹弹 play API 路径前缀, }' },
            { divId: eleIds.customeGetCommentDiv, lsKey: lsKeys.customeGetCommentUrl, rewrite: (tl) => {
                dandanplayApi.getComment = (episodeId, chConvert) => {
                    // 模板通过 eval 读取这两个参数；显式引用同时避免 IDE 将模板参数误判为无用变量。
                    void episodeId;
                    void chConvert;
                    return eval('`' + tl + '`');
                };
            }, msg1: customeUrlMsg1, msg2: '变量: { episodeId: 章节 ID, chConvert: 简繁转换, }' },
            { divId: eleIds.customeGetExtcommentDiv, lsKey: lsKeys.customeGetExtcommentUrl, rewrite: (tl) => {
                dandanplayApi.getExtcomment = (url) => {
                    // 模板通过 eval 读取 url；显式引用保留自定义 URL 模板的现有语义。
                    void url;
                    return eval('`' + tl + '`');
                };
            }, msg1: customeUrlMsg1, msg2: '变量: { url: 附加弹幕输入框中的网址, }' },
            { divId: eleIds.customePosterImgDiv, lsKey: lsKeys.customePosterImgUrl, rewrite: (tl) => {
                dandanplayApi.posterImg = (animeId) => {
                    // 模板通过 eval 读取 animeId；显式引用保留自定义海报 URL 模板语义。
                    void animeId;
                    return eval('`' + tl + '`');
                };
            }, msg1: customeUrlMsg1, msg2: '变量: { animeId: 弹弹 play 的作品 ID, }' },
        ],
    };
    // emby ui class
    const classes = {
        dialogContainer: 'dialogContainer',
        dialogBackdropOpened: 'dialogBackdropOpened',
        dialogBlur: 'dialog-blur', // Emby Theater (魔改版)上的毛玻璃背景
        dialog: 'dialog',
        formDialogHeader: 'formDialogHeader',
        formDialogFooter: 'formDialogFooter',
        formDialogFooterItem: 'formDialogFooterItem',
        dialogFullscreen: 'dialog-fullscreen',
        dialogFullscreenLowres: 'dialog-fullscreen-lowres', // Emby Android (魔改版)特殊全屏
        videoOsdTitle: 'videoOsdTitle', // 播放页媒体次级标题
        videoOsdBottomButtons: 'videoOsdBottom-buttons', // 新老客户端播放页通用的底部按钮,但在 TV 下是 hide
        videoOsdBottomButtonsTopRight: 'videoOsdBottom-buttons-topright', // 新客户端播放页右上方的按钮
        videoOsdBottomButtonsRight: 'videoOsdBottom-buttons-right', // 老客户端上的右侧按钮
        videoOsdPositionSliderContainer: 'videoOsdPositionSliderContainer',
        cardImageIcon: 'cardImageIcon',
        headerRight: 'headerRight',
        headerUserButton: 'headerUserButton',
        mdlSpinner: 'mdl-spinner',
        collapseContentNav: 'collapseContent navDrawerCollapseContent',
        embyLabel: 'inputLabel',
        embyInput: 'emby-input emby-input-smaller',
        embySelectWrapper: 'emby-select-wrapper',
        embySelectTv: 'emby-select-tv', // highlight on tv layout
        embyCheckboxList: 'checkboxList',
        embyFieldDesc: 'fieldDescription',
        embyTabsMenu: 'headerMiddle headerSection sectionTabs headerMiddle-withSectionTabs',
        embyTabsDiv1: 'tabs-viewmenubar tabs-viewmenubar-backgroundcontainer focusable scrollX hiddenScrollX smoothScrollX scrollFrameX emby-tabs',
        embyTabsDiv2: 'tabs-viewmenubar-slider emby-tabs-slider padded-left padded-right nohoverfocus scrollSliderX',
        embyTabsButton: 'emby-button secondaryText emby-tab-button main-tab-button',
        embyButtons: {
            basic: 'raised emby-button',
            submit: 'button-submit',
            help: 'button-help',
            link: 'button-link',
            iconButton: 'flex-shrink-zero paper-icon-button-light',
        },
    };
    const styles = {
        // 更改 checkboxList 垂直排列为横向自动
        embyCheckboxList: 'display: flex;flex-wrap: wrap;',
        // 容器内元素垂直排列,水平居中
        embySliderList: 'display: flex;flex-direction: column;justify-content: center;align-items: center;',
        // 容器内元素横向并排,垂直居中
        embySlider: 'display: flex; align-items: center; margin-bottom: 0.3em;',
        embySliderLabel: 'width: 4em; margin-left: 1em;',
        rightLayout: 'position: fixed; right: 0; width: 40%; min-width: auto; min-height: auto; max-width: 100%; max-height: 100%;',
        colors: {
            info: 0xffffff,  // 白色
            success: 0x00ff00,  // 绿色
            warn: 0xffff00,  // 黄色
            error: 0xff0000,  // 红色
            highlight: 'rgba(115, 160, 255, 0.3)', // 尽量接近浏览器控制台选定元素的淡蓝色背景色
            switchActiveColor: '#52b54b',
        },
        fontStyles: [
            { id: 'normal', name: '正常' },
            { id: 'italic', name: '原生斜体' },
            { id: 'oblique', name: '形变斜体' },
        ],
    };
    function objectEntries(obj) {
        if (obj && typeof obj === 'object') {
            return Object.keys(obj).map(key => [key, obj[key]]);
        }
        return [];
    }
    // [优化] UA 正则检测结果缓存，启动时一次性计算，避免每次调用都重复 regex
    const _ua = navigator.userAgent;
    const _uaCache = {
        android: /android/i.test(_ua),
        ios: /iPad|iPhone|iPod/i.test(_ua),
        macOS: /Macintosh|MacIntel/i.test(_ua),
        windows: /compatible|Windows/i.test(_ua),
        ubuntu: /Ubuntu/i.test(_ua),
    };
    const OS = {
        isAndroid: () => _uaCache.android,
        isIOS: () => _uaCache.ios,
        isMacOS: () => _uaCache.macOS,
        isApple: () => _uaCache.macOS || _uaCache.ios,
        isWindows: () => _uaCache.windows,
        isMobile: () => _uaCache.android || _uaCache.ios,
        isUbuntu: () => _uaCache.ubuntu,
        isAndroidEmbyNoisyX: () => {
            const client = getHostApiClient();
            return _uaCache.android && String(client?.appVersion?.() || '').includes('-');
        },
        isEmbyNoisyX: () => String(getHostApiClient()?.appVersion?.() || '').includes('-'),
        isOthers: () => !_uaCache.android && !_uaCache.ios && !_uaCache.macOS && !_uaCache.windows && !_uaCache.ubuntu,
    };
    // 全局 g 标志的正则在 test() 时会更新 lastIndex，跨调用产生状态导致漏判；移除 g，保留 u 支持 Unicode
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}]/u;

    // 日志级别常量
    const LOG_LEVEL = { OFF: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 };
    // 日志工具函数
    const DD_LOG_PREFIX = '[dd-danmaku]';
    const logger = {
        debug: (...args) => logLevel >= LOG_LEVEL.DEBUG && console.log(DD_LOG_PREFIX, '[DEBUG]', ...args),
        info: (...args) => logLevel >= LOG_LEVEL.INFO && console.log(DD_LOG_PREFIX, '[INFO]', ...args),
        warn: (...args) => logLevel >= LOG_LEVEL.WARN && console.warn(DD_LOG_PREFIX, '[WARN]', ...args),
        error: (...args) => logLevel >= LOG_LEVEL.ERROR && console.error(DD_LOG_PREFIX, '[ERROR]', ...args),
    };

    // ------ 程序内部使用,请勿更改 end ------

    // ------ require start ------
    let skipInnerModule = false;
    try {
        throw new Error();
    } catch(e) {
        skipInnerModule = e.stack && e.stack.includes('CustomCssJS');
        // console.log('ignore this not error, callee:', e);
    }

    // ========== Danmaku 运行时补丁系统（通用注册表，内联/网络加载后均可调用）==========
    // 补丁注册表：每个补丁是 { name, description, apply(DanmakuClass) }
    // apply 接收原始 Danmaku 类，返回补丁后的类（或 null 表示跳过）
    // 新增补丁只需往 danmakuPatches 数组 push 即可
    const danmakuPatches = [
        {
            name: 'seeking-position-fix',
            description: 'Seeking 恢复优化：回退 position 到 currentTime - duration，确保拖动进度条后弹幕立即恢复',
            apply(DanmakuClass) {
                const origDestroy = DanmakuClass.prototype.destroy;
                const OrigDanmaku = DanmakuClass;

                class PatchedDanmaku extends OrigDanmaku {
                    constructor(opts) {
                        super(opts);
                        if (this.media && this.comments && this._) {
                            const self = this;
                            this._patchedSeekingHandler = function () {
                                const targetTime = self.media.currentTime - (self._.duration || 4);
                                let pos = 0;
                                for (let i = 0; i < self.comments.length; i++) {
                                    if (self.comments[i].time >= targetTime) { pos = i; break; }
                                }
                                self._.position = Math.max(0, pos);
                            };
                            this._patchedSeekingWrapper = function () {
                                setTimeout(self._patchedSeekingHandler, 0);
                            };
                            this.media.addEventListener('seeking', this._patchedSeekingWrapper);
                        }
                    }

                    destroy() {
                        if (this.media && this._patchedSeekingWrapper) {
                            this.media.removeEventListener('seeking', this._patchedSeekingWrapper);
                            this._patchedSeekingWrapper = null;
                            this._patchedSeekingHandler = null;
                        }
                        return origDestroy.call(this);
                    }
                }
                return PatchedDanmaku;
            }
        },
        // 后续补丁在此追加，格式同上：
        // { name: 'xxx', description: 'xxx', apply(DanmakuClass) { ... return PatchedClass; } },
    ];

    // 通用补丁应用函数：遍历注册表逐个应用
    function applyDanmakuPatches() {
        let DanmakuClass = window.Danmaku || (typeof Danmaku !== 'undefined' ? Danmaku : null);
        if (!DanmakuClass) {
            logger.warn('[弹幕引擎补丁] Danmaku 类不可用，跳过所有补丁');
            return;
        }
        if (DanmakuClass._ddPatched) {
            logger.debug('[弹幕引擎补丁] 已应用过，跳过');
            return;
        }

        const applied = [];
        for (const patch of danmakuPatches) {
            try {
                const result = patch.apply(DanmakuClass);
                if (result) {
                    DanmakuClass = result;
                    applied.push(patch.name);
                }
            } catch (e) {
                logger.warn(`[弹幕引擎补丁] "${patch.name}" 应用失败:`, e);
            }
        }

        if (applied.length > 0) {
            DanmakuClass._ddPatched = true;
            window.Danmaku = DanmakuClass;
            logger.info(`[弹幕引擎补丁] 已应用 ${applied.length} 个补丁: ${applied.join(', ')}`);
        }
    }
    // ========== Danmaku 运行时补丁系统结束 ==========

    if (!skipInnerModule) {
        // 这里内置依赖是工作在浏览器油猴和服务端 index.html 环境下, requireDanmakuPath 是特殊环境 CustomCssJS 下网络加载使用
        /* https://cdn.jsdelivr.net/npm/danmaku@2.0.10/dist/danmaku.min.js */
        /* eslint-disable */
        // prettier-ignore
        // v2.0.10 原版代码（未修改），所有补丁在加载后通过运行时 monkey-patch 应用
        logger.info('[弹幕引擎] 使用内联模式加载 Danmaku 库 (非 CustomCssJS 环境)');

        // ===== AMD/RequireJS 环境隔离 (修复 Emby 4.9.5.0+ Alameda 冲突) =====
        // 临时屏蔽全局 define，避免 Danmaku UMD 被劫持到 AMD 分支
        let _originalDefine;
        let _hasDefine = false;
        try {
            _hasDefine = typeof window.define !== 'undefined';
            if (_hasDefine) {
                _originalDefine = window.define;
                logger.debug('[弹幕引擎] 检测到 AMD 环境 (Emby Alameda), 临时屏蔽 define 以避免 UMD 劫持');
                window.define = undefined;
            }
        } catch (e) {
            logger.warn('[弹幕引擎] 无法屏蔽 window.define (可能只读)，继续加载', e);
        }

        !function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t="undefined"!=typeof globalThis?globalThis:t||self).Danmaku=e()}(this,(function(){"use strict";var t=function(){if("undefined"==typeof document)return"transform";for(var t=["oTransform","msTransform","mozTransform","webkitTransform","transform"],e=document.createElement("div").style,i=0;i<t.length;i++)if(t[i]in e)return t[i];return"transform"}();function e(t){var e=document.createElement("div");if(e.style.cssText="position:absolute;","function"==typeof t.render){var i=t.render();if(i instanceof HTMLElement)return e.appendChild(i),e}if(e.textContent=t.text,t.style)for(var n in t.style)e.style[n]=t.style[n];return e}var i={name:"dom",init:function(){var t=document.createElement("div");return t.style.cssText="overflow:hidden;white-space:nowrap;transform:translateZ(0);",t},clear:function(t){for(var e=t.lastChild;e;)t.removeChild(e),e=t.lastChild},resize:function(t,e,i){t.style.width=e+"px",t.style.height=i+"px"},framing:function(){},setup:function(t,i){var n=document.createDocumentFragment(),s=0,r=null;for(s=0;s<i.length;s++)(r=i[s]).node=r.node||e(r),n.appendChild(r.node);for(i.length&&t.appendChild(n),s=0;s<i.length;s++)(r=i[s]).width=r.width||r.node.offsetWidth,r.height=r.height||r.node.offsetHeight},render:function(e,i){i.node.style[t]="translate("+i.x+"px,"+i.y+"px)"},remove:function(t,e){t.removeChild(e.node),this.media||(e.node=null)}},n="undefined"!=typeof window&&window.devicePixelRatio||1,s=Object.create(null);function r(t,e){if("function"==typeof t.render){var i=t.render();if(i instanceof HTMLCanvasElement)return t.width=i.width,t.height=i.height,i}var r=document.createElement("canvas"),h=r.getContext("2d"),o=t.style||{};o.font=o.font||"10px sans-serif",o.textBaseline=o.textBaseline||"bottom";var a=1*o.lineWidth;for(var d in a=a>0&&a!==1/0?Math.ceil(a):1*!!o.strokeStyle,h.font=o.font,t.width=t.width||Math.max(1,Math.ceil(h.measureText(t.text).width)+2*a),t.height=t.height||Math.ceil(function(t,e){if(s[t])return s[t];var i=12,n=t.match(/(\d+(?:\.\d+)?)(px|%|em|rem)(?:\s*\/\s*(\d+(?:\.\d+)?)(px|%|em|rem)?)?/);if(n){var r=1*n[1]||10,h=n[2],o=1*n[3]||1.2,a=n[4];"%"===h&&(r*=e.container/100),"em"===h&&(r*=e.container),"rem"===h&&(r*=e.root),"px"===a&&(i=o),"%"===a&&(i=r*o/100),"em"===a&&(i=r*o),"rem"===a&&(i=e.root*o),void 0===a&&(i=r*o)}return s[t]=i,i}(o.font,e))+2*a,r.width=t.width*n,r.height=t.height*n,h.scale(n,n),o)h[d]=o[d];var u=0;switch(o.textBaseline){case"top":case"hanging":u=a;break;case"middle":u=t.height>>1;break;default:u=t.height-a}return o.strokeStyle&&h.strokeText(t.text,a,u),h.fillText(t.text,a,u),r}function h(t){return 1*window.getComputedStyle(t,null).getPropertyValue("font-size").match(/(.+)px/)[1]}var o={name:"canvas",init:function(t){var e=document.createElement("canvas");return e.context=e.getContext("2d"),e._fontSize={root:h(document.getElementsByTagName("html")[0]),container:h(t)},e},clear:function(t,e){t.context.clearRect(0,0,t.width,t.height);for(var i=0;i<e.length;i++)e[i].canvas=null},resize:function(t,e,i){t.width=e*n,t.height=i*n,t.style.width=e+"px",t.style.height=i+"px"},framing:function(t){t.context.clearRect(0,0,t.width,t.height)},setup:function(t,e){for(var i=0;i<e.length;i++){var n=e[i];n.canvas=r(n,t._fontSize)}},render:function(t,e){t.context.drawImage(e.canvas,e.x*n,e.y*n)},remove:function(t,e){e.canvas=null}},a=function(){if("undefined"!=typeof window){var t=window.requestAnimationFrame||window.mozRequestAnimationFrame||window.webkitRequestAnimationFrame;if(t)return t.bind(window)}return function(t){return setTimeout(t,50/3)}}(),d=function(){if("undefined"!=typeof window){var t=window.cancelAnimationFrame||window.mozCancelAnimationFrame||window.webkitCancelAnimationFrame;if(t)return t.bind(window)}return clearTimeout}();function u(t,e,i){for(var n=0,s=0,r=t.length;s<r-1;)i>=t[n=s+r>>1][e]?s=n:r=n;return t[s]&&i<t[s][e]?s:r}function m(t){return/^(ltr|top|bottom)$/i.test(t)?t.toLowerCase():"rtl"}function c(){var t=9007199254740991;return[{range:0,time:-t,width:t,height:0},{range:t,time:t,width:0,height:0}]}function l(t){t.ltr=c(),t.rtl=c(),t.top=c(),t.bottom=c()}function f(){return void 0!==window.performance&&window.performance.now?window.performance.now():Date.now()}function p(t){var e=this,i=this.media?this.media.currentTime:f()/1e3;function n(t,n){if("top"===n.mode||"bottom"===n.mode)return i-t.time<e._.duration;var s=(e._.width+t.width)*(i-t.time)/e._.duration;if(t.width>s)return!0;var r=e._.duration+t.time-i,h=e._.width+n.width,o=e.media?n.time:n._utc,a=h*(i-o)/e._.duration,d=e._.width-a;return r>e._.duration*d/(e._.width+n.width)}for(var s=this._.space[t.mode],r=0,h=0,o=1;o<s.length;o++){var a=s[o],d=t.height;if("top"!==t.mode&&"bottom"!==t.mode||(d+=a.height),a.range-a.height-s[r].range>=d){h=o;break}n(a,t)&&(r=o)}var u=s[r].range,m={range:u+t.height,time:this.media?t.time:t._utc,width:t.width,height:t.height};return s.splice(r+1,h-r-1,m),"bottom"===t.mode?this._.height-t.height-u%this._.height:u%(this._.height-t.height)}function g(){if(!this._.visible||!this._.paused)return this;if(this._.paused=!1,this.media)for(var t=0;t<this._.runningList.length;t++){var e=this._.runningList[t];e._utc=f()/1e3-(this.media.currentTime-e.time)}var i=this,n=function(t,e,i,n){return function(s){t(this._.stage);var r=(s||f())/1e3,h=this.media?this.media.currentTime:r,o=this.media?this.media.playbackRate:1,a=null,d=0,u=0;for(u=this._.runningList.length-1;u>=0;u--)a=this._.runningList[u],h-(d=this.media?a.time:a._utc)>this._.duration&&(n(this._.stage,a),this._.runningList.splice(u,1));for(var m=[];this._.position<this.comments.length&&(a=this.comments[this._.position],!((d=this.media?a.time:a._utc)>=h));)h-d>this._.duration||(this.media&&(a._utc=r-(this.media.currentTime-a.time)),m.push(a)),++this._.position;for(e(this._.stage,m),u=0;u<m.length;u++)(a=m[u]).y=p.call(this,a),this._.runningList.push(a);for(u=0;u<this._.runningList.length;u++){a=this._.runningList[u];var c=(this._.width+a.width)*(r-a._utc)*o/this._.duration;"ltr"===a.mode&&(a.x=c-a.width),"rtl"===a.mode&&(a.x=this._.width-c),"top"!==a.mode&&"bottom"!==a.mode||(a.x=this._.width-a.width>>1),i(this._.stage,a)}}}(this._.engine.framing.bind(this),this._.engine.setup.bind(this),this._.engine.render.bind(this),this._.engine.remove.bind(this));return this._.requestID=a((function t(e){n.call(i,e),i._.requestID=a(t)})),this}function _(){return!this._.visible||this._.paused||(this._.paused=!0,d(this._.requestID),this._.requestID=0),this}function v(){if(!this.media)return this;this.clear(),l(this._.space);var t=u(this.comments,"time",this.media.currentTime);return this._.position=Math.max(0,t-1),this}function w(t){t.play=g.bind(this),t.pause=_.bind(this),t.seeking=v.bind(this),this.media.addEventListener("play",t.play),this.media.addEventListener("pause",t.pause),this.media.addEventListener("playing",t.play),this.media.addEventListener("waiting",t.pause),this.media.addEventListener("seeking",t.seeking)}function y(t){this.media.removeEventListener("play",t.play),this.media.removeEventListener("pause",t.pause),this.media.removeEventListener("playing",t.play),this.media.removeEventListener("waiting",t.pause),this.media.removeEventListener("seeking",t.seeking),t.play=null,t.pause=null,t.seeking=null}function x(t){this._={},this.container=t.container||document.createElement("div"),this.media=t.media,this._.visible=!0,this.engine=(t.engine||"DOM").toLowerCase(),this._.engine="canvas"===this.engine?o:i,this._.requestID=0,this._.speed=Math.max(0,t.speed)||144,this._.duration=4,this.comments=t.comments||[],this.comments.sort((function(t,e){return t.time-e.time}));for(var e=0;e<this.comments.length;e++)this.comments[e].mode=m(this.comments[e].mode);return this._.runningList=[],this._.position=0,this._.paused=!0,this.media&&(this._.listener={},w.call(this,this._.listener)),this._.stage=this._.engine.init(this.container),this._.stage.style.cssText+="position:relative;pointer-events:none;",this.resize(),this.container.appendChild(this._.stage),this._.space={},l(this._.space),this.media&&this.media.paused||(v.call(this),g.call(this)),this}function b(){if(!this.container)return this;for(var t in _.call(this),this.clear(),this.container.removeChild(this._.stage),this.media&&y.call(this,this._.listener),this)Object.prototype.hasOwnProperty.call(this,t)&&(this[t]=null);return this}var L=["mode","time","text","render","style"];function T(t){if(!t||"[object Object]"!==Object.prototype.toString.call(t))return this;for(var e={},i=0;i<L.length;i++)void 0!==t[L[i]]&&(e[L[i]]=t[L[i]]);if(e.text=(e.text||"").toString(),e.mode=m(e.mode),e._utc=f()/1e3,this.media){var n=0;void 0===e.time?(e.time=this.media.currentTime,n=this._.position):(n=u(this.comments,"time",e.time))<this._.position&&(this._.position+=1),this.comments.splice(n,0,e)}else this.comments.push(e);return this}function E(){return this._.visible?this:(this._.visible=!0,this.media&&this.media.paused||(v.call(this),g.call(this)),this)}function C(){return this._.visible?(_.call(this),this.clear(),this._.visible=!1,this):this}function k(){return this._.engine.clear(this._.stage,this._.runningList),this._.runningList=[],this}function z(){return this._.width=this.container.offsetWidth,this._.height=this.container.offsetHeight,this._.engine.resize(this._.stage,this._.width,this._.height),this._.duration=this._.width/this._.speed,this}var D={get:function(){return this._.speed},set:function(t){return"number"!=typeof t||isNaN(t)||!isFinite(t)||t<=0?this._.speed:(this._.speed=t,this._.width&&(this._.duration=this._.width/t),t)}};function M(t){t&&x.call(this,t)}return M.prototype.destroy=function(){return b.call(this)},M.prototype.emit=function(t){return T.call(this,t)},M.prototype.show=function(){return E.call(this)},M.prototype.hide=function(){return C.call(this)},M.prototype.clear=function(){return k.call(this)},M.prototype.resize=function(){return z.call(this)},Object.defineProperty(M.prototype,"speed",D),M}));

        // ===== 恢复全局 define =====
        try {
            if (_hasDefine && _originalDefine) {
                window.define = _originalDefine;
                logger.debug('[弹幕引擎] 已恢复 AMD define');
            }
        } catch (e) {
            logger.warn('[弹幕引擎] 无法恢复 window.define', e);
        }
        /* eslint-enable */

        // 内联加载后立即验证并确保 window.Danmaku 可用
        if (typeof window.Danmaku !== 'undefined') {
            logger.info('[弹幕引擎] 内联加载成功, window.Danmaku 已就绪');
        } else if (typeof Danmaku !== 'undefined') {
            logger.info('[弹幕引擎] 内联加载成功, Danmaku (局部变量) 已就绪，挂载到 window');
            window.Danmaku = Danmaku;  // 强制挂载到全局，供后续使用
        } else {
            logger.error('[弹幕引擎] 内联加载异常: window.Danmaku 和 Danmaku 均为 undefined，可能存在 AMD/模块系统冲突');
        }
        // 内联加载完成后立即应用补丁
        applyDanmakuPatches();
     } else {
        // 网络加载 + 动态修复 AMD
        // 必须使用 fetch 下载 -> 修改 -> Blob 执行，才能拦截 define 调用
        logger.info('[弹幕引擎] 使用网络模式加载 Danmaku 库 (CustomCssJS 环境), 路径:', requireDanmakuPath);

        fetch(requireDanmakuPath)
            .then(response => {
                if (!response.ok) throw new Error("网络请求失败: " + response.status);
                logger.info('[弹幕引擎] 网络下载成功, 正在应用 AMD 修复补丁...');
                return response.text();
            })
            .then(rawScript => {
                // 把 AMD 检测代码短路掉
                // 将 "function"==typeof define 替换为 false&&"function"==typeof define
                const patchedScript = rawScript.replace(
                    /"function"==typeof define&&define\.amd/g,
                    'false&&"function"==typeof define&&define.amd'
                );
                logger.info('[弹幕引擎] AMD 补丁已应用, 正在通过 Blob URL 执行脚本...');

                // 创建 Blob 对象，欺骗浏览器这是一个本地 JS 文件
                const blob = new Blob([patchedScript], { type: 'text/javascript' });
                const url = URL.createObjectURL(blob);

                const script = document.createElement('script');
                script.src = url;
                script.onload = () => {
                    URL.revokeObjectURL(url); // 用完释放内存
                    if (typeof window.Danmaku !== 'undefined') {
                        logger.info('[弹幕引擎] 网络加载成功, window.Danmaku 已就绪');
                        applyDanmakuPatches();
                    } else {
                        logger.error('[弹幕引擎] Blob 脚本执行完毕但 window.Danmaku 仍为 undefined, 可能被 AMD/RequireJS 劫持');
                    }
                };
                script.onerror = (e) => {
                    logger.error('[弹幕引擎] Blob 脚本执行失败, 尝试回退到 Emby.importModule 加载...', e);
                    // 最后的保底：如果 Blob 失败，尝试回退到普通加载
                    Emby.importModule(requireDanmakuPath).then(f => {
                        window.Danmaku = f;
                        logger.info('[弹幕引擎] Emby.importModule 回退加载成功');
                        applyDanmakuPatches();
                    }).catch(err => {
                        logger.error('[弹幕引擎] Emby.importModule 回退加载也失败:', err);
                    });
                };
                document.head.appendChild(script);
            })
            .catch(error => {
                logger.error('[弹幕引擎] Fetch 下载失败, 尝试回退到 Emby.importModule 加载:', error);
                Emby.importModule(requireDanmakuPath).then(f => {
                    window.Danmaku = f;
                    logger.info('[弹幕引擎] Emby.importModule 回退加载成功');
                    applyDanmakuPatches();
                }).catch(err => {
                    logger.error('[弹幕引擎] Emby.importModule 回退加载也失败:', err);
                });
            });
    }

    // ------ require end ------
    // ================== Worker 核心定义开始 ==================
    // 1. 通用 Worker 创建器
    // replacements: 可选的替换映射，如 { '__SPARK_MD5_URL__': 'https://...' }
    function createWorker(workerFunction, replacements = {}) {
        let dataObj = `(${workerFunction})();`;
        // 替换占位符
        for (const [placeholder, value] of Object.entries(replacements)) {
            dataObj = dataObj.replace(placeholder, value);
        }
        const blob = new Blob([dataObj], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);
        // 创建完实例后，URL 就可以释放了，不影响 worker 运行
        URL.revokeObjectURL(workerUrl);
        return worker;
    }

    // 2. MD5 Worker (从外部加载 SparkMD5 库计算文件哈希)
    // SparkMD5 库路径通过 requireSparkMD5Path 配置
    const md5WorkerBody = function() {
        // 从外部加载 SparkMD5 库
        importScripts('__SPARK_MD5_URL__');

        let spark = null;

        self.onmessage = function(e) {
            const { type, chunk, isLast } = e.data;
            if (type === 'INIT') {
                spark = new SparkMD5.ArrayBuffer();
            } else if (type === 'APPEND') {
                if (!spark) spark = new SparkMD5.ArrayBuffer();
                spark.append(chunk);
                if (isLast) {
                    const hash = spark.end();
                    self.postMessage({ success: true, hash: hash });
                    spark = null;
                    self.close();
                }
            }
        };
    };
    // 3. 弹幕去重 Worker (高性能版：只接收轻量数据)
    const mergeWorkerBody = function() {
        self.onmessage = function(e) {
            // 接收的数据结构变化了：lightComments 只有 {t: text, m: time, i: index}
            const { lightComments, threshold, timeWindow, enable } = e.data;

            if (!enable || !lightComments || lightComments.length === 0) {
                // 如果没开启，返回 null，主线程会直接使用原数据
                self.postMessage(null);
                return;
            }

            // --- 移植原本的 similarityPercentage 函数 ---
            function similarityPercentage(a, b, maxAllowedDiff, buffer) {
                if (a === b) return 100;
                const n = a.length; const m = b.length;
                if (n === 0 || m === 0) return 0;
                if (n > m) return similarityPercentage(b, a, maxAllowedDiff, buffer);
                if (buffer.length <= n + 1) {
                    const newBuffer = new Int32Array(n + 128);
                    const score = similarityPercentage(a, b, maxAllowedDiff, newBuffer);
                    return { score: score, buffer: newBuffer };
                }
                const v = buffer;
                for (let i = 0; i <= n; i++) v[i] = i;
                for (let j = 1; j <= m; j++) {
                    let pre = v[0]; v[0] = j; let rowMin = j;
                    const charB = b.charCodeAt(j - 1);
                    for (let i = 1; i <= n; i++) {
                        const tmp = v[i];
                        const cost = (a.charCodeAt(i - 1) === charB) ? 0 : 1;
                        let val = v[i] + 1;
                        const ins = v[i-1] + 1; if (ins < val) val = ins;
                        const sub = pre + cost; if (sub < val) val = sub;
                        v[i] = val; pre = tmp; if (val < rowMin) rowMin = val;
                    }
                    if (rowMin > maxAllowedDiff) return 0;
                }
                const maxLen = m; const distance = v[n];
                return ((maxLen - distance) / maxLen) * 100;
            }

            const resultIndices = []; // 只存保留下来的索引和修改后的文本
            const mergedIndices = new Set();
            const totalLen = lightComments.length;
            const errorRate = (100 - threshold) / 100;
            let sharedBuffer = new Int32Array(1024);

            // 预处理 Mask (使用简写属性 t, m)
            for (let i = 0; i < totalLen; i++) {
                const text = lightComments[i].t;
                let mask = 0;
                const len = text.length > 50 ? 50 : text.length;
                for (let k = 0; k < len; k++) { mask |= (1 << (text.charCodeAt(k) & 31)); }
                lightComments[i]._mask = mask;
            }

            for (let i = 0; i < totalLen; i++) {
                if (mergedIndices.has(i)) continue;
                const root = lightComments[i];
                const rootText = root.t;
                const rootLen = rootText.length;
                let count = 1;

                // 时间窗口化：前提是 lightComments 按 time 排序（来自服务端，通常已排序），
                // 最坏复杂度为 O(n × w)（w = 窗口内弹幕数）
                for (let j = i + 1; j < totalLen; j++) {
                    if (mergedIndices.has(j)) continue;
                    const compare = lightComments[j];
                    if ((compare.m - root.m) > timeWindow) break; // 已超出时间窗口，后续更远，直接退出

                    const compareLen = compare.t.length;
                    const maxLen = rootLen > compareLen ? rootLen : compareLen;
                    const maxDiff = maxLen * errorRate;

                    if (Math.abs(rootLen - compareLen) > maxDiff) continue;
                    if ((root._mask & compare._mask) === 0 && rootLen > 2) continue;

                    let res = similarityPercentage(rootText, compare.t, maxDiff, sharedBuffer);
                    let score = typeof res === 'object' ? (sharedBuffer = res.buffer, res.score) : res;

                    if (score >= threshold) {
                        count++;
                        mergedIndices.add(j);
                    }
                }

                // 我们不返回整个对象，只返回：原始索引(i) 和 最终文本(t)
                // 这样回传的数据量非常小
                const finalStr = count > 1 ? (rootText + " [x" + count + "]") : null;
                resultIndices.push({
                    i: root.i, // 原始数组的下标
                    t: finalStr // 如果没合并，传null省流量；合并了传新文本
                });
            }

            // 传回轻量级结果
            self.postMessage(resultIndices);
        };
    };
    // ================== Worker 核心定义结束 ==================

    class EDE {
        constructor() {
            this.chConvert = lsGetItem(lsKeys.chConvert.id);
            this.danmaku = null;
            this.episode_info = null;
            this.ob = null;
            this.loading = false;
            this.danmuCache = {};   // 只包含 comment 未解析
            this.commentsParsed = [];   // 包含 comment 和 extComment 解析后全量
            this.extCommentCache = {};   // 只包含 extComment 未解析
            this.destroyIntervalIds = [];
            this.searchDanmakuOpts = {};   // 手动搜索变量
            this.appLogAspect = null;   // 应用日志切面
            this.bangumiInfo = {};
            this.itemId = '';
            this.tempLsValues = {};   // 临时存储的由程序更改后的 ls 值
            this.abortControllers = new Set();  // 页面级请求控制器集合 (用于组件销毁时取消 UI 相关网络请求)
        }
    }

    class AppLogAspect {
        // [优化] 日志最大条数限制，防止长时间运行内存泄漏
        static MAX_LOG_LINES = 500;

        constructor() {
            this.initialized = false;
            this.originalError = console.error;
            this.originalWarn = console.warn;
            this.originalLog = console.log;

            // [优化] 改用数组存储日志行，避免字符串无限拼接导致内存泄漏
            this._logLines = [];
            this.listeners = [];
            this.ERROR = { text: 'ERROR', emoji: '❗️' };
            this.WARN = { text: 'WARN', emoji: '⚠️' };
            this.INFO = { text: 'INFO', emoji: '❕' };
            this.DEBUG = { text: 'DEBUG', emoji: '🔍' };

        }
        // [优化] value 属性改为 getter，按需拼接而非持续累积
        get value() {
            return this._logLines.join('');
        }
        set value(val) {
            if (val === '') { this._logLines = []; }
        }

        // 所有收集入口使用同一个严格来源判断，不因正文提到插件名而误收。
        isDdDanmakuLog(args) {
            return typeof args[0] === 'string' && /^\[dd-danmaku\](?:\s|$)/.test(args[0]);
        }
        collect(level, args) {
            if (!this.isDdDanmakuLog(args)) return;
            const marker = args[0] === DD_LOG_PREFIX ? args[1] : null;
            const declared = { '[ERROR]': this.ERROR, '[WARN]': this.WARN,
                '[INFO]': this.INFO, '[DEBUG]': this.DEBUG }[marker];
            level = declared || level;
            if (!this.shouldLog(level)) return;
            const content = declared ? [DD_LOG_PREFIX, ...args.slice(2)] : args;
            this._appendLog(this.format(level, content), args);
        }
        // 根据日志级别决定是否记录
        shouldLog(level) {
            const levelMap = { 'ERROR': 1, 'WARN': 2, 'INFO': 3, 'DEBUG': 4 };
            return logLevel >= levelMap[level.text];
        }
        // [优化] 添加日志行，自动裁剪超量部分
        _appendLog(line, args) {
            // 最终入库再次检查来源，避免其他调用绕过统一过滤。
            if (!args || !this.isDdDanmakuLog(args)) return;
            this._logLines.push(line);
            if (this._logLines.length > AppLogAspect.MAX_LOG_LINES) {
                // 保留后半部分，丢弃最旧的日志
                this._logLines = this._logLines.slice(-Math.floor(AppLogAspect.MAX_LOG_LINES * 0.8));
            }
            this.notifyListeners();
        }
        init() {
            if (this.initialized) { return this; }
            // 仅代理 console；不接管全局异常，避免替其他脚本添加插件标识。
            console.error = (...args) => {
                this.originalError.apply(console, args);
                this.collect(this.ERROR, args);
            };
            console.warn = (...args) => {
                this.originalWarn.apply(console, args);
                this.collect(this.WARN, args);
            };
            console.log = (...args) => {
                this.originalLog.apply(console, args);
                this.collect(this.INFO, args);
            };
            this.initialized = true;
            return this;
        }
        destroy(clearValue = true) {
            if (this.initialized) {
                console.error = this.originalError;
                console.warn = this.originalWarn;
                console.log = this.originalLog;

                clearValue && (this._logLines = []);
                this.listeners = [];
                this.initialized = false;
            }
            return this;
        }
        format(level, args) {
            const emoji = level.emoji ? `[${level.emoji}] ` : '';
            // 仅在面板展示时移除来源标识（包括重复标识），原始参数仍用于过滤。
            const message = args.map(arg => arg instanceof Error ? arg.message : (typeof arg === 'string' ? arg : JSON.stringify(arg)))
                .join(' ').split(DD_LOG_PREFIX).join('').trim();
            return `[${new Date(Date.now()).toLocaleString()}] [${level.text}] ${emoji}: `
                + message + '\n';
        }
        on(valueChangedCallback) {
            if (valueChangedCallback.toString().includes('console.log')
                || valueChangedCallback.toString().includes('console.error')) {
                throw new Error('The callback function must not contain console.log or console.error to avoid infinite loops.');
            }
            this.listeners.push(() => valueChangedCallback(this.value));
        }
        notifyListeners() { this.listeners.forEach(listener => listener()); }
        clearValue() { this._logLines = []; this.notifyListeners(); }
    }

    // 播放页按 DOM 身份管理；旧页迟到事件和异步回调不得操作新页。
    let activePlaybackView = null;
    let playbackViewGeneration = 0;
    let cancelDanmakuUIWait = null;
    const playbackBindings = new Map();
    const playbackViewSelector = '[data-type="video-osd"], .view-videoosd-videoosd';
    function getPlaybackView(e) {
        const target = e && e.target;
        // 事件来源用于区分新旧页，隐藏事件不能按可见性过滤。
        if (target instanceof Element) return target.closest(playbackViewSelector);
        if (e?.detail?.type !== 'video-osd' || e.type === 'viewbeforehide') return null;
        // 延迟注入的模拟显示事件没有 target，才回退到可见播放页。
        return Array.from(document.querySelectorAll(playbackViewSelector))
            .find(view => !view.closest('.hide, .page-hidden')) || null;
    }
    function getPlaybackMedia() {
        // 兼容 4.10.0.40 缓存旧 view 的 page-hidden，保留独立挂载的虚拟 video。
        const isCurrentMedia = el => el.isConnected && !el.closest('.hide, .page-hidden');
        const localMedia = activePlaybackView && Array.from(activePlaybackView.querySelectorAll(mediaQueryStr))
            .find(isCurrentMedia);
        return localMedia || Array.from(document.querySelectorAll(mediaQueryStr)).find(isCurrentMedia);
    }

    // 只保存当前加载任务的数据，切集、退出或手动清空后不得恢复旧弹幕。
    let danmakuPlaybackSnapshot = null;
    // 仅短暂保留停止前的数据，供同一媒体换流重启复用；退出/清空立即释放。
    let stoppedDanmakuSnapshot = null;
    let stoppedDanmakuTimer = null;
    function clearStoppedDanmaku() {
        clearTimeout(stoppedDanmakuTimer);
        stoppedDanmakuTimer = null;
        stoppedDanmakuSnapshot = null;
    }
    function getDanmakuPlaybackKey(manager, player) {
        if (!player) return null;
        const item = manager.currentItem(player);
        return item?.Id && item?.ServerId ? JSON.stringify([item.ServerId, item.Id]) : null;
    }
    function getDanmakuPlaybackOffset(manager, player, media) {
        // Emby 的逻辑时间包含转码起点；player.currentTime 为毫秒，ticks 为千万分之一秒。
        if (media.id || typeof manager.getCurrentTicks !== 'function'
            || typeof player.currentTime !== 'function') return 0;
        const offset = manager.getCurrentTicks(player) / 1e7 - player.currentTime() / 1000;
        return Number.isFinite(offset) ? offset : 0;
    }
    // 独立弹幕时钟：后端状态驱动，本地媒体即时响应与断线兜底，绝不回写视频。
    let danmakuClock = null;
    function createDanmakuClock(manager, player, key, generation) {
        // 仅允许当前播放器创建时钟，后续同一媒体换播放器由 refresh 接续。
        if (manager.getCurrentPlayer() !== player) return getPlaybackMedia();
        danmakuClock?.dispose();
        const events = new EventTarget();
        let media = null, remote = null, timer = null, last = null, disposed = false;
        // 保留节点引用，旧容器离开文档后仍可迁移原弹幕层。
        const overlay = getById(eleIds.danmakuWrapper);
        const names = ['play', 'playing', 'pause', 'waiting', 'seeking', 'seeked', 'ratechange', 'loadedmetadata', 'emptied'];
        // 换流时 currentPlayer/currentItem 可能短暂为空；未知不是切集，不能永久销毁时钟。
        const valid = () => {
            if (generation !== playbackViewGeneration) return false;
            const currentKey = getDanmakuPlaybackKey(manager, manager.getCurrentPlayer());
            return currentKey === null || currentKey === key;
        };
        const local = () => {
            const currentPlayer = manager.getCurrentPlayer();
            const offset = media && currentPlayer ? getDanmakuPlaybackOffset(manager, currentPlayer, media) : 0;
            return { position: (media?.currentTime || 0) + offset,
                paused: !media || media.paused || media.readyState < 2,
                rate: media?.playbackRate > 0 ? media.playbackRate : 1 };
        };
        const state = () => {
            const now = performance.now(), actual = local();
            // 真实 HTML 媒体掌握即时暂停/恢复和倍速；服务器上报可能滞后于换轨恢复。
            // 保留后端位置锚点，但状态冲突时退回完整本地时钟，避免冻结或缓冲时空跑。
            const realMedia = media && media.id !== eleIds.h5VideoAdapter;
            if (realMedia && remote && (remote.paused !== actual.paused || remote.rate !== actual.rate)) remote = null;
            if (!remote || now - remote.at > 15000) return actual;
            return { position: remote.position + (remote.paused ? 0 : (now - remote.at) / 1000 * remote.rate),
                paused: remote.paused, rate: remote.rate };
        };
        const emit = name => events.dispatchEvent(new Event(name));
        const sync = (seek = false) => {
            if (disposed) return;
            const next = state(), now = performance.now();
            const expected = last ? last.position + (last.paused ? 0 : (now - last.at) / 1000 * last.rate) : next.position;
            if (seek || (last && (Math.abs(next.position - expected) > 1 || next.rate !== last.rate))) emit('seeking');
            if (!last || last.paused !== next.paused || seek) emit(next.paused ? 'pause' : 'playing');
            last = { ...next, at: now };
        };
        const localEvent = event => {
            // 用户刚操作时立即用真实媒体状态，不等待下一次服务器上报。
            remote = null;
            sync(event.type === 'seeking' || event.type === 'seeked' || event.type === 'loadedmetadata' || event.type === 'ratechange');
        };
        const bind = () => {
            const next = getPlaybackMedia();
            if (next === media) return false;
            if (media) names.forEach(name => media.removeEventListener(name, localEvent));
            media = next;
            if (media) names.forEach(name => media.addEventListener(name, localEvent));
            remote = null;
            return true;
        };
        const clock = {
            get currentTime() { return state().position; },
            get paused() { return state().paused; },
            get playbackRate() { return state().rate; },
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
            refresh() {
                if (!valid()) { clock.dispose(); return; }
                sync(bind());
                const container = media?.closest(`.graphicContentContainer, ${playbackViewSelector}`)
                    || activePlaybackView;
                if (overlay && container?.isConnected && overlay.parentElement !== container) {
                    container.prepend(overlay);
                    window.ede?.danmaku?.resize?.();
                }
            },
            accept(data) {
                if (disposed || !valid()) return;
                bind();
                const previous = state();
                const rate = Number.isFinite(data.playbackRate) && data.playbackRate > 0 ? data.playbackRate : local().rate;
                // 接收时建立单调时钟锚点，不使用可能有时差的服务器墙上时钟推算。
                remote = { position: Number.isFinite(data.positionSeconds) ? data.positionSeconds : previous.position,
                    paused: data.isPaused === true, rate, at: performance.now() };
                sync();
            },
            fallback() { remote = null; if (!disposed) sync(); },
            dispose() {
                if (disposed) return;
                disposed = true;
                clearInterval(timer);
                if (media) names.forEach(name => media.removeEventListener(name, localEvent));
                remote = null;
                emit('pause');
                if (danmakuClock === clock) danmakuClock = null;
            }
        };
        bind();
        // 只在弹幕实例存在时核对节点替换、漏发恢复事件和后端状态过期。
        timer = setInterval(() => clock.refresh(), 200);
        danmakuClock = clock;
        return clock;
    }
    function onAudioTrackChange() {
        // 切字幕、音轨后可能异步换流；适配器持续核对，不再仅在切换瞬间判断一次。
        danmakuClock?.refresh();
    }

    function initListener() {
        const _media = getPlaybackMedia();
        // 页面未加载
        if (!_media) {
            window.ede.episode_info && (window.ede.episode_info = null);
            return;
        }
        // 监听绑定在 player 而非 video 上，复用 video 时也必须重新核对。

        // OSD 显示只核对绑定，不重复报告初始化。
        const generation = playbackViewGeneration;
        playbackEventsRefresh({ 'playbackstart': onPlaybackStart, 'playbackstop': onPlaybackStop,
            'audiotrackchange': onAudioTrackChange, 'subtitletrackchange': onAudioTrackChange })
            .then(() => {
                // 补上绑定前已开始播放的空窗；有任务时不因 OSD 显示重复请求。
                if (generation !== playbackViewGeneration || _media !== getPlaybackMedia()) return;
                if ((!_media.paused || OS.isAndroidEmbyNoisyX())
                    && window.ede._loadViewGeneration !== generation) {
                    window.ede._loadViewGeneration = generation;
                    loadDanmaku(LOAD_TYPE.INIT).catch(error => logger.warn('[生命周期] 补加载失败', error));
                }
            }).catch(error => logger.warn('[生命周期] 播放监听初始化失败', error));
        _media.setAttribute('ede_listening', true);
        refreshEventListener({ 'video-osd-show': onVideoOsdShow });
        refreshEventListener({ 'video-osd-hide': onVideoOsdHide });
        logger.debug('事件监听器绑定核对完成');

    }

    let activeLocalPlayback = null;
    function onPlaybackStart(e, state) {
        // 在加载首次 await 之前绑定本地开始事件，防止旧集停止取消新集加载。
        activeLocalPlayback = { itemId: state?.NowPlayingItem?.Id, generation: playbackViewGeneration };
        logger.debug('监听到事件: 播放开始 (playbackstart)');
        initUI(); // 播放器重新创建控制栏时幂等补建。
        const cached = danmakuPlaybackSnapshot || stoppedDanmakuSnapshot;
        const hostClient = getHostApiClient();
        clearStoppedDanmaku();
        // 同一用户/服务器/媒体的短暂重启复用正文，不重新匹配来源。
        if (cached && cached.generation === playbackViewGeneration
            && cached.userId === hostClient?.getCurrentUserId?.()
            && cached.key === getDanmakuPlaybackKey(cached.manager, cached.manager.getCurrentPlayer())
            && String(state?.NowPlayingItem?.Id || '') === String(JSON.parse(cached.key)[1])) {
            window.ede._loadSequence = (window.ede._loadSequence || 0) + 1;
            const id = `LOAD_${window.ede._loadSequence}`;
            window.ede.lastLoadId = id;
            createDanmaku(cached.comments, id).catch(error => logger.warn('[换流恢复] 复用弹幕失败', error));
            return;
        }
        loadDanmaku(LOAD_TYPE.INIT);
    }

    function onPlaybackStop(e, state) {
        // Emby 可能重复发送无媒体的停止事件，必须在失效加载任务前过滤。
        if (!state?.NowPlayingItem || !state?.PlayState) {
            logger.debug('[播放联动] 忽略缺少播放上下文的停止事件');
            return;
        }
        const snapshot = danmakuPlaybackSnapshot;
        // 新集仍在加载、尚无快照时，也使用开始事件的明确条目标识挡住旧停止。
        const localId = activeLocalPlayback?.generation === playbackViewGeneration ? activeLocalPlayback.itemId : null;
        const stoppedLocalId = String(state.NowPlayingItem.Id || '').replace(/-/g, '').toLowerCase();
        const currentLocalId = String(localId || '').replace(/-/g, '').toLowerCase();
        if (currentLocalId && stoppedLocalId && currentLocalId !== stoppedLocalId
            && /^[0-9]+$/.test(currentLocalId) === /^[0-9]+$/.test(stoppedLocalId)) {
            logger.debug('[播放联动] 新集加载中，忽略旧集停止');
            return;
        }
        if (snapshot?.generation === playbackViewGeneration && snapshot.sessionId === window.ede?.lastLoadId) {
            const stoppedId = String(state.NowPlayingItem.Id || '').replace(/-/g, '').toLowerCase();
            const currentId = String(JSON.parse(snapshot.key)[1]).replace(/-/g, '').toLowerCase();
            // 仅在同类 ID 明确不同且已有新集快照时拒绝旧停止，不猜测数字 ID 与 GUID 的映射。
            const sameKind = /^[0-9]+$/.test(stoppedId) === /^[0-9]+$/.test(currentId);
            if (stoppedId && sameKind && stoppedId !== currentId) {
                logger.debug('[播放联动] 忽略上一集迟到的停止事件');
                return;
            }
        }
        logger.debug('监听到事件: 播放停止 (playbackstop)');
        // 停止仍正常处理，仅保留十秒恢复数据，不能延续旧时钟。
        clearStoppedDanmaku();
        if (snapshot?.generation === playbackViewGeneration && snapshot.sessionId === window.ede?.lastLoadId) {
            stoppedDanmakuSnapshot = snapshot;
            stoppedDanmakuTimer = setTimeout(clearStoppedDanmaku, 10000);
        }
        danmakuClock?.dispose();
        // 播放停止后旧弹幕快照不可再用于音轨恢复，避免下一集尚未开始加载时串台。
        danmakuPlaybackSnapshot = null;
        if (window.ede) {
            window.ede._loadSequence = (window.ede._loadSequence || 0) + 1;
            window.ede.lastLoadId = `STOPPED_${window.ede._loadSequence}`;
        }
        // [修复] 保存当前集信息用于推理匹配
        // Emby 点"下一集/上一集"时不会离开 video-osd 页面，beforeDestroy 不会触发，
        // 必须在 playbackstop 时保存，否则推理匹配永远拿不到上一集的信息
        if (window.ede && window.ede.episode_info) {
            window.ede.previous_episode_info = { ...window.ede.episode_info };
            logger.debug(`[推理匹配] 已保存当前集信息: episodeId=${window.ede.episode_info.episodeId}, episodeIndex=${window.ede.episode_info.episodeIndex}`);
        }
        onPlaybackStopPct(e, state);
        removeHeaderClock();
        danmakuAutoFilterCancel();
    }

    function onVideoOsdShow(e) {
        const view = getPlaybackView(e);
        if (view && activePlaybackView && view !== activePlaybackView) return;
        initUI(); // OSD 重建后恢复按钮，并核对当前 player。
        initListener();
        logger.debug('监听到事件: OSD显示 (video-osd-show)');
        if (lsGetItem(lsKeys.osdLineChartEnable.id)) {
            buildProgressBarChart(20);
        }
        if (lsGetItem(lsKeys.osdHeaderClockEnable.id)) {
          addHeaderClock();
        }

    }

    function onVideoOsdHide(e) {
        logger.debug('监听到事件: OSD隐藏 (video-osd-hide)');
        if (lsGetItem(lsKeys.osdHeaderClockEnable.id)) {
          removeHeaderClock();
        }

    }


    function initUI() {
        // 只在当前 view 内去重；初始化完成后不保留永久布尔锁。
        const root = activePlaybackView || document;
        if (root.querySelector(`#${eleIds.danmakuCtr}`)) { return; }
        if (cancelDanmakuUIWait) { return; }
        const generation = playbackViewGeneration;
        domCache.clear();
        document.querySelectorAll(`#${eleIds.danmakuCtr}`).forEach(el => el.remove());
        logger.info('正在初始化UI');

        const hostClient = getHostApiClient();
        const serverVersion = hostClient?.serverVersion ? hostClient.serverVersion() : '';
        logger.info('[dd-danmaku] 服务器版本:', serverVersion);

        // [综合方案] 使用三层探测替代单一 API 版本判断
        const detected = detectMediaContainer();
        mediaContainerQueryStr = detected.selector;
        isVersionOld = detected.isOld;

        if (!mediaContainerQueryStr.includes(notHide)) {
            mediaContainerQueryStr += notHide;
        }

        // 可取消且有超时的 view 局部等待，避免旧页观察器在新页创建按钮。
        const ctrlWrapperQueryStr = activePlaybackView ? '.videoOsdBottom-maincontrols'
            : `${mediaContainerQueryStr} .videoOsdBottom-maincontrols`;
        let observer = null;
        let timer = null;
        const cancel = () => {
            if (observer) observer.disconnect();
            clearTimeout(timer);
            if (cancelDanmakuUIWait === cancel) cancelDanmakuUIWait = null;
        };
        cancelDanmakuUIWait = cancel;
        const mount = () => {
            if (generation !== playbackViewGeneration) { cancel(); return; }
            let wrapper = root.querySelector(ctrlWrapperQueryStr);
            if (!wrapper || !wrapper.isConnected) return;
            cancel();
            try {
            if (root.querySelector(`#${eleIds.danmakuCtr}`)) return;
            const commonWrapper = getByClass(classes.videoOsdBottomButtons + notHide, wrapper);
            if (commonWrapper) {
                wrapper = commonWrapper;
            } else {
                // Emby 客户端启动时会检测鼠标设备,无鼠标时, commonWrapper 将会 hide
                // 手动模拟无鼠标步骤为浏览器页签打开后不要动鼠标,仅使用键盘操作
                wrapper = getByClass(classes.videoOsdBottomButtonsTopRight, wrapper) || wrapper;
            }
            const menubar = document.createElement('div');
            menubar.id = eleIds.danmakuCtr;
            // [修改] 三路插入策略：
            // 1. Web端美化CSS场景：topright容器存在（position:absolute脱离flex流），prepend插入其内部使弹幕按钮排在字幕等按钮左侧
            // 2. 官方客户端场景：有 rightButtons（.videoOsdBottom-buttons-right），insertBefore插在其前面
            // 3. 降级：都没有时 append 到末尾并 margin-left:auto 推到最右
            const toprightWrapper = getByClass(classes.videoOsdBottomButtonsTopRight,
                wrapper.closest('.videoOsdBottom-maincontrols') || wrapper.parentElement || wrapper);
            const rightButtons = getByClass(classes.videoOsdBottomButtonsRight, wrapper);
            if (toprightWrapper) {
                toprightWrapper.prepend(menubar);
            } else if (rightButtons) {
                menubar.style.marginLeft = '';
                wrapper.insertBefore(menubar, rightButtons);
            } else {
                menubar.style.marginLeft = 'auto';
                wrapper.append(menubar);
            }
            mediaBtnOpts.forEach(opt => {
                menubar.appendChild(embyButton(opt, opt.onClick));
            });
            // [修复] 按钮创建完成后，检查是否有 loadDanmaku 提前触发的 pending 加载环状态，有则补激活
            if (window.ede && window.ede._pendingLoadingRing) {
                const { progress, tip } = window.ede._pendingLoadingRing;
                window.ede._pendingLoadingRing = null;
                ddSetLoadingRing(progress, tip);
            }
            // 每个播放页代次只默认开启一次，OSD 补建尊重用户当前开关。
            if (window.ede._switchGeneration !== playbackViewGeneration) {
                window.ede._switchGeneration = playbackViewGeneration;
                lsSetItem(lsKeys.switch.id, true);
            }
            const danmakuEnabled = lsGetItem(lsKeys.switch.id);
            const osdDanmakuSwitchBtn = getById(eleIds.danmakuSwitchBtn);
            if (osdDanmakuSwitchBtn) {
                // danmakuTextBtn 模式：只改内层颜色透明度，不影响整体按钮 opacity（避免加载环被压暗）
                const inner = osdDanmakuSwitchBtn.querySelector('.dd-btn-inner');
                if (inner) inner.style.opacity = danmakuEnabled ? '1' : '0.4';
            }
            logger.info('播放器弹幕UI初始化完成');
            } catch (error) {
                root.querySelector(`#${eleIds.danmakuCtr}`)?.remove();
                logger.warn('[生命周期] 按钮初始化失败，下次显示时重试', error);
            }
        };
        mount();
        if (cancelDanmakuUIWait === cancel) {
            observer = new MutationObserver(mount);
            observer.observe(root, { childList: true, subtree: true });
            timer = setTimeout(() => {
                cancel();
                logger.warn('[生命周期] 等待播放控制栏超时，下次显示时重试');
            }, 10000);
        }
    }

    async function getEmbyItemInfo() {
        return require(['playbackManager']).then((items) => items[0].currentItem());
    }

    async function fatchEmbyItemInfo(id) {
        if (!id) { return; }
        const client = getHostApiClient();
        if (!client?.getItem || !client.getCurrentUserId) return null;
        return await client.getItem(client.getCurrentUserId(), id);
    }

    async function fetchSearchEpisodes(anime, episode, prefix, appId, appSecret) {
        if (!anime) { throw new Error('anime is required'); }

        // 步骤1: 使用 /api/v2/search/anime 搜索动画
        const searchUrl = `${prefix}/search/anime?keyword=${encodeURIComponent(anime)}`;
        const signHeaders = await buildCustomApiSignHeaders(appId, appSecret, searchUrl);
        const searchResult = await fetchJson(searchUrl, Object.keys(signHeaders).length > 0 ? { headers: signHeaders } : {})
            .catch((error) => {
                logger.error(`[API请求] /search/anime 查询失败: ${error.message}`);
                return null;
            });

        if (!searchResult || !searchResult.animes || searchResult.animes.length === 0) {
            logger.debug(`[API请求] /search/anime 查询结果为空`);
            return { animes: [] };
        }

        logger.info(`[API请求] /search/anime 查询成功，共 ${searchResult.animes.length} 个结果`);

        // [改造1] 步骤2: 为前 N 个候选并发获取详细的分集信息
        // 不再只给第1个拉详情，而是给前3个并发拉，让后续评分系统能公平比较
        const TOP_N = Math.min(3, searchResult.animes.length);
        const bangumiPromises = [];

        for (let i = 0; i < TOP_N; i++) {
            const animeItem = searchResult.animes[i];
            if (animeItem.bangumiId) {
                bangumiPromises.push(
                    (async () => { const bgUrl = `${prefix}/bangumi/${animeItem.bangumiId}`; const bgSignHeaders = await buildCustomApiSignHeaders(appId, appSecret, bgUrl); return fetchJson(bgUrl, Object.keys(bgSignHeaders).length > 0 ? { headers: bgSignHeaders } : {}); })()
                        .then(result => ({ index: i, result }))
                        .catch((error) => {
                            logger.debug(`[API请求] /bangumi/${animeItem.bangumiId} 查询失败: ${error.message}`);
                            return { index: i, result: null };
                        })
                );
            }
        }

        // 并发等待所有 bangumi 请求
        const bangumiResults = await Promise.all(bangumiPromises);
        let enrichedCount = 0;

        // 给每个候选填充 episodes 信息
        for (const { index, result: bangumiResult } of bangumiResults) {
            if (!bangumiResult) continue;

            // 兼容不同 API 的返回格式：
            // - 标准格式: { bangumi: { episodes: [...] } }
            // - 简化格式: { episodes: [...] } 或直接返回 bangumi 对象
            let episodes = null;
            let seasons = null;
            if (bangumiResult.bangumi && bangumiResult.bangumi.episodes) {
                episodes = bangumiResult.bangumi.episodes;
                seasons = bangumiResult.bangumi.seasons;
            } else if (bangumiResult.episodes) {
                episodes = bangumiResult.episodes;
                seasons = bangumiResult.seasons;
            }

            if (episodes && episodes.length > 0) {
                // 按 episodeId 排序，确保集数顺序正确
                episodes.sort((a, b) => {
                    const idA = parseInt(a.episodeId) || 0;
                    const idB = parseInt(b.episodeId) || 0;
                    return idA - idB;
                });

                // 更新 imageUrl（bangumi 接口返回的可能更准确）
                let imageUrl = searchResult.animes[index].imageUrl;
                if (bangumiResult?.bangumi?.imageUrl) {
                    imageUrl = bangumiResult.bangumi.imageUrl;
                } else if (bangumiResult?.imageUrl) {
                    imageUrl = bangumiResult.imageUrl;
                }

                searchResult.animes[index] = {
                    ...searchResult.animes[index],
                    episodes: episodes,
                    seasons: seasons,
                    imageUrl: imageUrl
                };
                enrichedCount++;
                logger.debug(`[API请求] 已获取动画[${index}]的分集信息: ${searchResult.animes[index].animeTitle}, 共 ${episodes.length} 集`);
            }
        }
        logger.info(`[API请求] 已为前 ${TOP_N} 个候选中的 ${enrichedCount} 个补全分集信息`);

        // 如果指定了集数，在所有有 episodes 的候选中尝试匹配
        if (episode) {
            for (const animeItem of searchResult.animes) {
                if (!animeItem.episodes) continue;
                const matchedEpisode = animeItem.episodes.find(ep =>
                    ep.episodeId === episode ||
                    ep.episodeNumber === String(episode) ||
                    (ep.episodeTitle && ep.episodeTitle.includes(`第${episode}集`)) ||
                    (ep.episodeTitle && ep.episodeTitle.includes(`${episode}话`))
                );
                if (matchedEpisode) {
                    logger.info(`[API请求] 在 "${animeItem.animeTitle}" 中匹配到集数 ${episode}: ${matchedEpisode.episodeTitle}`);
                    break;
                }
            }
        }

        return searchResult;
    }

    /**
     * [降级] BGM 搜索兜底：主源（弹弹play）搜索失败/流控时，
     * 用 Bangumi(bgm.tv) 搜索拿 subjectId，再用弹弹play新接口 /bangumi/bgmtv/{id}
     * 获取番剧详情+分集，产出与 fetchSearchEpisodes 兼容的 anime 列表。
     * @param {String} searchTitle 搜索标题
     * @param {String} ddpPrefix   弹弹play 前缀（用于调 /bangumi/bgmtv，需签名走代理）
     * @returns {Array} anime 列表（含 episodes），失败返回 []
     */
    async function fetchBgmSearchFallback(searchTitle, ddpPrefix) {
        if (!searchTitle) return [];
        try {
            // 1. 调 Bangumi 新版搜索接口（POST /v0/search/subjects），type=2 表示动画
            const searchUrl = bangumiApi.searchSubjects();
            const searchBody = { keyword: searchTitle, filter: { type: [2] } };
            const searchRes = await fetchJson(searchUrl, { method: 'POST', body: searchBody });
            const subjects = (searchRes && Array.isArray(searchRes.data)) ? searchRes.data : [];
            if (subjects.length === 0) {
                logger.info(`[BGM兜底] Bangumi 搜索无结果: ${searchTitle}`);
                return [];
            }
            logger.info(`[BGM兜底] Bangumi 搜索命中 ${subjects.length} 个，取前 3 个查弹弹play详情`);

            // 2. 取前 3 个 subjectId，并发调弹弹play /bangumi/bgmtv/{id} 拿详情+分集
            const TOP_N = Math.min(3, subjects.length);
            const detailPromises = [];
            for (let i = 0; i < TOP_N; i++) {
                const subj = subjects[i];
                if (!subj || !subj.id) continue;
                const detailUrl = dandanplayApi.getBangumiByBgmId(subj.id);
                detailPromises.push(
                    fetchJson(detailUrl)
                        .then(result => ({ subj, result }))
                        .catch((error) => {
                            logger.debug(`[BGM兜底] /bangumi/bgmtv/${subj.id} 查询失败: ${error.message}`);
                            return { subj, result: null };
                        })
                );
            }
            const detailResults = await Promise.all(detailPromises);

            // 3. 组装成与 fetchSearchEpisodes 一致的 anime 结构
            const animes = [];
            for (const { subj, result } of detailResults) {
                if (!result) continue;
                // 兼容返回格式：{ bangumi: {...} } 或直接 bangumi 对象
                const bgm = result.bangumi || result;
                const episodes = bgm.episodes || [];
                if (!episodes.length) continue;
                episodes.sort((a, b) => (parseInt(a.episodeId) || 0) - (parseInt(b.episodeId) || 0));
                animes.push({
                    animeId: bgm.animeId,
                    animeTitle: bgm.animeTitle || subj.name_cn || subj.name || searchTitle,
                    typeDescription: bgm.typeDescription || 'BGM兜底',
                    episodes: episodes,
                    seasons: bgm.seasons,
                    imageUrl: bgm.imageUrl || (subj.images && subj.images.common) || '',
                });
            }
            logger.info(`[BGM兜底] 成功组装 ${animes.length} 个番剧（含分集）`);
            return animes;
        } catch (error) {
            logger.warn(`[BGM兜底] 执行失败: ${error.message || error}`);
            return [];
        }
    }

    /**
     * 应用搜索内容黑名单过滤
     * @param {Array} animes - 番剧列表
     * @param {boolean} filterEpisodes - 是否同时过滤分集
     * @param {string} apiKey - API 类型标识 ('official' 或 'custom')
     * @returns {Array} 过滤后的番剧列表
     */
    function applySearchBlacklist(animes, filterEpisodes = true, apiKey = 'official') {
        if (!animes || animes.length === 0) return animes;

        // 检查是否应该应用黑名单
        const blacklistApplyToCustomApi = lsGetItem(lsKeys.blacklistApplyToCustomApi.id) ?? lsKeys.blacklistApplyToCustomApi.defaultValue;

        // 如果是自定义接口且未开启自定义接口黑名单，直接返回
        if (apiKey !== 'official' && !blacklistApplyToCustomApi) {
            logger.debug('[黑名单] 自定义接口未启用黑名单过滤');
            return animes;
        }

        const animeTitleBlacklist = lsGetItem(lsKeys.animeTitleBlacklist.id) || '';
        const episodeTitleBlacklist = lsGetItem(lsKeys.episodeTitleBlacklist.id) || '';

        let animeTitleRegex = null;
        let episodeTitleRegex = null;

        // 编译正则表达式
        try {
            if (animeTitleBlacklist) {
                animeTitleRegex = new RegExp(animeTitleBlacklist, 'i');
            }
        } catch (e) {
            logger.warn(`[黑名单] 番剧标题正则表达式无效: ${e.message}`);
        }

        try {
            if (episodeTitleBlacklist) {
                episodeTitleRegex = new RegExp(episodeTitleBlacklist, 'i');
            }
        } catch (e) {
            logger.warn(`[黑名单] 分集名称正则表达式无效: ${e.message}`);
        }

        // 如果两个正则都无效，直接返回原数组
        if (!animeTitleRegex && !episodeTitleRegex) {
            return animes;
        }

        const originalCount = animes.length;
        let filteredAnimeCount = 0;
        let filteredEpisodeCount = 0;

        // 过滤番剧
        const filteredAnimes = animes.filter(anime => {
            // 检查番剧标题是否匹配黑名单
            if (animeTitleRegex && anime.animeTitle && animeTitleRegex.test(anime.animeTitle)) {
                logger.debug(`[黑名单] 过滤番剧: "${anime.animeTitle}"`);
                filteredAnimeCount++;
                return false;
            }
            return true;
        }).map(anime => {
            // 过滤分集时返回新对象而非原地修改，避免同一候选在其他优先级/UI 中被永久裁剪
            if (filterEpisodes && episodeTitleRegex && anime.episodes && anime.episodes.length > 0) {
                const originalEpisodeCount = anime.episodes.length;
                const filteredEpisodes = anime.episodes.filter(ep => {
                    if (ep.episodeTitle && episodeTitleRegex.test(ep.episodeTitle)) {
                        logger.debug(`[黑名单] 过滤分集: "${anime.animeTitle}" - "${ep.episodeTitle}"`);
                        filteredEpisodeCount++;
                        return false;
                    }
                    return true;
                });

                // 如果所有分集都被过滤了，也过滤掉这个番剧
                if (filteredEpisodes.length === 0 && originalEpisodeCount > 0) {
                    logger.debug(`[黑名单] 番剧 "${anime.animeTitle}" 所有分集都被过滤，移除该番剧`);
                    return null;
                }
                return { ...anime, episodes: filteredEpisodes };
            }
            return anime;
        }).filter(anime => anime !== null);

        if (filteredAnimeCount > 0 || filteredEpisodeCount > 0) {
            logger.info(`[黑名单] 过滤完成: 番剧 ${originalCount} -> ${filteredAnimes.length} (过滤 ${filteredAnimeCount} 个), 分集过滤 ${filteredEpisodeCount} 个`);
        }

        return filteredAnimes;
    }

    /**
     * 应用分集黑名单过滤（仅过滤分集，用于 /match 接口返回的结果）
     * @param {Array} matches - match 接口返回的匹配列表
     * @returns {Array} 过滤后的匹配列表
     */
    function applyEpisodeBlacklist(matches) {
        if (!matches || matches.length === 0) return matches;

        const episodeTitleBlacklist = lsGetItem(lsKeys.episodeTitleBlacklist.id) || '';

        if (!episodeTitleBlacklist) return matches;

        let episodeTitleRegex = null;
        try {
            episodeTitleRegex = new RegExp(episodeTitleBlacklist, 'i');
        } catch (e) {
            logger.warn(`[黑名单] 分集名称正则表达式无效: ${e.message}`);
            return matches;
        }

        const originalCount = matches.length;
        const filteredMatches = matches.filter(match => {
            if (match.episodeTitle && episodeTitleRegex.test(match.episodeTitle)) {
                logger.debug(`[黑名单] 过滤匹配结果: "${match.animeTitle}" - "${match.episodeTitle}"`);
                return false;
            }
            return true;
        });

        if (filteredMatches.length < originalCount) {
            logger.info(`[黑名单] 匹配结果过滤: ${originalCount} -> ${filteredMatches.length}`);
        }

        return filteredMatches;
    }

    // [改造4] 智能匹配：两阶段（选anime → 选episode）+ 偏好记忆
    function selectBestMatch(searchTitle, candidates, parsedSearchOverride, minSimilarity = 0.3) {
        if (!candidates?.length) return null;

        const parsedSearch = parsedSearchOverride || parseSearchKeyword(searchTitle);
        logger.info(`[智能匹配] "${searchTitle}" → ${JSON.stringify(parsedSearch)}, 候选: ${candidates.length}`);

        // 预计算：提到循环外避免重复
        const normalizedSearchTitle = normalizeTitle(parsedSearch.title);
        const preferKey = `_prefer_${normalizedSearchTitle}`;
        let preferredAnimeId = null;
        try {
            const pref = JSON.parse(localStorage.getItem(preferKey));
            if (pref?.animeId) preferredAnimeId = String(pref.animeId);
        } catch(e) {}

        // 评分 + 过滤（合并为一步，减少一次遍历）
        const scored = [];
        for (const candidate of candidates) {
            const sim = calculateStringSimilarity(parsedSearch.title, candidate.animeTitle);
            if (sim < minSimilarity) continue;

            const score = calculateMatchScore(normalizedSearchTitle, candidate, parsedSearch);

            // 用户偏好加分
            if (preferredAnimeId && (String(candidate.animeId) === preferredAnimeId || String(candidate.bangumiId) === preferredAnimeId)) {
                score.total += 0.50;
            }
            // /match 返回的带 episodeTitle 的候选，集数加分
            if (parsedSearch.episode && candidate.episodeTitle) {
                const epNum = extractEpisodeNumber(candidate.episodeTitle);
                if (epNum === parsedSearch.episode) score.total += 0.15;
            }

            scored.push({ ...candidate, score: score.total, scoreDetails: score });
        }

        if (!scored.length) { logger.info(`[智能匹配] 无有效候选`); return null; }

        scored.sort((a, b) => b.score - a.score);

        // [增强日志] 输出评分排名前 5 的候选，方便排查匹配问题
        const topN = scored.slice(0, 5);
        logger.info(`[智能匹配] 评分列表 (前${topN.length}/${scored.length}):\n` +
            topN.map((s, i) => `  ${i + 1}. "${s.animeTitle}"${s.episodeTitle ? ` - ${s.episodeTitle}` : ''} = ${s.score.toFixed(3)} (season:${s.scoreDetails?.seasonMatch || 0})`).join('\n'));

        const best = scored[0];
        if (best.score <= 0.10) { logger.info(`[智能匹配] 最高分太低: ${best.score.toFixed(3)}`); return null; }

        logger.info(`[智能匹配] ✓ 选中: "${best.animeTitle}"${best.episodeTitle ? ` - ${best.episodeTitle}` : ''} (${best.score.toFixed(3)})`);

        // 第二阶段：选 episode
        if (parsedSearch.episode && best.episodes?.length) {
            const ep = findBestEpisode(best.episodes, parsedSearch.episode);
            if (ep) {
                best.matchedEpisodeId = ep.episodeId;
                best.matchedEpisodeTitle = ep.episodeTitle;
                best.matchedEpisodeIndex = best.episodes.indexOf(ep);
            }
        }
        return best;
    }

    // [综合优化] 多维度评分 - 融合两版优势：条件加分机制 + bigram 精确相似度 + 用户偏好
    function calculateMatchScore(normalizedSearch, candidate, parsedSearch) {
        const candidateYear = candidate.animeTitle?.match(/\((\d{4})\)/)?.[1] | 0;
        const pureCandTitle = cleanTitleForComparison(candidate.animeTitle.replace(/\(\d{4}\)/, ''));
        const candidateTitle = cleanTitleForComparison(candidate.animeTitle);

        // 1. 名字得分 (0~0.40) - 基于 bigram 相似度
        let nameScore = 0;
        const exactMatch = normalizedSearch === pureCandTitle || normalizedSearch === candidateTitle;
        if (exactMatch) {
            nameScore = 0.40;
        } else if (pureCandTitle.includes(normalizedSearch) || normalizedSearch.includes(pureCandTitle)) {
            nameScore = 0.35;
        } else if (candidateTitle.includes(normalizedSearch) || normalizedSearch.includes(candidateTitle)) {
            nameScore = 0.30;
        } else {
            nameScore = calculateStringSimilarity(normalizedSearch, candidateTitle) * 0.40;
        }

        // 2. 年份匹配 (-0.20~0.20)
        let yearScore = 0;
        if (parsedSearch?.year && candidateYear) {
            const diff = Math.abs(candidateYear - parsedSearch.year);
            yearScore = diff === 0 ? 0.20 : diff === 1 ? 0.10 : -0.20;
        }

        // 3. 季度匹配 (-0.20~0.20) - [条件加分] 只在名字得分 >= 0.20 时生效，避免误匹配
        let seasonScore = 0;
        const parsedCand = parseCandidateTitle(candidate.animeTitle);
        const candSeason = parsedCand.season || detectSeasonFromTitle(candidate.animeTitle, normalizedSearch);
        if (parsedSearch?.season && nameScore >= 0.20) {
            if (candSeason === parsedSearch.season) {
                seasonScore = 0.20;
            } else if (candSeason) {
                const sDiff = Math.abs(candSeason - parsedSearch.season);
                seasonScore = sDiff === 1 ? -0.05 : -0.20;
            } else {
                seasonScore = parsedSearch.season === 1 ? 0.10 : -0.05;
            }
        }

        // 4. 集数匹配 (-0.20~0.20) - [条件加分] 只在名字得分 >= 0.20 时生效
        let episodeScore = 0;
        const targetEp = parsedSearch?.episode;
        if (targetEp && nameScore >= 0.20 && candidate.episodes?.length > 0) {
            const matchedEp = candidate.episodes.find(ep => parseInt(ep.episodeNumber) === targetEp);
            if (matchedEp) {
                episodeScore = 0.20;
                candidate._matchedEpisodeId = matchedEp.episodeId;
            } else {
                const epNums = candidate.episodes.map(ep => parseInt(ep.episodeNumber)).filter(n => n > 0);
                if (epNums.length > 0) {
                    const minEp = Math.min(...epNums), maxEp = Math.max(...epNums);
                    if (targetEp < minEp) episodeScore = -0.10;
                    else if (targetEp > maxEp) episodeScore = -0.10;
                    else episodeScore = -0.05;
                }
            }
        }

        // 5. 关键词辅助 (0~0.05)
        let keywordScore = 0;
        if (nameScore < 0.30) {
            const sKw = extractKeywords(normalizedSearch);
            const cKw = extractKeywords(candidate.animeTitle);
            const hits = sKw.filter(k => cKw.some(c => c.includes(k) || k.includes(c))).length;
            keywordScore = (hits / Math.max(sKw.length, 1)) * 0.05;
        }

        // 6. 类型加成 (-0.05~0.05)
        const hasSE = parsedSearch?.season || parsedSearch?.episode;
        const typeMap = hasSE
            ? { tvseries: 0.05, tvspecial: 0.03, web: 0.02, movie: -0.05 }
            : { movie: 0.05, tvseries: 0.02 };
        const typeBonus = typeMap[candidate.type] || 0;

        const total = nameScore + yearScore + seasonScore + episodeScore + keywordScore + typeBonus;
        return {
            nameScore, yearScore, seasonScore, episodeScore,
            keywordScore, typeBonus,
            exactMatch: exactMatch ? 1 : 0,
            titleSimilarity: nameScore, seasonMatch: seasonScore, yearMatch: yearScore,
            episodeCompleteness: episodeScore, keywordMatch: keywordScore,
            total
        };
    }

    // 标题标准化函数
    function normalizeTitle(title) {
        return title.toLowerCase().replace(/[：:]/g, '').replace(/\s+/g, ' ')
            .replace(/[^\w\s\u4e00-\u9fff]/g, '').trim();
    }

    // [综合优化] 从标题任意位置提取季度
    function extractSeasonNumber(title) {
        if (!title) return null;
        const t = title.toLowerCase();

        // 阿拉伯数字/中文季号
        const numMatch = t.match(/(?:第\s*([一二三四五六七八九十零\d]+)\s*[季部期]|season\s*(\d+)|s(\d+)(?![e\d\w]))/);
        if (numMatch) {
            const chineseNums = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'零':0 };
            const m = numMatch[1];
            if (m && isNaN(parseInt(m))) {
                if (m.length === 1 && chineseNums[m] !== undefined) return chineseNums[m];
                else if (m.length === 2 && m[0] === '十') return 10 + (chineseNums[m[1]] || 0);
                else if (m.includes('十')) { const parts = m.split('十'); return (chineseNums[parts[0]] || 1) * 10 + (chineseNums[parts[1]] || 0); }
                else return chineseNums[m];
            }
            return parseInt(numMatch[1] || numMatch[2] || numMatch[3]);
        }

        // 英文序数词季号
        const spelledOrdinals = {
            'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6,
            'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10
        };
        for (const [word, num] of Object.entries(spelledOrdinals)) {
            if (t.includes(word + ' season') || t.includes(word + ' series')) return num;
        }

        // 罗马数字季号
        const romanMatch = t.match(/\b([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]|ii|iii|iv|vi|vii|viii|ix|xi|xii)\b(?:\s*[季期部])?/);
        if (romanMatch) {
            const romanToNum = {
                'Ⅰ':1,'Ⅱ':2,'Ⅲ':3,'Ⅳ':4,'Ⅴ':5,'Ⅵ':6,'Ⅶ':7,'Ⅷ':8,'Ⅸ':9,'Ⅹ':10,'Ⅺ':11,'Ⅻ':12,
                'ii':2,'iii':3,'iv':4,'vi':6,'vii':7,'viii':8,'ix':9,'xi':11,'xii':12
            };
            return romanToNum[romanMatch[1]] || null;
        }

        return null;
    }

    // [综合优化] 解析搜索关键词，提取标题/季/集/年份
    function parseSearchKeyword(keyword) {
        keyword = cleanFileNameNoise(keyword.trim());

        // 提取年份
        let year = null;
        const ym = keyword.match(/[\(\[]\s*(\d{4})\s*[\)\]]/);
        if (ym) { year = parseInt(ym[1]); keyword = keyword.replace(ym[0], '').trim(); }
        else {
            const ym2 = keyword.match(/[\s.](\d{4})[\s.]/);
            if (ym2 && ym2[1] >= 1990 && ym2[1] <= 2030) { year = parseInt(ym2[1]); keyword = keyword.replace(ym2[1], ' ').replace(/\s{2,}/g, ' ').trim(); }
        }

        // 提取集数
        let episode = null;
        const se = /^(.+?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,4})$/i.exec(keyword);
        if (se) {
            return { title: cleanTitleTail(se[1]), season: parseInt(se[2]), episode: parseInt(se[3]), year };
        }

        const epPatterns = [
            /[Ee](\d+)/,
            /(?:^|[^\d])第\s*(\d+)\s*(?:集|话|话(?:\s*\/\s*)?第?\s*\d+\s*(?:集|话)?|卷)$/,
            /(?<![SpPeE])\b(\d{2,4})\s*话?(?=\s*(?:END|完|OVA|OAD|SP|BD|剧场版|\s*$))/i,
            /^(\d{1,3})(?=\s*(?:END|完|OVA|OAD|剧场版))/i,
        ];
        for (const pat of epPatterns) {
            const m = keyword.match(pat);
            if (m) { episode = parseInt(m[1]); break; }
        }
        if (episode !== null) keyword = keyword.replace(/([Ee]?\d+|\[?\d{1,2}\]?\s*(?:集|话|OVA|OAD|END|完))/g, '');

        // 提取季度 (使用新增的 extractSeasonNumber)
        let season = extractSeasonNumber(keyword);

        if (season !== null) {
            // 清理季度信息以防干扰标题匹配
            keyword = keyword.replace(/第\s*[一二三四五六七八九十零\d]+\s*[季部期]/i, '')
                           .replace(/\b(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/gi, '')
                           .replace(/\bS\d{1,2}\b/gi, '');
        } else {
            // 旧的回退逻辑
            const patterns = [
                { p: /^(.*?)[\s._-]*(?:S|Season)[\s._-]*(\d{1,2})$/i, h: m => parseInt(m[2]) },
                { p: /^(.*?)\s*([Ⅰ-Ⅻ])$/, h: m => _ROMAN[m[2]] },
                { p: /^(.*?)\s+(\d{1,2})$/, h: m => parseInt(m[2]) }
            ];
            for (const { p, h } of patterns) {
                const m = p.exec(keyword);
                if (m) {
                    try {
                        const t = cleanTitleTail(m[1]);
                        const s = h(m);
                        if (s && !(t.length > 4 && /\d{4}$/.test(t))) {
                            season = s;
                            keyword = t;
                            break;
                        }
                    } catch(e) {}
                }
            }
        }

        // 清理残余标记
        keyword = keyword.replace(/\s*-\s*(?:S\d+|SP|OVA|OAD|BD|剧场版)\s*$/i, '').replace(/\s+/g, ' ').trim();
        return { title: cleanTitleTail(keyword), season, episode, year };
    }

    // [优化] 清理标题中的附加信息，用于更精确的比较
    function cleanTitleForComparison(title) {
        return title
            .replace(/\s*[\(（].*?[\)）]/g, '')        // 移除括号内容: (2025), （来源：xxx）
            .replace(/\s*【.*?】/g, '')                 // 移除【电视剧】等
            .replace(/\s*from\s+\w+/gi, '')             // 移除 from renren 等
            .replace(/\s*（并行\s*来源.*$/g, '')         // 移除 （并行 来源：xxx 年份：xxx）
            .replace(/\s*（来源.*$/g, '')                // 移除 （来源：xxx）
            // 季集编号归一化: S01E01/s1e1/S1/s01 统一为不带前导零的格式
            .replace(/[Ss](\d+)[Ee](\d+)/g, (_, s, e) => `S${parseInt(s)}E${parseInt(e)}`)
            .replace(/[Ss](\d+)(?![Ee\d])/g, (_, s) => `S${parseInt(s)}`)
            .trim();
    }

    // [综合优化] 字符串相似度计算 - 融合 bigram Dice 系数 + 编辑距离 + CJK 优化
    function calculateStringSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;

        // 先清理附加信息再比较
        const s1 = cleanTitleForComparison(str1).toLowerCase().replace(/[：:]/g, '');
        const s2 = cleanTitleForComparison(str2).toLowerCase().replace(/[：:]/g, '');

        if (s1 === s2) return 1.0;
        if (s1.length === 0 || s2.length === 0) return 0;

        // 包含关系处理 - 加入 CJK 字符优化
        if (s1.includes(s2) || s2.includes(s1)) {
            const shorter = Math.min(s1.length, s2.length);
            const longer = Math.max(s1.length, s2.length);
            const baseSim = 0.9 * (shorter / longer);

            // [CJK 优化] 解决中文标题加英文副标题的问题（如"一人之下 THE OUTCAST"）
            // 若短串全部 CJK 字符都命中了长串的 CJK 字符，则按 CJK 字符数比例重新计算
            const cjkReg = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff]/g;
            const s1Cjk = (s1.match(cjkReg) || []).length;
            const s2Cjk = (s2.match(cjkReg) || []).length;
            if (s1Cjk > 0 && s2Cjk > 0 && s1Cjk <= s2Cjk) {
                const cjkSim = 0.85 * (s1Cjk / s2Cjk);
                return Math.max(baseSim, cjkSim);
            }
            return baseSim;
        }

        const n = s1.length, m = s2.length;

        // 优化：长度差距太大直接返回低相似度
        if (Math.abs(n - m) > Math.max(n, m) * 0.6) return 0.2;

        // 单字符无法生成 bigram，退化为字符比较
        if (n === 1 || m === 1) {
            return s1.charAt(0) === s2.charAt(0) ? 0.3 : 0;
        }

        // [优化] 使用 bigram Dice 系数 - 要求连续两字匹配，避免单字碰巧相同的误判
        const bigrams1 = new Set();
        for (let i = 0; i < n - 1; i++) bigrams1.add(s1.substring(i, i + 2));
        const bigrams2 = new Set();
        for (let i = 0; i < m - 1; i++) bigrams2.add(s2.substring(i, i + 2));

        let intersection = 0;
        for (const bigram of bigrams1) {
            if (bigrams2.has(bigram)) intersection++;
        }

        const diceSim = (2 * intersection) / (bigrams1.size + bigrams2.size);

        // [混合策略] 对于较短的字符串，编辑距离更可靠；对于较长的字符串，bigram 更精确
        if (Math.max(n, m) < 6) {
            // 短字符串：使用编辑距离
            const dp = Array.from({length: n + 1}, (_, i) => i);
            for (let j = 1; j <= m; j++) {
                let prev = dp[0]; dp[0] = j;
                for (let i = 1; i <= n; i++) {
                    const tmp = dp[i];
                    dp[i] = s1[i-1] === s2[j-1] ? prev : Math.min(prev, dp[i], dp[i-1]) + 1;
                    prev = tmp;
                }
            }
            const editSim = (Math.max(n, m) - dp[n]) / Math.max(n, m);
            return Math.max(diceSim, editSim); // 取两者较大值
        }

        // 长字符串：使用 bigram
        return diceSim;
    }

    // 提取关键词
    const _STOP_WORDS = new Set(['第','季','部','篇','章','话','集','期','season','episode','ep','ova','tv','movie','special','the','of','and','in','to','a','an']);
    function extractKeywords(title) {
        return title.toLowerCase().replace(/[：:]/g, ' ').replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
            .split(/[\s\u3000]+/).filter(w => w.length > 1 && !_STOP_WORDS.has(w) && !/^\d+$/.test(w));
    }

    // ========================================
    // 🔧 匹配精度增强 - 辅助函数
    // ========================================

    const _CN_NUM = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
    const _ROMAN = {'Ⅰ':1,'Ⅱ':2,'Ⅲ':3,'Ⅳ':4,'Ⅴ':5,'Ⅵ':6,'Ⅶ':7,'Ⅷ':8,'Ⅸ':9,'Ⅹ':10,'Ⅺ':11,'Ⅻ':12};

    // 从标题中提取年份 "xxx (2024)" → 2024
    function extractYearFromTitle(title) {
        return title?.match(/\((\d{4})\)/)?.[1] | 0 || null;
    }

    // 从候选标题中独立解析季度信息（不依赖搜索标题）
    // "平凡职业造就世界最强 第二季" → { title: "平凡职业造就世界最强", season: 2 }
    // "某某某 Season 3" → { title: "某某某", season: 3 }
    // "某某某 2nd Season" → { title: "某某某", season: 2 }
    // "某某某 Ⅲ" → { title: "某某某", season: 3 }
    // "某某某" (无季度标记) → { title: "某某某", season: null }
    function parseCandidateTitle(title) {
        if (!title) return { title: '', season: null };
        // 清除年份括号
        let clean = title.replace(/\(\d{4}\)/, '').trim();

        // [综合优化] 支持任意位置的季度提取
        const patterns = [
            // "第X季" / "第X部" (任意位置)
            { p: /(.*?)\s*第\s*([一二三四五六七八九十零\d]+)\s*[季部期](.*)/i, h: m => _CN_NUM[m[2]] || parseInt(m[2]), f: m => m[1] + ' ' + m[3] },
            // "Season X" / "S3" (任意位置)
            { p: /(.*?)\s*(?:Season|S)\s*(\d{1,2})\b(.*)/i, h: m => parseInt(m[2]), f: m => m[1] + ' ' + m[3] },
            // "2nd Season" / "3rd Season" (任意位置)
            { p: /(.*?)\s*(\d{1,2})(?:st|nd|rd|th)\s*Season(.*)/i, h: m => parseInt(m[2]), f: m => m[1] + ' ' + m[3] },
            // 罗马数字 "XXX Ⅲ" (任意位置)
            { p: /(.*?)\s*([Ⅰ-Ⅻ])(?:\s*[季期部])?(.*)/, h: m => _ROMAN[m[2]], f: m => m[1] + ' ' + m[3] },
            // "XXX II" / "XXX III" (英文罗马) (任意位置)
            { p: /(.*?)\s+\b(II|III|IV|V|VI|VII|VIII|IX|X)\b(?:\s*[季期部])?(.*)/i, h: m => ({ 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10 })[m[2].toUpperCase()], f: m => m[1] + ' ' + m[3] },
        ];

        for (const { p, h, f } of patterns) {
            const m = p.exec(clean);
            if (m) {
                try {
                    const season = h(m);
                    if (season) return { title: cleanTitleForComparison(f(m)).trim(), season };
                } catch(e) {}
            }
        }

        return { title: cleanTitleForComparison(clean).trim(), season: null };
    }

    // 从候选标题中推断季度（兼容旧逻辑：优先独立解析，回退到相对检测）
    function detectSeasonFromTitle(candidateTitle, searchTitle) {
        if (!candidateTitle) return null;
        // 优先：对候选标题做独立解析
        const parsed = parseCandidateTitle(candidateTitle);
        if (parsed.season) return parsed.season;

        // 回退：如果独立解析无结果，尝试相对位置推断
        if (!searchTitle) return null;
        const clean = candidateTitle.replace(/\(\d{4}\)/, '').trim().toLowerCase();
        const search = (typeof searchTitle === 'string' ? searchTitle : '').toLowerCase();
        const idx = clean.indexOf(search);
        if (idx === -1) return null;
        const after = clean.substring(idx + search.length).trim();
        if (!after) return 1; // 完全匹配搜索标题 → 第1季
        const num = after.match(/(\d+)/);
        if (num) return parseInt(num[1]);
        const cn = after.match(/([一二三四五六七八九十])/);
        if (cn && _CN_NUM[cn[1]]) return _CN_NUM[cn[1]];
        for (const [r, n] of Object.entries(_ROMAN)) { if (after.includes(r)) return n; }
        return null;
    }

    // 清洗文件名噪音（分辨率/编码/来源/字幕组标签等）
    function cleanFileNameNoise(name) {
        if (!name) return name;
        return name
            .replace(/\.(?![0-9])/g, ' ').replace(/_/g, ' ')
            .replace(/\b(2160|1080|720|480|360)[pi]\b/gi, '')
            .replace(/\b(x264|x265|h\.?264|h\.?265|HEVC|AVC|AAC|FLAC|DTS|DDP?\s*\d*\.?\d*|Atmos|TrueHD)\b/gi, '')
            .replace(/\b(WEB[-.]?DL|WEBRip|BluRay|BDRip|HDTV|DVDRip|HDRip|REMUX)\b/gi, '')
            .replace(/\b(HDR\d*|SDR|Dolby\s*Vision|DV|DoVi)\b/gi, '')
            .replace(/[\[【][^\]】]*[\]】]/g, '')
            .replace(/\.(mkv|mp4|avi|rmvb|flv|wmv|ts|m2ts)$/i, '')
            .replace(/\s{2,}/g, ' ').trim();
    }

    // 清理标题末尾噪音
    function cleanTitleTail(t) { return t ? t.replace(/[\s._-]+$/, '').trim() : t; }

    // 从 episodeTitle 提取集数
    function extractEpisodeNumber(title) {
        if (!title) return null;
        for (const p of [/第\s*(\d+)\s*[话集]/, /第\s*(\d+)\s*$/, /[Ee][Pp]?\s*(\d+)/, /\b(\d+)\s*[话集]/, /^(\d+)\s*[.\s-]/, /^\s*(\d+)\s*$/]) {
            const m = title.match(p);
            if (m) return parseInt(m[1]);
        }
        return null;
    }

    // 多策略集数定位
    function findBestEpisode(episodes, targetNum) {
        if (!episodes?.length || !targetNum) return null;
        // 过滤黑名单 + 去重
        const bl = lsGetItem(lsKeys.episodeTitleBlacklist.id) || '';
        let re = null;
        try { if (bl) re = new RegExp(bl, 'i'); } catch(e) {}
        const seen = new Set();
        const filtered = episodes.filter(ep => {
            if (re && ep.episodeTitle && re.test(ep.episodeTitle)) return false;
            if (seen.has(ep.episodeTitle)) return false;
            seen.add(ep.episodeTitle);
            return true;
        });
        const list = filtered.length ? filtered : episodes;
        // 策略1: 标题提取集数
        for (const ep of list) { if (extractEpisodeNumber(ep.episodeTitle) === targetNum) return ep; }
        // 策略2: episodeNumber 字段
        for (const ep of list) { if (ep.episodeNumber && parseInt(ep.episodeNumber) === targetNum) return ep; }
        // 策略3: 索引 fallback
        return list.length >= targetNum ? list[targetNum - 1] : null;
    }

    // 空值不转换成 0，只提交协议允许的整数。
    function backendNumber(value, max, min = 0) {
        if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
        const number = Number(value);
        return Number.isInteger(number) && number >= min && number <= max ? number : null;
    }

    function buildBackendCandidate(candidate, sourceId, index) {
        // 类型描述优先于源的数值类型码；不猜测未知代码的含义。
        const type = String(candidate.mediaType ?? candidate.typeDescription ?? candidate.type ?? '').trim().toLowerCase();
        const mediaType = /movie|电影|剧场版/.test(type) ? 'movie'
            : /episode|tv|series|ova|ona|电视剧|动画/.test(type) ? 'episode' : null;
        return {
            candidateId: `candidate-${index}`, sourceId,
            animeId: candidate.animeId == null ? null : String(candidate.animeId).slice(0, 256),
            title: String(candidate.animeTitle ?? candidate.title ?? '').slice(0, 256),
            aliases: Array.isArray(candidate.aliases) ? candidate.aliases.filter(x => typeof x === 'string' && x.trim()).slice(0, 10).map(x => x.slice(0, 256)) : null,
            mediaType,
            seasonNumber: mediaType === 'movie' ? null : backendNumber(candidate.seasonNumber, 999),
            year: backendNumber(candidate.year ?? candidate.productionYear, 9999, 1),
            // 只接受带作用范围的源标识，不把 animeId 冒充 TMDB 等标识。
            providerIds: Array.isArray(candidate.providerIds) ? candidate.providerIds : null,
            __sourceCandidate: candidate
        };
    }

    async function resolveBackendCandidates(animeName, episode, seasonNumber, candidates, sourceId, isCurrent = () => true) {
        if (!isCurrent() || !ddBackend.isDll() || !Array.isArray(candidates) || !candidates.length) return null;
        if (!ddBackend.has('MediaMatch')) {
            logger.warn('[后端匹配] DLL 未声明 MediaMatch 能力，禁止前端自行选择');
            return null;
        }
        // 与 DLL 请求硬上限一致；AI 实际上限仍由服务端配置决定。
        if (candidates.length > 1000) {
            logger.warn('[后端匹配] 作品搜索结果超过 1000 个，未截断候选，请缩小搜索范围');
            return null;
        }
        const itemId = window.ede?.itemId;
        const item = await fatchEmbyItemInfo(itemId).catch(() => null);
        if (!isCurrent() || !item || itemId !== window.ede?.itemId) return null;
        const mediaType = item.Type === 'Movie' ? 'movie' : item.Type === 'Episode' ? 'episode' : null;
        const work = mediaType === 'episode' && item.SeriesId
            ? await fatchEmbyItemInfo(item.SeriesId).catch(() => null) : item;
        if (!isCurrent() || itemId !== window.ede?.itemId) return null;
        const scope = mediaType === 'movie' ? 'movie' : 'series';
        const providerIds = Object.entries(work?.ProviderIds || {}).slice(0, 16)
            .filter(([provider, id]) => provider && id != null && String(id).trim())
            .map(([provider, id]) => ({ provider, scope, id: String(id).trim() }));
        // 聚合请求按输入顺序保留来源优先级，序号唯一，原始候选不进入请求体。
        const mapped = candidates.map((candidate, index) => buildBackendCandidate(candidate,
            typeof sourceId === 'function' ? sourceId(index) : sourceId, index));
        const target = { itemId, title: String(animeName || work?.Name || '').slice(0, 256),
            mediaType, seasonNumber: mediaType === 'episode' ? backendNumber(seasonNumber ?? item.ParentIndexNumber, 999) : null,
            episodeNumber: mediaType === 'episode' ? backendNumber(episode ?? item.IndexNumber, 99999) : null,
            year: backendNumber(work?.ProductionYear, 9999, 1), providerIds };
        logger.info(`[后端匹配] 提交作品候选=${mapped.length}，类型=${mediaType || '未知'}，季=${target.seasonNumber}，集=${target.episodeNumber}，年份=${target.year}，平台标识数=${providerIds.length}`);
        const response = await ddBackend.resolveMatch({ mode: 'auto', selectionScope: 'work', target,
            candidates: mapped.map(({ __sourceCandidate, ...value }) => value), resultLimit: 100 });
        if (!isCurrent() || !response || itemId !== window.ede?.itemId) return null;
        const status = String(response.status ?? response.Status ?? '').toLowerCase();
        const selectedId = response.selectedCandidateId ?? response.SelectedCandidateId;
        const confirmation = response.needsConfirmation ?? response.NeedsConfirmation;
        const selected = status === 'matched' && confirmation !== true && selectedId
            ? mapped.find(candidate => candidate.candidateId === String(selectedId)) : null;
        logger.info(`[后端匹配] 作品候选=${mapped.length}，状态=${status || 'unknown'}，已选作品=${Boolean(selected)}`);
        return { status, selected: selected?.__sourceCandidate || null, response };
    }

    // 后端仅限制为所选作品，后续仍使用原来的分集获取流程。
    async function resolveBackendSearch(animes, itemInfoMap, config, sourceId) {
        const match = await resolveBackendCandidates(itemInfoMap.animeName, itemInfoMap.episode,
            itemInfoMap.seasonNumber, animes, sourceId);
        if (!match?.selected) return null;
        return { backendResolved: true, animaInfo: { animes: [match.selected] },
            apiPrefix: config.prefix, apiName: config.name,
            apiAppId: config.appId || '', apiAppSecret: config.appSecret || '' };
    }


    async function fetchMatchApi(payload, prefix, appId, appSecret) {
        const url = `${prefix}/match`;
        // [脱敏] 官方源走 Worker 代理时不打印完整代理 URL/前缀,避免暴露代理端点;自定义源保留便于调试
        if (logLevel >= LOG_LEVEL.DEBUG) {
            if (ddSign.isProxiedOfficial(url)) {
                logger.debug(`[API请求] match - path: /match, Payload:`, payload);
            } else {
                logger.debug(`[API请求] match - URL: ${url}, Prefix: ${prefix}, Payload:`, payload);
            }
        }

        // 复用 fetchJson 网络层，获得统一超时/AbortController/销毁取消/错误语义
        try {
            const isDandanplayApi = prefix.includes('api.dandanplay.net') || prefix.includes('dandanplay');
            const extraHeaders = {};
            if (isDandanplayApi) {
                extraHeaders['X-User-Agent'] = userAgent;
            } else if (logLevel >= LOG_LEVEL.DEBUG) {
                logger.debug(`[API请求] match 跳过 X-User-Agent (自定义API)`);
            }
            if (appId && appSecret) {
                Object.assign(extraHeaders, await buildCustomApiSignHeaders(appId, appSecret, url));
            }
            // wasm 签名头由 fetchJson 内部的 ddSign.isProxiedOfficial 分支自动附加

            const matchResult = await fetchJson(url, {
                method: 'POST',
                body: payload,       // fetchJson 会 JSON.stringify body
                headers: extraHeaders,
            });

            if (!matchResult) return null;
            logger.debug(`[API请求] match 查询响应:`, matchResult);
            // 统一 /match 和 /search/episodes 的返回格式
            if (matchResult.matches) {
                matchResult.animes = matchResult.matches;
                delete matchResult.matches;
            }
            return matchResult;

        } catch (error) {
            logger.warn(`[API请求] match 查询失败:`, error.message || error);
            if (ddSign.isProxiedOfficial(url)) {
                logger.warn(`[API请求] match 失败详情 - Payload:`, payload);
            } else {
                logger.warn(`[API请求] match 失败详情 - URL: ${url}, Payload:`, payload);
            }
            return null;
        }
    }
    // 自动保存仅接收网络原始集合，不接收过滤结果、通知或本地 XML 回读。
    const xmlSaveAttempts = new Set();
    async function fetchComment(episodeId, overridePrefix, appId, appSecret) {
        const client = getHostApiClient();
        const itemId = window.ede?.itemId;
        const loadId = window.ede?.lastLoadId;
        const generation = playbackViewGeneration;
        const base = String(client?.serverAddress?.() || '').replace(/\/$/, '');
        const userId = client?.getCurrentUserId?.();
        const token = client?.accessToken?.();
        const current = () => itemId && itemId === window.ede?.itemId
            && loadId === window.ede?.lastLoadId && generation === playbackViewGeneration
            && base === String(client?.serverAddress?.() || '').replace(/\/$/, '')
            && userId === client?.getCurrentUserId?.() && token === client?.accessToken?.();
        // 按本次实际请求地址确定来源，避免切换来源后沿用旧匹配标签。
        const rawPrefix = overridePrefix || window.ede?.episode_info?.apiPrefix || dandanplayApi.prefix;
        const normalize = value => String(value || '').replace(/\/+$/, '');
        // 与实际网络请求保持相同的凭据回退，避免规范化地址不同而误标来源。
        const commentAppId = appId || window.ede?.episode_info?.apiAppId || '';
        const commentAppSecret = appSecret || window.ede?.episode_info?.apiAppSecret || '';
        const actualPrefix = normalize(normalizeCustomApiPrefix(rawPrefix, commentAppId, commentAppSecret));
        const officialPrefix = normalize(corsProxy + 'https://api.dandanplay.net/api/v2');
        const official = actualPrefix === officialPrefix || actualPrefix === 'https://api.dandanplay.net/api/v2';
        const custom = getCustomApiList().find(item => normalize(normalizeCustomApiPrefix(item.url, item.appId, item.appSecret)) === actualPrefix);
        const source = official ? 'dandanplay' : String(custom?.name || window.ede?.episode_info?.apiName || '').trim();
        const validSource = source.length > 0 && source.length <= 64 && !/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(source)
            && (official || source.toLowerCase() !== 'dandanplay');
        const comments = await fetchNetworkComments(episodeId, overridePrefix, appId, appSecret);
        if (!validSource) logger.warn('[XML联动] 来源名称无效或使用官方保留名称，跳过自动保存');
        if (validSource && current() && ddBackend.isDll() && Array.isArray(comments) && comments.length) {
            // 不等待落盘，不阻塞播放；同一加载同一来源最多尝试一次。
            const key = `${base}|${userId}|${itemId}|${source}|${loadId}|${generation}`;
            if (!xmlSaveAttempts.has(key)) {
                xmlSaveAttempts.add(key);
                if (xmlSaveAttempts.size > 100) xmlSaveAttempts.delete(xmlSaveAttempts.values().next().value);
                void saveNetworkXml(comments, itemId, source, base, token, current);
            }
        }
        return comments;
    }

    async function saveNetworkXml(comments, itemId, source, base, token, current) {
        // 只有能力探测确认后端在线且处于 DLL 模式，才允许进入 XML 保存策略链路。
        if (!ddBackend.isDll()) return;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const options = { credentials: 'same-origin', redirect: 'error', cache: 'no-store',
                signal: controller.signal, headers: { 'X-Emby-Token': token, Accept: 'application/json' } };
            const response = await fetch(`${base}/dd-danmaku/api/playback-policy`, options);
            if (!response.ok || !current()) return;
            const body = await response.json();
            const policy = body?.data ?? body?.Data ?? body;
            // 自动保存必须同时获准写入且开启自动保存；保留已确认的同来源覆盖行为。
            if ((policy?.canWrite ?? policy?.CanWrite) !== true
                || (policy?.autoSave ?? policy?.AutoSave) !== true || !current()) return;
            const xml = document.implementation.createDocument('', 'i', null);
            // 弹弹 play 的 p 为时间、类型、颜色、发送者；XML 需补齐字号和日期等字段。
            for (const comment of comments) {
                const fields = String(comment?.p || '').split(',');
                if (fields.length < 3 || typeof comment?.m !== 'string') return;
                const node = xml.createElement('d');
                node.setAttribute('p', [fields[0], fields[1], 25, fields[2], 0, 0, fields[3] || '', comment.cid || 0].join(','));
                node.textContent = comment.m;
                xml.documentElement.appendChild(node);
            }
            const payload = new XMLSerializer().serializeToString(xml);
            if (!current() || new Blob([payload]).size > 32 * 1024 * 1024) return;
            const sourceQuery = source ? `&Source=${encodeURIComponent(source)}` : '';
            const saved = await fetch(`${base}/dd-danmaku/api/items/${encodeURIComponent(itemId)}/danmaku?Overwrite=true${sourceQuery}`, {
                ...options, method: 'PUT', headers: { ...options.headers, 'Content-Type': 'application/xml' }, body: payload
            });
            if (saved.ok) logger.info('[XML联动] 网络弹幕已保存到服务器');
            else if (saved.status !== 409) logger.warn('[XML联动] 自动保存未完成，不影响播放');
        } catch (_) {
            logger.debug('[XML联动] 自动保存跳过，不影响播放');
        } finally { clearTimeout(timer); }
    }

    async function fetchNetworkComments(episodeId, overridePrefix, appId, appSecret) {
         // [修复] 支持指定源：推理匹配时传入上一集使用的源，避免多源混淆
        const rawPrefix = overridePrefix || window.ede.episode_info?.apiPrefix || dandanplayApi.prefix;
        const commentAppId = appId || window.ede.episode_info?.apiAppId || '';
        const commentAppSecret = appSecret || window.ede.episode_info?.apiAppSecret || '';
        // [兼容] 规范化 prefix：兜底处理缓存中遗留的旧格式（如缺少 /api/v2 的 dandanplay 地址）
        const prefix = normalizeCustomApiPrefix(rawPrefix, commentAppId, commentAppSecret);

        // [v2.7.0] 仅当当前源对应的 serverName 在 knownApiServers 中配置了 supportsAsync:true 时，
        // 才追加 async=1 参数，避免向不支持异步接口的服务器发送无效参数
        const supportsAsyncPoll = (() => {
            const list = getCustomApiList();
            const normalize = u => (u || '').replace(/\/$/, '');
            const matchedItem = list.find(i => normalize(i.url) === normalize(rawPrefix));
            if (!matchedItem || !matchedItem.serverName) return false;
            const server = knownApiServers.find(s => s.serverName === matchedItem.serverName);
            return !!(server && server.supportsAsync);
        })();
        const url = `${prefix}/comment/${episodeId}?withRelated=true&chConvert=${window.ede.chConvert}${supportsAsyncPoll ? '&async=1' : ''}`;

        const startTime = performance.now(); // [Log] 开始计时

        // [签名] 自定义API签名头（按原始 /comment URL 签名，不含 async 参数影响 path）
        const commentSignHeaders = await buildCustomApiSignHeaders(commentAppId, commentAppSecret, url);
        const fetchOpts = Object.keys(commentSignHeaders).length > 0
            ? { headers: commentSignHeaders, timeoutMs: 100000 }
            : { timeoutMs: 100000 };

        // [v2.7.0] 轮询异步任务：/taskcomment/{taskId}
        // 轮询必须有上限：服务端任务异常或状态字段不兼容时，不能让“正在获取”永久占用播放页。
        const pollTask = async (taskId) => {
            const taskUrl = `${prefix}/taskcomment/${taskId}`;
            const pollInterval = 1000;
            const deadline = Date.now() + 600000; // 最长轮询 600 秒，兼容耗时较长的弹幕生成任务
            let i = 0;
            while (Date.now() < deadline) {
                // 切集、换源或退出后，旧任务必须立即停止，不能继续覆盖新任务的加载提示。
                if (!current()) return null;
                await new Promise(r => setTimeout(r, pollInterval));
                if (!current()) return null;
                i++;
                let taskData = null;
                try {
                    const taskSignHeaders = await buildCustomApiSignHeaders(commentAppId, commentAppSecret, taskUrl);
                    taskData = await fetchJson(taskUrl, Object.keys(taskSignHeaders).length > 0 ? { headers: taskSignHeaders } : {});
                } catch (_) {}
                if (!taskData) {
                    ddSetLoadingRing(-1, '正在重试获取弹幕…');
                    continue;
                }
                const task = taskData?.data || taskData?.task || taskData;
                const progress = typeof task?.progress === 'number' ? task.progress
                    : typeof task?.percent === 'number' ? task.percent : -1;
                const desc = task?.description || task?.message || '';
                const status = String(task?.status || task?.state || '').toLowerCase();
                logger.debug(`[异步弹幕] 轮询 #${i} taskId=${taskId} status=${status} progress=${progress}`);
                ddSetLoadingRing(progress, desc || '正在获取弹幕…');
                if (['completed', 'complete', 'success', 'succeeded', 'done', 'finished'].includes(status)) {
                    const finalUrl = `${prefix}/comment/${episodeId}?withRelated=true&chConvert=${window.ede.chConvert}`;
                    const finalSignHeaders = await buildCustomApiSignHeaders(commentAppId, commentAppSecret, finalUrl);
                    return fetchJson(finalUrl, Object.keys(finalSignHeaders).length > 0 ? { headers: finalSignHeaders } : {});
                }
                if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
                    logger.warn(`[异步弹幕] 任务失败 taskId=${taskId} status=${status}`);
                    return null;
                }
            }
            logger.warn(`[异步弹幕] 任务轮询超时 taskId=${taskId}`);
            return null;
        };

        return fetchJson(url, fetchOpts)
            .then(async (data) => {
                const endTime = performance.now();
                const duration = (endTime - startTime).toFixed(0);

                // [v2.7.0] 仅在本次请求携带了 async=1 的情况下，才尝试进入异步轮询模式。
                // 严格判断：status === 'pending' && taskId 有值，避免服务器返回空弹幕但无 taskId 时被误判。
                if (supportsAsyncPoll && data && data.status === 'pending' && data.taskId) {
                    logger.info(`[API请求] comment 返回异步任务 taskId=${data.taskId}，开始轮询, 耗时: ${duration}ms`);
                    data = await pollTask(data.taskId);
                    if (!data) return null;
                }

                 // 兼容不同 API 的返回格式：
                // - 标准格式: { comments: [...] }
                // - 嵌套格式: { data: { comments: [...] } }
                // - 直接数组: [...]
                let comments = null;
                // 直接返回数组
                if (Array.isArray(data)) comments = data;
                // 标准格式: { comments: [...] }
                else if (data?.comments) comments = data.comments;
                // 嵌套格式: { data: { comments: [...] } }
                else if (data?.data?.comments) comments = data.data.comments;
                // 其他格式: { result: [...] }
                else if (data?.result) comments = data.result;

                if (comments) {
                    logger.info(`[API请求] comment 获取弹幕成功, 耗时: ${duration}ms, 数量: ${comments.length}`);
                    return comments;
                } else {
                    logger.error(`[API请求] comment 返回数据格式不兼容，结构: ${data ? JSON.stringify(Object.keys(data)) : 'null'}, 耗时: ${duration}ms`);
                    return null;
                }
            })
            .catch((error) => {
                logger.error(`[API请求] comment 获取弹幕失败: ${error.message}`);
                return null;
            });
    }

    function onPlaybackStopPct(e, state) {
        if (!state.NowPlayingItem) { return logger.debug('跳过 Web 端自身错误触发的第二次播放停止事件'); }
        logger.debug('监听到事件: 播放停止 (playbackstop)');
        const positionTicks = state.PlayState.PositionTicks;
        const runtimeTicks = state.NowPlayingItem.RunTimeTicks;
        if (!runtimeTicks) { return logger.debug('无可播放时长,跳过处理'); }
        const pct = parseInt(positionTicks / runtimeTicks * 100);
        logger.debug(`结束播放百分比: ${pct}%`);
        const bangumiPostPercent = lsGetItem(lsKeys.bangumiPostPercent.id);
        const bangumiToken = lsGetItem(lsKeys.bangumiToken.id);
        const currentEpisodeInfo = window.ede.episode_info;
        if (lsGetItem(lsKeys.bangumiEnable.id) && bangumiToken
            && pct >= bangumiPostPercent && currentEpisodeInfo?.episodeId
        ) {
            logger.debug(`大于需提交的设定百分比: ${bangumiPostPercent}%`);
            const { animeTitle, episodeTitle } = currentEpisodeInfo;
            const targetName = `${animeTitle} - ${episodeTitle}`;
            const episodeInfo = { ...currentEpisodeInfo };
            const backgroundFetchOpts = { abortOnDestroy: false };
            putBangumiEpStatus(bangumiToken, { episodeInfo, fetchOpts: backgroundFetchOpts }).then(res => {
                const subjectDoneText = res?.subjectMarkedDone ? ', 条目已全部看完并标记为看过' : '';
                embyToast({ text: `Bangumi收藏更新成功${subjectDoneText}, 目标: ${targetName}, 结束播放百分比: ${pct}%, 大于需提交的设定百分比: ${bangumiPostPercent}%`});
                logger.info(`Bangumi收藏更新成功, 目标: ${targetName}`);
            }).catch(error => {
                embyToast({ text: `Bangumi收藏更新失败, 目标: ${targetName}, ${error.message}` });
                logger.error(`putBangumiEpStatus 失败, 目标: ${targetName}`, error);
            });
        }
    }

    function isValidEpisodeIndex(value) {
        if (value === null || value === undefined || value === '') {
            return false;
        }
        const num = Number(value);
        return Number.isInteger(num) && num >= 0;
    }

    function isHttpStatus(error, status) {
        return new RegExp(`Status:\\s*${status}\\b`).test(String(error?.message || ''));
    }

    function deriveBgmEpisodeIndex(previousInfo, fallbackEpisodeIndex, delta) {
        if (previousInfo && isValidEpisodeIndex(previousInfo.bgmEpisodeIndex)) {
            const derived = Number(previousInfo.bgmEpisodeIndex) + delta;
            if (isValidEpisodeIndex(derived)) {
                return derived;
            }
        }
        return isValidEpisodeIndex(fallbackEpisodeIndex) ? Number(fallbackEpisodeIndex) : null;
    }

    async function getEpisodeBangumiRel(episode_info = window.ede.episode_info, fetchOpts = {}) {
        if (!episode_info) { throw new Error('未获取到 episode_info'); }
        const _bangumi_key = lsLocalKeys.bangumiEpInfoPrefix + episode_info.episodeId;
        let bangumiInfoLs = localStorage.getItem(_bangumi_key);
        if (bangumiInfoLs) {
            bangumiInfoLs = JSON.parse(bangumiInfoLs);
        }
        let bangumiEpsRes = bangumiInfoLs ? bangumiInfoLs.bangumiEpsRes : null;
        let subjectId = bangumiInfoLs ? bangumiInfoLs.subjectId : null;
        let bangumiUrl = bangumiInfoLs ? bangumiInfoLs.bangumiUrl : null;
        const animeId = episode_info.animeId;
        const bangumiId = episode_info.bangumiId || animeId;
        if (!subjectId) {
            if (!bangumiId) { throw new Error('未获取到 bangumiId/animeId'); }
            const officialPrefix = `${corsProxy}https://api.dandanplay.net/api/v2`;
            const normalizePrefix = prefix => (prefix || '').replace(/\/+$/, '');
            const primaryPrefix = normalizePrefix(episode_info.apiPrefix || dandanplayApi.prefix || officialPrefix);
            const fallbackPrefix = normalizePrefix(officialPrefix);
            const fetchBangumiByPrefix = prefix => fetchJson(`${prefix}/bangumi/${bangumiId}`, fetchOpts);

            let danDanPlayBangumiRes = null;
            try {
                danDanPlayBangumiRes = await fetchBangumiByPrefix(primaryPrefix);
            } catch (error) {
                if (primaryPrefix && primaryPrefix !== fallbackPrefix) {
                    logger.warn(`[Bangumi] 源 ${primaryPrefix} 查询 /bangumi/${bangumiId} 失败，回退官方源: ${error.message || error}`);
                    danDanPlayBangumiRes = await fetchBangumiByPrefix(fallbackPrefix);
                } else {
                    throw error;
                }
            }

            const danDanPlayBangumi = danDanPlayBangumiRes?.bangumi || danDanPlayBangumiRes;
            episode_info.bgmEpisodeIndex = offsetBgmEpisodeIndex(episode_info.bgmEpisodeIndex, danDanPlayBangumi);
            bangumiUrl = danDanPlayBangumi?.bangumiUrl;
            if (!bangumiUrl) { throw new Error('未请求到 bangumiUrl'); }
            subjectId = parseInt(bangumiUrl.match(/\/(\d+)$/)[1]);
        }
        const episodeIndex = episode_info ? episode_info.episodeIndex : null;
        const bgmEpisodeIndex = episode_info ? episode_info.bgmEpisodeIndex : null;
        const bangumiInfo = { animeId, bangumiId, bangumiUrl, subjectId, episodeIndex, bgmEpisodeIndex, bangumiEpsRes, _bangumi_key };
        window.ede.bangumiInfo = bangumiInfo;
        localStorage.setItem(bangumiInfo._bangumi_key, JSON.stringify(bangumiInfo));
        return bangumiInfo;
    }

    function offsetBgmEpisodeIndex(currentBgmEpisodeIndex, danDanPlayBangumi) {
        if (!danDanPlayBangumi || !Array.isArray(danDanPlayBangumi.episodes)) {
            return currentBgmEpisodeIndex;
        }
        if (!isValidEpisodeIndex(currentBgmEpisodeIndex)) {
            return currentBgmEpisodeIndex;
        }
        const normalizedIndex = Number(currentBgmEpisodeIndex);
        let bangumiEp = danDanPlayBangumi.episodes[normalizedIndex];
        if (!bangumiEp) {
            logger.debug(`未匹配到 danDanPlayBangumi 番剧集数,剧集不为第一季,尝试切换接口数据匹配返回修正后的 bgmEpisodeIndex`);
            const fallbackIndex = danDanPlayBangumi.episodes.findIndex(ep => ep.episodeNumber == normalizedIndex + 1);
            return fallbackIndex >= 0 ? fallbackIndex : currentBgmEpisodeIndex;
        } else {
            return normalizedIndex;
        }
    }

    async function patchBangumiSubjectDoneIfAllEpisodesWatched(token, bangumiInfo, fetchOpts = {}) {
        const bangumiEpsRes = bangumiInfo?.bangumiEpsRes;
        const episodeCollections = bangumiEpsRes?.data;
        if (!Array.isArray(episodeCollections)) {
            logger.debug('Bangumi 章节收藏列表为空,跳过条目看过检查');
            return false;
        }
        if (bangumiEpsRes.total && episodeCollections.length < bangumiEpsRes.total) {
            logger.warn(`Bangumi 章节收藏列表未完整加载(${episodeCollections.length}/${bangumiEpsRes.total}),跳过条目看过检查`);
            return false;
        }
        const mainEpisodeCollections = episodeCollections.filter(epColl => epColl?.episode?.type === 0);
        if (mainEpisodeCollections.length === 0) {
            logger.debug('Bangumi 未找到本篇章节,跳过条目看过检查');
            return false;
        }
        const unfinished = mainEpisodeCollections.find(epColl => epColl.type !== 2);
        if (unfinished) {
            const ep = unfinished.episode || {};
            logger.debug(`Bangumi 条目尚未全部看完,未完成章节: ${ep.name_cn || ep.name || ep.id || '未知章节'}`);
            return false;
        }
        await fetchJson(bangumiApi.patchUserCollection(bangumiInfo.subjectId), { ...fetchOpts, token, body: { type: 2 }, method: 'PATCH' });
        logger.info(`Bangumi 本篇章节已全部看过,条目收藏状态已更新为看过, subjectId: ${bangumiInfo.subjectId}`);
        return true;
    }

    async function putBangumiEpStatus(token, opts = {}) {
        const fetchOpts = opts.fetchOpts || {};
        const bangumiInfo = await getEpisodeBangumiRel(opts.episodeInfo, fetchOpts);
        const { subjectId, bgmEpisodeIndex, } = bangumiInfo;
        const episodeIndex = isValidEpisodeIndex(bgmEpisodeIndex) ? Number(bgmEpisodeIndex) : Number(bangumiInfo.episodeIndex);
        if (!isValidEpisodeIndex(episodeIndex)) {
            throw new Error('未获取到有效 Bangumi 章节索引');
        }
        logger.debug('准备校验 Bangumi 条目收藏状态是否为看过');
        let bangumiMe = localStorage.getItem(lsLocalKeys.bangumiMe);
        if (bangumiMe) {
            bangumiMe = JSON.parse(bangumiMe);
        } else {
            bangumiMe = await fetchBangumiApiGetMe(token, fetchOpts);
        }
        let msg = '';
        let bangumiUserColl = null;
        try {
            bangumiUserColl = await fetchJson(bangumiApi.getUserCollection(bangumiMe.username, subjectId), { ...fetchOpts, token });
        } catch (error) {
            if (!isHttpStatus(error, 404)) {
                throw error;
            }
            logger.info(`Bangumi 条目收藏不存在，将创建在看状态, subjectId: ${subjectId}`);
        }
        if (bangumiUserColl?.type === 2) { // 看过状态
            msg = 'Bangumi 条目已为看过状态,跳过更新';
            logger.debug(msg, bangumiUserColl);
            throw new Error(msg);
        }
        logger.debug('准备修改 Bangumi 条目收藏状态为在看, 如果不存在则创建, 如果存在则修改');
        let body = { type: 3 }; // 在看状态
        await fetchJson(bangumiApi.postUserCollection(subjectId), { ...fetchOpts, token, body });
        if (!bangumiInfo.bangumiEpsRes) {
            const fetchUrl = bangumiApi.getUserSubjectEpisodeCollection(subjectId);
            const bangumiEpsRes = await fetchJson(fetchUrl, { ...fetchOpts, token });
            bangumiInfo.bangumiEpsRes = bangumiEpsRes;
            const bangumiEpColl = bangumiEpsRes.data[episodeIndex];
            if (!bangumiEpColl) { throw new Error('未匹配到 bangumiEpColl'); }
            // bangumiInfo.episodeIndex = episodeIndex;
        }
        const bangumiEpColl = bangumiInfo.bangumiEpsRes.data[episodeIndex];
        const bangumiEp = bangumiEpColl.episode;
        if (bangumiEpColl.type === 2) {
            msg = 'Bangumi 章节收藏已是看过状态,跳过更新';
            logger.debug(msg, bangumiEp);
            const patchedSubject = await patchBangumiSubjectDoneIfAllEpisodesWatched(token, bangumiInfo, fetchOpts);
            if (patchedSubject) {
                bangumiInfo.subjectMarkedDone = true;
                window.ede.bangumiInfo = bangumiInfo;
                localStorage.setItem(bangumiInfo._bangumi_key, JSON.stringify(bangumiInfo));
                return bangumiInfo;
            }
            throw new Error(msg);
        }
        logger.debug('准备更新 Bangumi 章节收藏状态, 详情: ', bangumiEp);
        body.type = 2; // 看过状态
        await fetchJson(bangumiApi.putUserEpisodeCollection(bangumiEp.id), { ...fetchOpts, token, body, method: 'PUT' });
        bangumiEpColl.type = body.type;
        logger.info(`成功更新 Bangumi 章节收藏状态, 在看 => 看过, 详情: `, bangumiEp);
        bangumiInfo.subjectMarkedDone = await patchBangumiSubjectDoneIfAllEpisodesWatched(token, bangumiInfo, fetchOpts);
        window.ede.bangumiInfo = bangumiInfo;
        localStorage.setItem(bangumiInfo._bangumi_key, JSON.stringify(bangumiInfo));
        return bangumiInfo;
    }

    async function fetchJson(url, opts = {}) {
    const { token, headers, body } = opts;
    const abortOnDestroy = opts.abortOnDestroy !== false;
    let { method = 'GET' } = opts;
    if (method === 'GET' && body) method = 'POST';

    const isDandanplayApi = url.includes('api.dandanplay.net') || url.includes('dandanplay');
    const shouldSendUserAgent = isDandanplayApi;

    const requestHeaders = {
        'Accept': 'application/json',
    };
    if (body) {
        requestHeaders['Content-Type'] = 'application/json';
    }
    if (shouldSendUserAgent) {
        requestHeaders['X-User-Agent'] = userAgent;
    }

    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    if (headers) Object.assign(requestHeaders, headers);

    if (ddSign.isProxiedOfficial(url)) {
        Object.assign(requestHeaders, await ddSign.buildHeaders(url));
    }

    const requestBody = body ? JSON.stringify(body) : null;


    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs || 30000;
    let timeoutFired = false;
    const timeoutId = setTimeout(() => {
        timeoutFired = true;
        controller.abort();
    }, timeoutMs);

    if (opts.signal) {
        if (opts.signal.aborted) {
            controller.abort();
        } else {
            opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
    }

    // 将控制器注册到全局集合，便于销毁时统一取消
    if (abortOnDestroy && window.ede?.abortControllers) {
        window.ede.abortControllers.add(controller);
    }

    const startTime = performance.now(); // 网络请求开始时间（用于测量耗时）
    try {
        const signal = controller.signal;

        // 发起请求（fetch resolves when response headers are received）
        const response = await fetch(url, {
            method,
            headers: requestHeaders,
            body: requestBody,
            signal: signal,
        });

        const ttfbMs = (performance.now() - startTime).toFixed(0); // time to first byte (近似: fetch resolve 时刻)

        // 读取 body（测量下载耗时）
        const downloadStart = performance.now();
        const responseText = await response.text();
        const downloadMs = (performance.now() - downloadStart).toFixed(0);
        const totalMs = (performance.now() - startTime).toFixed(0);

        // [优化] 从 URL 提取简短 API 路径名用于日志（不暴露完整 URL）
        const apiPath = (() => { try { return new URL(url).pathname.split('/').slice(-2).join('/'); } catch(e) { return method; } })();

        // 统一日志输出
        logger.debug(`[Network] ${apiPath} | status=${response.status} | ttfb=${ttfbMs}ms | download=${downloadMs}ms | total=${totalMs}ms`);

        if (!response.ok) {
            logger.warn(`[Network] ${apiPath} 错误响应 | status=${response.status} | total=${totalMs}ms`);
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        if (responseText?.length > 0) {
            try {
                return JSON.parse(responseText);
            } catch (parseError) {
                logger.warn('responseText is not JSON:', parseError);
            }
        }
        return { success: true };
    } catch (error) {
        clearTimeout(timeoutId);
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(0);
        const errPath = (() => { try { return new URL(url).pathname.split('/').slice(-2).join('/'); } catch(e) { return method; } })();

        if (error.name === 'AbortError') {
            // 区分是被组件销毁取消的(人为)，还是超时取消的
            if (timeoutFired) {
                logger.warn(`[Network] ${errPath} 请求超时或被中断 | duration=${duration}ms`);
            } else if (abortOnDestroy && window.ede?.lastLoadId?.toString().startsWith('DESTROYED')) {
                logger.debug(`[Network] ${errPath} 请求已因组件销毁而取消 | duration=${duration}ms`);
            } else {
                logger.warn(`[Network] ${errPath} 请求被中断 | duration=${duration}ms`);
            }
            throw error;
        }

        logger.error(`[Network] ${errPath} 异常 | duration=${duration}ms | error: ${error.message || error}`);
        throw error;
    } finally {
        // 统一在 finally 清理定时器，确保响应体读取全程受超时保护
        clearTimeout(timeoutId);
        // 请求结束（无论成功失败），从集合中移除控制器
        if (abortOnDestroy && window.ede?.abortControllers) {
            window.ede.abortControllers.delete(controller);
        }
        // 外部 signal 的监听器随控制器一起清理（AbortController 内部会处理），
        // 使用 { once: true } 确保监听器不会长期持有闭包引用
    }
}

    /**
     * 获取所有媒体库列表
     * @returns {Promise<Array<{id: string, name: string, collectionType: string}>>}
     */
    async function getAllLibraries() {
        try {
            const client = getHostApiClient();
            if (!client?.getCurrentUserId || !client.getUrl || !client.getJSON) return [];
            const userId = client.getCurrentUserId();
            // 通过 Views API 获取用户可见的媒体库
            const viewsUrl = client.getUrl(`Users/${userId}/Views`);
            const viewsResult = await client.getJSON(viewsUrl).catch(() => null);

            if (viewsResult && viewsResult.Items && viewsResult.Items.length > 0) {
                return viewsResult.Items.map(item => ({
                    id: item.Id,
                    name: item.Name,
                    collectionType: item.CollectionType || item.Type || ''
                }));
            }
        } catch (error) {
            logger.error('[dd-danmaku] 获取媒体库列表失败:', error);
        }
        return [];
    }

    /**
     * 获取当前播放项目所属的媒体库信息
     * 使用多种方法尝试获取，确保稳定性（兼容网盘/302反代用户）
     * 结果按 itemId 缓存（5分钟 TTL），同一集多次 loadDanmaku 只查一次 API
     * @param {Object} item - Emby item 对象
     * @returns {Promise<{libraryId: string, libraryName: string, collectionType: string}|null>}
     */
    const _libraryInfoCache = new Map(); // key: itemId → {result, timestamp}
    const _LIBRARY_CACHE_TTL = 5 * 60 * 1000; // 5 分钟 TTL，防止陈旧

    async function getItemLibraryInfo(item) {
        if (!item) return null;

        const cacheKey = item.Id;
        const cached = cacheKey && _libraryInfoCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < _LIBRARY_CACHE_TTL) {
            logger.debug('[dd-danmaku] libraryInfo 缓存命中:', cacheKey);
            return cached.result;
        }

        try {
            // 获取所有媒体库列表
            const libraries = await getAllLibraries();
            logger.info('[dd-danmaku] 媒体库列表:', libraries.map(l => ({ id: l.id, name: l.name })));
            if (!libraries || libraries.length === 0) {
                logger.warn('[dd-danmaku] 无法获取媒体库列表');
                return null;
            }

            // 通过 API 获取完整的 item 信息（包含 ParentId 等字段）
            const client = getHostApiClient();
            if (!client?.getCurrentUserId || !client.getUrl || !client.getJSON) return null;
            const userId = client.getCurrentUserId();
            const itemUrl = client.getUrl(`Users/${userId}/Items/${item.Id}`, {
                Fields: 'ParentId,Path,SeriesId,SeasonId,ProviderIds,LocationType'
            });
            const fullItem = await client.getJSON(itemUrl).catch(() => null) || item;

            logger.debug('[dd-danmaku] Item 完整信息:', {
                Id: fullItem.Id,
                Name: fullItem.Name,
                Type: fullItem.Type,
                ParentId: fullItem.ParentId,
                SeriesId: fullItem.SeriesId,
                SeasonId: fullItem.SeasonId,
                Path: fullItem.Path,
                LocationType: fullItem.LocationType
            });

            // 方法1: 通过 ParentId 递归查找媒体库
            let currentId = fullItem.SeriesId || fullItem.SeasonId || fullItem.ParentId;
            logger.debug('[dd-danmaku] 开始 ParentId 递归查找, 起始ID:', currentId);

            let maxDepth = 10;
            let lastFolderBeforeRoot = null; // 记录 root 之前的最后一个文件夹

            while (currentId && maxDepth > 0) {
                // 检查当前 ID 是否是媒体库
                const matchedLib = libraries.find(lib => lib.id === currentId);
                if (matchedLib) {
                    logger.info(`[dd-danmaku] 通过 ParentId 匹配到媒体库: ${matchedLib.name}`);
                    return {
                        libraryId: matchedLib.id,
                        libraryName: matchedLib.name,
                        collectionType: matchedLib.collectionType || ''
                    };
                }

                // 获取父级信息继续查找
                const parentUrl = client.getUrl(`Users/${userId}/Items/${currentId}`, {
                    Fields: 'ParentId,Name,Type,CollectionType'
                });
                const parentItem = await client.getJSON(parentUrl).catch(() => null);
                logger.debug('[dd-danmaku] 递归查找父级:', parentItem ? { Id: parentItem.Id, Name: parentItem.Name, ParentId: parentItem.ParentId, Type: parentItem.Type } : 'null');

                if (!parentItem) break;

                // 检查父级名称是否匹配媒体库名称
                const matchedByName = libraries.find(lib => lib.name === parentItem.Name);
                if (matchedByName) {
                    logger.info(`[dd-danmaku] 通过父级名称匹配到媒体库: ${matchedByName.name}`);
                    return {
                        libraryId: matchedByName.id,
                        libraryName: matchedByName.name,
                        collectionType: matchedByName.collectionType || ''
                    };
                }

                // 检查父级类型是否为 CollectionFolder（媒体库根目录）
                if (parentItem.Type === 'CollectionFolder' || parentItem.Type === 'UserView') {
                    logger.info(`[dd-danmaku] 找到媒体库根目录: ${parentItem.Name}`);
                    return {
                        libraryId: parentItem.Id,
                        libraryName: parentItem.Name,
                        collectionType: parentItem.CollectionType || ''
                    };
                }

                // 如果遇到 AggregateFolder (root)，使用之前记录的文件夹通过 VirtualFolders 匹配
                if (parentItem.Type === 'AggregateFolder') {
                    logger.debug('[dd-danmaku] 到达 AggregateFolder (root)，尝试通过 VirtualFolders 匹配');
                    if (lastFolderBeforeRoot) {
                        const vfResult = await matchLibraryByFolderName(lastFolderBeforeRoot.Name, libraries);
                        if (vfResult) return vfResult;
                    }
                    break;
                }

                // 记录当前文件夹（作为 root 之前的最后一个文件夹）
                if (parentItem.Type === 'Folder') {
                    lastFolderBeforeRoot = parentItem;
                }

                currentId = parentItem.ParentId;
                maxDepth--;
            }

            // 方法2: 通过 Path 路径匹配媒体库（适用于网盘/302反代用户）
            if (fullItem.Path) {
                logger.debug('[dd-danmaku] 尝试通过 Path 匹配媒体库, Path:', fullItem.Path);

                // 标准化 item 路径（统一使用正斜杠，转小写用于比较）
                const normalizedItemPath = fullItem.Path.replace(/\\/g, '/').toLowerCase();

                // 获取媒体库的路径信息（需要管理员权限，可能失败）
                try {
                    const virtualFoldersUrl = client.getUrl('Library/VirtualFolders');
                    const virtualFolders = await client.getJSON(virtualFoldersUrl).catch(() => null);

                    if (virtualFolders && virtualFolders.length > 0) {
                        logger.debug('[dd-danmaku] VirtualFolders:', virtualFolders.map(f => ({ Name: f.Name, Locations: f.Locations })));

                        for (const folder of virtualFolders) {
                            if (folder.Locations && folder.Locations.length > 0) {
                                for (const location of folder.Locations) {
                                    // 标准化媒体库路径
                                    const normalizedLocation = location.replace(/\\/g, '/').toLowerCase();

                                    // 检查 item 的 Path 是否以媒体库路径开头或包含媒体库路径
                                    if (normalizedItemPath.startsWith(normalizedLocation) ||
                                        normalizedItemPath.includes(normalizedLocation + '/') ||
                                        normalizedItemPath.includes('/' + normalizedLocation.split('/').pop() + '/')) {
                                        const matchedLib = libraries.find(lib => lib.name === folder.Name);
                                        if (matchedLib) {
                                            logger.info(`[dd-danmaku] 通过 Path 匹配到媒体库: ${matchedLib.name}`);
                                            return {
                                                libraryId: matchedLib.id,
                                                libraryName: matchedLib.name,
                                                collectionType: matchedLib.collectionType || ''
                                            };
                                        }
                                        // 即使在 libraries 中找不到，也返回 folder 信息
                                        logger.info(`[dd-danmaku] 通过 Path 匹配到媒体库 (VirtualFolder): ${folder.Name}`);
                                        return {
                                            libraryId: folder.ItemId || folder.Name,
                                            libraryName: folder.Name,
                                            collectionType: folder.CollectionType || ''
                                        };
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    logger.debug('[dd-danmaku] VirtualFolders API 失败 (可能需要管理员权限):', e);
                }

                // 方法3: 从 Path 中提取可能的媒体库名称（最后的回退方案）
                // 路径格式可能是: /媒体库名/子文件夹/文件名 或 D:\媒体库名\子文件夹\文件名
                const pathParts = fullItem.Path.replace(/\\/g, '/').split('/').filter(p => p);
                logger.debug('[dd-danmaku] Path 分段:', pathParts);

                // 尝试匹配路径中的每个部分与媒体库名称
                for (const part of pathParts) {
                    const matchedLib = libraries.find(lib =>
                        lib.name === part ||
                        lib.name.toLowerCase() === part.toLowerCase()
                    );
                    if (matchedLib) {
                        logger.info(`[dd-danmaku] 通过 Path 分段匹配到媒体库: ${matchedLib.name}`);
                        return {
                            libraryId: matchedLib.id,
                            libraryName: matchedLib.name,
                            collectionType: matchedLib.collectionType || ''
                        };
                    }
                }
            }

            logger.warn('[dd-danmaku] 无法匹配到媒体库');
        } catch (error) {
            logger.warn('[dd-danmaku] 获取媒体库信息失败:', error);
        }

        _cacheLibraryInfo(item.Id, null);
        return null;
    }

    // 内部辅助：写入 libraryInfo 缓存
    function _cacheLibraryInfo(itemId, result) {
        if (itemId) _libraryInfoCache.set(itemId, { result, timestamp: Date.now() });
        return result;
    }

    /**
     * 通过文件夹名称匹配媒体库（使用 VirtualFolders API）
     * 适用于媒体库名称与实际文件夹名称不同的情况
     * @param {string} folderName - 文件夹名称
     * @param {Array} libraries - 媒体库列表
     * @returns {Promise<Object|null>}
     */
    async function matchLibraryByFolderName(folderName, libraries) {
        try {
            const client = getHostApiClient();
            if (!client?.getUrl || !client.getJSON) return null;
            const virtualFoldersUrl = client.getUrl('Library/VirtualFolders');
            const virtualFolders = await client.getJSON(virtualFoldersUrl).catch(() => null);

            if (virtualFolders && virtualFolders.length > 0) {
                logger.debug('[dd-danmaku] VirtualFolders:', virtualFolders.map(f => ({ Name: f.Name, Locations: f.Locations, ItemId: f.ItemId })));

                for (const folder of virtualFolders) {
                    if (folder.Locations && folder.Locations.length > 0) {
                        for (const location of folder.Locations) {
                            // 标准化路径并检查是否包含文件夹名称
                            const normalizedLocation = location.replace(/\\/g, '/');
                            const locationParts = normalizedLocation.split('/').filter(p => p);
                            const lastPart = locationParts[locationParts.length - 1];

                            // 检查路径最后一部分是否匹配文件夹名称
                            if (lastPart === folderName || lastPart.toLowerCase() === folderName.toLowerCase()) {
                                const matchedLib = libraries.find(lib => lib.name === folder.Name);
                                if (matchedLib) {
                                    logger.debug(`[dd-danmaku] 通过 VirtualFolders 匹配到媒体库: ${matchedLib.name} (文件夹: ${folderName})`);
                                    return {
                                        libraryId: matchedLib.id,
                                        libraryName: matchedLib.name,
                                        collectionType: matchedLib.collectionType || ''
                                    };
                                }
                                // 即使在 libraries 中找不到，也返回 folder 信息
                                logger.debug(`[dd-danmaku] 通过 VirtualFolders 匹配到媒体库: ${folder.Name} (文件夹: ${folderName})`);
                                return {
                                    libraryId: folder.ItemId || folder.Name,
                                    libraryName: folder.Name,
                                    collectionType: folder.CollectionType || ''
                                };
                            }
                        }
                    }
                }
            }
        } catch (e) {
            logger.debug('[dd-danmaku] VirtualFolders API 失败:', e);
        }
        return null;
    }

    /**
     * 检查当前媒体库是否在排除列表中
     * @param {Object} libraryInfo - 媒体库信息
     * @returns {boolean} - true 表示应该禁用弹幕
     */
    function isLibraryExcluded(libraryInfo) {
        if (!libraryInfo) return false;

        const excludedLibraries = lsGetItem(lsKeys.excludedLibraries.id) || [];
        if (excludedLibraries.length === 0) return false;

        // 检查媒体库名称是否在排除列表中
        const isExcluded = excludedLibraries.some(excluded => excluded === libraryInfo.libraryName);
        logger.info(`[dd-danmaku] 检查媒体库排除: "${libraryInfo.libraryName}" 在排除列表 [${excludedLibraries.join(', ')}] 中: ${isExcluded}`);
        return isExcluded;
    }

    async function getMapByEmbyItemInfo() {
        // 防止旧请求在切集后回写播放条目标识。
        const playbackKey = manualDanmakuKey(window.ede?.itemId);
        let item = await getEmbyItemInfo();
        if (!item) {
            item = await fatchEmbyItemInfo(window.ede.itemId);
        }
        if (!item || playbackKey !== manualDanmakuKey(window.ede?.itemId)) return null;
        if (!['Episode', 'Movie'].includes(item.Type)) {
            return logger.error('不支持的类型');
        }

        const libraryInfo = await getItemLibraryInfo(item);
        if (playbackKey !== manualDanmakuKey(window.ede?.itemId)) return null;
        if (libraryInfo) {
            logger.info(`[dd-danmaku] 媒体库信息 - ID: ${libraryInfo.libraryId}, 名称: ${libraryInfo.libraryName}, 类型: ${libraryInfo.collectionType}`);
            window.ede.currentLibraryInfo = libraryInfo;
        }

        window.ede.itemId = item.Id;
        let _id;
        let animeName;
        let animeId = -1;
        let episode;
        if (item.Type === 'Episode') {
            _id = item.SeasonId;
            const seriesName = item.SeriesName;
            const seasonNumber = item.ParentIndexNumber;
            const episodeNumber = item.IndexNumber;
            episode = episodeNumber;
            if (seasonNumber !== undefined && episodeNumber !== undefined) {
                animeName = `${seriesName} S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
            } else {
                animeName = seriesName + (seasonNumber && seasonNumber !== 1 ? ` ${seasonNumber}` : '');
            }
        } else {
            _id = item.Id;
            animeName = item.Name;
            episode = 'movie';
        }
        let _id_key = lsLocalKeys.animePrefix + _id;
        let _season_key = lsLocalKeys.animeSeasonPrefix + _id;
        const seasonId = item.SeasonId || '';
        let _episode_key = lsLocalKeys.animeEpisodePrefix + _id + '_' + seasonId + '_' + episode;
        if (window.localStorage.getItem(_id_key)) {
            animeId = window.localStorage.getItem(_id_key);
        }
        // 检查是否需要重新获取完整的item信息
        if (!item.MediaSources || item.MediaSources.length === 0) {
            logger.debug(`[Stream] MediaSources为空，通过API重新获取完整信息...`);
            try {
                const fullItem = await fatchEmbyItemInfo(item.Id);
                if (fullItem && fullItem.MediaSources && fullItem.MediaSources.length > 0) {
                    item = fullItem;
                    logger.debug(`[Stream] 重新获取成功，MediaSources数量: ${item.MediaSources.length}`);
                } else {
                    logger.warn(`[Stream] 重新获取失败或仍无MediaSources`);
                }
            } catch (error) {
                logger.error(`[Stream] 重新获取item信息失败:`, error);
            }
        }

        const mediaSource = item.MediaSources && item.MediaSources[0];
        logger.debug(`[Stream] 最终MediaSources数量: ${item.MediaSources ? item.MediaSources.length : 0}`);

        // 参考embyToLocalPlayer项目的方式构建流媒体URL
        let streamUrl = null;
        if (mediaSource) {
            const client = getHostApiClient();
            if (!client?.deviceId || !client.accessToken || !client.serverAddress) return null;
            const itemId = item.Id;
            const mediaSourceId = mediaSource.Id;
            const deviceId = client.deviceId();
            const apiKey = client.accessToken();
            const serverAddress = client.serverAddress();

            // 检测是否为Emby服务器
            const isEmby = serverAddress.includes('/emby/') || String(client.appName?.() || '').toLowerCase().includes('emby');
            const extraStr = isEmby ? '/emby' : '';

            // 构建流媒体URL，参考embyToLocalPlayer的方式
            const container = item.Path ? item.Path.split('.').pop() : 'mkv';
            streamUrl = `${serverAddress}${extraStr}/videos/${itemId}/stream?DeviceId=${deviceId}&MediaSourceId=${mediaSourceId}&api_key=${apiKey}&Static=true&Container=${container}`;

            logger.debug(`[Stream] 认证信息 - ApiKey: ${apiKey ? '已获取' : '未获取'}, DeviceId: ${deviceId ? '已获取' : '未获取'}`);
        } else {
            logger.warn(`[Stream] 无MediaSource，无法构建流媒体URL`);
        }

        const map = {
            _id: _id,
            _id_key: _id_key,
            _season_key: _season_key,
            _episode_key: _episode_key,
            animeId: animeId,
            episode: episode, // this is episode index, not a program index
            animeName: animeName,
            seriesName: item.SeriesName || item.Name || '',   // [新增] 系列名称，供集数偏移规则匹配
            seasonNumber: item.ParentIndexNumber || null,     // [新增] 季号，供集数偏移规则匹配
            seriesOrMovieId: item.SeriesId || item.Id,
            // 新增：提取匹配所需的文件信息
            streamUrl: streamUrl,
            size: mediaSource?.Size,
            duration: (mediaSource?.RunTimeTicks || 0) / 10000000, // Ticks to seconds
        };
        return map;
    }

    // 通过缓存中的剧集名称与偏移量进行匹配
    async function lsSeasonSearchEpisodes(_season_key, episode) {
        const seasonInfoListStr = window.localStorage.getItem(_season_key);
        if (!seasonInfoListStr) {
            return null;
        }
        const seasonInfoList = JSON.parse(seasonInfoListStr);
        let minPositiveDiff = Infinity;
        let selectedSeasonInfo = null;
        for (let i = 0; i < seasonInfoList.length; i++) {
            const seasonInfo = seasonInfoList[i];
            const adjustedEpisode = episode + seasonInfo.episodeOffset;
            if (adjustedEpisode > 0 && adjustedEpisode < minPositiveDiff) {
                minPositiveDiff = adjustedEpisode;
                selectedSeasonInfo = seasonInfo;
            }
        }
        if (selectedSeasonInfo) {
            const newEpisode = episode + selectedSeasonInfo.episodeOffset;
            logger.info(`命中seasonInfo缓存: ${selectedSeasonInfo.name},偏移量: ${selectedSeasonInfo.episodeOffset},集: ${newEpisode}`);
            const animaInfo = await fetchSearchEpisodes(selectedSeasonInfo.name, newEpisode);
            return { animaInfo, newEpisode, };
        }
        return null;
    }

    async function autoFailback(animeName, episodeIndex, seriesOrMovieId) {
        logger.info(`自动匹配未查询到结果,可能为非番剧,将移除章节过滤,重试一次`);
        let animaInfo = await fetchSearchEpisodes(animeName);
        if (animaInfo.animes.length > 0) {
            logger.debug(`移除章节过滤,自动匹配成功,转换为目标章节索引 0`);
            if (isNaN(episodeIndex)) { episodeIndex = 0; }
            // const episodeInfo = animaInfo.animes[0].episodes[episodeIndex - 1 ?? 0];
            const episodeInfo = animaInfo.animes[0].episodes[episodeIndex];
            if (!episodeInfo) {
                return null;
            }
            animaInfo.animes[0].episodes = [episodeInfo];
            return { animeName, animaInfo, };
        }
        // from: https://github.com/Izumiko/jellyfin-danmaku/blob/jellyfin/ede.js#L886
        const seriesOrMovieInfo = await fatchEmbyItemInfo(seriesOrMovieId);
        if (!seriesOrMovieInfo.OriginalTitle) { return null; }
        logger.info(`标题名: ${animeName},自动匹配未查询到结果,将使用原标题名,重试一次`);
        const animeOriginalTitle = seriesOrMovieInfo.OriginalTitle;
        animaInfo = await fetchSearchEpisodes(animeOriginalTitle, episodeIndex);
        if (animaInfo.animes.length < 1) { return null; }
        logger.info(`使用原标题名: ${animeOriginalTitle},自动匹配成功`);
        return { animeName, animeOriginalTitle, animaInfo, };
    }

    // --- 替换后的 calculateFileHash (使用 Worker) ---
    // 单飞缓存：同一 streamUrl+size 组合只计算一次哈希，第二次调用直接复用 Promise
    const _fileHashCache = new Map(); // key: `${streamUrl}:${fileSize}` → Promise<string|null>
    async function calculateFileHash(streamUrl, fileSize) {
        if (!streamUrl || !fileSize) {
            logger.warn('缺少 streamUrl 或 fileSize，无法计算哈希。');
            return null;
        }
        const cacheKey = `${streamUrl}:${fileSize}`;
        if (_fileHashCache.has(cacheKey)) {
            logger.debug('[Hash] 复用已缓存的哈希计算结果');
            return _fileHashCache.get(cacheKey);
        }

        // [修复 #191] strm/302/网盘用户预检：先用 HEAD 请求探测是否可访问
        // 如果 streamUrl 会被 302 重定向到外部 CDN（如 115/阿里云盘），fetch 必定 CORS 失败
        // 提前探测可以避免不必要的下载等待和 Worker 创建
        try {
            const probeRes = await fetch(streamUrl, { method: 'HEAD', mode: 'cors' });
            if (!probeRes.ok && probeRes.status !== 206) {
                logger.warn(`[Hash] 预检失败 (${probeRes.status})，可能是 strm/网盘 302 重定向，跳过哈希计算`);
                _fileHashCache.delete(cacheKey); // 预检失败，移除占位
                return null;
            }
        } catch (probeError) {
            // CORS 或网络错误 → 大概率是 strm/302 用户
            logger.warn('[Hash] 预检 CORS/网络错误，跳过哈希计算:', probeError.message);
            _fileHashCache.delete(cacheKey); // 预检失败，移除占位
            return null;
        }

        const hashPromise = new Promise(async (resolve, reject) => {
            const worker = createWorker(md5WorkerBody, {
                '__SPARK_MD5_URL__': requireSparkMD5Path
            });
            worker.onmessage = (e) => {
                if (e.data.success) {
                    logger.debug(`[Hash-Worker] 计算完成: ${e.data.hash}`);
                    resolve(e.data.hash);
                    worker.terminate();
                }
            };
            worker.onerror = (err) => {
                logger.error("[Hash-Worker] Error:", err);
                worker.terminate();
                resolve(null);
            };
            worker.postMessage({ type: 'INIT' });

            const authHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'identity'
            };
            const CHUNK_SIZE = 16 * 1024 * 1024;

            try {
                if (fileSize < CHUNK_SIZE * 2) {
                    logger.debug(`[Hash] 文件较小，下载全量计算...`);
                    const response = await fetch(streamUrl, { headers: authHeaders });
                    if (!response.ok) throw new Error(`Fetch error: ${response.status}`);
                    const buffer = await response.arrayBuffer();
                    worker.postMessage({ type: 'APPEND', chunk: buffer, isLast: true }, [buffer]);
                } else {
                    logger.debug(`[Hash] 文件较大，下载头尾分片计算...`);
                    const headRes = await fetch(streamUrl, {
                        headers: { ...authHeaders, 'Range': `bytes=0-${CHUNK_SIZE - 1}` }
                    });
                    const headBuffer = await headRes.arrayBuffer();
                    worker.postMessage({ type: 'APPEND', chunk: headBuffer, isLast: false }, [headBuffer]);

                    const tailRes = await fetch(streamUrl, {
                        headers: { ...authHeaders, 'Range': `bytes=${fileSize - CHUNK_SIZE}-${fileSize - 1}` }
                    });
                    const tailBuffer = await tailRes.arrayBuffer();
                    worker.postMessage({ type: 'APPEND', chunk: tailBuffer, isLast: true }, [tailBuffer]);
                }
            } catch (error) {
                logger.error('[Hash] 下载或通信失败:', error);
                worker.terminate();
                resolve(null);
            }
        });
        _fileHashCache.set(cacheKey, hashPromise);
        // 计算完成后（成功或失败）都从缓存中移除，避免失败结果被后续集复用
        hashPromise.then(() => _fileHashCache.delete(cacheKey)).catch(() => _fileHashCache.delete(cacheKey));
        return hashPromise;
    }

    /**
     * 解析 "XXXX SXXEXX" 格式的标题
     * @param {string} animeName - 完整的动画标题
     * @returns {{title: string, season: number|null, episode: number|null}}
     */
    function parseAnimeName(animeName) {
        const match = animeName.match(/^(.*?)\s*[Ss](\d{1,2})[Ee](\d{1,4})\b/);
        if (match) {
            return {
                title: match[1].replace(/[\._]/g, ' ').trim(),
                season: parseInt(match[2], 10),
                episode: parseInt(match[3], 10)
            };
        }
        // 如果不匹配，返回原始标题和null
        return {
            title: animeName,
            season: null,
            episode: null
        };
    }

    // DLL 按源优先级串行处理；当前源成功即短路，不混合低优先级源的候选。
    async function collectBackendRound(itemInfoMap, configs, priority, payload, mappings, isCurrent) {
        for (const sourceId of [...new Set(priority)]) {
            const config = configs[sourceId];
            if (!config?.enabled || !config.prefix) continue;
            if (!isCurrent()) return null;
            try {
                const result = await resolveBackendSource(itemInfoMap, configs, [sourceId], payload, mappings, isCurrent);
                if (!isCurrent()) return null;
                if (result) return result;
            } catch (error) {
                logger.warn(`[自动匹配] 来源 ${config.name} 判断失败，继续下一来源`);
            }
        }
        return null;
    }

    // 单源先处理精确结果；只有未确认的候选才提交 DLL。
    async function resolveBackendSource(itemInfoMap, configs, priority, payload, mappings, isCurrent) {
        const entries = new Map();
        const { animeName, episode, seasonNumber, seriesOrMovieId } = itemInfoMap;
        const base = parseAnimeName(animeName).title || animeName;
        for (const sourceId of [...new Set(priority)]) {
            const config = configs[sourceId];
            if (!config?.enabled || !config.prefix) continue;
            if (!isCurrent()) return null;
            const add = (animes, mapping, direct = false) => {
                const filtered = direct && sourceId === 'official'
                    ? applyEpisodeBlacklist(animes || []) : applySearchBlacklist(animes || [], true, sourceId);
                for (const candidate of filtered) {
                    const identity = candidate.animeId ?? candidate.bangumiId;
                    // 无作品标识时用完整标题及已知元数据去重，不混用不同源的编号。
                    const key = JSON.stringify([sourceId, identity == null
                        ? [candidate.animeTitle ?? candidate.title, candidate.seasonNumber, candidate.year] : String(identity)]);
                    const existing = entries.get(key);
                    if (!existing) entries.set(key, { candidate: { ...candidate }, sourceId, config, mapping, direct });
                    else {
                        // 同作品只补齐明确缺失的元数据，不覆盖首次匹配分集，也不推测季度。
                        for (const field of ['animeTitle', 'title', 'seasonNumber', 'year', 'productionYear',
                            'mediaType', 'type', 'typeDescription', 'aliases', 'providerIds', 'imageUrl', 'episodes']) {
                            const value = existing.candidate[field];
                            if (value == null || value === '' || (Array.isArray(value) && !value.length)) {
                                if (candidate[field] != null) existing.candidate[field] = candidate[field];
                            }
                        }
                    }
                }
            };
            const search = async (title, mapping) => {
                if (!isCurrent()) return;
                const url = `${config.prefix}/search/anime?keyword=${encodeURIComponent(title)}`;
                const headers = await buildCustomApiSignHeaders(config.appId, config.appSecret, url);
                if (!isCurrent()) return;
                const response = await fetchJson(url, Object.keys(headers).length ? { headers } : {}).catch(() => null);
                if (isCurrent()) add(response?.animes, mapping);
            };
            try {
                if (payload) {
                    // 单个源的 /match 失败不妨碍继续收集它的标题搜索结果。
                    const response = await fetchMatchApi(payload, config.prefix, config.appId, config.appSecret).catch(() => null);
                    if (!isCurrent()) return null;
                    // 精确标记不等于候选数组；沿用 1.3.0 黑名单与标题二次校验。
                    const matches = sourceId === 'official'
                        ? applyEpisodeBlacklist(response?.animes || [])
                        : applySearchBlacklist(response?.animes || [], true, sourceId);
                    const exact = matches[0];
                    const directId = exact?.episodeId ?? exact?.matchedEpisodeId;
                    if (response?.isMatched === true && exact && directId != null) {
                        const similarity = calculateStringSimilarity(normalizeTitle(animeName), normalizeTitle(exact.animeTitle || ''));
                        if (similarity >= 0.4) {
                            logger.info(`[自动匹配] 来源 ${config.name} 精确命中，二次验证通过，跳过后端匹配`);
                            const episodeInfo = { ...exact, episodeId: directId,
                                episodeTitle: exact.episodeTitle ?? exact.matchedEpisodeTitle };
                            return { apiExactMatched: true, directMatch: true,
                                episodeInfo: { ...episodeInfo, episodes: [episodeInfo] },
                                apiPrefix: config.prefix, apiName: config.name,
                                apiAppId: config.appId || '', apiAppSecret: config.appSecret || '' };
                        }
                        logger.warn(`[自动匹配] 来源 ${config.name} 精确结果未通过标题二次校验，转候选判断`);
                    }
                    add(matches, { season: seasonNumber, episode }, true);
                }
                const beforeSearch = entries.size;
                const searched = new Set();
                for (const mapping of mappings) {
                    const season = mapping.season ?? seasonNumber;
                    const title = season > 1 ? `${base} 第${season}季` : base;
                    if (searched.has(title)) continue;
                    searched.add(title);
                    await search(title, mapping);
                    if (!isCurrent()) return null;
                }
                if (entries.size === beforeSearch) {
                    if (!searched.has(animeName)) await search(animeName, mappings[0]);
                    if (!isCurrent()) return null;
                    const work = await fatchEmbyItemInfo(seriesOrMovieId).catch(() => null);
                    if (work?.OriginalTitle && !searched.has(work.OriginalTitle)) await search(work.OriginalTitle, mappings[0]);
                }
            } catch (error) {
                logger.warn(`[自动匹配] 来源 ${config.name} 收集失败，保留其他来源候选`);
            }
        }
        if (!isCurrent() || !entries.size) return null;
        // 前端仅执行协议安全硬上限，AI 的可调上限由 DLL 独立检查。
        if (entries.size > 1000) {
            logger.warn(`[后端匹配] 当前源作品 ${entries.size} 个，超过 1000 个上限；未截断、未拆分提交`);
            embyToast({ text: '作品候选超过1000个，请缩小搜索范围或手动选择来源' });
            return null;
        }
        const origins = [...entries.values()];
        const candidates = origins.map(entry => entry.candidate);
        // sourceId 回调仅用于协议映射；不向 DLL 或 AI 发送源地址、AppId、密钥。
        const match = await resolveBackendCandidates(animeName, episode, seasonNumber,
            candidates, index => origins[index].sourceId, isCurrent);
        if (!isCurrent() || !match?.selected) return null;
        const origin = origins[candidates.indexOf(match.selected)];
        const { candidate, config, mapping, direct } = origin;
        let selectedEpisode = direct ? { episodeId: candidate.episodeId ?? candidate.matchedEpisodeId,
            episodeTitle: candidate.episodeTitle ?? candidate.matchedEpisodeTitle } : null;
        if (selectedEpisode?.episodeId == null) {
            let episodes = candidate.episodes;
            const id = candidate.bangumiId ?? candidate.animeId;
            if (id != null) {
                const url = `${config.prefix}/bangumi/${encodeURIComponent(id)}`;
                const headers = await buildCustomApiSignHeaders(config.appId, config.appSecret, url);
                if (!isCurrent()) return null;
                const detail = await fetchJson(url, Object.keys(headers).length ? { headers } : {}).catch(() => null);
                episodes = detail?.bangumi?.episodes ?? detail?.episodes ?? episodes;
            }
            if (!isCurrent()) return null;
            // 电影标记不是集号：单条正文直接采用，多条不明确时交给用户确认。
            if (episode === 'movie') {
                selectedEpisode = episodes?.length === 1 ? episodes[0] : null;
                if (!selectedEpisode) logger.warn(`[后端匹配] 来源 ${config.name} 作品已确认，但电影分集不唯一或为空，请手动选择`);
            } else {
                selectedEpisode = findBestEpisode(episodes, mapping?.episode ?? episode);
                if (!selectedEpisode && !episode && episodes?.length === 1) selectedEpisode = episodes[0];
            }
        }
        if (!isCurrent() || selectedEpisode?.episodeId == null) return null;
        // 每个源的候选仅提交一次；成功后外层循环不再请求低优先级源。
        logger.info(`[后端匹配] 当前源一次判断完成，采用来源=${config.name}`);
        return { backendResolved: true, directMatch: true,
            episodeInfo: { ...candidate, ...selectedEpisode, episodes: [selectedEpisode] },
            apiPrefix: config.prefix, apiName: config.name,
            apiAppId: config.appId || '', apiAppSecret: config.appSecret || '' };
    }

    // --- 优化：串行请求 (节省流量) & 耗时日志 ---
    async function searchEpisodes(itemInfoMap, isCurrent = () => true) {
        // [日志优化] 生成匹配流程唯一 ID
        const matchId = Date.now().toString(36).slice(-6);

        // 每次开始搜索前重新确认当前会话的 DLL 能力；在线时后续候选必须先交给后端判断。
        const backendState = await ddBackend.prepare();
        // 初始化等待期间任务也可能被手动选择或切集淘汰。
        if (!isCurrent()) return null;
        const backendOnline = Boolean(backendState && ddBackend.isDll());
        logger.info(`[匹配 #${matchId}] DLL 后端状态：${backendOnline ? '在线，启用后端匹配' : '不可用，使用纯 JS 流程'}`);

        const { animeName, episode, seriesOrMovieId, streamUrl, size, duration, seriesName, seasonNumber } = itemInfoMap;
        logger.debug(`[匹配 #${matchId}] searchEpisodes调用 - streamUrl: ${streamUrl ? '已获取' : '未获取'}, size: ${size}, duration: ${duration}`);
        const startTime = performance.now();

        // [新增] 手动集数偏移规则 - 优先级最高
        let seasonEpisodeCandidates = [{ season: null, episode: episode }]; // 候选列表，默认包含原始集数
        const offsetRules = lsGetItem(lsKeys.episodeOffsetRules.id) || [];
        if (offsetRules.length > 0 && seriesName && seasonNumber) {
            const matchedRule = offsetRules.find(rule =>
                rule.seriesName && seriesName.includes(rule.seriesName) &&
                rule.fromSeason === seasonNumber
            );
            if (matchedRule) {
                const mappedEpisode = episode + (matchedRule.episodeOffset || 0);
                logger.info(`[匹配 #${matchId}] [手动偏移] 命中规则: "${matchedRule.seriesName}" S${String(seasonNumber).padStart(2, '0')}E${String(episode).padStart(2, '0')} → S${String(matchedRule.toSeason).padStart(2, '0')}E${String(mappedEpisode).padStart(2, '0')} (偏移: ${matchedRule.episodeOffset >= 0 ? '+' : ''}${matchedRule.episodeOffset})`);
                seasonEpisodeCandidates.unshift({ season: matchedRule.toSeason, episode: mappedEpisode });
            }
        }

        // [新增] TMDB Episode Mapper 集成 - 双向匹配策略（季集格式）
        const itemId = window.ede?.itemId;
        if (itemId && episode) {
            try {
                const mappingResult = await getEpisodeMappingForCurrentItem(itemId);
                if (mappingResult && mappingResult.mapping) {
                    const currentSeason = mappingResult.currentSeason || 1;
                    const mappedSeasonEpisode = convertSeasonEpisode(currentSeason, episode, mappingResult.mapping);
                    if (mappedSeasonEpisode && (mappedSeasonEpisode.season !== currentSeason || mappedSeasonEpisode.episode !== episode)) {
                        // 优先使用映射后的季集作为第一候选
                        seasonEpisodeCandidates = [
                            { season: mappedSeasonEpisode.season, episode: mappedSeasonEpisode.episode }, // 第一候选：映射后
                            { season: currentSeason, episode: episode } // 第二候选：原始（备用）
                        ];
                        logger.info(`[匹配 #${matchId}] [集数映射] 双向匹配: S${String(currentSeason).padStart(2, '0')}E${String(episode).padStart(2, '0')} <-> S${String(mappedSeasonEpisode.season).padStart(2, '0')}E${String(mappedSeasonEpisode.episode).padStart(2, '0')}`);
                    }
                }
            } catch (error) {
                logger.error('[集数映射] 映射过程出错，使用原始集数:', error);
            }
        }

        // 读取用户定义的API优先级
        const apiPriority = lsGetItem(lsKeys.apiPriority.id);
        // 构建API配置，支持多个自定义源（新数据结构）
        const customApiList = getCustomApiList();
        const apiConfigs = {
            official: { name: '弹弹play', prefix: corsProxy + 'https://api.dandanplay.net/api/v2', enabled: lsGetItem(lsKeys.useOfficialApi.id) },
        };
        // 为每个启用的自定义源创建配置
        if (lsGetItem(lsKeys.useCustomApi.id) && customApiList.length > 0) {
            customApiList.forEach((item, index) => {
                if (item.enabled) {
                    apiConfigs[`custom_${index}`] = { name: item.name || `自定义源${index + 1}`, prefix: normalizeCustomApiPrefix(item.url, item.appId, item.appSecret), enabled: true, appId: item.appId || "", appSecret: item.appSecret || "" };
                }
            });
        }

        // 构建优先级队列
        const actualPriority = [];
        for (const key of apiPriority) {
            if (key === 'official') actualPriority.push('official');
            else if (key === 'custom') customApiList.forEach((item, i) => item.enabled && actualPriority.push(`custom_${i}`));
        }

        // 读取 /match 接口开关和匹配模式
        const matchApiEnabled = lsGetItem(lsKeys.matchApiEnable.id);
        const userMatchMode = lsGetItem(lsKeys.matchMode.id);
        const useHash = matchApiEnabled && userMatchMode === 'hashAndFileName';

        // 准备 /match 接口的请求体 (仅在启用时才需要)
        let matchPayload = null;
        if (matchApiEnabled) {
            const FALLBACK_HASH = 'a1b2c3d4e5f67890abcd1234ef567890';
            let fileHash = FALLBACK_HASH;

            if (useHash && streamUrl && size > 0) {
                logger.info(`[匹配 #${matchId}] 匹配模式: 哈希+文件名, 正在计算文件哈希...`);
                fileHash = await calculateFileHash(streamUrl, size) || FALLBACK_HASH;
                if (fileHash === FALLBACK_HASH) {
                    logger.warn(`[匹配 #${matchId}] 文件哈希计算失败, 已回退文件名匹配`);
                } else {
                    logger.info(`[匹配 #${matchId}] 文件哈希计算成功: ${fileHash}`);
                }
            } else if (useHash) {
                logger.warn(`[匹配 #${matchId}] 匹配模式: 哈希+文件名, 但缺少 streamUrl 或 size, 使用假哈希`);
            } else {
                logger.info(`[匹配 #${matchId}] 匹配模式: 仅文件名 (跳过哈希计算)`);
            }

            matchPayload = {
                fileName: animeName,
                fileHash: fileHash,
                fileSize: size || 0,
                videoDuration: Math.floor(duration || 0),
                matchMode: useHash ? 'hashAndFileName' : 'fileNameOnly'
            };
        } else {
            logger.info(`[匹配 #${matchId}] /match 接口已关闭, 将直接使用 /search/episodes 接口`);
        }

        // DLL 路径到此分流，绝不再进入下面逐源提交的旧流程。
        if (!isCurrent()) return null;
        if (backendOnline) return collectBackendRound(itemInfoMap, apiConfigs,
            actualPriority, matchPayload, seasonEpisodeCandidates, isCurrent);
        logger.info(`[自动匹配] 开始串行搜索... 目标: ${animeName}`);

        // --- 3. 串行执行逻辑 (回归) ---
        for (const apiKey of actualPriority) {
            const config = apiConfigs[apiKey];
            // 跳过未启用或配置错误的源
            if (!config?.enabled || !config?.prefix) continue;

            logger.info(`[自动匹配] 正在尝试源: ${config.name}...`);
            const providerStart = performance.now();

            try {
                let result = null;

                // A. 尝试 /match 接口 (仅在启用时调用)
                if (matchApiEnabled && matchPayload) {
                const matchResult = await fetchMatchApi(matchPayload, config.prefix, config.appId, config.appSecret);

                // [黑名单] 对官方 API 的 match 结果应用分集黑名单过滤
                if (apiKey === 'official' && matchResult?.animes?.length > 0) {
                    matchResult.animes = applyEpisodeBlacklist(matchResult.animes);
                }

                // DLL 模式只把候选交给后端判断，禁止前端再次绕过策略自行挑选。
                const backendMatch = backendOnline && matchResult?.animes?.length > 0
                    ? await resolveBackendCandidates(animeName, episode, seasonNumber, matchResult.animes, apiKey)
                    : null;
                if (backendMatch) {
                    if (backendMatch.status === 'matched' && backendMatch.selected) {
                        const selected = backendMatch.selected;
                        // /match 自身已有具体分集时沿用它；作品列表形态不能伪装成直接分集。
                        const directId = selected.episodeId ?? selected.matchedEpisodeId;
                        result = { apiPrefix: config.prefix, apiName: config.name,
                            backendResolved: true,
                            apiAppId: config.appId || '', apiAppSecret: config.appSecret || '',
                            ...(directId != null ? { directMatch: true, episodeInfo: { ...selected,
                                episodeId: directId,
                                episodeTitle: selected.episodeTitle ?? selected.matchedEpisodeTitle,
                                episodes: [{ episodeId: directId, episodeTitle: selected.episodeTitle ?? selected.matchedEpisodeTitle }] } }
                                : { animaInfo: { animes: [selected] } }) };
                        logger.info(`[自动匹配] DLL 后端匹配成功：status=matched，来源=${config.name}`);
                    } else {
                        logger.info(`[自动匹配] DLL 后端匹配未自动采用：status=${backendMatch.status || 'unknown'}`);
                    }
                }

                // [改造6] A1. 精确匹配：isMatched: true 时做二次验证
                if (!backendOnline && !result && matchResult?.isMatched && matchResult?.animes?.length > 0) {
                    const match = matchResult.animes[0];
                    // 二次验证：检查标题相似度是否合理
                    const similarity = calculateStringSimilarity(
                        normalizeTitle(animeName),
                        normalizeTitle(match.animeTitle || '')
                    );
                    if (similarity >= 0.4) {
                        result = { directMatch: true, apiPrefix: config.prefix, apiName: config.name, apiAppId: config.appId || '', apiAppSecret: config.appSecret || '', episodeInfo: { ...match, episodes: [{ episodeId: match.episodeId, episodeTitle: match.episodeTitle }], imageUrl: match.imageUrl } };
                        logger.info(`[自动匹配] /match 精确命中，二次验证通过 (相似度: ${similarity.toFixed(2)})`);
                    } else {
                        // 相似度太低，降级为模糊匹配处理
                        logger.warn(`[自动匹配] /match 声称精确匹配但标题不够像 ("${animeName}" vs "${match.animeTitle}", 相似度: ${similarity.toFixed(2)})，降级处理`);
                        const bestMatch = selectBestMatch(animeName, matchResult.animes, null, 0.3);
                        if (bestMatch) {
                            result = { directMatch: true, apiPrefix: config.prefix, apiName: config.name, apiAppId: config.appId || '', apiAppSecret: config.appSecret || '', episodeInfo: { ...bestMatch, episodes: [{ episodeId: bestMatch.episodeId || bestMatch.matchedEpisodeId, episodeTitle: bestMatch.episodeTitle || bestMatch.matchedEpisodeTitle }], imageUrl: bestMatch.imageUrl } };
                        }
                    }
                }
                // A2. 模糊匹配：isMatched: false 时，用改造后的智能匹配
                else if (!backendOnline && !result && matchResult?.animes?.length > 0) {
                    const bestMatch = selectBestMatch(animeName, matchResult.animes, null, 0.3);
                    if (bestMatch) {
                        // [修复] 季度守卫：如果搜索标题明确包含季度信息，但选出的最佳候选季度不匹配
                        // 说明 /match 返回的候选中没有正确季度的条目，不应采纳，让 /search 路径兜底
                        const parsedAnim = parseAnimeName(animeName);
                        const bestParsed = parseCandidateTitle(bestMatch.animeTitle);
                        const bestSeason = bestParsed.season || detectSeasonFromTitle(bestMatch.animeTitle, normalizeTitle(parsedAnim.title));
                        if (parsedAnim.season && parsedAnim.season > 1 && bestSeason && bestSeason !== parsedAnim.season) {
                            logger.warn(`[自动匹配] /match 模糊结果季度不匹配 (期望: S${String(parsedAnim.season).padStart(2,'0')}, 选中: "${bestMatch.animeTitle}" → S${String(bestSeason).padStart(2,'0')})，放弃 /match 结果，转 /search`);
                            // 不设置 result，让流程 fall through 到 /search 路径
                        } else {
                            result = { directMatch: true, apiPrefix: config.prefix, apiName: config.name, apiAppId: config.appId || '', apiAppSecret: config.appSecret || '', episodeInfo: { ...bestMatch, episodes: [{ episodeId: bestMatch.episodeId || bestMatch.matchedEpisodeId, episodeTitle: bestMatch.episodeTitle || bestMatch.matchedEpisodeTitle }], imageUrl: bestMatch.imageUrl } };
                        }
                    }
                }
                }

                // B. 尝试 /search/episodes 接口 (如果 match 没有结果)
                if (!result) {
                    let searchTitle = animeName;

                    // 官方源特殊优化
                    if (apiKey === 'official') {
                        const parsed = parseAnimeName(animeName);
                        if (parsed.season !== null) {
                            searchTitle = parsed.season === 1 ? parsed.title : `${parsed.title} 第${parsed.season}季`;
                        }
                    }

                    // 双向匹配：尝试所有候选季集，选择最佳结果
                    let bestAnimaInfo = null;
                    let bestCandidate = null;

                    // 解析基础标题（去掉季度后缀），用于根据候选季度动态构建搜索标题
                    const parsedBase = parseAnimeName(animeName);
                    const baseName = parsedBase.title || animeName;

                    for (const candidate of seasonEpisodeCandidates) {
                        const candidateEpisode = candidate.episode;
                        const candidateSeason = candidate.season;

                        let logMsg = `[双向匹配] 尝试集数: ${candidateEpisode}`;
                        if (candidateSeason) {
                            logMsg = `[双向匹配] 尝试: S${String(candidateSeason).padStart(2, '0')}E${String(candidateEpisode).padStart(2, '0')}`;
                        }
                        logger.debug(logMsg);

                        // 根据候选的季度动态调整搜索标题
                        let candidateSearchTitle = searchTitle;
                        if (candidateSeason && candidateSeason > 1) {
                            candidateSearchTitle = `${baseName} 第${candidateSeason}季`;
                            logger.debug(`[双向匹配] 根据候选季度调整搜索标题: "${candidateSearchTitle}"`);
                        } else if (candidateSeason === 1) {
                            // 第1季使用纯标题（不带季度后缀）
                            candidateSearchTitle = baseName;
                        }

                        const animaInfo = await fetchSearchEpisodes(candidateSearchTitle, candidateEpisode, config.prefix, config.appId, config.appSecret);

                        // [黑名单] 对搜索结果应用黑名单过滤
                        if (animaInfo?.animes?.length > 0) {
                            animaInfo.animes = applySearchBlacklist(animaInfo.animes, true, apiKey);
                        }

                        if (animaInfo?.animes?.length > 0) {
                            // [改造5] 不盲信第一个，用智能选择从多个候选中精选最优 anime
                            const parsedForMatch = parseSearchKeyword(candidateSearchTitle);
                            if (candidateEpisode) parsedForMatch.episode = candidateEpisode;
                            if (candidateSeason) parsedForMatch.season = candidateSeason;

                            // DLL 模式统一由后端解析候选；非 DLL 模式保留原有前端选择逻辑。
                            let bestSelected = null;
                            if (backendOnline) {
                                const backendMatch = await resolveBackendCandidates(
                                    candidateSearchTitle, candidateEpisode, candidateSeason,
                                    animaInfo.animes, apiKey
                                );
                                if (backendMatch?.status === 'matched' && backendMatch.selected) {
                                    bestSelected = backendMatch.selected;
                                    logger.info(`[自动匹配] DLL 后端匹配成功：status=matched，来源=${config.name}`);
                                } else if (backendMatch) {
                                    logger.info(`[自动匹配] DLL 后端匹配未自动采用：status=${backendMatch.status || 'unknown'}`);
                                }
                            } else {
                                bestSelected = selectBestMatch(
                                    candidateSearchTitle,
                                    animaInfo.animes,
                                    parsedForMatch,
                                    0.25
                                );
                            }

                            if (bestSelected && backendOnline) {
                                // 后端只选择作品，分集继续交给已有获取流程。
                                result = {
                                    backendResolved: true,
                                    animaInfo: { animes: [bestSelected] },
                                    apiPrefix: config.prefix,
                                    apiName: config.name,
                                    apiAppId: config.appId || '',
                                    apiAppSecret: config.appSecret || ''
                                };
                                logger.info(`[自动匹配] DLL 后端确定作品：来源=${config.name}`);
                                break;
                            }

                            if (bestSelected) {
                                // 把最佳候选移到 animes[0]，保持后续逻辑兼容
                                const bestIndex = animaInfo.animes.findIndex(
                                    a => a.animeId === bestSelected.animeId
                                );
                                if (bestIndex > 0) {
                                    const [best] = animaInfo.animes.splice(bestIndex, 1);
                                    animaInfo.animes.unshift(best);
                                }

                                bestAnimaInfo = animaInfo;
                                bestCandidate = candidate;
                                logger.info(`[双向匹配] 智能选择: "${bestSelected.animeTitle}" ` +
                                    `(分: ${bestSelected.score?.toFixed(3)}) ` +
                                    `S${String(candidateSeason).padStart(2, '0')}E${String(candidateEpisode).padStart(2, '0')}`);
                                break;
                            }
                            // 智能选择没命中（所有候选评分都太低），继续下一个候选季集
                            logger.debug(`[双向匹配] 智能选择未命中，继续下一个候选`);
                        }
                    }

                    if (!result && bestAnimaInfo) {
                        let logMsg = `[双向匹配] 最佳匹配使用集数: ${bestCandidate.episode}`;
                        if (bestCandidate.season) {
                            logMsg = `[双向匹配] 最佳匹配: S${String(bestCandidate.season).padStart(2, '0')}E${String(bestCandidate.episode).padStart(2, '0')}`;
                        }
                        logger.info(`${logMsg}, 结果数: ${bestAnimaInfo.animes.length}`);
                        result = { animaInfo: bestAnimaInfo, apiPrefix: config.prefix, apiName: config.name };
                    }
                    // 降级：不带集数搜索；DLL 模式仍必须交给后端决定。
                    else if (!result) {
                        const animaInfo = await fetchSearchEpisodes(animeName, null, config.prefix, config.appId, config.appSecret);

                        // [黑名单] 对搜索结果应用黑名单过滤
                        if (animaInfo?.animes?.length > 0) {
                            animaInfo.animes = applySearchBlacklist(animaInfo.animes, true, apiKey);
                        }

                        if (animaInfo?.animes?.length > 0) {
                            if (backendOnline) {
                                result = await resolveBackendSearch(animaInfo.animes, itemInfoMap, config, apiKey);
                                if (result) logger.info(`[自动匹配] DLL 后端采用无集数搜索结果：来源=${config.name}`);
                            } else {
                                result = { animaInfo, apiPrefix: config.prefix, apiName: config.name };
                            }
                        }
                        // 降级：原始标题搜索
                        else {
                            const seriesOrMovieInfo = await fatchEmbyItemInfo(seriesOrMovieId);
                            if (seriesOrMovieInfo?.OriginalTitle) {
                                const animaInfoOriginal = await fetchSearchEpisodes(seriesOrMovieInfo.OriginalTitle, seasonEpisodeCandidates[0].episode, config.prefix, config.appId, config.appSecret);

                                // [黑名单] 对搜索结果应用黑名单过滤
                                if (animaInfoOriginal?.animes?.length > 0) {
                                    animaInfoOriginal.animes = applySearchBlacklist(animaInfoOriginal.animes, true, apiKey);
                                }

                                if (animaInfoOriginal?.animes?.length > 0) {
                                    if (backendOnline) {
                                        result = await resolveBackendSearch(animaInfoOriginal.animes, itemInfoMap, config, apiKey);
                                        if (result) result.animeOriginalTitle = seriesOrMovieInfo.OriginalTitle;
                                    } else {
                                        result = { animaInfo: animaInfoOriginal, animeOriginalTitle: seriesOrMovieInfo.OriginalTitle, apiPrefix: config.prefix, apiName: config.name };
                                    }
                                }
                            }
                        }
                    }
                }

                // --- 4. 关键：如果找到了，直接返回 (Short-Circuit) ---
                if (result) {
                    const totalTime = (performance.now() - startTime).toFixed(0);
                    logger.info(`[自动匹配] 在源 [${config.name}] 匹配成功! 耗时: ${(performance.now() - providerStart).toFixed(0)}ms (累计: ${totalTime}ms)`);
                    appendvideoOsdDanmakuInfo(null, `匹配耗时: ${totalTime}ms`);
                    return result; // <--- 之后的循环不会执行，请求被节省了
                }

            } catch (e) {
                logger.warn(`[自动匹配] 源 ${config.name} 发生错误:`, e);
                // 继续下一个循环
            }
        }

        logger.info(`[自动匹配] 所有源均未匹配成功, 总耗时: ${(performance.now() - startTime).toFixed(0)}ms`);
        return null;
    }

    // 自动触发复用整条匹配链，显式重新匹配则以新任务替代旧任务。
    let activeEpisodeTask = null;
    function getEpisodeInfo(is_auto = true, useCache = true) {
        const key = manualDanmakuKey(window.ede?.itemId);
        if (useCache && activeEpisodeTask?.key === key && activeEpisodeTask.isCurrent()) {
            logger.info('[自动匹配] 复用当前条目正在进行的匹配任务');
            return activeEpisodeTask.promise;
        }
        const selection = manualDanmakuSelection;
        const task = { key, promise: null, isCurrent: null };
        task.isCurrent = () => activeEpisodeTask === task
            && key === manualDanmakuKey(window.ede?.itemId) && selection === manualDanmakuSelection;
        activeEpisodeTask = task;
        task.promise = getEpisodeInfoCore(is_auto, useCache, task.isCurrent).finally(() => {
            if (activeEpisodeTask === task) activeEpisodeTask = null;
        });
        return task.promise;
    }

    async function getEpisodeInfoCore(is_auto = true, useCache = true, isCurrent = () => true) {
        const matchId = Date.now().toString(36).slice(-6);

        const itemInfoMap = await getMapByEmbyItemInfo();
        if (!isCurrent() || !itemInfoMap) { return null; }
        const { _episode_key, animeId, episode, seriesOrMovieId, animeName } = itemInfoMap;

        logger.info(`[匹配 #${matchId}] 开始获取弹幕: ${animeName} 第${episode}集 (is_auto=${is_auto}, useCache=${useCache})`);
        // [新增] 搜索开始时立即更新 OSD 和 tooltip 标题，告知用户正在搜索哪部内容
        setOsdDanmakuText(`正在搜索弹幕：${animeName}`);
        if (window.ede) { window.ede._danmakuLoadTitle = `正在搜索弹幕：${animeName}`; }
        // [修复] 搜索阶段也激活圆环旋转（indeterminate 模式），搜索完成后由后续流程清除或更新
        ddSetLoadingRing(-1, '');

        // 下一集/上一集推理逻辑：
        // - 条件1: is_auto=true（仅 INIT/CHECK 类型触发，RELOAD/REFRESH/SEARCH 不推理）
        // - 条件2: 同一个系列（seriesOrMovieId 相同）
        // - 条件3: previous_info 有有效的 episodeId（上一集曾正常匹配过）
        // epid 是连续整数，上一集 episodeId±1 即为相邻集
        const previous_info = window.ede.previous_episode_info;
        logger.debug(`[推理诊断] is_auto=${is_auto} | previous_info存在=${!!previous_info} | previous episodeId=${previous_info?.episodeId} | previous seriesOrMovieId=${previous_info?.seriesOrMovieId} | current seriesOrMovieId=${seriesOrMovieId} | previous episodeIndex=${previous_info?.episodeIndex} | current episode=${episode}`);
        if (!ddBackend.isDll() && is_auto && previous_info && previous_info.episodeId && previous_info.seriesOrMovieId === seriesOrMovieId) {
            const previousEpisodeIndex = previous_info.episodeIndex; // 0-based
            const currentEpisodeNumber = episode;                     // 1-based（Emby 集号）
            const previousEpisodeId = parseInt(previous_info.episodeId, 10);

            let predictedEpisodeId = null;
            let direction = '';
            let bgmIndexDelta = 0;

            // 下一集：Emby 集号 = 上一集 0-based index + 2（即 index+1 → episode+1）
            if (currentEpisodeNumber === previousEpisodeIndex + 2) {
                predictedEpisodeId = previousEpisodeId + 1;
                direction = '下一集';
                bgmIndexDelta = 1;
            }
            // 上一集：Emby 集号 = 上一集 0-based index（即 index-1 → episode-1）
            else if (currentEpisodeNumber === previousEpisodeIndex) {
                predictedEpisodeId = previousEpisodeId - 1;
                direction = '上一集';
                bgmIndexDelta = -1;
            }

            if (predictedEpisodeId) {
                const prevApiPrefix = previous_info.apiPrefix;
                const prevApiName = previous_info.apiName || '';
                const prevApiAppId = previous_info.apiAppId || '';
                const prevApiAppSecret = previous_info.apiAppSecret || '';
                logger.info(`[推理匹配] 检测到播放'${direction}'，episodeId: ${previousEpisodeId} → ${predictedEpisodeId}，源: ${prevApiName || '默认'}`);

                const comments = await fetchComment(predictedEpisodeId, prevApiPrefix, prevApiAppId, prevApiAppSecret);
                if (comments && comments.length > 0) {
                    logger.info(`[推理匹配] 成功！episodeId: ${predictedEpisodeId}，弹幕数: ${comments.length}，源: ${prevApiName || '默认'}`);
                    const predictedEpisodeIndex = isNaN(currentEpisodeNumber) ? 0 : currentEpisodeNumber - 1;
                    const predictedBgmEpisodeIndex = deriveBgmEpisodeIndex(previous_info, predictedEpisodeIndex, bgmIndexDelta);
                    const predictedEpisodeInfo = {
                        ...itemInfoMap,
                        episodeId: predictedEpisodeId,
                        episodeTitle: `第 ${currentEpisodeNumber} 集 (推断)`,
                        animeId: previous_info.animeId,
                        bangumiId: previous_info.bangumiId || previous_info.animeId,
                        animeTitle: previous_info.animeTitle,
                        animeOriginalTitle: previous_info.animeOriginalTitle || '',
                        imageUrl: previous_info.imageUrl,
                        apiAppId: prevApiAppId,
                        apiAppSecret: prevApiAppSecret,
                        seriesOrMovieId: seriesOrMovieId,
                        episodeIndex: predictedEpisodeIndex,
                        bgmEpisodeIndex: predictedBgmEpisodeIndex,
                        apiPrefix: prevApiPrefix,
                        apiName: prevApiName,
                    };
                    // 推理结果不写入 localStorage 缓存，下次仍可走正常匹配流程
                    return predictedEpisodeInfo;
                } else {
                    logger.info(`[推理匹配] 失败 (episodeId: ${predictedEpisodeId} 在源 [${prevApiName || '默认'}] 无弹幕)，回退到常规匹配。`);
                }
            }
        }

        // 修正缓存键，区分官方和自定义API
        const useOfficialApi = lsGetItem(lsKeys.useOfficialApi.id);
        const useCustomApi = lsGetItem(lsKeys.useCustomApi.id);
        const apiPriority = lsGetItem(lsKeys.apiPriority.id);
        const enabledApis = apiPriority.filter(apiKey => {
            if (apiKey === 'official') return useOfficialApi;
            if (apiKey === 'custom') return useCustomApi;
            return false;
        });
        const unique_episode_key = `_api_${enabledApis.join('_')}_` + _episode_key;
        if (useCache && window.localStorage.getItem(unique_episode_key)) {
            const cachedInfo = JSON.parse(window.localStorage.getItem(unique_episode_key));
            // 仅信任 DLL 已确认或源精确命中且经过标题二次校验的缓存。
            if (ddBackend.isDll() && cachedInfo.backendResolved !== true && cachedInfo.apiExactMatched !== true) {
                logger.info('[匹配] DLL 模式忽略未经后端或源精确校验确认的旧缓存');
            } else {
            logger.info(`[匹配 #${matchId}] 使用缓存: episodeId=${cachedInfo.episodeId}`);
            return cachedInfo;
            }
        }

        // 过期任务不能提交后端，也不能继续写入分集缓存。
        if (!isCurrent()) return null;
        const res = await searchEpisodes(itemInfoMap, isCurrent);
        if (!isCurrent()) return null;

        const useOfficial = lsGetItem(lsKeys.useOfficialApi.id);
        const useCustom = lsGetItem(lsKeys.useCustomApi.id);
        if (!useOfficial && !useCustom) {
            return null;
        }
        if (!res || (!res.directMatch && (!res.animaInfo || res.animaInfo.animes.length === 0))) {
            logger.info(`弹弹 Play 章节匹配失败`);
            // 播放界面右下角添加弹幕信息
            appendvideoOsdDanmakuInfo();
            // toastByDanmaku('弹弹 Play 章节匹配失败', 'error');
            return null;
        }
        // 源精确分集已通过二次校验；模糊作品仍必须由 DLL 确认。
        if (ddBackend.isDll() && res.backendResolved !== true && res.apiExactMatched !== true) {
            logger.warn('[匹配] 结果未经后端或源精确校验确认，拒绝前端另选作品');
            return null;
        }
        // 处理来自 /match 的直接匹配结果
        if (res.directMatch) {
            const episodeIndex = isNaN(episode) ? 0 : episode - 1;
            const bgmEpisodeIndex = isValidEpisodeIndex(res.episodeInfo.bgmEpisodeIndex)
                ? Number(res.episodeInfo.bgmEpisodeIndex)
                : (
                    isValidEpisodeIndex(res.episodeInfo.matchedEpisodeIndex)
                        ? Number(res.episodeInfo.matchedEpisodeIndex)
                        : episodeIndex
                );
            const episodeInfo = {
                episodeId: res.episodeInfo.episodeId,
                episodeTitle: res.episodeInfo.episodeTitle,
                // [修复] episodeIndex 必须用实际集数，否则推理匹配(上/下一集 episodeId±1)只在 EP1→EP2 时生效
                episodeIndex,
                bgmEpisodeIndex,
                animeId: res.episodeInfo.animeId,
                bangumiId: res.episodeInfo.bangumiId || res.episodeInfo.animeId,
                animeTitle: res.episodeInfo.animeTitle,
                animeOriginalTitle: '',
                imageUrl: res.episodeInfo.imageUrl,
                apiName: res.apiName,
                apiPrefix: res.apiPrefix,
                apiAppId: res.apiAppId || '',
                apiAppSecret: res.apiAppSecret || '',
                seriesOrMovieId: seriesOrMovieId,
                backendResolved: res.backendResolved === true,
                // 独立保存源精确校验标记，不冒充后端确认。
                apiExactMatched: res.apiExactMatched === true,
            };
            // [增强日志] 完整输出 directMatch 最终结果，方便排查
            logger.info(`[匹配结果] directMatch: "${episodeInfo.animeTitle}" - "${episodeInfo.episodeTitle}" (episodeId: ${episodeInfo.episodeId}, animeId: ${episodeInfo.animeId})`);
            localStorage.setItem(unique_episode_key, JSON.stringify(episodeInfo));
            return episodeInfo;
        }

        // [修正] 从 res 中解构出 apiPrefix 和 apiName
        const { animeOriginalTitle, animaInfo, apiPrefix, apiName, apiAppId, apiAppSecret } = res;
        let selectAnime_id = 1;
        if (animeId != -1) {
            for (let index = 0; index < animaInfo.animes.length; index++) {
                if (animaInfo.animes[index].animeId == animeId) {
                    selectAnime_id = index + 1;
                }
            }
        }
        selectAnime_id = parseInt(selectAnime_id) - 1;
        const episodeIndex = isNaN(episode) ? 0 : episode - 1;
        // 健壮性检查：确保 animes[selectAnime_id] 和 episodes 存在
        if (!animaInfo.animes[selectAnime_id] || !animaInfo.animes[selectAnime_id].episodes || animaInfo.animes[selectAnime_id].episodes.length === 0) {
            logger.error('匹配逻辑错误：未能找到有效的分集信息。');
            return null;
        }
        // [修复] 根据 episodeIndex 定位到正确的分集，而非永远取 episodes[0]
        const selectedAnime = animaInfo.animes[selectAnime_id];
        const selectedAnimeEpisodes = selectedAnime.episodes;
        let targetEpisode = selectedAnimeEpisodes[0]; // 默认回退到第一集

        if (episodeIndex >= 0 && episodeIndex < selectedAnimeEpisodes.length) {
            // 优先使用 episodeIndex 直接定位
            targetEpisode = selectedAnimeEpisodes[episodeIndex];
            logger.info(`[自动匹配] 使用 episodeIndex(${episodeIndex}) 定位到分集: ${targetEpisode.episodeTitle} (episodeId: ${targetEpisode.episodeId})`);
        } else if (selectedAnimeEpisodes.length === 1) {
            // 搜索结果只有一集（fetchSearchEpisodes 已经根据集数过滤了），直接使用
            targetEpisode = selectedAnimeEpisodes[0];
            logger.info(`[自动匹配] 搜索结果仅一集, 直接使用: ${targetEpisode.episodeTitle} (episodeId: ${targetEpisode.episodeId})`);
        } else {
            // episodeIndex 超出范围，尝试从 episodeTitle 或 episodeNumber 匹配
            const epNumber = episode; // 1-based
            const matched = selectedAnimeEpisodes.find(ep =>
                ep.episodeNumber == epNumber ||
                (ep.episodeTitle && (ep.episodeTitle.includes(`第${epNumber}话`) || ep.episodeTitle.includes(`第${epNumber}集`)))
            );
            if (matched) {
                targetEpisode = matched;
                logger.info(`[自动匹配] episodeIndex(${episodeIndex}) 超出范围, 通过集数号(${epNumber})匹配到: ${targetEpisode.episodeTitle} (episodeId: ${targetEpisode.episodeId})`);
            } else {
                logger.warn(`[自动匹配] episodeIndex(${episodeIndex}) 超出范围(共${selectedAnimeEpisodes.length}集), 且无法通过集数号匹配, 回退使用第一集: ${targetEpisode.episodeTitle}`);
            }
        }

        const episodeInfo = {
            episodeId: targetEpisode.episodeId,
            episodeTitle: targetEpisode.episodeTitle,
            episodeIndex,
            bgmEpisodeIndex: isValidEpisodeIndex(res.bgmEpisodeIndex) ? Number(res.bgmEpisodeIndex) : episodeIndex,
            animeId: selectedAnime.animeId,
            bangumiId: selectedAnime.bangumiId || selectedAnime.animeId,
            animeTitle: selectedAnime.animeTitle,
            animeOriginalTitle,
            imageUrl: selectedAnime.imageUrl,
            seriesOrMovieId: seriesOrMovieId,
            apiPrefix: apiPrefix, // [修正] 保存API前缀
            apiName: apiName, // [新增] 保存API名称
            apiAppId: apiAppId || "", // [新增] 保存自定义API AppId
            apiAppSecret: apiAppSecret || "", // [新增] 保存自定义API AppSecret
            // 缓存记录作品已经后端确认，不要求后端选择分集。
            backendResolved: res.backendResolved === true,
        };
        localStorage.setItem(unique_episode_key, JSON.stringify(episodeInfo));
        logger.info(`[匹配 #${matchId}] 匹配成功: ${episodeInfo.animeTitle} - ${episodeInfo.episodeTitle} (episodeId: ${episodeInfo.episodeId})`);
        return episodeInfo;
    }


    async function createDanmaku(comments, sessionId) {
        // 跨异步等待保持 view 与媒体身份，防止旧任务挂载到新播放器。
        const generation = playbackViewGeneration;
        const sourceMedia = getPlaybackMedia();
        const isCurrent = () => generation === playbackViewGeneration
            && (!sessionId || sessionId === window.ede.lastLoadId)
            && sourceMedia === getPlaybackMedia();
        // [核心修复] 1. 入口身份核验
        // 如果调用者传了身份证(sessionId)，必须和全局最新的(lastLoadId)一致
        if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) {
            logger.warn(`[防串台] 拦截旧任务(入口): ${sessionId}, 当前: ${window.ede.lastLoadId}`);
            return;
        }

        if (!comments) { return; }

        // 捕获数据所属条目和换流起点，恢复时不读取网络或重新搜索匹配。
        const manager = await new Promise(resolve => require(['playbackManager'], resolve));
        if (!isCurrent()) return;
        const player = manager.getCurrentPlayer();
        const key = player && getDanmakuPlaybackKey(manager, player);
        const offset = player && sourceMedia ? getDanmakuPlaybackOffset(manager, player, sourceMedia) : 0;
        danmakuPlaybackSnapshot = key && sourceMedia ? {
            manager, player, key, generation, sessionId: sessionId || window.ede.lastLoadId,
            userId: getHostApiClient()?.getCurrentUserId?.(),
            comments, media: sourceMedia, src: sourceMedia.src, offset,
        } : null;
        // 适配器在过滤完成后才创建，避免旧异步任务遗留定时器。
        let engineMedia = sourceMedia;

        // [优化] 保存弹幕到 IndexedDB 缓存
        if (window.ede.episode_info && window.ede.episode_info.episodeId) {
            const episodeId = window.ede.episode_info.episodeId;
            const animeId = window.ede.episode_info.animeId || 'unknown';
            IndexedDBCache.save(episodeId, animeId, comments).catch(error => {
                logger.warn('[IndexedDB] 保存弹幕缓存失败:', error);
            });
        }

        if (window.ede.danmaku) {
            try { window.ede.danmaku.hide(); window.ede.danmaku.destroy(); } catch (e) {
                logger.warn('旧弹幕实例销毁异常', e);
            }
            window.ede.danmaku = null;
        }

        const ghostWrappers = document.querySelectorAll(`#${eleIds.danmakuWrapper}`);
        ghostWrappers.forEach(el => el.remove());

        // [优化] 全量解析 + 缓存（复用 danmakuParser，确保字段格式完全兼容）

        // 清空旧的弹幕缓存（切换剧集时）
        danmakuParseCache.clearAll();

        // 全量解析弹幕（带缓存，相同弹幕集不会重复解析）
        const commentsParsed = parseAllDanmaku(comments);
        window.ede.commentsParsed = commentsParsed;

        logger.debug('开始过滤和合并弹幕 (异步)...');

        // --- 异步等待 (这里耗时 1秒左右) ---
        let _comments = await danmakuFilter(commentsParsed);

        // [核心修复] 2. 出口身份核验 (防止 await 期间切集)
        if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) {
            logger.warn(`[防串台] 拦截旧任务(出口): ${sessionId}, 当前: ${window.ede.lastLoadId}`);
            return;
        }

        if (!isCurrent()) return;
        logger.info('弹幕加载成功: ' + _comments.length);

        const _media = sourceMedia;
        if (!_media) {
            // this only working on quickDebug
            if (!window.ede.danmaku) {
                window.ede.danmaku = { comments: _comments, };
            }
            // 设置弹窗内的弹幕信息
            buildCurrentDanmakuInfo(currentDanmakuInfoContainerId);
            // throw new Error('创建弹幕失败：用户已退出视频播放页面。');
            logger.warn('用户已退出视频播放页面，停止创建。');
            return;
        }
        if (!isVersionOld) { _media.style.position = 'absolute'; }
        // from https://github.com/Izumiko/jellyfin-danmaku/blob/jellyfin/ede.js#L1104
        const wrapperTop = 0;
        // 播放器 UI 顶部阴影
        let wrapper = getById(eleIds.danmakuWrapper);
        wrapper && wrapper.remove();
        wrapper = document.createElement('div');
        wrapper.id = eleIds.danmakuWrapper;
        wrapper.style.position = 'fixed';
        wrapper.style.width = '100%';
        wrapper.style.height = `calc(${lsGetItem(lsKeys.heightPercent.id)}% - ${wrapperTop}px)`;
        wrapper.style.backgroundColor = lsGetItem(lsKeys.debugShowDanmakuWrapper.id) ? styles.colors.highlight : '';
        // wrapper.style.opacity = lsGetItem(lsKeys.fontOpacity.id);
        // 弹幕整体透明度
        wrapper.style.top = wrapperTop + 'px';
        wrapper.style.pointerEvents = 'none';
        // [优化] 告诉浏览器这个层是会变的，让 GPU 提前准备
        wrapper.style.willChange = 'transform, opacity';

        // [综合方案] 容器查找：当前选择器 → 去掉:not(.hide) → 尝试另一版本选择器 → video父元素兜底
        let _container = null;
        const altSelector = isVersionOld ? _CONTAINER_SELECTORS.new : _CONTAINER_SELECTORS.old;
        try {
            _container = await waitForElement(mediaContainerQueryStr, null, 6000);
        } catch (e1) {
            logger.warn(`[弹幕容器] "${mediaContainerQueryStr}" 查找超时，尝试去掉 :not(.hide)...`);
            const noHideSelector = mediaContainerQueryStr.replace(/:not\(\.hide\)/g, '');
            try {
                _container = await waitForElement(noHideSelector, null, 3000);
                logger.info(`[弹幕容器] 使用 "${noHideSelector}" 找到容器`);
            } catch (e2) {
                // 尝试另一版本的选择器（可能版本检测误判）
                logger.warn(`[弹幕容器] 尝试另一版本选择器: "${altSelector}"...`);
                const altEl = document.querySelector(altSelector) || document.querySelector(altSelector.replace(/:not\(\.hide\)/g, ''));
                if (altEl) {
                    _container = altEl;
                    // 自动修正全局选择器，后续不再走错
                    mediaContainerQueryStr = altSelector + (altSelector.includes(notHide) ? '' : notHide);
                    isVersionOld = (altSelector === _CONTAINER_SELECTORS.old);
                    logger.warn(`[弹幕容器] 版本选择器已自动修正为: "${mediaContainerQueryStr}" (isOld: ${isVersionOld})`);
                } else {
                    // 最终兜底：video 父元素或 body
                    const videoEl = document.querySelector(mediaQueryStr);
                    _container = videoEl?.parentElement || document.body;
                    logger.warn(`[弹幕容器] 全部选择器超时，使用 fallback: ${_container.tagName}#${_container.id || ''}`);
                }
            }
        }
        if (!isCurrent() || !_media.isConnected) return;
        // 优先使用当前媒体所属容器，不使用隐藏旧 view 的全局首个匹配。
        _container = _media.closest(`.graphicContentContainer, ${playbackViewSelector}`)
            || activePlaybackView || _container;
        _container.prepend(wrapper);
        let _speed = 144 * (lsGetItem(lsKeys.speed.id) / 100);
        // 检查 Danmaku 库是否已加载，如果未加载则等待
        const danmakuAvailable = typeof Danmaku !== 'undefined';
        const windowDanmakuAvailable = typeof window.Danmaku !== 'undefined';
        logger.info(`[弹幕引擎] 检测可用性: window.Danmaku=${windowDanmakuAvailable}, Danmaku(局部)=${danmakuAvailable}, skipInnerModule=${skipInnerModule}`);

        if (!danmakuAvailable && !windowDanmakuAvailable) {
            logger.warn('[弹幕引擎] 弹幕库未就绪，开始轮询等待 (最多3秒)...');
            // 尝试等待 Danmaku 库加载完成，最多等待 3 秒
            let waitCount = 0;
            const maxWait = 30; // 30 * 100ms = 3秒
            while (typeof window.Danmaku === 'undefined' && waitCount < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }
            if (typeof window.Danmaku === 'undefined') {
                logger.error(`[弹幕引擎] 轮询等待超时 (${maxWait * 100}ms), window.Danmaku 仍为 undefined`);
                logger.info('[弹幕引擎] 尝试通过 Emby.importModule 重试加载, 路径:', requireDanmakuPath);
                // 尝试重新加载
                try {
                    const module = await Emby.importModule(requireDanmakuPath);
                    window.Danmaku = module;
                    logger.info('[弹幕引擎] Emby.importModule 重试加载成功, window.Danmaku 已就绪');
                } catch (error) {
                    logger.error('[弹幕引擎] Emby.importModule 重试加载失败:', error);
                    throw new Error('创建弹幕失败：Danmaku 库未能加载。请检查网络连接或刷新页面重试。');
                }
            } else {
                logger.info(`[弹幕引擎] 轮询等待成功, 等待了 ${waitCount * 100}ms, window.Danmaku 已就绪`);
            }
        }
        if (!isCurrent() || !_media.isConnected || !wrapper.isConnected) {
            wrapper.remove();
            return;
        }
        const DanmakuClass = window.Danmaku || Danmaku;
        logger.info(`[弹幕引擎] 使用的引擎类: ${DanmakuClass ? DanmakuClass.name || 'Danmaku(anonymous)' : 'undefined'}`);
        // 当前任务最终确认后挂接独立弹幕时钟，换 video 不再丢失引擎监听。
        if (key) engineMedia = createDanmakuClock(manager, player, key, generation);
        window.ede.danmaku = new DanmakuClass({
            container: wrapper,
            media: engineMedia, // 转码流使用包含起点偏移的剧集时间。
            comments: _comments,
            engine: lsGetItem(lsKeys.engine.id),
            speed: _speed,
        });
        // [优化] 始终让引擎 show() 保持运行，通过 CSS visibility 控制可见性
        // 避免 hide()/show() 导致 runningList 被 clear，弹幕位置信息丢失
        window.ede.danmaku.show();
        if (!lsGetItem(lsKeys.switch.id)) {
            wrapper.style.visibility = 'hidden';
        }
        if (window.ede.ob) {
            window.ede.ob.disconnect();
        }

        // 增加尺寸比对
        // 1. 记录上一次的宽高
        let lastWidth = _container.offsetWidth;
        let lastHeight = _container.offsetHeight;
        let resizeTimer;

        window.ede.ob = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                if (Math.abs(width - lastWidth) < 20 && Math.abs(height - lastHeight) < 20) {
                    return;
                }
                lastWidth = width;
                lastHeight = height;
                if (resizeTimer) clearTimeout(resizeTimer);

                resizeTimer = setTimeout(() => {
                    // 尺寸回调只属于创建它的 view 和加载任务。
                    if (isCurrent() && window.ede && window.ede.ob && window.ede.danmaku) {
                        logger.debug(`[Resize] 尺寸变化 (${width|0}x${height|0})，重载弹幕轨道...`);
                        loadDanmaku(LOAD_TYPE.RELOAD);
                    }
                    resizeTimer = null;
                }, 500);
            }
        });

        window.ede.ob.observe(_container);
        // 自定义的 initH5VideoAdapter 下,解决暂停时暂停的弹幕再次加载会自动恢复问题
        if (_media.id) {
            require(['playbackManager'], (playbackManager) => {
                if (playbackManager.getPlayerState().PlayState.IsPaused) {
                    _media.dispatchEvent(new Event('pause'));
                }
            });
        }
        // 设置弹窗内的弹幕信息
        buildCurrentDanmakuInfo(currentDanmakuInfoContainerId);
        // 播放界面右下角添加弹幕信息（OSD 标题区）
        appendvideoOsdDanmakuInfo(_comments.length);

        // 绘制弹幕进度条
        if (lsGetItem(lsKeys.osdLineChartEnable.id)) {
            buildProgressBarChart(20);
        }
    }

    function buildProgressBarChart(chartHeightNum) {
        const chartEle = getById(eleIds.progressBarLineChart);
        if (chartEle) {
            chartEle.remove();
        }
        if (!window.ede.danmaku) {
            return;
        }
        const osdLineChartSkipFilter = lsGetItem(lsKeys.osdLineChartSkipFilter.id);
        const comments = osdLineChartSkipFilter ? window.ede.commentsParsed : window.ede.danmaku.comments;
        const container = getByClass(classes.videoOsdPositionSliderContainer);
        if (!comments || !container || (comments && comments.length === 0)) {
            return;
        }
        const progressBarWidth = container.offsetWidth;
        logger.debug('进度条宽度 (progressBarWidth): ' + progressBarWidth);
        const bulletChartCanvas = document.createElement('canvas');
        bulletChartCanvas.id = eleIds.progressBarLineChart;
        bulletChartCanvas.width = progressBarWidth;
        bulletChartCanvas.height = chartHeightNum;
        bulletChartCanvas.style.position = 'absolute';
        bulletChartCanvas.style.top = OS.isEmbyNoisyX() ? '-24px' : '-21px';
        container.prepend(bulletChartCanvas);
        const ctx = bulletChartCanvas.getContext('2d');
        // 计算每个时间点的弹幕数量
        // [修复] 使用 reduce 代替 Math.max(...array) 避免大数组栈溢出
        const maxTime = comments.reduce((max, c) => c.time > max ? c.time : max, 0);
        const timeStep = lsGetItem(lsKeys.osdLineChartTime.id);
        const timeCounts = Array.from({ length: Math.ceil(maxTime / timeStep) }, () => 0);
        comments.forEach(c => {
            const index = Math.floor(c.time / timeStep);
            if (index < timeCounts.length) {
                timeCounts[index]++;
            }
        });
        // [修改] 内部绘制函数：改为平滑波浪线
        function drawLineChart(data) {
            ctx.clearRect(0, 0, progressBarWidth, chartHeightNum);
            // [修复] 使用 reduce 代替 Math.max(...array) 避免大数组栈溢出
            const maxY = data.reduce((max, val) => val > max ? val : max, 0);
            if (maxY <= 0) return; // 防止除以0

            const scale = chartHeightNum / maxY; // 用于拉长 y 轴间距

            // 1. 预计算坐标点，方便后续计算控制点
            const points = data.map((val, i) => ({
                x: (i / (data.length - 1)) * progressBarWidth,
                y: chartHeightNum - val * scale
            }));

            // 2. 开始绘制路径
            ctx.beginPath();
            ctx.moveTo(0, chartHeightNum); // 起点：左下角
            ctx.lineTo(points[0].x, points[0].y); // 连接到第一个数据点

            // 3. 使用贝塞尔曲线连接数据点 (张力系数 tension)
            const tension = 0.4; // 0.3~0.5 比较圆滑，0 为折线

            for (let i = 0; i < points.length - 1; i++) {
                const p0 = points[Math.max(0, i - 1)];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[Math.min(points.length - 1, i + 2)];

                // 计算控制点
                const cp1x = p1.x + (p2.x - p0.x) * tension;
                const cp1y = p1.y + (p2.y - p0.y) * tension;
                const cp2x = p2.x - (p3.x - p1.x) * tension;
                const cp2y = p2.y - (p3.y - p1.y) * tension;

                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
            }

            // 4. 闭合路径 (右下角 -> 左下角)
            ctx.lineTo(progressBarWidth, chartHeightNum);
            ctx.closePath();

            // 5. 填充颜色
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'; // 内部填充淡淡的白色
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; // 边缘描边
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        drawLineChart(timeCounts);
        logger.info('已重绘进度条弹幕数量折线图');
    }


    // [新增] 强制清理 UI 函数
    function clearDanmakuUI() {
    // 清空同时释放时钟及媒体监听，禁止旧状态恢复已取消的弹幕。
    clearStoppedDanmaku();
    danmakuClock?.dispose();
    // 显式清空后不允许切轨恢复已取消的匹配。
    danmakuPlaybackSnapshot = null;
    // 1. 隐藏并清空现有弹幕
    if (window.ede.danmaku) {
        window.ede.danmaku.hide();
        window.ede.danmaku.clear();
    }

    // 2. [关键修改] 立即重置剧集元数据信息，防止旧标题残留
    if (window.ede) {
        // [推理匹配] 必须在清空 episode_info 前保存，因为 playbackstart 早于 playbackstop 触发，
        // 等到 onPlaybackStop 时 episode_info 已经是 null，推理匹配拿不到上一集信息
        if (window.ede.episode_info) {
            window.ede.previous_episode_info = { ...window.ede.episode_info };
            logger.debug(`[推理匹配] clearDanmakuUI 中保存: episodeId=${window.ede.episode_info.episodeId}, episodeIndex=${window.ede.episode_info.episodeIndex}`);
        }
        window.ede.episode_info = null;
        // 本地展示信息不参与在线匹配推理，清空时独立失效。
        window.ede.localDanmakuInfo = null;
    }

    // 3. 重置右下角 OSD 信息
    const videoOsdDanmakuTitle = getById(eleIds.videoOsdDanmakuTitle);
    if (videoOsdDanmakuTitle) {
        videoOsdDanmakuTitle.innerText = '';
    }


    // 4. 移除高能进度条
    const chartEle = getById(eleIds.progressBarLineChart);
    if (chartEle) {
        chartEle.remove();
    }

    // 5. 清空当前的弹幕数据缓存
    window.ede.commentsParsed = [];
}

    // 手动来源仅覆盖当前用户、服务器和播放条目，不影响下一集的 DLL 策略。
    let manualDanmakuSelection = null;
    function manualDanmakuKey(itemId) {
        const client = getHostApiClient();
        return JSON.stringify([playbackViewGeneration, client?.serverAddress?.(),
            client?.getCurrentUserId?.(), String(itemId || '')]);
    }

    async function loadDanmaku(loadType = LOAD_TYPE.CHECK) {
        // 显式重新匹配立即废弃旧任务，普通自动触发仍可复用进行中的任务。
        if (loadType === LOAD_TYPE.SEARCH || loadType === LOAD_TYPE.REFRESH) activeEpisodeTask = null;
        const generation = playbackViewGeneration;
        const _media = getPlaybackMedia();
        if (!_media) {
            return logger.warn('用户已退出视频播放，停止加载弹幕');
        }

        // [新增] 自动加载弹幕总开关检查 (手动搜索 SEARCH 和重载 RELOAD 不受此限制)
        if (loadType !== LOAD_TYPE.SEARCH && loadType !== LOAD_TYPE.RELOAD) {
            if (!lsGetItem(lsKeys.autoLoadSwitch.id)) {
                logger.info('[dd-danmaku] 自动加载弹幕已关闭，跳过自动匹配 (可通过弹幕设置手动匹配)');
                return;
            }
        }

        window.ede._loadViewGeneration = generation;
        // 在任何 await 前取得单调任务 ID，同一 view 快速切集也能淘汰旧请求。
        window.ede._loadSequence = (window.ede._loadSequence || 0) + 1;
        const currentSessionId = `LOAD_${window.ede._loadSequence}`;
        window.ede.lastLoadId = currentSessionId;
        const isCurrentLoad = () => generation === playbackViewGeneration
            && _media === getPlaybackMedia() && currentSessionId === window.ede.lastLoadId;
        logger.info('[dd-danmaku] 开始检查媒体库排除...');
        if (window.ede) {
            // 在任何后端或 Emby 请求前清理上一集，避免 DLL 查询期间显示旧弹幕。
            if (typeof clearDanmakuUI === 'function') clearDanmakuUI();
            logger.info('开始加载新弹幕，已清除上一集 UI');
            ddSetLoadingRing(-1, '');
        }

        // 播放前等待 DLL 默认值和当前用户参数；后端失败时继续纯 JS 流程。
        await prepareUserParameters();
        if (!isCurrentLoad()) return;
        const item = await getEmbyItemInfo();
        if (!isCurrentLoad()) return;

        // 只把当前播放条目交给 DLL；后端会基于 Token、当前用户和媒体可见性再次校验。
        // 不比较前端事件中的 ID 字符串：Emby 可能返回数字 ID，而后端会规范化为 GUID。
        const requestedItemId = item?.Id || window.ede.itemId;
        // 在启动匹配任务前统一条目标识，切集立即使旧任务失效。
        if (requestedItemId) window.ede.itemId = requestedItemId;

        // 手动确认的来源先加载，不允许本地 XML 或仅按集号索引的旧缓存覆盖。
        const manualSelection = manualDanmakuSelection;
        if (manualSelection && manualSelection.key !== manualDanmakuKey(requestedItemId)) {
            manualDanmakuSelection = null;
        } else if (manualSelection) {
            window.ede.episode_info = { ...manualSelection.info };
            try {
                logger.info('[手动匹配] 使用当前条目已确认的在线来源，跳过本地优先');
                const info = manualSelection.info;
                const comments = await fetchComment(info.episodeId, info.apiPrefix,
                    info.apiAppId, info.apiAppSecret);
                if (!isCurrentLoad()) return;
                await createDanmaku(comments, currentSessionId);
                if (isCurrentLoad()) logger.info('[手动匹配] 所选来源弹幕已加载');
            } catch (error) {
                if (!isCurrentLoad()) return;
                logger.warn('[手动匹配] 所选来源加载失败，未回退本地弹幕');
                embyToast({ text: '所选来源弹幕加载失败，请重试或重新选择来源' });
            } finally {
                if (isCurrentLoad()) {
                    window.ede.loading = false;
                    ddClearLoadingRing();
                }
            }
            return;
        }

        // 自动播放保留 DLL 本地优先；手动选择已在上方独立处理。
        if (requestedItemId) {
            const backendPlayback = await ddBackend.queryPlayback(requestedItemId);
            if (!isCurrentLoad()) return;
            const backendComments = backendPlayback?.comments || backendPlayback?.Comments;
            const backendFound = backendPlayback?.found ?? backendPlayback?.Found;
            if (backendFound === true && Array.isArray(backendComments)) {
                // DLL 返回结构化 DTO；本地解析器仍使用弹弹 play 的 {cid,p,m} 输入格式，
                // 在适配层转换，避免把后端契约细节泄漏到原有过滤和渲染链路。
                const comments = backendComments.map(comment => {
                    const text = comment?.text ?? comment?.Text;
                    const time = Number(comment?.time ?? comment?.Time);
                    const mode = Number(comment?.mode ?? comment?.Mode);
                    const color = Number(comment?.color ?? comment?.Color);
                    const userId = String(comment?.userId ?? comment?.UserId ?? '');
                    if (typeof text !== 'string' || !Number.isFinite(time)
                        || !Number.isInteger(mode) || !Number.isInteger(color)) return null;
                    return { cid: userId, p: `${time},${mode},${color},${userId}`, m: text };
                });
                if (comments.some(comment => comment === null)) {
                    logger.warn('[DLL] 本地弹幕 DTO 字段无效，回退 JS 链路');
                } else {
                    logger.info(`[DLL] 读取本地弹幕 ${comments.length} 条`);
                    try {
                        await createDanmaku(comments, currentSessionId);
                        if (!isCurrentLoad()) return;
                        // 只保存当前任务的本地展示信息，不伪造在线分集 ID 或参与匹配推理。
                        const episodeLabel = item?.Type === 'Episode'
                            ? [item.ParentIndexNumber != null ? `第${item.ParentIndexNumber}季` : '',
                                item.IndexNumber != null ? `第${item.IndexNumber}集` : '', item.Name || ''].filter(Boolean).join(' ') : '';
                        window.ede.localDanmakuInfo = {
                            title: String(item?.SeriesName || item?.Name || '当前媒体'),
                            episode: episodeLabel,
                            source: String(backendPlayback.source || '本地 XML'),
                            commentCount: comments.length,
                        };
                        if (isCurrentLoad()) ddClearLoadingRing();
                        return;
                    } catch (error) {
                        // DLL 数据格式或渲染失败时必须继续原有 JS 匹配链路，不能把旁路故障当成无弹幕。
                        if (!isCurrentLoad()) return;
                        logger.warn('[DLL] 本地弹幕渲染失败，回退 JS 链路', error);
                        clearDanmakuUI();
                    }
                }
            }
        }

        if (!isCurrentLoad()) return;

        logger.debug('[dd-danmaku] getEmbyItemInfo 返回:', item ? item.Name : 'null');
        if (item) {
            const libraryInfo = await getItemLibraryInfo(item);
            if (!isCurrentLoad()) return;
            logger.debug('[dd-danmaku] getItemLibraryInfo 返回:', libraryInfo);
            if (libraryInfo) {
                window.ede.currentLibraryInfo = libraryInfo;
                const excludedList = lsGetItem(lsKeys.excludedLibraries.id) || [];
                if (excludedList.includes(libraryInfo.libraryName)) {
                    logger.info(`[dd-danmaku] 媒体库 "${libraryInfo.libraryName}" 在排除列表中，跳过弹幕搜索和加载`);
                    appendvideoOsdDanmakuInfo(0);
                    createDanmaku([], currentSessionId);
                    return;
                }
            }
        }

        if (window.ede) {

            // =========== [修改开始] ===========
            // 在这里调用清理函数，确保发起请求前，上一集的 UI 已经被清除
            if (typeof clearDanmakuUI === 'function') {
                clearDanmakuUI();
            }
            logger.info('开始加载新弹幕，已清除上一集 UI');
            // =========== [修改结束] ===========

            // 加载开始：显示圆形加载环（indeterminate 模式），tip 留空避免影响 tooltip 显示
            ddSetLoadingRing(-1, '');
        }

        // 注意：这里不再设置 window.ede.loading = true，因为并发时无法准确控制
        // 我们改用 ID 校验来控制

        // 本地 XML 已由前面的 DLL 策略入口处理，未命中时只回退在线链路。
        loadOnlineDanmaku(loadType, currentSessionId);
    }

    function loadOnlineDanmaku(loadType, sessionId) {
        // 安全检查：如果这个任务还没开始跑就已经过时了，直接停止
        if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) {
            logger.warn('任务已过期，停止在线加载');
            return;
        }

        getEpisodeInfo(
            loadType === LOAD_TYPE.INIT || loadType === LOAD_TYPE.CHECK,
            loadType !== LOAD_TYPE.SEARCH && loadType !== LOAD_TYPE.REFRESH
        )
            .then((info) => {
                return new Promise((resolve, reject) => {
                    // 二次检查
                    if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) {
                        reject('任务已过期'); return;
                    }

                    if (!info) {
                        if (loadType !== LOAD_TYPE.INIT) {
                            reject('播放器未完成加载或媒体库被排除');
                        } else {
                            reject(null);
                        }
                        return; // [修复] 添加 return 防止继续执行
                    }
                    if (
                        loadType !== LOAD_TYPE.SEARCH &&
                        loadType !== LOAD_TYPE.REFRESH &&
                        loadType !== LOAD_TYPE.RELOAD &&
                        loadType !== LOAD_TYPE.INIT &&
                        window.ede.danmaku &&
                        window.ede.episode_info &&
                        window.ede.episode_info.episodeId == info.episodeId
                    ) {
                        reject('当前播放视频未变动');
                    } else {
                        window.ede.episode_info = info;
                        resolve(info.episodeId);
                    }
                });
            })
            .then(
                (episodeId) => {
                    if (episodeId) {
                        // 再次检查
                        if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) return;

                        if (loadType === LOAD_TYPE.RELOAD && window.ede.danmuCache[episodeId]) {
                            return createDanmaku(window.ede.danmuCache[episodeId], sessionId)
                                .then(() => {
                                    if (window.ede && sessionId === window.ede.lastLoadId)
                                        logger.info('弹幕已从缓存加载就位');
                                })
                                .catch((err) => {
                                    logger.debug(err);
                                });
                        } else {
                            // [新增] 调用弹幕接口前更新状态卡片和 tooltip 提示
                            const fetchAnimeName = (window.ede.episode_info && window.ede.episode_info.animeTitle) || '';
                            setOsdDanmakuText('弹幕：正在获取弹幕');
                            if (window.ede && fetchAnimeName) {
                                window.ede._danmakuLoadTitle = `正在获取弹幕：${fetchAnimeName}`;
                            }
                            // return 确保外层链等待 fetchComment 及 createDanmaku 全部完成，
                            // 避免 loading=false 和按钮透明度恢复早于弹幕到位
                            return fetchComment(episodeId).then((comments) => {
                                if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) return;

                                window.ede.danmuCache[episodeId] = comments;
                                // 写入缓存后裁剪，只保留最近 3 个集的弹幕，防止长时间播放内存无限增长
                                const MAX_CACHE = 3;
                                const cacheKeys = Object.keys(window.ede.danmuCache);
                                if (cacheKeys.length > MAX_CACHE) {
                                    cacheKeys.slice(0, cacheKeys.length - MAX_CACHE).forEach(k => delete window.ede.danmuCache[k]);
                                }
                                return createDanmaku(comments, sessionId)
                                    .then(() => {
                                        if (window.ede && sessionId === window.ede.lastLoadId)
                                            logger.info('弹幕已从网络加载就位');
                                    })
                                    .catch((err) => {
                                        logger.debug(err);
                                    });
                            });
                        }
                    }
                },
                (msg) => {
                    if (msg) {
                        logger.debug(msg);
                    }
                },
            )
            .then(() => {
                if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) return;

                const extCommentCache = window.ede.extCommentCache[window.ede.itemId] || {};
                objectEntries(extCommentCache).forEach(([key, val]) => {
                    addExtComments(key, val);
                })
                window.ede.loading = false;
                // 加载完成：清除圆形加载环
                ddClearLoadingRing();
                const danmakuCtrEle = getById(eleIds.danmakuCtr);
                if (danmakuCtrEle && danmakuCtrEle.style.opacity !== '1') {
                    danmakuCtrEle.style.opacity = '1';
                }
            })
            .catch((err) => {
                if (sessionId && sessionId !== window.ede.lastLoadId) return;
                logger.debug(err);
                // 仅当前任务可结束加载提示，旧请求失败不得影响新页。
                ddClearLoadingRing();
            });
    }

    async function danmakuFilter(comments) {
        let _comments = [...comments];
        danmakuAutoFilter(_comments);
        _comments = danmakuTypeFilter(_comments);
        _comments = danmakuSourceFilter(_comments);
        _comments = danmakuDensityLevelFilter(_comments);
        _comments = danmakuKeywordsFilter(_comments);
        _comments = await danmakuMergeSimilar(_comments, lsGetItem(lsKeys.mergeSimilarPercent.id), lsGetItem(lsKeys.mergeSimilarTime.id));
        _comments = danmakuAntiOverlapFilter(_comments);
        return _comments;
    }
   /**
     * [新增] 获取统一的弹幕字体大小 (公共方法)
     * 逻辑提取自原 danmakuParser，供 parser 和 antiOverlapFilter 复用
     */
    function getDanmakuFontSize() {
        const fontSizeRate = lsGetItem(lsKeys.fontSizeRate.id) / 100;
        let fontSize = 25;
        // 播放页媒体次级标题 h3 元素
        const fontSizeReferent = getByClass(classes.videoOsdTitle);
        if (fontSizeReferent) {
            const computed = getComputedStyle(fontSizeReferent).fontSize;
            if (computed) {
                fontSize = parseFloat(computed.replace('px', '')) * fontSizeRate;
            }
        } else {
            fontSize = Math.round(
                (window.screen.height > window.screen.width
                    ? window.screen.width
                    : window.screen.height / 1080) * 18 * fontSizeRate
            );
        }
        return fontSize;
    }


    /**
     * 防重叠过滤器
     * 根据显示区域计算可用轨道数，模拟轨道分配，过滤掉会超出轨道的弹幕
     *
     * 原理：
     * 1. 根据 heightPercent 和字体大小计算可用轨道数
     * 2. 按时间顺序遍历弹幕，模拟轨道分配
     * 3. 滚动弹幕的轨道占用时间 = 弹幕完全进入屏幕的时间 + 缓冲时间
     * 4. 顶部/底部弹幕的轨道占用时间 = 整个显示时间
     * 5. 无法分配轨道的弹幕被过滤掉
     */
    function danmakuAntiOverlapFilter(comments) {

    if (!lsGetItem(lsKeys.antiOverlap.id)) {
        return comments;
    }

    const beforeCount = comments.length;
    if (beforeCount === 0) return comments;

    // 获取配置参数
    const heightPercent = lsGetItem(lsKeys.heightPercent.id);
    const speedRate = lsGetItem(lsKeys.speed.id) / 100;

    // 获取容器尺寸
    const container = document.querySelector(mediaContainerQueryStr);
    const containerHeight = container ? container.offsetHeight : (window.innerHeight || 720);
    const containerWidth = container ? container.offsetWidth : (window.innerWidth || 1280);

    // 使用公共函数获取字体大小
    const fontSize = getDanmakuFontSize();

    // 为滚动弹幕和固定弹幕使用不同的高度计算

    // 滚动弹幕高度
    const verticalPadding = 2;
    const scrollDanmakuHeight = (fontSize * 1.3) + verticalPadding;

    // 固定弹幕高度（顶部/底部需要更大的间距）
    const fixedLineHeight = 1.4;  // 固定弹幕的行高系数
    const fixedVerticalGap = Math.max(10, fontSize * 0.4);  // 固定弹幕的额外间距
    const fixedDanmakuHeight = (fontSize * fixedLineHeight) + fixedVerticalGap;

    // 计算实际可用高度和轨道数
    const availableHeight = containerHeight * (heightPercent / 100);

    // 为滚动弹幕和固定弹幕分别计算轨道数
    const scrollMaxTracks = Math.max(1, Math.floor(availableHeight / scrollDanmakuHeight));
    const fixedMaxTracks = Math.max(1, Math.floor(availableHeight / fixedDanmakuHeight));

    // 顶部和底部弹幕轨道各占一部分
    const topMaxTracks = Math.max(1, Math.floor(fixedMaxTracks / 3));
    const bottomMaxTracks = Math.max(1, Math.floor(fixedMaxTracks / 4));

    // 速度计算
    const baseSpeed = 144;
    const speed = baseSpeed * speedRate;
    const duration = containerWidth / speed;
    const screenDuration = duration;

    // 估算文字宽度
    const estimateWidth = (text) => {
        let width = 0;
        for (let i = 0; i < text.length; i++) {
            width += (text.charCodeAt(i) > 127 ? 1 : 0.6);
        }
        return (width * fontSize) + 35;
    };

    const tracks = {
        rtl: new Array(scrollMaxTracks).fill(null),
        ltr: new Array(scrollMaxTracks).fill(null),
        top: new Array(topMaxTracks).fill(null),
        bottom: new Array(bottomMaxTracks).fill(null),
    };

    // 按时间排序
    const sortedComments = [...comments].sort((a, b) => a.time - b.time);

    const filteredComments = sortedComments.filter(curr => {
        const mode = curr.mode || 'rtl';
        const trackType = (mode === 'ltr') ? 'rtl' : mode;
        const trackList = tracks[trackType] || tracks['rtl'];

        if (!trackList || trackList.length === 0) return true;

        const currWidth = estimateWidth(curr.text);
        const currTime = curr.time;

        // 顶部/底部弹幕处理
        if (mode === 'top' || mode === 'bottom') {
            // 固定弹幕的显示时长
            const displayDuration = 5;
            const occupyTime = displayDuration;

            for (let i = 0; i < trackList.length; i++) {
                const last = trackList[i];

                if (!last || currTime >= last.time + occupyTime) {
                    trackList[i] = { time: currTime, width: 0 };
                    return true;
                }
            }

            return false;
        }

        // 滚动弹幕碰撞检测
        const buffer = 0.5;

        for (let i = 0; i < trackList.length; i++) {
            const last = trackList[i];

            if (!last) {
                trackList[i] = { time: currTime, width: currWidth };
                return true;
            }

            // 进场追尾检测
            const timeToFullyEnter = screenDuration * (last.width / (containerWidth + last.width));
            const safeTimeEnter = last.time + timeToFullyEnter + buffer;

            // 离场追尾检测
            const timeToCatchUp = screenDuration * (currWidth / (containerWidth + currWidth));
            const safeTimeExit = last.time + timeToCatchUp + buffer;

            const safeTime = Math.max(safeTimeEnter, safeTimeExit);

            if (currTime >= safeTime) {
                trackList[i] = { time: currTime, width: currWidth };
                return true;
            }
        }
        return false;
    });

    const afterCount = filteredComments.length;
    const filteredCount = beforeCount - afterCount;
    if (filteredCount > 0) {
        logger.debug(`[防重叠] 容器: ${containerWidth}x${containerHeight}, 字体: ${fontSize}px`);
        logger.debug(`  - 滚动弹幕高度: ${scrollDanmakuHeight.toFixed(1)}px, 轨道数: ${scrollMaxTracks}`);
        logger.debug(`  - 固定弹幕高度: ${fixedDanmakuHeight.toFixed(1)}px (行高: ${fixedLineHeight}, 间距: ${fixedVerticalGap.toFixed(1)}px)`);
        logger.debug(`  - 顶部轨道: ${topMaxTracks}, 底部轨道: ${bottomMaxTracks}`);
        logger.debug(`  - 过滤: ${beforeCount} -> ${afterCount} (丢弃 ${filteredCount})`);
    }

    return filteredComments;
}


    function danmakuAutoFilter(comments) {
        const autoFilterCount = lsGetItem(lsKeys.autoFilterCount.id);
        if (autoFilterCount == 0 || comments.length < autoFilterCount) {
            return danmakuAutoFilterCancel();
        }
        let msg = `检测到 ${comments.length} 条弹幕 > ${lsKeys.autoFilterCount.name}:${autoFilterCount},准备开始自动过滤(单集有效)`;
        const initMsgLenth = msg.length;
        const heightPercent = lsGetItem(lsKeys.heightPercent.id);
        if (heightPercent > 90) {
            window.ede.tempLsValues[lsKeys.heightPercent.id] = heightPercent;
            lsSetItem(lsKeys.heightPercent.id, 90);
            msg += `\n已自动调整 ${lsKeys.heightPercent.name}:90`;
        }
        const typeFilter = lsGetItem(lsKeys.typeFilter.id);
        if (!typeFilter.includes(danmakuTypeFilterOpts.bottom.id)) {
            window.ede.tempLsValues[lsKeys.typeFilter.id] = typeFilter;
            const typeFilterTemp = [...typeFilter, danmakuTypeFilterOpts.bottom.id];
            lsSetItem(lsKeys.typeFilter.id, typeFilterTemp);
            msg += `\n已自动添加 ${lsKeys.typeFilter.name}:${danmakuTypeFilterOpts.bottom.name}`;
        }
        const mergeSimilarEnable = lsGetItem(lsKeys.mergeSimilarEnable.id);
        if (!mergeSimilarEnable) {
            window.ede.tempLsValues[lsKeys.mergeSimilarEnable.id] = mergeSimilarEnable;
            lsSetItem(lsKeys.mergeSimilarEnable.id, true);
            msg += `\n已自动调整 ${lsKeys.mergeSimilarEnable.name}:true`;
        }
        if (msg.length != initMsgLenth) {
            embyToast({ text: msg });
            logger.debug('[自动过滤] ' + msg);
        }
    }

    function danmakuAutoFilterCancel() {
        if (Object.keys(window.ede.tempLsValues).length > 0) {
            objectEntries(window.ede.tempLsValues).forEach(([key, val]) => lsSetItem(key, val));
            window.ede.tempLsValues = {};
            logger.debug('[自动过滤] 已从临时值恢复用户设置');
        }
    }

    /** 过滤弹幕类型 */
    function danmakuTypeFilter(comments) {
        let idArray = lsGetItem(lsKeys.typeFilter.id);
        // 彩色过滤,只留下默认的白色
        if (idArray.includes(danmakuTypeFilterOpts.onlyWhite.id)) {
            comments = comments.filter(c => '#ffffff' === c.style.color.toLowerCase().slice(0, 7));
            idArray.splice(idArray.indexOf(danmakuTypeFilterOpts.onlyWhite.id), 1);
        }
        // 过滤滚动弹幕
        if (idArray.includes(danmakuTypeFilterOpts.rolling.id)) {
            comments = comments.filter(c => danmakuTypeFilterOpts.ltr.id !== c.mode
                && danmakuTypeFilterOpts.rtl.id !== c.mode);
            idArray.splice(idArray.indexOf(danmakuTypeFilterOpts.rolling.id), 1);
        }
        // 按 emoji 过滤
        if (idArray.includes(danmakuTypeFilterOpts.emoji.id)) {
            comments = comments.filter(c => !emojiRegex.test(c.text));
            idArray.splice(idArray.indexOf(danmakuTypeFilterOpts.emoji.id), 1);
        }
        // 过滤特定模式的弹幕
        if (idArray.length > 0) {
            comments = comments.filter(c => !idArray.includes(c.mode));
        }
        return comments;
    }

    /** 过滤弹幕来源平台 */
    function danmakuSourceFilter(comments) {
        return comments.filter(c => !(lsGetItem(lsKeys.sourceFilter.id).includes(c.source)));
    }

    /** 过滤弹幕密度等级,水平和垂直 */
    function danmakuDensityLevelFilter(comments) {
        let level = lsGetItem(lsKeys.filterLevel.id);
        if (level == 0) {
            return comments;
        }
        const limit = 9 - level * 2;
        const vertical_limit = 6;

        // 改用 Map 替代稀疏数组，避免超长视频大跨度稀疏数组导致遍历成本与最大时间相关
        const buckets = new Map();       // 水平弹幕按秒分桶
        const vBuckets = new Map();      // 垂直弹幕按 3 秒分桶
        const result = [];

        for (let index = 0; index < comments.length; index++) {
            const element = comments[index];
            // 守卫：跳过数组中混入的空项，防止访问 .time 时崩溃
            if (!element || element.time == null) continue;
            const i = Math.ceil(element.time);
            const i_v = Math.ceil(element.time / 3);

            if (!vBuckets.has(i_v)) vBuckets.set(i_v, 0);
            if (vBuckets.get(i_v) < vertical_limit) {
                vBuckets.set(i_v, vBuckets.get(i_v) + 1);
            } else {
                element.mode = 'rtl';
            }

            if (!buckets.has(i)) buckets.set(i, 0);
            if (buckets.get(i) < limit) {
                buckets.set(i, buckets.get(i) + 1);
                result.push(element);
            }
        }
        return result;
    }

    /** 通过屏蔽关键词过滤弹幕 */
    function danmakuKeywordsFilter(comments) {
        if (!lsGetItem(lsKeys.filterKeywordsEnable.id)) { return comments; }
        const keywords = lsGetItem(lsKeys.filterKeywords.id)
            .split(/\r?\n/).map(k => k.trim()).filter(k => k.length > 0 && !k.startsWith('// '));
        if (keywords.length === 0) { return comments; }
        const cKeys = [ 'text', ...Object.keys(showSource) ];

        // 进入过滤前一次性预编译正则，避免每条弹幕×每个关键词都 new RegExp
        const compiled = keywords.map(keyword => {
            try {
                return { regex: new RegExp(keyword), literal: null };
            } catch (_) {
                return { regex: null, literal: keyword }; // 非法正则退化为字面量匹配
            }
        });

        return comments.filter(comment =>
            !compiled.some(({ regex, literal }) =>
                cKeys.some(key => {
                    const val = comment[key];
                    if (!val) return false;
                    return regex ? regex.test(val) : val.includes(literal);
                })
            )
        );
    }

    // --- 优化：复用 Worker 实例的合并函数 ---
    // 单飞队列：同一时刻只允许一个合并任务在 Worker 中运行，防止快速切集时消息串包
   let _mergeWorkerBusy = false;
   const _mergeWorkerQueue = [];

   function _runMergeWorkerTask(worker, lightComments, comments, threshold, timeWindow, enable, resolve) {
       const startTime = performance.now();
       const onMessage = (e) => {
           const results = e.data;
           const endTime = performance.now();
           worker.removeEventListener('message', onMessage);
           _mergeWorkerBusy = false;
           // 处理下一个排队任务
           if (_mergeWorkerQueue.length > 0) {
               const next = _mergeWorkerQueue.shift();
               _mergeWorkerBusy = true;
               _runMergeWorkerTask(worker, next.lightComments, next.comments, next.threshold, next.timeWindow, next.enable, next.resolve);
           }
           if (!results) { resolve(comments); return; }
           // 数据重组 (Rehydration)
           const finalComments = results.map(item => {
               const originalComment = comments[item.i];
               return item.t ? { ...originalComment, text: item.t, xCount: true } : originalComment;
           });
           logger.info(`[合并相似弹幕] 完成, 耗时: ${(endTime - startTime).toFixed(2)}ms, 屏蔽: ${comments.length - finalComments.length}`);
           resolve(finalComments);
       };
       worker.addEventListener('message', onMessage);
       worker.postMessage({ lightComments, threshold, timeWindow, enable });
   }

   function danmakuMergeSimilar(comments, threshold = 50, timeWindow = 15) {
       return new Promise((resolve) => {
           const enable = lsGetItem(lsKeys.mergeSimilarEnable.id);
           if (!enable || !comments || comments.length === 0) {
               resolve(comments);
               return;
           }
           // [优化] 复用 Worker，避免重复创建销毁的开销
           if (!window.ede.mergeWorker) {
               logger.debug('[合并Worker] 初始化新线程...');
               window.ede.mergeWorker = createWorker(mergeWorkerBody);
           }
           const worker = window.ede.mergeWorker;
           // 1. 数据精简 (Data Slimming)：只传 text/time/index，减少传输体积 ~80%
           const lightComments = comments.map((c, index) => ({ t: c.text, m: c.time, i: index }));
           if (_mergeWorkerBusy) {
               // 已有任务在跑，入队等待
               _mergeWorkerQueue.push({ lightComments, comments, threshold, timeWindow, enable, resolve });
           } else {
               _mergeWorkerBusy = true;
               _runMergeWorkerTask(worker, lightComments, comments, threshold, timeWindow, enable, resolve);
           }
       });
   }

    // [优化] 弹幕解析缓存（全量解析结果缓存，避免相同弹幕集重复解析）
    const danmakuParseCache = {
        // 全量解析结果缓存
        fullParsed: null,
        // 全量解析的源数据引用（用于判断是否需要重新解析）
        fullSource: null,

        // 清空缓存（切换剧集时调用）
        clearAll() {
            this.fullParsed = null;
            this.fullSource = null;
            logger.debug('[弹幕缓存] 已清空所有缓存');
        }
    };

    // [优化] 全量解析弹幕（带缓存，避免重复解析相同弹幕集）
    // 直接复用经过充分验证的 danmakuParser 函数，确保输出格式完全兼容
    function parseAllDanmaku(comments) {
        // 如果弹幕源数据没变，直接返回缓存
        if (danmakuParseCache.fullSource === comments && danmakuParseCache.fullParsed) {
            return danmakuParseCache.fullParsed;
        }

        // 调用原始 danmakuParser 进行全量解析
        const parsed = danmakuParser(comments);

        // 缓存结果和源引用
        danmakuParseCache.fullParsed = parsed;
        danmakuParseCache.fullSource = comments;

        return parsed;
    }

    function danmakuParser($obj) {
        const fontSize = getDanmakuFontSize();
        const fontWeight = lsGetItem(lsKeys.fontWeight.id);
        const fontStyleIdx = lsGetItem(lsKeys.fontStyle.id);
        const fontStyleObj = styles.fontStyles[fontStyleIdx] || styles.fontStyles[0];
        const fontStyle = fontStyleObj.id;
        const fontFamily = lsGetItem(lsKeys.fontFamily.id);
        // 弹幕透明度
        const fontOpacity = Math.round(lsGetItem(lsKeys.fontOpacity.id) / 100 * 255).toString(16).padStart(2, '0');
        // 时间轴偏移秒数
        const timelineOffset = lsGetItem(lsKeys.timelineOffset.id);
        const sourceUidReg = /\[(.*)\](.*)/;
        const showSourceIds = lsGetItem(lsKeys.showSource.id);

        // 读取转换设置 & 初始化统计
        const convertTopTo = lsGetItem(lsKeys.convertTopTo.id);
        const convertBottomTo = lsGetItem(lsKeys.convertBottomTo.id);
        let stat = { t2b: 0, t2r: 0, b2t: 0, b2r: 0 };
        // -------------------------------------
       // const removeEmojiEnable = lsGetItem(lsKeys.removeEmojiEnable.id);
       //const $xml = new DOMParser().parseFromString(string, 'text/xml')
        const parsedComments = $obj
            .map(($comment) => {
                const p = $comment.p;
                //if (p === null || $comment.childNodes[0] === undefined) return null;
                const values = p.split(',');
                let mode = { 6: 'ltr', 1: 'rtl', 5: 'top', 4: 'bottom' }[values[1]];
                if (!mode) return null;

                // 位置转换逻辑
                if (mode === 'top') {
                    if (convertTopTo === 'bottom') {
                        mode = 'bottom';
                        stat.t2b++;
                    } else if (convertTopTo === 'rolling') {
                        mode = 'rtl';
                        stat.t2r++;
                    }
                } else if (mode === 'bottom') {
                    if (convertBottomTo === 'top') {
                        mode = 'top';
                        stat.b2t++;
                    } else if (convertBottomTo === 'rolling') {
                        mode = 'rtl';
                        stat.b2r++;
                    }
                }
                // -------------------------

                // 弹幕颜色+透明度
                const baseColor = Number(values[2]).toString(16).padStart(6, '0');
                const color = `${baseColor}${fontOpacity}`; // 生成8位十六进制颜色
                const shadowColor = baseColor === '000000' ? `#ffffff${fontOpacity}` : `#000000${fontOpacity}`;
                const sourceUidMatches = values[3].match(sourceUidReg);
                const sourceId = sourceUidMatches && sourceUidMatches[1] ? sourceUidMatches[1] : danmakuSource.DanDanPlay.id;
                const originalUserId = sourceUidMatches && sourceUidMatches[2] ? sourceUidMatches[2] : values[3];
                const cmt = {
                    text: $comment.m,
                    mode,
                    time: values[0] * 1 + timelineOffset,
                    style: getCommentStyle(color, shadowColor, fontStyle, fontWeight, fontSize, fontFamily),
                    // 以下为自定义属性
                    [showSource.cid.id]: $comment.cid,
                    [showSource.source.id]: sourceId,
                    [showSource.originalUserId.id]: originalUserId,
                };
                if (showSourceIds.length > 0) {
                    cmt.originalText = cmt.text;
                    cmt.text += showSourceIds.map(id => id === showSource.source.id ? `,[${cmt[id]}]` : ',' + cmt[id]).join('');
                }
                 // if (removeEmojiEnable) {
                //     cmt.text = cmt.text.replace(emojiRegex, '');
                // }
                cmt.cuid = cmt[showSource.cid.id] + ',' + cmt[showSource.originalUserId.id];

                return cmt;
            })
            .filter((x) => x)
            .sort((a, b) => a.time - b.time);

        // 日志输出
        if (stat.t2b + stat.t2r + stat.b2t + stat.b2r > 0) {
            let msg = [];
            if (stat.t2b) msg.push(`顶部转换为底部 ${stat.t2b}条`);
            if (stat.t2r) msg.push(`顶部转换为滚动 ${stat.t2r}条`);
            if (stat.b2t) msg.push(`底部转换为顶部 ${stat.b2t}条`);
            if (stat.b2r) msg.push(`底部转换为滚动 ${stat.b2r}条`);
            logger.info(`[转换成功]: ${msg.join(' ')}`);
        }
        return parsedComments;
    }

    function getCommentStyle(color, shadowColor, fontStyle, fontWeight, fontSize, fontFamily) {
        return {
            color: `#${color}`, // dom
            textShadow: `-1px -1px ${shadowColor}, -1px 1px ${shadowColor}, 1px -1px ${shadowColor}, 1px 1px ${shadowColor}`,

            font: `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`,
            fillStyle: `#${color}`, // canvas
            strokeStyle: shadowColor,
            lineWidth: 2.0,
        };
    }

    function toastByDanmaku(text, type) {
        text = toastPrefixes.system + text;
        const fontSize = parseFloat(getComputedStyle(getByClass(classes.videoOsdTitle))
            .fontSize.replace('px', '')) * 1.5;
        const color = styles.colors[type];
        const dandanplayMode = 5;
        const time = document.querySelector(mediaQueryStr).currentTime;
        const fontOpacity = 'ff';
        const colorStr = `000000${color.toString(16)}${fontOpacity}`.slice(-8);
        const mode = { 6: 'ltr', 1: 'rtl', 5: 'top', 4: 'bottom' }[dandanplayMode];
        const comment = {
            text,
            mode,
            time,
            style: {
                fontSize: `${fontSize}px`,
                color: `#${colorStr}`,
                textShadow:
                    colorStr === '00000' ? '-1px -1px #fff, -1px 1px #fff, 1px -1px #fff, 1px 1px #fff' : '-1px -1px #000, -1px 1px #000, 1px -1px #000, 1px 1px #000',

                font: `${fontSize}px sans-serif`,
                fillStyle: `#${colorStr}`,
                strokeStyle: colorStr === '000000' ? `#ffffff${fontOpacity}` : `#000000${fontOpacity}`,
                lineWidth: 2.0,
            }, // emit 无法添加自定义属性
        };
        window.ede.danmaku.emit(comment);
    }

    function createDialog() {
        require([
            'emby-select', 'emby-checkbox', 'emby-slider', 'emby-textarea', 'emby-collapse'
            , 'emby-button',
        ]);
        const html = `<div id="${eleIds.dialogContainer}"></div>`;
        embyDialog({ html, buttons: [{ name: '关闭' }] });
        waitForElement('#' + eleIds.dialogContainer, afterEmbyDialogCreated);
    }

    async function afterEmbyDialogCreated(dialogContainer) {
        const itemInfoMap = await getMapByEmbyItemInfo();
        if (itemInfoMap) {
            window.ede.searchDanmakuOpts = {
                _id_key: itemInfoMap._id_key,
                _season_key: itemInfoMap._season_key,
                _episode_key: itemInfoMap._episode_key,
                animeId: itemInfoMap.animeId,
                animeName: itemInfoMap.animeName,
                seriesName: itemInfoMap.seriesName,
                seriesOrMovieId: itemInfoMap.seriesOrMovieId,
                episode: (parseInt(itemInfoMap.episode) || 1) - 1, // convert to index
                animes: [],
            }
        }
        let formDialogHeader = getByClass(classes.formDialogHeader);
        const formDialogFooter = getByClass(classes.formDialogFooter);
        formDialogHeader = formDialogHeader || dialogContainer;
        const tabsMenuContainer = document.createElement('div');
        tabsMenuContainer.className = classes.embyTabsMenu;
        tabsMenuContainer.append(embyTabs(danmakuTabOpts, danmakuTabOpts[0].id, 'id', 'name', (value) => {
            danmakuTabOpts.forEach(obj => {
                const elem = getById(obj.id);
                if (elem) { elem.hidden = obj.id !== value.id; }
            });
        }));
        formDialogHeader.append(tabsMenuContainer);
        formDialogHeader.style = 'width: 100%; padding: 0; height: auto;';

        // [性能优化] 延迟构建 tab 内容，避免同步构建所有 tab 导致弹幕动画卡顿
        // 原理：只立即构建当前可见的第一个 tab，其余 tab 延迟到下一帧再构建
        const builtTabs = new Set();
        danmakuTabOpts.forEach((tab, index) => {
            const tabContainer = document.createElement('div');
            tabContainer.id = tab.id;
            tabContainer.style.textAlign = 'left';
            tabContainer.hidden = index != 0;
            dialogContainer.append(tabContainer);
        });

        // 立即构建第一个 tab（用户能看到的）
        try {
            danmakuTabOpts[0].buildMethod(danmakuTabOpts[0].id);
            builtTabs.add(danmakuTabOpts[0].id);
        } catch (error) { logger.error(error); }

        // 其余 tab 延迟构建（不阻塞主线程，不影响弹幕动画）
        requestAnimationFrame(() => {
            danmakuTabOpts.forEach((tab) => {
                if (builtTabs.has(tab.id)) return;
                try {
                    tab.buildMethod(tab.id);
                    builtTabs.add(tab.id);
                } catch (error) { logger.error(error); }
            });
        });
        if (formDialogFooter) {
            formDialogFooter.style.padding = '0.3em';
        }
    }

    function buildDanmakuSetting(containerId) {
        const container = getById(containerId);
        let template =  `
            <div style="display: flex; justify-content: center;">
                <div>
                    <div id="${eleIds.danmakuSwitchDiv}" style="margin-bottom: 0.2em; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center;">
                            <label class="${classes.embyLabel}">${lsKeys.switch.name} </label>
                        </div>
                        <div id="${eleIds.antiOverlapDiv}" style="display: flex; align-items: center;">
                            <label class="${classes.embyLabel}">${lsKeys.antiOverlap.name} </label>
                        </div>
                    </div>
                    <div style="${styles.embySlider}">
                        <label class="${classes.embyLabel}" style="width: 5em;">${lsKeys.filterLevel.name}: </label>
                        <div id="${eleIds.filterLevelDiv}" style="width: 15.5em; text-align: center;"></div>
                        <label>
                            <label style="${styles.embySliderLabel}"></label>
                            <label></label>
                        </label>
                    </div>
                    <div style="${styles.embySlider}">
                        <label class="${classes.embyLabel}" style="width: 5em;">${lsKeys.heightPercent.name}: </label>
                        <div id="${eleIds.heightPercentDiv}" style="width: 15.5em; text-align: center;"></div>
                        <label>
                            <label style="${styles.embySliderLabel}"></label>
                            <label>%</label>
                        </label>
                    </div>
                    <div style="${styles.embySlider}">
                        <label class="${classes.embyLabel}" style="width: 5em;">${lsKeys.fontSizeRate.name}: </label>
                        <div id="${eleIds.danmakuSizeDiv}" style="width: 15.5em; text-align: center;"></div>
                        <label>
                            <label style="${styles.embySliderLabel}"></label>
                            <label>%</label>
                        </label>
                    </div>
                    <div style="${styles.embySlider}">
                        <label class="${classes.embyLabel}" style="width: 5em;">${lsKeys.fontOpacity.name}: </label>
                        <div id="${eleIds.danmakuOpacityDiv}" style="width: 15.5em; text-align: center;"></div>
                        <label>
                            <label style="${styles.embySliderLabel}"></label>
                            <label>%</label>
                        </label>
                    </div>
                    <div style="${styles.embySlider}">
                        <label class="${classes.embyLabel}" style="width: 5em;">${lsKeys.speed.name}: </label>
                        <div id="${eleIds.danmakuSpeedDiv}" style="width: 15.5em; text-align: center;"></div>
                        <label>
                            <label style="${styles.embySliderLabel}"></label>
                            <label>%</label>
                        </label>
                    </div>
                    <div style="${styles.embySlider}">
                        <label class="${classes.embyLabel}" style="width: 5em;">${lsKeys.timelineOffset.name}: </label>
                        <div id="${eleIds.timelineOffsetDiv}" style="width: 15.5em; text-align: center;"></div>
                        <label style="${styles.embySliderLabel}"></label>
                    </div>
                    <div is="emby-collapse" title="弹幕字体样式" data-expanded="false">
                        <div class="${classes.collapseContentNav}">
                            <div style="${styles.embySlider}">
                                <label class="${classes.embyLabel}" style="width: 5em;">${lsKeys.fontWeight.name}: </label>
                                <div id="${eleIds.danmakuFontWeightDiv}" style="width: 15.5em; text-align: center;"></div>
                                <label>
                                    <label style="${styles.embySliderLabel}"></label>
                                </label>
                            </div>
                            <div style="${styles.embySlider}">
                                <label class="${classes.embyLabel}" style="width: 5em;">${lsKeys.fontStyle.name}: </label>
                                <div id="${eleIds.danmakuFontStyleDiv}" style="width: 15.5em; text-align: center;"></div>
                                <label>
                                    <label style="${styles.embySliderLabel}"></label>
                                </label>
                            </div>

                            <div id="${eleIds.fontFamilyCtrl}" style="margin: 0.6em 0;"></div>
                            <div style="${styles.embySlider}">
                                <label class="${classes.embyLabel}" style="width: 5em;">${lsKeys.fontFamily.name}: </label>
                                <div id="${eleIds.fontFamilyDiv}" class="${classes.embySelectWrapper}"></div>
                                <label id="${eleIds.fontFamilyLabel}" style="width: 10em; margin-left: 1em;"></label>
                            </div>
                            <div style="max-width: 31.5em;">
                                <label class="${classes.embyLabel}" style="width: 5em;">弹幕外观: </label>
                                <div id="${eleIds.fontStylePreview}"
                                    class="flex justify-content-center"
                                    style="border: .08em solid gray;color: black;border-radius: .24em;padding: .5em;;background-color: #6a96bd;">
                                    简中/繁體/English/こんにちはウォルド/</br>
                                    ABC/abc/012/~!@<?>[]/《？》【】</br>
                                    ☆*: .｡. o(≧▽≦)o .｡.:*☆</br>
                                    emoji:😆👏🎈🍋🌞⁉️🎉</br>
                                </div>
                                <div class="${classes.embyFieldDesc}">
                                    这些设置会影响此设备上的弹幕外观,此处固定为 dom 引擎,
                                    canvas 引擎效果一样,此处不做切换展示,
                                    因为弹幕大小是根据播放页次标题动态计算的,此处不做参考,
                                    选择或输入的字体是否有效取决于设备本身的字体库,没有网络加载
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="${eleIds.settingsCtrl}" style="margin: 0.6em 0;"></div>
                    <textarea id="${eleIds.settingsText}" style="display: none;resize: vertical;width: 100%" rows="20"
                        is="emby-textarea" class="txtOverview emby-textarea"></textarea>
                </div>
            </div>
        `;
        container.innerHTML = template.trim();

        getById(eleIds.danmakuSwitchDiv, container).querySelector('div:first-child').prepend(
            embyButton({ id: eleIds.danmakuSwitch, label: '弹幕开关'
                , iconKey: lsGetItem(lsKeys.switch.id) ? iconKeys.switch_on : iconKeys.switch_off
                , style: (lsGetItem(lsKeys.switch.id) ? 'color:#52b54b;' : '') + 'font-size:1.5em;padding:0;' }
                // , style: lsGetItem(lsKeys.switch.id) ? 'color:#52b54b;font-size:1.5em;padding:0;': 'font-size:1.5em;padding:0;'}
                , doDanmakuSwitch)
        );
        // 防重叠按钮
        getById(eleIds.antiOverlapDiv, container).prepend(
            embyButton({ id: eleIds.antiOverlapBtn, label: '防重叠开关'
                , iconKey: lsGetItem(lsKeys.antiOverlap.id) ? iconKeys.switch_on : iconKeys.switch_off
                , style: (lsGetItem(lsKeys.antiOverlap.id) ? 'color:#52b54b;' : '') + 'font-size:1.5em;padding:0;' }
                , doAntiOverlapSwitch)
        );
        // 滑块
        getById(eleIds.filterLevelDiv, container).append(
            embySlider({ lsKey: lsKeys.filterLevel }, onSliderChange, onSliderChangeLabel)
        );
        getById(eleIds.heightPercentDiv, container).append(
            embySlider({ lsKey: lsKeys.heightPercent }, onSliderChange, onSliderChangeLabel)
        );
        getById(eleIds.danmakuSizeDiv, container).append(
            embySlider({ lsKey: lsKeys.fontSizeRate }, onSliderChange, onSliderChangeLabel)
        );
        getById(eleIds.danmakuOpacityDiv, container).append(
            embySlider({ lsKey: lsKeys.fontOpacity }, onSliderChange, onSliderChangeLabel
        )
        );
        getById(eleIds.danmakuSpeedDiv, container).append(
            embySlider({ lsKey: lsKeys.speed }, onSliderChange, onSliderChangeLabel)
        );
        // 弹幕时间轴偏移秒数
        const btnContainer = getById(eleIds.timelineOffsetDiv, container);
        const timelineOffsetOpts = { key: lsKeys.timelineOffset.id };
        onSliderChangeLabel(lsGetItem(lsKeys.timelineOffset.id), timelineOffsetOpts);
        timeOffsetBtns.forEach(btn => {
            btnContainer.append(embyButton(btn, (e) => {
                if (e.target) {
                    let oldValue = lsGetItem(lsKeys.timelineOffset.id);
                    let newValue = oldValue + (parseFloat(e.target.getAttribute('valueOffset')) || 0);
                    // 如果 offset 为 0,则 newValue 应该设置为 0
                    if (newValue === oldValue) { newValue = 0; }
                    onSliderChange(newValue, timelineOffsetOpts);
                }
            }));
        });
        buildFontStyleSetting(container);
        // 配置 JSON 导入,导出
        buildSettingsBackup(container);
    }

    function buildSettingsBackup(container) {
        const settingsCtrlEle = getById(eleIds.settingsCtrl, container);
        settingsCtrlEle.append(
            embyButton({ label: '配置', iconKey: iconKeys.more }, (e) => {
                const xChecked = !e.target.xChecked;
                e.target.xChecked = xChecked;
                e.target.title = xChecked ? '关闭' : '配置';
                e.target.firstChild.innerHTML = xChecked ? iconKeys.close : iconKeys.more;
                const settingsTextEle = getById(eleIds.settingsText);
                settingsTextEle.style.display = xChecked ? '' : 'none';
                if (xChecked) { settingsTextEle.value = getSettingsJson(2); }
                [eleIds.settingReloadBtn, eleIds.settingsImportBtn].forEach(id => {
                    getById(id).style.display = xChecked ? '' : 'none';
                });
            })
        );
        settingsCtrlEle.append(
            embyButton({ id: eleIds.settingReloadBtn, label: '刷新', iconKey: iconKeys.refresh, style: 'display: none;' }
                , () => getById(eleIds.settingsText).value = getSettingsJson(2))
        );
        settingsCtrlEle.append(
            embyButton({ id: eleIds.settingsImportBtn, label: '应用', iconKey: iconKeys.done, style: 'display: none;' }, () => {
                // const settings = JSON.parse(getById(eleIds.settingsText).value);
                // lsBatchSet(Object.fromEntries(objectEntries(settings).map(([key, valueObj]) => [key, valueObj.value])));
                lsBatchSet(JSON.parse(getById(eleIds.settingsText).value));
                loadDanmaku(LOAD_TYPE.INIT);
                closeEmbyDialog();
            })
        );
    }

    function buildFontStyleSetting() {
        // --- 1. 弹幕粗细 ---
        var weightDiv = getById(eleIds.danmakuFontWeightDiv);
        weightDiv.append(
            embySlider({ lsKey: lsKeys.fontWeight }, onSliderChange, onSliderChangeLabel)
        );
        var savedWeight = lsGetItem(lsKeys.fontWeight.id);
        if (weightDiv.nextElementSibling) {
            var label = weightDiv.nextElementSibling.querySelector('label');
            if (label) label.innerText = savedWeight;
        }

        // --- 2. 弹幕斜体 ---
        var styleDiv = getById(eleIds.danmakuFontStyleDiv);
        styleDiv.append(
            embySlider({ lsKey: lsKeys.fontStyle }
            , (val, opts) => {
                onSliderChange(val, opts); // 保存
                onSliderChangeLabel(styles.fontStyles[val].name, opts);
            }
            , (val, opts) => {
                onSliderChangeLabel(styles.fontStyles[val].name, opts);
            })
        );
        // 使用 || 0 确保如果是空值或0，也能正确识别为第0项
        var savedStyleIdx = parseInt(lsGetItem(lsKeys.fontStyle.id)) || 0;
        var styleName = (styles.fontStyles[savedStyleIdx] || styles.fontStyles[0]).name;

        if (styleDiv.nextElementSibling) {
             var label = styleDiv.nextElementSibling.querySelector('label');
             if (label) label.innerText = styleName;
        }

        buildFontFamilySetting();
    }

    function buildFontFamilySetting() {
        const fontFamilyVal = lsGetItem(lsKeys.fontFamily.id);
        let availableFonts = [
            { family: lsKeys.fontFamily.defaultValue, fullName: lsKeys.fontFamily.defaultValue },
            { family: 'Consolas', fullName: 'Consolas' },
            { family: 'SimHei', fullName: '黑体' },
            { family: 'SimSun', fullName: '宋体' },
            { family: 'KaiTi', fullName: '楷体' },
            { family: 'Microsoft YaHei', fullName: '微软雅黑' },
        ];
        if ('queryLocalFonts' in window) {
            queryLocalFonts().then(fonts => {
                availableFonts = [...availableFonts, ...fonts].reduce((acc, font) => {
                    if (!acc.some(f => f.family === font.family)) acc.push(font);
                    return acc;
                }, []);
                const selectedIndex = availableFonts.findIndex(f => f.family === fontFamilyVal);
                resetFontFamilyDiv(selectedIndex, availableFonts);
            }).catch(err => {
                logger.error(err);
            });
        } else {
            logger.info('queryLocalFonts 高级查询 API 不可用,使用预定字体列表');
        }
        const selectedIndex = availableFonts.findIndex(f => f.family === fontFamilyVal);
        resetFontFamilyDiv(selectedIndex, availableFonts);
        buildFontFamilyCtrl();
    }

    function buildFontFamilyCtrl() {
        const fontFamilyCtrl = getById(eleIds.fontFamilyCtrl);
        fontFamilyCtrl.append(
            embyButton({ label: '切换手填', iconKey: iconKeys.edit, }, (e) => {
                const xChecked = !e.target.xChecked;
                e.target.xChecked = xChecked;
                e.target.title = xChecked ? '手填' : '选择';
                getById(eleIds.fontFamilySelect).style.display = xChecked ? 'none' : '';
                getById(eleIds.fontFamilyInput).style.display = xChecked ? '' : 'none';
                if (xChecked) {
                    getById(eleIds.fontFamilyLabel).innerHTML = '';
                }
            })
        );
        fontFamilyCtrl.append(
            embyButton({ label: '重置为默认', iconKey: iconKeys.refresh, }
                , () => {
                    if (lsCheckSet(lsKeys.fontFamily.id, lsKeys.fontFamily.defaultValue)) {
                        changeFontStylePreview();
                        onSliderChangeLabel(lsKeys.fontFamily.defaultValue, { labelId: eleIds.fontFamilyLabel });
                        getById(eleIds.fontFamilyInput).value = lsGetItem(lsKeys.fontFamily.id);
                        loadDanmaku(LOAD_TYPE.RELOAD);
                    }
                })
        );
    }

    function resetFontFamilyDiv(selectedIndexOrValue, opts) {
        const fontFamilyDiv = getById(eleIds.fontFamilyDiv);
        fontFamilyDiv.innerHTML = '';
        fontFamilyDiv.append(
            embySelect({ id: eleIds.fontFamilySelect, label: `${lsKeys.fontFamily.name}: `, }
                , selectedIndexOrValue, opts, 'family', 'family'
                , (value, index, option) => {
                    logger.debug('fontFamilyDivChange: ', value, index, option);
                    // loadLocalFont(option.family);
                    if (lsCheckSet(lsKeys.fontFamily.id, value)) {
                        changeFontStylePreview();
                        const labelVal = option.family !== option.fullName ? option.fullName : '';
                        onSliderChangeLabel(labelVal, { labelId: eleIds.fontFamilyLabel });
                        loadDanmaku(LOAD_TYPE.RELOAD);
                    }
                })
        );
        fontFamilyDiv.append(
            embyInput({ id: eleIds.fontFamilyInput, value: lsGetItem(lsKeys.fontFamily.id)
                , type: 'search', style: 'display: none;' }
                , (e) => {
                    const inputVal = getTargetInput(e).value.trim();
                    if (!inputVal) { return; }
                    if (lsCheckSet(lsKeys.fontFamily.id, inputVal)) {
                        changeFontStylePreview();
                        loadDanmaku(LOAD_TYPE.RELOAD);
                    }
                })
        );
        changeFontStylePreview();
        const fontFamilyOpt = opts.find(opt => opt.family === lsGetItem(lsKeys.fontFamily.id));
        const labelVal = fontFamilyOpt ? fontFamilyOpt.fullName : '';
        onSliderChangeLabel(labelVal, { labelId: eleIds.fontFamilyLabel });
    }

    // function fontCheck(family, callback) {
    //     document.fonts.ready.then(() => {
    //         if (document.fonts.check(`25px "${family}"`)) {
    //             console.log(`The font family "${family}" is now available`);
    //             callback(true);
    //         } else {
    //             console.log(`The font family "${family}" is not available`);
    //             callback(false);
    //         }
    //     });
    // }

    function loadLocalFont(family) {
        const font = new FontFace(family, `local("${family}")`);
        font.load().then(loadedFont => {
            document.fonts.add(loadedFont);
            logger.debug(`The local font "${family}" has been added under the name "${family}"`);
        }).catch(err => {
            logger.error(`Failed to load or add the local font "${family}"`, err);
        });
    }

    function changeFontStylePreview() {
    const fontStylePreview = getById(eleIds.fontStylePreview);
    if (!fontStylePreview) return; // 增加判空
    const fontWeight = lsGetItem(lsKeys.fontWeight.id);
    const fontStyleIdx = lsGetItem(lsKeys.fontStyle.id);
    const fontStyleObj = styles.fontStyles[fontStyleIdx] || styles.fontStyles[0];
    const fontStyle = fontStyleObj.id;

        const fontFamily = lsGetItem(lsKeys.fontFamily.id);
        const fontOpacity = Math.round(lsGetItem(lsKeys.fontOpacity.id) / 100 * 255).toString(16).padStart(2, '0');
        const baseColor = Number(styles.colors.info).toString(16).padStart(6, '0');
        const color = `${baseColor}${fontOpacity}`;
        const shadowColor = baseColor === '000000' ? `#ffffff${fontOpacity}` : `#000000${fontOpacity}`;
        const fontSizeReferent = fontStylePreview.previousElementSibling;
        const fontSize  = parseFloat(getComputedStyle(fontSizeReferent).fontSize.replace('px', ''));
        const cmtStyle = getCommentStyle(color, shadowColor, fontStyle, fontWeight, fontSize, fontFamily);
        Object.assign(fontStylePreview.style, cmtStyle);
    }

    function buildSearchEpisode(containerId) {
        const container = getById(containerId);
        const episodeId = window.ede.episode_info ? window.ede.episode_info.episodeId : null;
        const comments = window.ede.danmuCache[episodeId] || [];
        let template = `
            <div>
                <div>
                    <label class="${classes.embyLabel}">标题: </label>
                    <div id="${eleIds.danmakuSearchNameDiv}" style="display: flex;"></div>
                    <div id="${eleIds.appendSeasonEpisodeDiv}" style="margin-top: 0.3em;"></div>
                </div>
                <div id="${eleIds.danmakuEpisodeFlag}" hidden>
                    <div style="display: flex;">
                        <div style="width: 80%;">
                            <label class="${classes.embyLabel}">媒体名: </label>
                            <div id="${eleIds.danmakuAnimeDiv}" class="${classes.embySelectWrapper}"></div>
                            <label class="${classes.embyLabel}">分集名: </label>
                            <div style="display: flex;">
                                <div id="${eleIds.danmakuEpisodeNumDiv}" style="max-width: 90%;" class="${classes.embySelectWrapper}"></div>
                                <div id="${eleIds.danmakuEpisodeLoad}"></div>
                            </div>
                        </div>
                        <div style="width: 20%; margin: 0 2%; text-align: center;">
                            <img id="${eleIds.searchImg}" style="width: 100%; height: auto;"
                                loading="lazy" decoding="async" draggable="false" class="coveredImage-noScale"></img>
                            <div id="${eleIds.searchApiSource}" class="${classes.embyFieldDesc}" style="margin-top: 0.5em;">
                                <!-- API来源将在这里显示 -->
                            </div>
                        </div>
                    </div>
                    </div>
                <div hidden>
                    <label class="${classes.embyLabel}" id="${eleIds.danmakuRemark}"></label>
                </div>
                <div>
                    <h4>匹配源</h4>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <div id="${eleIds.currentMatchedDiv}">
                                <label class="${classes.embyLabel}">弹弹 play 总量: ${comments.length}</label>
                            </div>
                            <label class="${classes.embyLabel}">弹弹 play 附加的第三方 url: </label>
                        </div>
                        <button is="emby-button" type="button" class="raised emby-button" id="btnClearLocalMatchCache">清除本地匹配缓存</button>
                    </div>
                    <div id="${eleIds.extUrlsDiv}"></div>
                </div>

            <div is="emby-collapse" title="API选择、自定义API配置">
                <div class="${classes.collapseContentNav}">
                    <div id="${eleIds.apiSelectDiv}" class="${classes.embyCheckboxList}" style="${styles.embyCheckboxList} align-items: center;">
                        <!-- API 优先级列表将在这里创建 -->
                    </div>
                    <div id="customApiContainer" style="margin-top: 1em;">
                        <!-- 自定义API地址输入框将在这里创建 -->
                    </div>
            </div>
            </div>
        `;
        container.innerHTML = template.trim();
        buildSearchEpisodeEle();
        // 本地读取由 DLL 策略控制，不再构建重复的 XML 开关。

        // 绑定手动匹配页面的额外按钮事件
        bindManualMatchButtons();
    }

    function bindManualMatchButtons() {
        const searchNameDiv = getById(eleIds.danmakuSearchNameDiv);
        // 这部分逻辑保持不变，只是从 buildSearchEpisodeEle 移到这里
        // ...

        // 绑定清除本地匹配缓存按钮事件
        const btnClearCache = getById('btnClearLocalMatchCache');
        if (btnClearCache) {
            btnClearCache.addEventListener('click', () => {
                const prefixesToClear = [
                    lsLocalKeys.animeEpisodePrefix,
                    lsLocalKeys.animeSeasonPrefix,
                    lsLocalKeys.animePrefix,
                    lsLocalKeys.bangumiEpInfoPrefix, // [修复] 添加Bangumi集数信息缓存
                    lsLocalKeys.bangumiMe, // [修复] 添加Bangumi用户信息缓存
                    '_api_' // [修复] 清除带API前缀的弹幕匹配缓存
                ];
                lsBatchRemove(prefixesToClear);

                // [修复] 清除当前episode_info中的匹配信息
                if (window.ede.episode_info) {
                    window.ede.episode_info.episodeId = null;
                    window.ede.episode_info.animeId = null;
                    window.ede.episode_info.animeTitle = null;
                    window.ede.episode_info.episodeTitle = null;
                }

                // [修复] 清除搜索选项中的缓存数据
                if (window.ede.searchDanmakuOpts) {
                    window.ede.searchDanmakuOpts.animes = [];
                    window.ede.searchDanmakuOpts.episodes = [];
                }

                // [修复] 清除TMDB映射缓存（内存 + IndexedDB）
                episodeMappingCache.clear();
                IndexedDBCache.clearTmdb();

                embyToast({ text: '本地匹配缓存已清除，包括animeId、episodeId等所有匹配信息' });
                loadDanmaku(LOAD_TYPE.REFRESH); // 强制重新匹配和加载弹幕
            });
        }
    }

    function buildSearchEpisodeEle() {
        const customApiContainer = getById('customApiContainer');
        if (!customApiContainer) return;
        customApiContainer.innerHTML = '';

        // --- 多自定义弹幕源列表 UI (PR #167 优化) ---
        const renderSourceList = () => {
            customApiContainer.innerHTML = '';
            const list = getCustomApiList();

            // 添加表单（标签行+输入框行的组合：源名称/API地址标签行、输入框行、AppId/AppSecret标签行、输入框行、底部toggle行）
            const addForm = document.createElement('div');
            addForm.style.cssText = 'display: flex; flex-direction: column; gap: 0.3em; background: rgba(0,0,0,0.3); padding: 1em; border-radius: 4px; margin-bottom: 1em;';

            // 标签样式
            const addLabelStyle = 'font-size: 0.82em; opacity: 0.7; white-space: nowrap;';

            // 第一行：「源名称」「API地址」标签横排（占比 4:6）
            const labelRow1 = document.createElement('div');
            labelRow1.style.cssText = 'display: flex; gap: 0.5em; width: 100%;';
            const nameLabel = document.createElement('span');
            nameLabel.textContent = '源名称';
            nameLabel.style.cssText = addLabelStyle + ' flex: 4;';
            const urlLabel = document.createElement('span');
            urlLabel.textContent = 'API 地址';
            urlLabel.style.cssText = addLabelStyle + ' flex: 6;';
            labelRow1.append(nameLabel, urlLabel);

            // 第二行：「源名称」「API地址」输入框横排（占比 4:6）
            const nameInput = document.createElement('input');
            nameInput.setAttribute('is', 'emby-input');
            nameInput.className = classes.embyInput;
            nameInput.type = 'text';
            nameInput.placeholder = '必填';
            nameInput.style.cssText = 'flex: 4; min-width: 0;';

            const urlInput = document.createElement('input');
            urlInput.setAttribute('is', 'emby-input');
            urlInput.className = classes.embyInput;
            urlInput.type = 'text';
            urlInput.placeholder = 'http://';
            urlInput.style.cssText = 'flex: 6; min-width: 0;';

            const inputRow1 = document.createElement('div');
            inputRow1.style.cssText = 'display: flex; gap: 0.5em; width: 100%;';
            inputRow1.append(nameInput, urlInput);

            // 第三行：「AppId」「AppSecret」标签横排（默认隐藏，占比 4:6）
            const labelRow2 = document.createElement('div');
            labelRow2.style.cssText = 'display: none; gap: 0.5em; width: 100%; margin-top: 0.3em;';
            const appIdLabel = document.createElement('span');
            appIdLabel.textContent = 'AppId';
            appIdLabel.style.cssText = addLabelStyle + ' flex: 4;';
            const appSecretLabel = document.createElement('span');
            appSecretLabel.textContent = 'AppSecret';
            appSecretLabel.style.cssText = addLabelStyle + ' flex: 6;';
            labelRow2.append(appIdLabel, appSecretLabel);

            // 第四行：「AppId」「AppSecret」输入框横排（默认隐藏，占比 4:6）
            const appIdInput = document.createElement('input');
            appIdInput.setAttribute('is', 'emby-input');
            appIdInput.className = classes.embyInput;
            appIdInput.type = 'text';
            appIdInput.placeholder = '必填';
            appIdInput.style.cssText = 'flex: 4; min-width: 0;';

            const appSecretInput = document.createElement('input');
            appSecretInput.setAttribute('is', 'emby-input');
            appSecretInput.className = classes.embyInput;
            appSecretInput.type = 'text';
            appSecretInput.placeholder = '必填';
            appSecretInput.style.cssText = 'flex: 6; min-width: 0;';

            const inputRow2 = document.createElement('div');
            inputRow2.style.cssText = 'display: none; gap: 0.5em; width: 100%;';
            inputRow2.append(appIdInput, appSecretInput);

            // 第五行：toggle开关紧贴左边 + 标签 + 添加按钮（右对齐）
            const bottomRow = document.createElement('div');
            bottomRow.style.cssText = 'display: flex; align-items: center; gap: 0.5em; width: 100%; margin-top: 0.4em;';

            // "自定义弹弹官方key" 开关
            let keyAuthOn = false;
            const keyToggleBtn = document.createElement('button');
            keyToggleBtn.type = 'button';
            keyToggleBtn.setAttribute('role', 'switch');
            keyToggleBtn.setAttribute('aria-checked', 'false');
            keyToggleBtn.style.cssText = 'position:relative;width:2.8em;height:1.55em;border:0;border-radius:1em;cursor:pointer;transition:background .2s;padding:0;flex:none;background:rgba(255,255,255,.28);';
            const keyThumb = document.createElement('span');
            keyThumb.style.cssText = 'position:absolute;top:.18em;left:.18em;width:1.2em;height:1.2em;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.35);';
            keyToggleBtn.append(keyThumb);

            const keyToggleLabel = document.createElement('span');
            keyToggleLabel.textContent = '自定义弹弹官方key';
            keyToggleLabel.style.cssText = 'font-size: 0.85em; opacity: 0.8; cursor: pointer; white-space: nowrap;';
            keyToggleLabel.onclick = () => keyToggleBtn.click();

            // 添加按钮（右侧固定）
            const addBtn = document.createElement('button');
            addBtn.setAttribute('is', 'emby-button');
            addBtn.className = 'raised button-submit emby-button';
            addBtn.innerHTML = '<i class="md-icon">check</i> 添加';
            addBtn.style.cssText = 'height: 2.5em; flex: 0 0 auto; margin-left: auto;';

            bottomRow.append(keyToggleBtn, keyToggleLabel, addBtn);

            // 开关切换逻辑：控制 AppId/AppSecret 标签行和输入框行的显示
            keyToggleBtn.onclick = () => {
                keyAuthOn = !keyAuthOn;
                keyToggleBtn.setAttribute('aria-checked', String(keyAuthOn));
                keyToggleBtn.style.background = keyAuthOn ? '#52b54b' : 'rgba(255,255,255,.28)';
                keyThumb.style.left = keyAuthOn ? '1.42em' : '.18em';
                labelRow2.style.display = keyAuthOn ? 'flex' : 'none';
                inputRow2.style.display = keyAuthOn ? 'flex' : 'none';
            };

            addBtn.onclick = async () => {
                const name = nameInput.value.trim();
                let url = urlInput.value.trim();
                if (!name || !url) {
                    embyToast({ text: '请填写完整' });
                    return;
                }
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    embyToast({ text: '请输入有效的URL（以 http:// 或 https:// 开头）' });
                    return;
                }
                if (url.endsWith('/')) url = url.slice(0, -1);
                const appId = keyAuthOn ? appIdInput.value.trim() : '';
                const appSecret = keyAuthOn ? appSecretInput.value.trim() : '';
                if (keyAuthOn && (!appId || !appSecret)) {
                    embyToast({ text: '开启自定义key后，请填写 AppId 和 AppSecret' });
                    return;
                }
                // 添加时异步检测服务器类型（不阻塞，失败静默）
                addBtn.disabled = true;
                addBtn.innerHTML = '<i class="md-icon">hourglass_empty</i> 检测中…';
                let serverMeta = null;
                try { serverMeta = await detectApiServerType(url); } catch (_) {}
                addBtn.disabled = false;
                addBtn.innerHTML = '<i class="md-icon">check</i> 添加';
                addCustomApiSource(name, url, appId, appSecret, serverMeta);
                nameInput.value = '';
                urlInput.value = '';
                appIdInput.value = '';
                appSecretInput.value = '';
                renderSourceList();
                const knownInfo = serverMeta && knownApiServers.find(s => s.serverName === serverMeta.serverName);
                embyToast({
                    text: '已添加弹幕源',
                    secondaryText: knownInfo ? `${knownInfo.badge} v${serverMeta.version}` : name,
                });
            };

            // 回车添加
            urlInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') addBtn.click();
            });

            addForm.append(
                labelRow1,   // 源名称 / API地址 标签行
                inputRow1,   // 源名称 / API地址 输入框行（4:6）
                labelRow2,   // AppId / AppSecret 标签行（开启后显示）
                inputRow2,   // AppId / AppSecret 输入框行（开启后显示，4:6）
                bottomRow    // toggle + 自定义弹弹官方key + 添加按钮
            );
            customApiContainer.append(addForm);

            // 列表容器
            const listDiv = document.createElement('div');
            listDiv.style.cssText = 'max-height: 250px; overflow-y: auto; overflow-x: hidden; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 0.5em;';

            if (list.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'fieldDescription';
                empty.style.cssText = 'color: #888; padding: 0.5em; font-size: 0.9em;';
                empty.textContent = '暂无自定义源，请在上方添加';
                listDiv.append(empty);
            } else {
                list.forEach((item, index) => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display: flex; align-items: center; margin-bottom: 0.5em; background: rgba(0,0,0,0.2); padding: 0.5em; border-radius: 4px;';

                    // 启用开关：embyCheckbox 样式
                    const switchDiv = document.createElement('div');
                    switchDiv.style.cssText = 'margin-right: 0.5em; flex-shrink: 0;';
                    switchDiv.append(embyCheckbox({ label: '' }, item.enabled, (checked) => {
                        toggleCustomApiSource(index, checked);
                        renderSourceList();
                    }));
                    row.append(switchDiv);

                    // 信息显示 / 编辑区域
                    const infoDiv = document.createElement('div');
                    infoDiv.style.cssText = 'flex: 1; min-width: 0; overflow: hidden;';
                    const nameStyle = item.enabled ? 'font-weight:bold;' : 'font-weight:bold; color: #999;';
                    const urlStyle = 'font-size:0.8em; opacity:0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
                    // 只展示域名+端口部分，完整地址保留在 title 供 hover 查看
                    const urlOrigin = (() => { try { return new URL(item.url).origin; } catch { return item.url; } })();
                    // 服务器类型小卡片：匹配到已知 serverName 时展示
                    const knownServerInfo = item.serverName ? knownApiServers.find(s => s.serverName === item.serverName) : null;
                    const serverBadgeHtml = knownServerInfo
                        ? ` <span title="${item.serverName}" style="display:inline-block;font-size:0.72em;font-weight:normal;padding:0.08em 0.45em;border-radius:3px;background:${knownServerInfo.color};color:#fff;vertical-align:middle;margin-left:0.3em;">${knownServerInfo.badge}${item.serverVersion ? ' v' + item.serverVersion : ''}</span>`
                        : '';
                    infoDiv.innerHTML = `<div style="${nameStyle}">${item.name}${item.appId && item.appSecret ? " <span title=\"已配置AppId/AppSecret\" style=\"color:#52b54b;\">&#128274;</span>" : ""}${serverBadgeHtml}</div><div style="${urlStyle}" title="${item.url}">${urlOrigin}</div>`;
                    row.append(infoDiv);

                    // 编辑按钮
                    const editBtn = document.createElement('button');
                    editBtn.setAttribute('is', 'emby-button');
                    editBtn.className = 'paper-icon-button-light';
                    editBtn.innerHTML = '<i class="md-icon">edit</i>';
                    editBtn.title = '编辑';
                    editBtn.style.cssText = 'padding: 0.2em; flex-shrink: 0;';
                    let isEditing = false;
                    editBtn.onclick = async () => {
                        if (!isEditing) {
                            // 进入编辑模式：替换 infoDiv 内容为输入框
                            isEditing = true;
                            editBtn.innerHTML = '<i class="md-icon">check</i>';
                            editBtn.title = '保存';
                            editBtn.style.color = '#52b54b';

                            // 通用输入框底样式
                            const editInputStyle = 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.25);border-radius:3px;color:inherit;padding:0.2em 0.4em;outline:none;font-family:inherit;box-sizing:border-box;min-width:0;width:100%;';
                            // 卡片行样式：标签固定宽度 4.5em，确保两行输入框左边缘对齐
                            const makeEditCardRow = (labelText, input, inputExtraStyle) => {
                                const r = document.createElement('div');
                                r.style.cssText = 'display:flex;align-items:center;gap:0.5em;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:0.3em 0.5em;margin-bottom:0.3em;width:100%;box-sizing:border-box;';
                                const lbl = document.createElement('span');
                                lbl.textContent = labelText;
                                // flex:0 0 4.5em 固定标签列宽，两行输入框左边缘统一对齐
                                lbl.style.cssText = 'font-size:0.82em;opacity:0.7;white-space:nowrap;flex:0 0 4.5em;';
                                input.style.cssText = editInputStyle + 'flex:1;border:none;background:transparent;padding:0.1em 0.3em;' + (inputExtraStyle || '');
                                r.append(lbl, input);
                                return r;
                            };

                            // 第一行：名称卡片行
                            const editNameInput = document.createElement('input');
                            editNameInput.type = 'text';
                            editNameInput.value = item.name;
                            editNameInput.placeholder = '必填';
                            const editNameRow = makeEditCardRow('名称', editNameInput, 'font-weight:bold;');

                            // 第二行：API地址卡片行
                            const editUrlInput = document.createElement('input');
                            editUrlInput.type = 'text';
                            editUrlInput.value = item.url;
                            editUrlInput.placeholder = 'http://';
                            const editUrlRow = makeEditCardRow('API 地址', editUrlInput);

                            // 第三行：AppId / AppSecret 标签行（默认隐藏）
                            let editAuthOn = !!(item.appId && item.appSecret);

                            const editAppIdInput = document.createElement('input');
                            editAppIdInput.type = 'text';
                            editAppIdInput.value = item.appId || '';
                            editAppIdInput.placeholder = '必填';
                            editAppIdInput.style.cssText = editInputStyle + 'flex:1;';

                            const editAppSecretInput = document.createElement('input');
                            editAppSecretInput.type = 'text';
                            editAppSecretInput.value = item.appSecret || '';
                            editAppSecretInput.placeholder = '必填';
                            editAppSecretInput.style.cssText = editInputStyle + 'flex:1;';

                            // 第三行：AppId AppSecret 标签横排
                            const editAuthLabelRow = document.createElement('div');
                            editAuthLabelRow.style.cssText = 'display:flex;gap:0.5em;width:100%;margin-bottom:0.1em;';
                            const aidLbl = document.createElement('span');
                            aidLbl.textContent = 'AppId';
                            aidLbl.style.cssText = 'font-size:0.82em;opacity:0.7;flex:1;';
                            const asecLbl = document.createElement('span');
                            asecLbl.textContent = 'AppSecret';
                            asecLbl.style.cssText = 'font-size:0.82em;opacity:0.7;flex:1;';
                            editAuthLabelRow.append(aidLbl, asecLbl);

                            // 第四行：AppId AppSecret 输入框横排
                            const editAuthInputRow = document.createElement('div');
                            editAuthInputRow.style.cssText = 'display:flex;gap:0.5em;width:100%;margin-bottom:0.3em;';
                            editAuthInputRow.append(editAppIdInput, editAppSecretInput);

                            // 默认按 editAuthOn 控制显示
                            editAuthLabelRow.style.display = editAuthOn ? 'flex' : 'none';
                            editAuthInputRow.style.display = editAuthOn ? 'flex' : 'none';

                            // 认证开关行（toggle 紧贴左边）
                            const editAuthBtn = document.createElement('button');
                            editAuthBtn.type = 'button';
                            editAuthBtn.setAttribute('role', 'switch');
                            editAuthBtn.style.cssText = `position:relative;width:2.4em;height:1.35em;border:0;border-radius:1em;cursor:pointer;transition:background .2s;padding:0;flex:none;background:${editAuthOn ? '#52b54b' : 'rgba(255,255,255,.28)'};`;
                            const editAuthThumb = document.createElement('span');
                            editAuthThumb.style.cssText = `position:absolute;top:.15em;width:1.05em;height:1.05em;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.35);left:${editAuthOn ? '1.2em' : '.15em'};`;
                            editAuthBtn.append(editAuthThumb);

                            const editAuthLabel = document.createElement('span');
                            editAuthLabel.textContent = '自定义弹弹官方key';
                            editAuthLabel.style.cssText = 'font-size:0.78em;opacity:0.75;cursor:pointer;white-space:nowrap;';
                            editAuthLabel.onclick = () => editAuthBtn.click();

                            const editAuthRow = document.createElement('div');
                            editAuthRow.style.cssText = 'display:flex;align-items:center;gap:0.4em;margin-top:0.1em;';
                            editAuthRow.append(editAuthBtn, editAuthLabel);

                            // 同步显示/隐藏 AppId/AppSecret 行
                            const syncEditAuth = () => {
                                editAuthBtn.style.background = editAuthOn ? '#52b54b' : 'rgba(255,255,255,.28)';
                                editAuthThumb.style.left = editAuthOn ? '1.2em' : '.15em';
                                editAuthLabelRow.style.display = editAuthOn ? 'flex' : 'none';
                                editAuthInputRow.style.display = editAuthOn ? 'flex' : 'none';
                            };
                            editAuthBtn.onclick = () => { editAuthOn = !editAuthOn; syncEditAuth(); };

                            // 编辑模式下 infoDiv 改为纵向 flex
                            infoDiv.style.cssText = 'flex: 1; min-width: 0; display: flex; flex-direction: column;';
                            infoDiv.innerHTML = '';
                            infoDiv.append(
                                editNameRow,       // 行1：名称卡片行
                                editUrlRow,        // 行2：API地址卡片行
                                editAuthLabelRow,  // 行3：AppId / AppSecret 标签（开启后显示）
                                editAuthInputRow,  // 行4：AppId / AppSecret 输入框（开启后显示）
                                editAuthRow        // toggle + 自定义弹弹官方key
                            );

                            editNameInput.focus();
                            // 回车保存
                            const onEnter = (e) => { if (e.key === 'Enter') editBtn.click(); };
                            editNameInput.addEventListener('keydown', onEnter);
                            editUrlInput.addEventListener('keydown', onEnter);
                        } else {
                            // 保存编辑：display 控制在父行 div 上，通过父元素判断认证开关是否开启
                            const inputs = infoDiv.querySelectorAll('input');
                            const newName = inputs[0]?.value.trim();
                            let newUrl = inputs[1]?.value.trim();
                            if (!newName || !newUrl) {
                                embyToast({ text: '名称和地址不能为空' });
                                return;
                            }
                            if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
                                embyToast({ text: '请输入有效的URL（以 http:// 或 https:// 开头）' });
                                return;
                            }
                            if (newUrl.endsWith('/')) newUrl = newUrl.slice(0, -1);
                            // 认证开关关闭时父行 display 为 none，此时传空字符串清除认证
                            const newAppId = (inputs[2]?.parentElement?.style.display !== 'none' && inputs[2]?.value.trim()) || '';
                            const newAppSecret = (inputs[3]?.parentElement?.style.display !== 'none' && inputs[3]?.value.trim()) || '';
                            // URL 变更，或 URL 未变但之前没有检测到 serverName → 重新检测
                            const urlChanged = newUrl !== item.url;
                            const needDetect = urlChanged || !item.serverName;
                            editBtn.disabled = true;
                            editBtn.innerHTML = '<i class="md-icon">hourglass_empty</i>';
                            let newServerMeta = undefined;
                            if (needDetect) {
                                try { newServerMeta = await detectApiServerType(newUrl); } catch (_) { newServerMeta = null; }
                            }
                            editBtn.disabled = false;
                            editBtn.innerHTML = '<i class="md-icon">check</i>';
                            updateCustomApiSource(index, newName, newUrl, newAppId, newAppSecret, newServerMeta);
                            renderSourceList();
                            embyToast({ text: '已保存修改', secondaryText: newName });
                        }
                    };
                    row.append(editBtn);

                    // 上移按钮
                    if (index > 0) {
                        const upBtn = document.createElement('button');
                        upBtn.setAttribute('is', 'emby-button');
                        upBtn.className = 'paper-icon-button-light';
                        upBtn.innerHTML = '<i class="md-icon">arrow_upward</i>';
                        upBtn.title = '上移';
                        upBtn.style.cssText = 'padding: 0.2em; flex-shrink: 0;';
                        upBtn.onclick = () => {
                            moveCustomApiSource(index, index - 1);
                            renderSourceList();
                        };
                        row.append(upBtn);
                    }

                    // 下移按钮
                    if (index < list.length - 1) {
                        const downBtn = document.createElement('button');
                        downBtn.setAttribute('is', 'emby-button');
                        downBtn.className = 'paper-icon-button-light';
                        downBtn.innerHTML = '<i class="md-icon">arrow_downward</i>';
                        downBtn.title = '下移';
                        downBtn.style.cssText = 'padding: 0.2em; flex-shrink: 0;';
                        downBtn.onclick = () => {
                            moveCustomApiSource(index, index + 1);
                            renderSourceList();
                        };
                        row.append(downBtn);
                    }

                    // 删除按钮
                    const delBtn = document.createElement('button');
                    delBtn.setAttribute('is', 'emby-button');
                    delBtn.className = 'paper-icon-button-light';
                    delBtn.innerHTML = '<i class="md-icon">close</i>';
                    delBtn.title = '删除';
                    delBtn.style.cssText = 'padding: 0.2em; color: #f44336; flex-shrink: 0;';
                    delBtn.onclick = () => {
                        removeCustomApiSource(index);
                        renderSourceList();
                        embyToast({ text: '已删除弹幕源' });
                    };
                    row.append(delBtn);

                    listDiv.append(row);
                });
            }

            customApiContainer.append(listDiv);
        };

        // 初始渲染列表
        renderSourceList();

        const searchNameDiv = getById(eleIds.danmakuSearchNameDiv);
        // [开关] 根据「文件名拼接季集号」决定搜索框预填充内容
        const opts = window.ede.searchDanmakuOpts;
        const appendSE = lsGetItem(lsKeys.appendSeasonEpisode.id);
        const searchValue = appendSE ? opts.animeName : (opts.seriesName || opts.animeName);
        searchNameDiv.append(embyInput({ id: eleIds.danmakuSearchName, value: searchValue, type: 'search' }
            , doDanmakuSearchEpisode));
        searchNameDiv.append(embyButton({ label: '搜索', iconKey: iconKeys.search}, doDanmakuSearchEpisode));

        // 文件名拼接季集号开关
        getById(eleIds.appendSeasonEpisodeDiv).append(
            embyCheckbox({ label: lsKeys.appendSeasonEpisode.name }, appendSE, (checked) => {
                lsSetItem(lsKeys.appendSeasonEpisode.id, checked);
                // 实时更新搜索框内容
                const searchInput = getById(eleIds.danmakuSearchName);
                if (searchInput) {
                    searchInput.value = checked ? opts.animeName : (opts.seriesName || opts.animeName);
                }
            })
        );

        // --- API选择和优先级设置 (PR #167 优化布局) ---
        const apiSelectDiv = getById(eleIds.apiSelectDiv);
        apiSelectDiv.innerHTML = '';
        apiSelectDiv.style.display = 'block';

        // 控制栏：左侧优先级滑块，右侧启用开关组 - 同一行
        const controlBar = document.createElement('div');
        controlBar.style.cssText = 'display: flex; align-items: center; gap: 15px; margin-bottom: 1em;';

        // --- 左侧：优先级滑块 ---
        const leftGroup = document.createElement('div');
        leftGroup.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-shrink: 0;';

        const priorityLabel = document.createElement('label');
        priorityLabel.className = classes.embyLabel;
        priorityLabel.textContent = '优先级:';
        priorityLabel.style.cssText = 'margin-bottom: 0; white-space: nowrap;';

        const prioritySwitch = document.createElement('div');
        prioritySwitch.className = 'emby-toggle-switch';
        prioritySwitch.style.cssText = 'position: relative; width: 160px; height: 32px; background-color: #333; border-radius: 16px; cursor: pointer; transition: all 0.3s ease; flex-shrink: 0;';

        const prioritySlider = document.createElement('div');
        prioritySlider.style.cssText = 'position: absolute; top: 2px; width: 80px; height: 28px; background-color: #4a90e2; border-radius: 14px; transition: all 0.3s ease; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;';

        const leftLabel = document.createElement('div');
        leftLabel.style.cssText = 'position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 11px; color: #999; pointer-events: none;';
        leftLabel.textContent = '自定义';

        const rightLabel = document.createElement('div');
        rightLabel.style.cssText = 'position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: 11px; color: #999; pointer-events: none;';
        rightLabel.textContent = '弹弹play';

        prioritySwitch.append(leftLabel, rightLabel, prioritySlider);

        const currentPriority = lsGetItem(lsKeys.apiPriority.id);
        const isOfficialFirst = currentPriority[0] === 'official';

        const updatePrioritySwitch = (officialFirst) => {
            if (officialFirst) {
                prioritySlider.style.left = '78px';
                prioritySlider.textContent = '弹弹play';
                leftLabel.style.color = '#999';
                rightLabel.style.color = 'white';
            } else {
                prioritySlider.style.left = '2px';
                prioritySlider.textContent = '自定义';
                leftLabel.style.color = 'white';
                rightLabel.style.color = '#999';
            }
        };
        updatePrioritySwitch(isOfficialFirst);

        prioritySwitch.onclick = () => {
            const currentPriority = lsGetItem(lsKeys.apiPriority.id);
            const newPriority = currentPriority[0] === 'official' ? ['custom', 'official'] : ['official', 'custom'];
            lsSetItem(lsKeys.apiPriority.id, newPriority);
            updatePrioritySwitch(newPriority[0] === 'official');
        };

        leftGroup.append(priorityLabel, prioritySwitch);

        // --- 右侧：启用开关组 (官方 / 自定义) - 同一行显示 ---
        const rightGroup = document.createElement('div');
        rightGroup.style.cssText = 'display: flex; align-items: center; gap: 15px;';

        // 弹弹play API开关
        const officialCb = embyCheckbox({ label: '启用弹弹play' }, lsGetItem(lsKeys.useOfficialApi.id), (checked) => {
            lsSetItem(lsKeys.useOfficialApi.id, checked);
        });
        officialCb.style.cssText = 'display: inline-flex !important; align-items: center; margin: 0 !important; white-space: nowrap;';

        // 自定义API开关
        const customCb = embyCheckbox({ label: '启用自定义' }, lsGetItem(lsKeys.useCustomApi.id), (checked) => {
            lsSetItem(lsKeys.useCustomApi.id, checked);
            const customContainer = getById('customApiContainer');
            if (customContainer) {
                customContainer.style.opacity = checked ? '1' : '0.5';
                customContainer.style.pointerEvents = checked ? 'auto' : 'none';
            }
        });
        customCb.style.cssText = 'display: inline-flex !important; align-items: center; margin: 0 !important; white-space: nowrap;';

        rightGroup.append(officialCb, customCb);
        controlBar.append(leftGroup, rightGroup);
        apiSelectDiv.append(controlBar);

        // 初始化自定义API容器的透明度
        const customContainer = getById('customApiContainer');
        if (customContainer) {
            const customEnabled = lsGetItem(lsKeys.useCustomApi.id);
            customContainer.style.opacity = customEnabled ? '1' : '0.5';
            customContainer.style.pointerEvents = customEnabled ? 'auto' : 'none';
        }

        searchNameDiv.append(embyButton({ label: '切换[原]标题', iconKey: iconKeys.text_format }, doSearchTitleSwtich));
        getById(eleIds.danmakuEpisodeLoad).append(
            embyButton({ id: eleIds.danmakuSwitchEpisode, label: '加载弹幕', iconKey: iconKeys.done }, doDanmakuSwitchEpisode)
        );
        const currentMatchedDiv = getById(eleIds.currentMatchedDiv);
        currentMatchedDiv.append(
            embyButton({ label: '取消匹配/清空弹幕', iconKey: iconKeys.close }, (e) => {
                if (window.ede.episode_info && window.ede.episode_info.episodeId) {
                    window.ede.episode_info.episodeId = null;
                }
                if (window.ede.danmaku) {
                    createDanmaku([]);
                }
                currentMatchedDiv.querySelector('label').textContent = '弹弹 play 总量: 0';
            })
        );
    }


    function buildCurrentDanmakuInfo(containerId) {
        const container = getById(containerId);
        if (!container) { return; }
        const { episodeTitle, animeId, animeTitle, imageUrl, apiName, apiPrefix } = window.ede.episode_info || {};
        const loadSum = getDanmakuComments(window.ede).length;
        const downloadSum = window.ede.commentsParsed.length;
        let template = `
            <div style="display: flex;">
                <div id="${eleIds.posterImgDiv}"></div>
                <div>
                    <div>
                        <label class="${classes.embyLabel}">媒体名: </label>
                        <div class="${classes.embyFieldDesc}">${animeTitle}</div>
                    </div>
                    ${!episodeTitle ? '' :
                    `<div>
                        <label class="${classes.embyLabel}">章节名: </label>
                        <div class="${classes.embyFieldDesc}">${episodeTitle}</div>
                    </div>`}
                    <div>
                        <label class="${classes.embyLabel}">匹配来源: </label>
                        <div class="${classes.embyFieldDesc}">${apiName || '未知'}</div>
                    </div>
                    <div>
                        <label class="${classes.embyLabel}">其它信息: </label>
                        <div class="${classes.embyFieldDesc}">
                            获取总数: ${downloadSum},
                            加载总数: ${loadSum},
                            被过滤数: ${downloadSum - loadSum}
                        </div>
                    </div>
                </div>
            </div>
            <div style="margin-top: 2%;">
                <label class="${classes.embyLabel}">${lsKeys.danmuList.name}: </label>
                <div id="${eleIds.danmuListDiv}" style="margin: 1% 0;"></div>
                <div id="${eleIds.danmuListText}" style="display: none; height: 300px; overflow-y: auto; position: relative; border: 1px solid #444; background:                       rgba(0,0,0,0.3);">
                <div id="danmuListPhantom" style="position: absolute; left: 0; top: 0; right: 0; z-index: -1;"></div>
                <div id="danmuListContent" style="position: absolute; left: 0; right: 0; top: 0;"></div>
                </div>
                <div class="${classes.embyFieldDesc}">列表展示格式为: [序号][分:秒] : 弹幕正文 [来源平台][用户ID][弹幕CID][模式]</div>
            </div>
            <div id="${eleIds.extInfoCtrlDiv}" style="margin: 0.6em 0;"></div>
            <div id="${eleIds.extInfoDiv}" hidden>
                <label class="${classes.embyLabel}">Bangumi 角色介绍: </label>
                <div style="${styles.embySlider + 'margin: 0.8em 0;'}">
                    <label class="${classes.embyLabel}" style="width:7em;">角色图片高度: </label>
                    <div id="${eleIds.characterImgHeihtDiv}" style="width: 36.5em; text-align: center;"></div>
                    <label>
                        <label id="${eleIds.characterImgHeihtLabel}" style="${styles.embySliderLabel}">auto</label>
                        <label>em</label>
                    </label>
                </div>
                <div id="${eleIds.charactersDiv}" style="display: flex; flex-wrap: wrap;"></div>
            </div>
        `;
        container.innerHTML = template.trim();

        let posterSrc = '';
        // 修正海报显示逻辑：
        // 根据使用的API源来决定图片来源
        if (imageUrl) {
            // 如果 episode_info 中有 imageUrl，直接使用
            posterSrc = imageUrl;
        } else if (animeId) {
            // 如果没有 imageUrl，只有官方 API 才显示图片
            const isCustomApi = apiPrefix && apiPrefix !== dandanplayApi.prefix;
            if (!isCustomApi) {
                // 使用弹弹play API时，用弹弹play图片
                posterSrc = dandanplayApi.posterImg(animeId);
            }
            // 使用自定义API且无 imageUrl 时，不显示图片
        }
        const posterStyle = 'width: calc((var(--videoosd-tabs-height) - 3em) * (2 / 3)); margin-right: 1em;';
        const posterDiv = getById(eleIds.posterImgDiv, container);
        if (posterSrc) {
            posterDiv.append(embyImgButton(embyImg(posterSrc), posterStyle));
        } else {
            // 没有图片时也保留空位
            posterDiv.style.cssText = posterStyle;
        }
        buildDanmuListDiv(container);
        // 额外信息
        buildExtInfo(container);
    }

    function buildDanmuListDiv(container) {
        const { episodeId, } = window.ede.episode_info || {};
        const extCommentCache = window.ede.extCommentCache[window.ede.itemId] || {};
        const danmuListExts = Object.values(extCommentCache).map((value, index) => {
            return { id: `ext${index + 1}`, name: `附加${index + 1}`, onChange: () => danmakuParser(value) };
        });
        let danmuListTabOpts = danmuListOpts;
        if (danmuListExts.length > 0) {
            const dandanplayListOpt = { id: 'dandanplay', name: '弹弹 play', onChange: () => {
                const comments = window.ede.danmuCache[episodeId];
                return comments ? danmakuParser(comments) : [];
            } };
            danmuListTabOpts = danmuListTabOpts.concat(dandanplayListOpt).concat(danmuListExts);
        }
        getById(eleIds.danmuListDiv, container).append(
            embyTabs(danmuListTabOpts, lsKeys.danmuList.defaultValue, 'id', 'name', doDanmuListOptsChange)
        );
    }

    function buildExtInfo(container) {
        getById(eleIds.characterImgHeihtDiv, container).append(embySlider(
            { labelId: eleIds.characterImgHeihtLabel, value: '12', min: 12, max: 100, step: 1 }
            , (val, opts) => {
                if (val === '12') { val = 'auto'; }
                onSliderChangeLabel(val, opts);
                Array.from(getById(eleIds.charactersDiv).children)
                    .map(c => c.style.height = val === 'auto' ? val : val + 'em');
            }
        ));
        const extInfoCtrlDiv = getById(eleIds.extInfoCtrlDiv, container);
        extInfoCtrlDiv.append(
            embyButton({ label: '额外信息', iconKey: iconKeys.more }, (e) => {
                const xChecked = !e.target.xChecked;
                e.target.xChecked = xChecked;
                e.target.title = xChecked ? '关闭' : '额外信息';
                e.target.firstChild.innerHTML = xChecked ? iconKeys.close : iconKeys.more;
                const extInfoDiv = getById(eleIds.extInfoDiv);
                extInfoDiv.hidden = !xChecked;
                const charactersDiv = getById(eleIds.charactersDiv);
                if (charactersDiv.firstChild) { return; }
                const bangumiInfo = window.ede.bangumiInfo;
                if (bangumiInfo && bangumiInfo.characters
                    && bangumiInfo.animeId === window.ede.episode_info.animeId
                ) {
                    return renderBangumiCharacters(charactersDiv, bangumiInfo.characters);
                }
                getEpisodeBangumiRel().then(bangumiInfo => {
                    return fetchJson(bangumiApi.getCharacters(bangumiInfo.subjectId));
                }).then(characters => {
                    bangumiInfo.characters = characters;
                    renderBangumiCharacters(charactersDiv, characters);
                });
                function renderBangumiCharacters(container, characters) {
                    // 图片域名替换：将默认 lain.bgm.tv 替换为用户自定义域名
                    const replaceBgmImageDomain = (url) => {
                        if (!url) return url;
                        const customDomain = bangumiApi.imageDomain;
                        if (customDomain && customDomain !== 'https://lain.bgm.tv') {
                            return url.replace('https://lain.bgm.tv', customDomain);
                        }
                        return url;
                    };
                    characters.map(c => {
                        const characterDiv = document.createElement('div');
                        characterDiv.style = 'width: 31%; display: flex; margin: .5em;';
                        let embyImgButtonInner = embyImg(replaceBgmImageDomain(c.images.large), 'object-position: top;');
                        if (!c.images.large) {
                            embyImgButtonInner = embyI(iconKeys.person, classes.cardImageIcon);
                        }
                        characterDiv.append(embyImgButton(embyImgButtonInner));
                        const characterRightDiv = document.createElement('div');
                        characterRightDiv.style.marginLeft = '.5em';
                        const characterNameDiv = document.createElement('div');
                        characterNameDiv.textContent = c.relation + ': ' + c.name;
                        characterRightDiv.append(characterNameDiv);
                        const characterCvDiv = document.createElement('div');
                        characterCvDiv.textContent = 'CV: ' + c.actors.map(a => a.name).join();
                        if (c.actors[0]) {
                            characterCvDiv.append(embyImgButton(embyImg(replaceBgmImageDomain(c.actors[0].images.large))));
                        }
                        characterRightDiv.append(characterCvDiv);
                        characterDiv.append(characterRightDiv);
                        container.append(characterDiv);
                    });
                }
            })
        );
    }

    function buildProSetting(containerId) {
        const container = getById(containerId);
        let template = `
            <div style="height: 30em;">
                <div is="emby-collapse" title="弹幕屏蔽" data-expanded="true">
                    <div class="${classes.collapseContentNav}">
                        <div id="${eleIds.danmakuTypeFilterDiv}" style="margin-bottom: 0.2em;">
                            <label class="${classes.embyLabel}">${lsKeys.typeFilter.name}: </label>
                        </div>
                        <div id="${eleIds.danmakuSourceFilterDiv}">
                            <label class="${classes.embyLabel}">${lsKeys.sourceFilter.name}: </label>
                        </div>
                        <div id="${eleIds.danmakuShowSourceDiv}">
                            <label class="${classes.embyLabel}">${lsKeys.showSource.name}: </label>
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="弹幕高级屏蔽">
                    <div class="${classes.collapseContentNav}">
                        <div>
                            <div style="${styles.embySlider}">
                                <label class="${classes.embyLabel}" style="width: 10em;">${lsKeys.autoFilterCount.name}: </label>
                                <div id="${eleIds.danmakuAutoFilterCountDiv}" style="width: 15.5em; text-align: center;"></div>
                                <label style="${styles.embySliderLabel}">0</label>
                            </div>
                            <label class="${classes.embyLabel}">${lsKeys.mergeSimilarEnable.name}: </label>
                            <div id="${eleIds.danmakuFilterProDiv}" class="${classes.embyCheckboxList}" style="${styles.embyCheckboxList}"></div>
                            <div style="${styles.embySlider}">
                                <label class="${classes.embyLabel}" style="width: 10em;">${lsKeys.mergeSimilarPercent.name}: </label>
                                <div id="${eleIds.mergeSimilarPercentDiv}" style="width: 15.5em; text-align: center;"></div>
                                <label>
                                    <label style="${styles.embySliderLabel}"></label>
                                    <label>%</label>
                                </label>
                            </div>
                            <div style="${styles.embySlider}">
                            <label class="${classes.embyLabel}" style="width: 10em;">${lsKeys.mergeSimilarTime.name}: </label>
                            <div id="${eleIds.mergeSimilarTimeDiv}" style="width: 15.5em; text-align: center;"></div>
                            <label>
                               <label style="${styles.embySliderLabel}"></label>
                               <label>秒</label>
                            </label>
                        </div>
                        </div>
                        <div id="${eleIds.filterKeywordsDiv}" style="margin-bottom: 0.2em;">
                            <label class="${classes.embyLabel}">${lsKeys.filterKeywords.name}: </label>
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="弹幕位置转换">
                    <div class="${classes.collapseContentNav}">
                        <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1em; padding: 0.5em 0;">
                    <div style="flex: 1; display: flex; align-items: center; min-width: 250px;">
                    <label class="${classes.embyLabel}" style="width: auto; margin-right: 1em; white-space: nowrap;">顶部转:</label>
                    <div id="danmakuConvertTopToDiv" style="flex: 1;"></div>
                </div>
                <div style="flex: 1; display: flex; align-items: center; min-width: 250px;">
                    <label class="${classes.embyLabel}" style="width: auto; margin-right: 1em; white-space: nowrap;">底部转:</label>
                    <div id="danmakuConvertBottomToDiv" style="flex: 1;"></div>
                </div>
                </div>
                </div>
                </div>
                <div is="emby-collapse" title="额外设置">
                    <div class="${classes.collapseContentNav}" style="padding-top: 0.5em !important;">
                        <div id="${eleIds.extCheckboxDiv}" class="${classes.embyCheckboxList}" style="${styles.embyCheckboxList}"></div>
                        <div id="${eleIds.danmakuChConverDiv}" style="margin-bottom: 0.2em;">
                            <label class="${classes.embyLabel}">${lsKeys.chConvert.name}: </label>
                        </div>
                        <div id="${eleIds.danmakuEngineDiv}" style="margin-bottom: 0.2em;">
                            <label class="${classes.embyLabel}">${lsKeys.engine.name}: </label>
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="自动匹配">
                    <div class="${classes.collapseContentNav}" style="padding-top: 0.5em !important;">
                        <div id="${eleIds.autoLoadSwitchDiv}" style="margin-bottom: 0.5em;"></div>
                        <div id="${eleIds.matchApiEnableDiv}" style="margin-bottom: 0.5em;"></div>
                        <div id="${eleIds.matchModeDiv}"></div>
                        <div class="${classes.embyFieldDesc}" style="margin-top: 0.5em;">
                            自动加载弹幕：关闭后播放视频时不会自动搜索和加载弹幕，但仍可通过弹幕设置弹窗手动匹配。<br/>
                            /match 接口：关闭后跳过 /match 接口，直接使用 /search/episodes 文件名搜索。<br/>
                            匹配模式：「哈希+文件名」会下载视频分片计算 MD5 进行精确匹配；「仅文件名」跳过哈希计算（网盘/strm 用户建议选此项）。
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="集数偏移">
                    <div id="${eleIds.episodeOffsetRulesDiv}" class="${classes.collapseContentNav}"></div>
                </div>
                <div is="emby-collapse" title="播放界面设置">
                    <div class="${classes.collapseContentNav}">
                        <div id="${eleIds.osdCheckboxDiv}" class="${classes.embyCheckboxList}" style="${styles.embyCheckboxList}"></div>
                        <div>
                            <div id="${eleIds.osdLineChartDiv}" class="${classes.embyCheckboxList}" style="${styles.embyCheckboxList}"></div>
                            <div style="${styles.embySlider}">
                    <label class="${classes.embyLabel}" style="width: 12em;">${lsKeys.osdLineChartTime.name}: </label>
                          <div id="${eleIds.osdLineChartTimeDiv}" style="width: 15.5em; text-align: center;"></div>
                          <label>
                             <label style="${styles.embySliderLabel}"></label>
                          <label>秒</label>
                          </label>
                        </div>
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="播放设置">
                    <div class="${classes.collapseContentNav}">
                        <label class="${classes.embyLabel}">单次定时执行: </label>
                        <div id="${eleIds.timeoutCallbackTypeDiv}"></div>
                        <label class="${classes.embyLabel}">定时单位: </label>
                        <div id="${eleIds.timeoutCallbackUnitDiv}"></div>
                        <div style="${styles.embySlider + 'margin-top: 0.3em;'}">
                            <label class="${classes.embyLabel}" style="width:4em;">${lsKeys.timeoutCallbackValue.name}: </label>
                            <div id="${eleIds.timeoutCallbackDiv}" style="width: 15.5em; text-align: center;"></div>
                            <label id="${eleIds.timeoutCallbackLabel}" style="${styles.embySliderLabel}"></label>
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="Bangumi 设置">
                    <div class="${classes.collapseContentNav}" style="padding-top: 0.5em !important;">
                        <label id="${eleIds.bgmSearchFallbackLabel}" class="${classes.embyLabel}"></label>
                        <div class="${classes.embyFieldDesc}" style="margin-bottom: 0.5em;">
                            主源（弹弹play）搜索无结果时，用 Bangumi 搜索兜底（仅手动搜索页生效）
                        </div>
                        <label id="${eleIds.bangumiEnableLabel}" class="${classes.embyLabel}"></label>
                        <div id="${eleIds.bangumiSettingsDiv}">
                            <div id="${eleIds.bangumiTokenInputDiv}" style="display: flex;" ></div>
                            <div id="${eleIds.bangumiTokenLabel}" class="${classes.embyFieldDesc}"></div>
                            <div class="${classes.embyFieldDesc}">
                                你可以在以下链接生成一个 Access Token
                            </div>
                            <div id="${eleIds.bangumiTokenLinkDiv}" style="padding-bottom: 0.5em;"></div>
                            <label class="${classes.embyLabel}">自动更新单章节收藏信息: </label>
                            <div style="${styles.embySlider}">
                                <label class="${classes.embyLabel}" style="width:4em;">${lsKeys.bangumiPostPercent.name}: </label>
                                <div id="${eleIds.bangumiPostPercentDiv}" style="width: 15.5em; text-align: center;"></div>
                                <label>
                                    <label style="${styles.embySliderLabel}"></label>
                                    <label>%</label>
                                </label>
                            </div>
                            <div class="${classes.embyFieldDesc}">
                                触发时机为正常停止播放,且播放进度超过设定百分比时;
                                同步的媒体信息为自动匹配而来,可在"弹幕信息"中查看;
                                自动匹配有误可"手动匹配",仍无法匹配可点击按钮X"取消匹配/清除弹幕",则此单章节不会同步;
                            </div>
                            <label class="${classes.embyLabel}">Bangumi API 地址: </label>
                            <div id="${eleIds.bangumiApiPrefixInputDiv}" style="display: flex; margin-bottom: 0.5em;"></div>
                            <label class="${classes.embyLabel}">Bangumi 图片域名: </label>
                            <div id="${eleIds.bangumiImageDomainInputDiv}" style="display: flex; margin-bottom: 0.5em;"></div>
                            <div class="${classes.embyFieldDesc}">
                                自定义 Bangumi API 和图片域名，用于镜像/代理场景，留空则使用默认值
                            </div>
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="TMDB 集数映射设置">
                    <div class="${classes.collapseContentNav}" style="padding-top: 0.5em !important;">
                        <label id="${eleIds.tmdbEnableLabel}" class="${classes.embyLabel}"></label>
                        <div id="${eleIds.tmdbSettingsDiv}">
                            <div id="${eleIds.tmdbApiKeyInputDiv}" style="display: flex;" ></div>
                            <div id="${eleIds.tmdbApiKeyLabel}" class="${classes.embyFieldDesc}"></div>
                            <div class="${classes.embyFieldDesc}">
                                你可以在以下链接申请 TMDB API Key
                            </div>
                            <div id="${eleIds.tmdbApiKeyLinkDiv}" style="padding-bottom: 0.5em;"></div>
                            <label class="${classes.embyLabel}">TMDB API 域名: </label>
                            <div id="${eleIds.tmdbApiBaseUrlInputDiv}" style="display: flex; margin-bottom: 0.5em;" ></div>
                            <div id="${eleIds.tmdbApiBaseUrlLabel}" class="${classes.embyFieldDesc}"></div>
                            <div class="${classes.embyFieldDesc}">
                                通过 TMDB Episode Group 自动处理集数偏移问题（如 S02E01→S01E25）
                            </div>
                            <div class="${classes.embyFieldDesc}">
                                启用后，将自动从 Emby 获取 TMDB Episode Group ID，并建立季集映射关系。
                                适用于解决 DanDanPlay 和 TMDB 集数不一致的问题。
                            </div>
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="配置持久化">
                    <div class="${classes.collapseContentNav}" style="padding-top: 0.5em !important;">
                        <div style="display: flex; gap: 20px; align-items: center;">
                            <label id="${eleIds.persistenceEnableLabel}" class="${classes.embyLabel}"></label>
                            <label id="${eleIds.persistenceAutoSyncLabel}" class="${classes.embyLabel}"></label>
                        </div>
                        <div id="${eleIds.persistenceSettingsDiv}">

                            <div style="display: flex; gap: 10px; margin-top: 1em;">
                                <button id="btnPersistenceUpload" is="emby-button" type="button" class="raised" style="flex: 1;">
                                    <span>同步到服务器</span>
                                </button>
                                <button id="btnPersistenceLoad" is="emby-button" type="button" class="raised" style="flex: 1;">
                                    <span>从服务器恢复</span>
                                </button>
                            </div>
                            <div id="${eleIds.persistenceStatusLabel}" class="${classes.embyFieldDesc}" style="margin-top: 1em;"></div>
                            <div class="${classes.embyFieldDesc}">
                                需要安装 <a href="https://github.com/l429609201/Parameter_persistence/releases" target="_blank" style="color: #4ea1d3; text-decoration: underline;">Parameter_persistence</a> 插件。开启后可手动同步配置到服务器，启用实时同步后配置变更会自动同步。
                            </div>
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="媒体库排除设置">
                    <div id="${eleIds.excludedLibrariesDiv}" class="${classes.collapseContentNav}"></div>
                </div>
                <div is="emby-collapse" title="搜索内容黑名单">
                    <div id="${eleIds.searchBlacklistDiv}" class="${classes.collapseContentNav}"></div>
                </div>
                <div is="emby-collapse" title="自定义接口地址">
                    <div id="${eleIds.customeUrlsDiv}" class="${classes.collapseContentNav}"></div>
                </div>
            </div>
        `;
        container.innerHTML = template.trim();
        const topOpts = [
        { id: 'default', name: '默认' },
        { id: 'bottom', name: '底部' },
        { id: 'rolling', name: '滚动' }
    ];
    getById('danmakuConvertTopToDiv', container).append(
        embyTabs(topOpts, lsGetItem(lsKeys.convertTopTo.id), 'id', 'name', (val) => {
            lsSetItem(lsKeys.convertTopTo.id, val.id);
            loadDanmaku(LOAD_TYPE.RELOAD);
        })
    );
    const bottomOpts = [
        { id: 'default', name: '默认' },
        { id: 'top', name: '顶部' },
        { id: 'rolling', name: '滚动' }
    ];
    getById('danmakuConvertBottomToDiv', container).append(
        embyTabs(bottomOpts, lsGetItem(lsKeys.convertBottomTo.id), 'id', 'name', (val) => {
            lsSetItem(lsKeys.convertBottomTo.id, val.id);
            loadDanmaku(LOAD_TYPE.RELOAD);
        })
    );
        buildDanmakuFilterSetting(container);
        buildExtSetting(container);
        buildAutoMatchSetting(container);
        buildEpisodeOffsetTab(eleIds.episodeOffsetRulesDiv);
        buildOsdSetting();
        buildPlaySetting(container);
        buildBangumiSetting(container);
        buildTmdbSetting(container);
        buildPersistenceSetting(container);
        buildExcludedLibrariesSetting(container);
        buildSearchBlacklistSetting(container);
        buildCustomUrlSetting(container);
    }

    function buildDanmakuFilterSetting(container) {
        getById(eleIds.danmakuTypeFilterDiv, container).append(
            embyCheckboxList(null, eleIds.danmakuTypeFilterSelectName
                , lsGetItem(lsKeys.typeFilter.id), Object.values(danmakuTypeFilterOpts).filter(o => !o.hidden)
                , doDanmakuTypeFilterSelect)
        );
        getById(eleIds.danmakuSourceFilterDiv, container).append(
            embyCheckboxList(null, eleIds.danmakuSourceFilterSelectName
                , lsGetItem(lsKeys.sourceFilter.id), Object.values(danmakuSource), doDanmakuSourceFilterSelect)
        );
        getById(eleIds.danmakuShowSourceDiv, container).append(
            embyCheckboxList(null, eleIds.danmakuShowSourceSelectName
                , lsGetItem(lsKeys.showSource.id), Object.values(showSource), doDanmakuShowSourceSelect)
        );
        getById(eleIds.danmakuAutoFilterCountDiv).append(
            embySlider({ lsKey: lsKeys.autoFilterCount }, onSliderChange, onSliderChangeLabel)
        );
        // 合并相似弹幕
        getById(eleIds.danmakuFilterProDiv, container).append(
            embyCheckbox({ label: labels.enable }, lsGetItem(lsKeys.mergeSimilarEnable.id)
            , (checked) => {
                lsSetItem(lsKeys.mergeSimilarEnable.id, checked);
                loadDanmaku(LOAD_TYPE.RELOAD);
            }
        ));
        getById(eleIds.mergeSimilarPercentDiv).append(
            embySlider({ lsKey: lsKeys.mergeSimilarPercent }, onSliderChange, onSliderChangeLabel)
        );
        getById(eleIds.mergeSimilarTimeDiv).append(
            embySlider({ lsKey: lsKeys.mergeSimilarTime }, onSliderChange, onSliderChangeLabel)
        );
        // 屏蔽关键词
        const keywordsContainer = getById(eleIds.filterKeywordsDiv, container);
        const keywordsEnableDiv = keywordsContainer.appendChild(document.createElement('div'));
        const keywordsBtn = embyButton({ label: '加载关键词过滤', iconKey: iconKeys.done_disabled }, doDanmakuFilterKeywordsBtnClick);
        keywordsBtn.disabled = true;
        keywordsEnableDiv.setAttribute('style', 'display: flex; justify-content: space-between; align-items: center; width: 100%;');
        keywordsEnableDiv.append(embyCheckbox(
            { id: eleIds.filterKeywordsEnableId, label: labels.enable }
            , lsGetItem(lsKeys.filterKeywordsEnable.id), (flag) => updateFilterKeywordsBtn(keywordsBtn, flag
                , getById(eleIds.filterKeywordsId).value.trim()))
        );
        keywordsEnableDiv.appendChild(document.createElement('div')).appendChild(keywordsBtn);
        keywordsContainer.appendChild(document.createElement('div')).appendChild(
            embyTextarea({id: eleIds.filterKeywordsId, value: lsGetItem(lsKeys.filterKeywords.id)
                , style: 'width: 100%;margin-top: 0.2em;', rows: 8}, (event) => updateFilterKeywordsBtn(keywordsBtn
                , getById(eleIds.filterKeywordsEnableId).checked, event.target.value.trim()))
        );
        const label = document.createElement('label');
        label.innerText = `关键词/正则匹配过滤,支持过滤[正文,${Object.values(showSource).map(o => o.name).join()}],多个表达式用换行分隔`;
        label.className = classes.embyFieldDesc;
        keywordsContainer.appendChild(document.createElement('div')).appendChild(label);
    }

    function buildExtSetting(container) {
        getById(eleIds.danmakuChConverDiv, container).append(
            embyTabs(danmakuChConverOpts, window.ede.chConvert, 'id', 'name', doDanmakuChConverChange)
        );
        getById(eleIds.danmakuEngineDiv, container).append(
            embyTabs(danmakuEngineOpts, lsGetItem(lsKeys.engine.id), 'id', 'name', doDanmakuEngineSelect)
        );
    }

    function buildAutoMatchSetting(container) {
        // 自动加载弹幕总开关
        const autoLoadDiv = getById(eleIds.autoLoadSwitchDiv, container);
        const autoLoadEnabled = lsGetItem(lsKeys.autoLoadSwitch.id);
        autoLoadDiv.append(
            embyCheckbox({ id: eleIds.autoLoadSwitchBtn, label: lsKeys.autoLoadSwitch.name }, autoLoadEnabled, (checked) => {
                lsSetItem(lsKeys.autoLoadSwitch.id, checked);
            })
        );

        // /match 接口开关
        const matchModeDiv = getById(eleIds.matchModeDiv, container);
        const matchEnabled = lsGetItem(lsKeys.matchApiEnable.id);
        matchModeDiv.style.display = matchEnabled ? '' : 'none';
        getById(eleIds.matchApiEnableDiv, container).append(
            embyCheckbox({ label: lsKeys.matchApiEnable.name }, matchEnabled, (checked) => {
                lsSetItem(lsKeys.matchApiEnable.id, checked);
                matchModeDiv.style.display = checked ? '' : 'none';
            })
        );

        // 匹配模式选择
        const matchModeLabelEle = document.createElement('label');
        matchModeLabelEle.className = classes.embyLabel;
        matchModeLabelEle.textContent = lsKeys.matchMode.name + ': ';
        matchModeDiv.append(matchModeLabelEle);
        matchModeDiv.append(
            embyTabs(danmakuMatchModeOpts, lsGetItem(lsKeys.matchMode.id), 'id', 'name', (value) => {
                lsSetItem(lsKeys.matchMode.id, value.id);
            })
        );
    }

    function buildEpisodeOffsetTab(containerId) {
        const container = getById(containerId);
        if (!container) return;

        // 生成示例 JSON
        const exampleRules = [
            { seriesName: '葬送的芙莉莲', fromSeason: 2, toSeason: 1, episodeOffset: 28 },
            { seriesName: '某剧第三季', fromSeason: 3, toSeason: 2, episodeOffset: 12 }
        ];
        const exampleJson = JSON.stringify(exampleRules, null, 2);

        const currentRules = lsGetItem(lsKeys.episodeOffsetRules.id) || [];
        const currentJson = currentRules.length > 0 ? JSON.stringify(currentRules, null, 2) : '[]';

        container.innerHTML = `
            <div style="padding: 0.5em 0;">
                <div class="${classes.embyFieldDesc}" style="margin-bottom: 1em;">
                    用于解决 Emby (TMDB) 和弹弹Play 集数不一致的问题。优先级高于 TMDB 剧集组映射。
                </div>
                <div style="margin-bottom: 0.8em;">
                    <label class="${classes.embyLabel}">当前规则 (JSON):</label>
                    <textarea id="episodeOffsetJsonEditor" is="emby-textarea" class="txtOverview emby-textarea"
                        style="width: 100%; resize: vertical; font-family: monospace; font-size: 0.9em;" rows="10">${escapeHtml(currentJson)}</textarea>
                </div>
                <div style="display: flex; gap: 0.5em; margin-bottom: 1em;">
                    <button id="episodeOffsetSaveBtn" is="emby-button" type="button" class="raised button-submit emby-button">
                        <span>保存规则</span>
                    </button>
                    <button id="episodeOffsetLoadExampleBtn" is="emby-button" type="button" class="raised emby-button">
                        <span>加载示例</span>
                    </button>
                    <button id="episodeOffsetClearBtn" is="emby-button" type="button" class="raised emby-button">
                        <span>清空规则</span>
                    </button>
                </div>
                <div id="episodeOffsetStatus" class="${classes.embyFieldDesc}" style="margin-bottom: 1em;"></div>
                <div is="emby-collapse" title="字段说明" data-expanded="true">
                    <div class="${classes.collapseContentNav}">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.15);">
                                <td style="padding: 0.4em; font-weight: bold; width: 130px;">seriesName</td>
                                <td style="padding: 0.4em;">系列名称，包含匹配（填的文字被包含在 Emby 系列名中即命中）</td>
                            </tr>
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.15);">
                                <td style="padding: 0.4em; font-weight: bold;">fromSeason</td>
                                <td style="padding: 0.4em;">来源季号 — 当 Emby 播放的季号等于此值时触发偏移</td>
                            </tr>
                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.15);">
                                <td style="padding: 0.4em; font-weight: bold;">toSeason</td>
                                <td style="padding: 0.4em;">目标季号 — 搜索弹幕时使用的季号</td>
                            </tr>
                            <tr>
                                <td style="padding: 0.4em; font-weight: bold;">episodeOffset</td>
                                <td style="padding: 0.4em;">集数偏移 — 搜索集号 = 原集号 + 此值（可以为负数）</td>
                            </tr>
                        </table>
                    </div>
                </div>
                <div is="emby-collapse" title="映射示例">
                    <div class="${classes.collapseContentNav}">
                        <pre style="background: rgba(0,0,0,0.3); padding: 0.8em; border-radius: 4px; font-size: 0.85em; overflow-x: auto; white-space: pre-wrap;">${escapeHtml(exampleJson)}</pre>
                        <div class="${classes.embyFieldDesc}" style="margin-top: 0.5em;">
                            上面的示例表示：<br/>
                            ① 葬送的芙莉莲: Emby S02E01 → 搜索 S01E29, S02E05 → 搜索 S01E33<br/>
                            ② 某剧第三季: Emby S03E01 → 搜索 S02E13, S03E05 → 搜索 S02E17
                        </div>
                    </div>
                </div>
            </div>
        `.trim();

        // 保存按钮
        getById('episodeOffsetSaveBtn').addEventListener('click', () => {
            const editor = getById('episodeOffsetJsonEditor');
            const statusLabel = getById('episodeOffsetStatus');
            try {
                const parsed = JSON.parse(editor.value);
                if (!Array.isArray(parsed)) throw new Error('JSON 必须是数组格式 [...]');
                // 校验每条规则
                for (let i = 0; i < parsed.length; i++) {
                    const r = parsed[i];
                    if (!r.seriesName || typeof r.seriesName !== 'string') throw new Error(`第 ${i + 1} 条: seriesName 必须是非空字符串`);
                    if (typeof r.fromSeason !== 'number') throw new Error(`第 ${i + 1} 条: fromSeason 必须是数字`);
                    if (typeof r.toSeason !== 'number') throw new Error(`第 ${i + 1} 条: toSeason 必须是数字`);
                    if (typeof r.episodeOffset !== 'number') throw new Error(`第 ${i + 1} 条: episodeOffset 必须是数字`);
                }
                lsSetItem(lsKeys.episodeOffsetRules.id, parsed);
                statusLabel.innerText = `✅ 已保存 ${parsed.length} 条偏移规则`;
                statusLabel.style.color = 'green';
                embyToast({ text: `已保存 ${parsed.length} 条集数偏移规则` });
            } catch (e) {
                statusLabel.innerText = `❌ JSON 格式错误: ${e.message}`;
                statusLabel.style.color = 'red';
                embyToast({ text: `保存失败: ${e.message}` });
            }
        });

        // 加载示例
        getById('episodeOffsetLoadExampleBtn').addEventListener('click', () => {
            getById('episodeOffsetJsonEditor').value = exampleJson;
            getById('episodeOffsetStatus').innerText = '已加载示例，请修改后点击「保存规则」';
            getById('episodeOffsetStatus').style.color = '';
        });

        // 清空
        getById('episodeOffsetClearBtn').addEventListener('click', () => {
            getById('episodeOffsetJsonEditor').value = '[]';
            lsSetItem(lsKeys.episodeOffsetRules.id, []);
            getById('episodeOffsetStatus').innerText = '✅ 已清空所有偏移规则';
            getById('episodeOffsetStatus').style.color = 'green';
            embyToast({ text: '已清空集数偏移规则' });
        });
    }

    function buildOsdSetting() {
        getById(eleIds.osdCheckboxDiv).append(embyCheckbox(
            { label: lsKeys.osdTitleEnable.name }, lsGetItem(lsKeys.osdTitleEnable.id), (checked) => {
                lsSetItem(lsKeys.osdTitleEnable.id, checked);
                const videoOsdContainer = document.querySelector(`${mediaContainerQueryStr} .videoOsdSecondaryText`);
                const videoOsdDanmakuTitle = getById(eleIds.videoOsdDanmakuTitle, videoOsdContainer);
                if (videoOsdDanmakuTitle) {
                    videoOsdDanmakuTitle.style.display = checked ? 'block' : 'none';
                } else if (checked) {
                    appendvideoOsdDanmakuInfo(getDanmakuComments(window.ede).length);
                }
            }
        ));
        getById(eleIds.osdCheckboxDiv).append(embyCheckbox(
            { label: lsKeys.osdHeaderClockEnable.name }, lsGetItem(lsKeys.osdHeaderClockEnable.id), (checked) => {
                lsSetItem(lsKeys.osdHeaderClockEnable.id, checked);
                checked ? addHeaderClock() : removeHeaderClock();
            }
        ));
        getById(eleIds.osdLineChartDiv).append(embyCheckbox(
            { label: lsKeys.osdLineChartEnable.name }, lsGetItem(lsKeys.osdLineChartEnable.id), (checked) => {
                lsSetItem(lsKeys.osdLineChartEnable.id, checked);
                const progressBarLineChart = getById(eleIds.progressBarLineChart);
                if (progressBarLineChart) {
                    progressBarLineChart.style.display = checked ? 'block' : 'none';
                } else if (checked) {
                    buildProgressBarChart(20);
                }
            }
        ));
        getById(eleIds.osdLineChartDiv).append(embyCheckbox(
            { label: lsKeys.osdLineChartSkipFilter.name }, lsGetItem(lsKeys.osdLineChartSkipFilter.id), (checked) => {
                lsSetItem(lsKeys.osdLineChartSkipFilter.id, checked);
                // [修复] 仅在用户手动操作时重绘，避免打开设置弹窗时自动触发
                buildProgressBarChart(20);
            }
        ));
        getById(eleIds.osdLineChartTimeDiv).append(
            embySlider({ lsKey: lsKeys.osdLineChartTime, needReload: false }
                , (val, opts) => {
                    onSliderChange(val, opts);
                    // [修复] opts.isManual=false 说明是 embySlider 初始化时自动触发的 change，跳过重绘
                    if (opts.isManual !== false) { buildProgressBarChart(20); }
                }, onSliderChangeLabel)
        );
    }

    function buildPlaySetting(container) {
        const btnContainer = getById(eleIds.timeoutCallbackDiv, container);
        const timeoutCallbacktOpts = { labelId: eleIds.timeoutCallbackLabel, key: lsKeys.timeoutCallbackValue.id, needReload: false };
        onSliderChangeLabel(lsGetItem(lsKeys.timeoutCallbackValue.id), timeoutCallbacktOpts);
        timeOffsetBtns.forEach(btn => {
            btnContainer.append(embyButton(btn, (e) => {
                if (e.target) {
                    let oldValue = lsGetItem(lsKeys.timeoutCallbackValue.id);
                    let newValue = oldValue + (parseFloat(e.target.getAttribute('valueOffset')) || 0);
                    if (newValue === oldValue || newValue < 0) { newValue = 0; }
                    onSliderChange(newValue, timeoutCallbacktOpts);
                }
            }));
        });
        getById(eleIds.timeoutCallbackUnitDiv, container).append(
            embyTabs(timeoutCallbackUnitOpts, lsGetItem(lsKeys.timeoutCallbackUnit.id), 'id', 'name', (value, index) => {
                lsSetItem(lsKeys.timeoutCallbackUnit.id, index);
            })
        );
        getById(eleIds.timeoutCallbackTypeDiv, container).append(
            embyTabs(timeoutCallbackTypeOpts, timeoutCallbackTypeOpts[0].id, 'id', 'name', (value) => {
                const unitObj = timeoutCallbackUnitOpts[lsGetItem(lsKeys.timeoutCallbackUnit.id)];
                value.onChange(lsGetItem(lsKeys.timeoutCallbackValue.id) * unitObj.msRate);
            })
        );
    }

    function buildBangumiSetting(container) {
        // BGM 搜索兜底开关（独立于令牌收藏功能，始终可用）
        const bgmSearchFallbackLabel = getById(eleIds.bgmSearchFallbackLabel, container);
        if (bgmSearchFallbackLabel) {
            bgmSearchFallbackLabel.append(embyCheckbox(
                { label: lsKeys.bgmSearchFallbackEnable.name }, lsGetItem(lsKeys.bgmSearchFallbackEnable.id), (checked) => {
                    lsSetItem(lsKeys.bgmSearchFallbackEnable.id, checked);
                }
            ));
        }
        const bangumiSettingsDiv = getById(eleIds.bangumiSettingsDiv, container);
        const bangumiEnable = lsGetItem(lsKeys.bangumiEnable.id);
        bangumiSettingsDiv.hidden = !bangumiEnable;
        const bangumiEnableLabel = getById(eleIds.bangumiEnableLabel, container);
        bangumiEnableLabel.append(embyCheckbox(
            { label: lsKeys.bangumiEnable.name }, bangumiEnable, (checked) => {
                lsSetItem(lsKeys.bangumiEnable.id, checked);
                bangumiSettingsDiv.hidden = !checked;
            }
        ));
        const bangumiTokenInputDiv = getById(eleIds.bangumiTokenInputDiv, container);
        bangumiTokenInputDiv.append(embyInput(
            { id: eleIds.bangumiTokenInput, type: 'password', value: lsGetItem(lsKeys.bangumiToken.id) }, onEnterBangumiToken
        ));
        bangumiTokenInputDiv.append(embyButton({ label: '校验', iconKey: iconKeys.check}, onEnterBangumiToken));
        getById(eleIds.bangumiPostPercentDiv, container).append(embySlider(
            { lsKey: lsKeys.bangumiPostPercent, needReload: false }
            , (val, opts) => { onSliderChange(val, opts) }, onSliderChangeLabel
        ));
        const bangumiTokenLinkDiv = getById(eleIds.bangumiTokenLinkDiv, container);
        bangumiTokenLinkDiv.append(embyALink(bangumiApi.accessTokenUrl, bangumiApi.accessTokenUrl));
        // Bangumi API 地址输入框
        const bangumiApiPrefixInputDiv = getById(eleIds.bangumiApiPrefixInputDiv, container);
        if (bangumiApiPrefixInputDiv) {
            bangumiApiPrefixInputDiv.append(embyInput(
                { id: 'bangumiApiPrefixInput', value: lsGetItem(lsKeys.bangumiApiPrefix.id) },
                (e) => { lsSetItem(lsKeys.bangumiApiPrefix.id, getById('bangumiApiPrefixInput').value.trim()); }
            ));
        }
        // Bangumi 图片域名输入框
        const bangumiImageDomainInputDiv = getById(eleIds.bangumiImageDomainInputDiv, container);
        if (bangumiImageDomainInputDiv) {
            bangumiImageDomainInputDiv.append(embyInput(
                { id: 'bangumiImageDomainInput', value: lsGetItem(lsKeys.bangumiImageDomain.id) },
                (e) => { lsSetItem(lsKeys.bangumiImageDomain.id, getById('bangumiImageDomainInput').value.trim()); }
            ));
        }
    }

    function onEnterBangumiToken(e) {
        const bangumiToken = getById(eleIds.bangumiTokenInput).value.trim();
        lsSetItem(lsKeys.bangumiToken.id, bangumiToken);
        const label = getById(eleIds.bangumiTokenLabel);
        fetchBangumiApiGetMe(bangumiToken).then(res => {
            label.innerText = 'Bangumi Token 验证成功';
            label.style.color = 'green';
        }).catch(error => {
            label.innerText = 'Bangumi Token 验证失败';
            label.style.color = 'red';
            logger.error('Bangumi Token 校验按钮处理失败', error);
        });
    }

    async function fetchBangumiApiGetMe(bangumiToken, fetchOpts = {}) {
        try {
            const res = await fetchJson(bangumiApi.getMe(), { ...fetchOpts, token: bangumiToken });
            logger.debug('Bangumi Token 验证成功', res);
            localStorage.setItem(lsLocalKeys.bangumiMe, JSON.stringify(res));
            return res;
        } catch (error) {
            logger.error('Bangumi Token 验证失败', error);
            throw error;
        }
    }

    function buildTmdbSetting(container) {
        const tmdbSettingsDiv = getById(eleIds.tmdbSettingsDiv, container);
        const tmdbEnable = lsGetItem(lsKeys.tmdbEpisodeMappingEnable.id);
        tmdbSettingsDiv.hidden = !tmdbEnable;
        const tmdbEnableLabel = getById(eleIds.tmdbEnableLabel, container);
        tmdbEnableLabel.append(embyCheckbox(
            { label: lsKeys.tmdbEpisodeMappingEnable.name }, tmdbEnable, (checked) => {
                lsSetItem(lsKeys.tmdbEpisodeMappingEnable.id, checked);
                tmdbSettingsDiv.hidden = !checked;
            }
        ));
        const tmdbApiKeyInputDiv = getById(eleIds.tmdbApiKeyInputDiv, container);
        tmdbApiKeyInputDiv.append(embyInput(
            { id: eleIds.tmdbApiKeyInput, type: 'password', value: lsGetItem(lsKeys.tmdbApiKey.id) }, onEnterTmdbApiKey
        ));
        tmdbApiKeyInputDiv.append(embyButton({ label: '校验', iconKey: iconKeys.check}, onEnterTmdbApiKey));
        const tmdbApiKeyLinkDiv = getById(eleIds.tmdbApiKeyLinkDiv, container);
        tmdbApiKeyLinkDiv.append(embyALink('https://www.themoviedb.org/settings/api', 'https://www.themoviedb.org/settings/api'));

        // TMDB API 域名输入框
        const tmdbApiBaseUrlInputDiv = getById(eleIds.tmdbApiBaseUrlInputDiv, container);
        tmdbApiBaseUrlInputDiv.append(embyInput(
            { id: eleIds.tmdbApiBaseUrlInput, type: 'text', value: lsGetItem(lsKeys.tmdbApiBaseUrl.id) }, onEnterTmdbApiBaseUrl
        ));
        const tmdbApiBaseUrlLabel = getById(eleIds.tmdbApiBaseUrlLabel, container);
        tmdbApiBaseUrlLabel.innerText = '默认: https://api.themoviedb.org (如需使用代理或镜像站，可修改此域名)';
    }

    function onEnterTmdbApiBaseUrl(e) {
        const tmdbApiBaseUrl = getById(eleIds.tmdbApiBaseUrlInput).value.trim();
        lsSetItem(lsKeys.tmdbApiBaseUrl.id, tmdbApiBaseUrl);
        const label = getById(eleIds.tmdbApiBaseUrlLabel);
        label.innerText = `已保存: ${tmdbApiBaseUrl}`;
        label.style.color = 'green';
    }

    function onEnterTmdbApiKey(e) {
        const tmdbApiKey = getById(eleIds.tmdbApiKeyInput).value.trim();
        lsSetItem(lsKeys.tmdbApiKey.id, tmdbApiKey);
        const label = getById(eleIds.tmdbApiKeyLabel);
        verifyTmdbApiKey(tmdbApiKey).then(res => {
            label.innerText = 'TMDB API Key 验证成功';
            label.style.color = 'green';
        }).catch(error => {
            label.innerText = 'TMDB API Key 验证失败';
            label.style.color = 'red';
            throw error;
        });
    }

    async function verifyTmdbApiKey(apiKey) {
        try {
            const tmdbBaseUrl = lsGetItem(lsKeys.tmdbApiBaseUrl.id) || 'https://api.themoviedb.org';
            const url = `${tmdbBaseUrl}/3/configuration?api_key=${apiKey}`;
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`TMDB API 请求失败: ${res.status}`);
            }
            const data = await res.json();
            logger.debug('TMDB API Key 验证成功', data);
            return data;
        } catch (error) {
            logger.error('TMDB API Key 验证失败', error);
            throw error;
        }
    }


    function buildPersistenceSetting(container) {
        const persistenceSettingsDiv = getById(eleIds.persistenceSettingsDiv, container);
        const persistenceEnable = lsGetItem(lsKeys.configPersistenceEnable.id);
        persistenceSettingsDiv.hidden = !persistenceEnable;

        const persistenceEnableLabel = getById(eleIds.persistenceEnableLabel, container);
        persistenceEnableLabel.append(embyCheckbox(
            { label: lsKeys.configPersistenceEnable.name }, persistenceEnable, (checked) => {
                lsSetItem(lsKeys.configPersistenceEnable.id, checked, true); // 持久化开关自身不同步
                persistenceSettingsDiv.hidden = !checked;
            }
        ));

        // 实时同步开关（在同一行）
        const persistenceAutoSyncLabel = getById(eleIds.persistenceAutoSyncLabel, container);
        const autoSyncEnable = lsGetItem(lsKeys.configPersistenceAutoSync.id);
        persistenceAutoSyncLabel.append(embyCheckbox(
            { label: lsKeys.configPersistenceAutoSync.name }, autoSyncEnable, (checked) => {
                lsSetItem(lsKeys.configPersistenceAutoSync.id, checked, true); // 实时同步开关自身不同步
            }
        ));

        // DLL 与纯 JS 模式都不再提供同步标识编辑；历史命名空间仅用于兼容读取。

        // 同步到服务器按钮
        const btnUpload = getById('btnPersistenceUpload', container);
        if (btnUpload) {
            btnUpload.addEventListener('click', async () => {
                const statusLabel = getById(eleIds.persistenceStatusLabel);
                statusLabel.innerText = '正在同步配置到服务器...';
                statusLabel.style.color = '';
                try {
                    const result = await persistenceUploadAll();
                    statusLabel.innerText = `✅ 同步完成: 新建 ${result.created} 个, 更新 ${result.updated} 个`;
                    statusLabel.style.color = 'green';
                    embyToast({ text: `配置已同步到服务器` });
                } catch (error) {
                    statusLabel.innerText = `❌ 同步失败: ${error.message}`;
                    statusLabel.style.color = 'red';
                    embyToast({ text: `同步失败: ${error.message}` });
                }
            });
        }

        // 从服务器恢复按钮
        const btnLoad = getById('btnPersistenceLoad', container);
        if (btnLoad) {
            btnLoad.addEventListener('click', async () => {
                const statusLabel = getById(eleIds.persistenceStatusLabel);
                statusLabel.innerText = '正在从服务器恢复配置...';
                statusLabel.style.color = '';
                try {
                    const identity = persistenceIdentity();
                    await prepareUserParameters();
                    const count = identity === persistenceIdentity() ? await persistenceLoadAll(identity) : -1;
                    if (count > 0) {
                        statusLabel.innerText = `✅ 恢复完成: 已加载 ${count} 个配置，刷新页面生效`;
                        statusLabel.style.color = 'green';
                        embyToast({ text: `已从服务器恢复 ${count} 个配置，刷新页面生效` });
                    } else if (count === 0) {
                        statusLabel.innerText = '⚠️ 服务器无配置数据，请先同步';
                        statusLabel.style.color = 'orange';
                    } else {
                        statusLabel.innerText = '❌ 恢复失败: 无法连接持久化服务';
                        statusLabel.style.color = 'red';
                    }
                } catch (error) {
                    statusLabel.innerText = `❌ 恢复失败: ${error.message}`;
                    statusLabel.style.color = 'red';
                    embyToast({ text: `恢复失败: ${error.message}` });
                }
            });
        }
    }


    // =============================================
    // 配置持久化服务 - 通过 Parameter_persistence 插件
    // =============================================

    function getPersistenceNamespace() {
        return lsGetItem(lsKeys.configPersistenceNamespace.id) || 'dd-danmaku';
    }

    function getPersistenceBaseUrl() {
        return `${getHostApiClient()?.serverAddress?.() || ''}/emby/ParameterPersistence`;
    }

    function getPersistenceHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-Emby-Token': getHostApiClient()?.accessToken?.() || ''
        };
    }

    // 查询服务器上所有持久化配置
    async function persistenceQueryAll(withMetadata = false) {
        try {
            // 使用宿主认证头，不在查询字符串中暴露令牌。
            const url = `${getPersistenceBaseUrl()}/Query?Namespace=${encodeURIComponent(getPersistenceNamespace())}`;
            const response = await fetch(url, { method: 'GET', headers: { 'X-Emby-Token': getHostApiClient()?.accessToken?.() || '' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            if (result.Success) return withMetadata ? result : (result.DataList || []);
            logger.warn('[持久化] 查询失败:', result.Message);
            return withMetadata ? null : [];
        } catch (error) {
            logger.error('[持久化] 查询服务器配置失败:', error);
            return null;
        }
    }

    // 批量保存配置到服务器（自动区分 Create / Update）
    async function persistenceSaveBatch(paramsMap) {
        try {
            const existingList = await persistenceQueryAll();
            if (existingList === null) throw new Error('无法连接持久化服务');
            const existingKeys = new Set(existingList.map(p => p.Key));

            const toCreate = [];
            const toUpdate = [];
            for (const [key, value] of Object.entries(paramsMap)) {
                const param = {
                    Namespace: getPersistenceNamespace(),
                    Key: key,
                    Value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                    Type: typeof value === 'object' ? 'json' : typeof value,
                    Description: lsGetKeyById(key) ? lsKeys[lsGetKeyById(key)].name : key
                };
                if (existingKeys.has(key)) {
                    toUpdate.push(param);
                } else {
                    toCreate.push(param);
                }
            }

            let created = 0, updated = 0;
            if (toCreate.length > 0) {
                const resp = await fetch(`${getPersistenceBaseUrl()}/Create`, {
                    method: 'POST',
                    headers: getPersistenceHeaders(),
                    body: JSON.stringify({ userid: getHostApiClient()?.getCurrentUserId?.() || '', Parameters: toCreate })
                });
                const r = await resp.json();
                if (r.Success) created = toCreate.length;
            }
            if (toUpdate.length > 0) {
                const resp = await fetch(`${getPersistenceBaseUrl()}/Update`, {
                    method: 'POST',
                    headers: getPersistenceHeaders(),
                    body: JSON.stringify({ userid: getHostApiClient()?.getCurrentUserId?.() || '', Parameters: toUpdate })
                });
                const r = await resp.json();
                if (r.Success) updated = toUpdate.length;
            }

            logger.info(`[持久化] 批量保存完成: 新建 ${created} 个, 更新 ${updated} 个`);
            return { created, updated };
        } catch (error) {
            logger.error('[持久化] 批量保存失败:', error);
            throw error;
        }
    }

    // 保存单个配置到服务器（防抖）
    const _persistenceSaveTimers = {};
    function persistenceSaveOneDebounced(key, value) {
        const identity = persistenceIdentity();
        const timerKey = `${identity}:${key}`;
        if (_persistenceSaveTimers[timerKey]) clearTimeout(_persistenceSaveTimers[timerKey]);
        _persistenceSaveTimers[timerKey] = setTimeout(async () => {
            try {
                // 等待首次读取完服务器参数，账号切换后丢弃旧会话的异步写入。
                await prepareUserParameters();
                if (identity !== persistenceIdentity() || !ddBackend.has('ParameterPersistence')) return;
                const userId = getHostApiClient()?.getCurrentUserId?.() || '';
                // 先尝试 Update，如果不存在则 Create
                let resp = await fetch(`${getPersistenceBaseUrl()}/Update`, {
                    method: 'POST',
                    headers: getPersistenceHeaders(),
                    body: JSON.stringify({
                        userid: userId,
                        Namespace: getPersistenceNamespace(),
                        Key: key,
                        Value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                        Type: typeof value === 'object' ? 'json' : typeof value
                    })
                });
                let result = await resp.json();
                if (!result.Success && identity === persistenceIdentity()) {
                    // 不存在则创建
                    resp = await fetch(`${getPersistenceBaseUrl()}/Create`, {
                        method: 'POST',
                        headers: getPersistenceHeaders(),
                        body: JSON.stringify({
                            userid: userId,
                            Namespace: getPersistenceNamespace(),
                            Key: key,
                            Value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                            Type: typeof value === 'object' ? 'json' : typeof value,
                            Description: lsGetKeyById(key) ? lsKeys[lsGetKeyById(key)].name : key
                        })
                    });
                }
            } catch (error) {
                logger.debug(`[持久化] 同步 ${key} 失败:`, error.message);
            }
        }, 1000); // 1秒防抖
    }

    // 从服务器加载所有配置到 localStorage
    async function persistenceLoadAll(identity = '') {
        try {
            const result = await persistenceQueryAll(true);
            if (!result || (identity && identity !== persistenceIdentity())) return -1;
            const list = result.DataList || [];
            // 服务端为当前用户的权威快照；移除本地已删除的个人项，避免重置后继续沿用旧值。
            const serverKeys = new Set(list.map(param => param.Key));
            for (const { id } of Object.values(lsKeys)) {
                if (!serverKeys.has(id)) {
                    const storageKey = localParameterKey(id);
                    localStorage.removeItem(storageKey);
                    lsCache.delete(storageKey);
                }
            }
            if (!list.length) {
                logger.info('[持久化] 服务器无配置数据');
                return 0;
            }
            // 旧浏览器共享键无法确认归属，不自动上传；只接收当前用户服务器文件。
            let count = 0;
            for (const param of list) {
                if (identity && identity !== persistenceIdentity()) return -1;
                const keyName = lsGetKeyById(param.Key);
                if (!keyName) continue;
                const defaultValue = lsKeys[keyName].defaultValue;
                let parsedValue;
                if (param.Type === 'json' || Array.isArray(defaultValue) || typeof defaultValue === 'object') {
                    try { parsedValue = JSON.parse(param.Value); } catch { parsedValue = param.Value; }
                } else if (typeof defaultValue === 'boolean') {
                    parsedValue = param.Value === 'true';
                } else if (typeof defaultValue === 'number') {
                    parsedValue = parseFloat(param.Value);
                } else {
                    parsedValue = param.Value;
                }
                lsSetItem(param.Key, parsedValue, true);
                count++;
            }
            logger.info(`[持久化] 从服务器加载了 ${count} 个配置`);
            return count;
        } catch (error) {
            logger.error('[持久化] 从服务器加载配置失败:', error);
            return -1;
        }
    }

    // 将当前 localStorage 所有 lsKeys 配置上传到服务器
    async function persistenceUploadAll() {
        const paramsMap = {};
        for (const [, keyConfig] of Object.entries(lsKeys)) {
            if (keyConfig.id === lsKeys.configPersistenceEnable.id) continue;
            const value = lsGetItem(keyConfig.id);
            if (value !== null && value !== undefined) {
                paramsMap[keyConfig.id] = value;
            }
        }
        return await persistenceSaveBatch(paramsMap);
    }

    /**
     * TMDB Episode Mapper - 集数映射功能
     * 通过 TMDB Episode Group 自动处理集数偏移问题
     */
    const episodeMappingCache = new Map();

    async function getEmbyItemProviderIds(itemId) {
        try {
            const client = getHostApiClient();
            if (!client?.getCurrentUserId || !client.serverAddress || !client.accessToken) return [];
            const userId = client.getCurrentUserId();
            const url = `${client.serverAddress()}/emby/Users/${userId}/Items/${itemId}?api_key=${client.accessToken()}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Emby API 请求失败: ${response.status}`);
            }
            const data = await response.json();

            // 获取 Episode 的基本信息
            const episodeInfo = {
                providerIds: data.ProviderIds || {},
                season: data.ParentIndexNumber,
                episode: data.IndexNumber,
                seriesId: data.SeriesId,
                seriesName: data.SeriesName
            };

            // 如果有 SeriesId，从 Series 获取 TMDB Episode Group ID
            if (data.SeriesId) {
                try {
                    const seriesUrl = `${client.serverAddress()}/emby/Users/${userId}/Items/${data.SeriesId}?api_key=${client.accessToken()}`;
                    const seriesResponse = await fetch(seriesUrl);
                    if (seriesResponse.ok) {
                        const seriesData = await seriesResponse.json();
                        // 合并 Series 的 ProviderIds（TMDB Episode Group ID 通常在这里）
                        episodeInfo.providerIds = {
                            ...episodeInfo.providerIds,
                            ...(seriesData.ProviderIds || {})
                        };
                        logger.debug(`[集数映射] 已从 Series (${data.SeriesId}) 获取 ProviderIds:`, seriesData.ProviderIds);
                    }
                } catch (seriesError) {
                    logger.warn('[集数映射] 获取 Series ProviderIds 失败:', seriesError);
                }
            }

            return episodeInfo;
        } catch (error) {
            logger.error('获取 Emby ProviderIds 失败:', error);
            return null;
        }
    }

    async function getTmdbEpisodeGroups(tmdbId, tmdbApiKey) {
        try {
            // 先查 IndexedDB 缓存（TTL 7天）
            const cacheKey = `eg-list:${tmdbId}`;
            const cached = await IndexedDBCache.loadTmdb(cacheKey);
            if (cached) {
                logger.info(`[集数映射] Episode Groups 列表缓存命中 (tmdbId: ${tmdbId})`);
                return cached;
            }

            const tmdbBaseUrl = lsGetItem(lsKeys.tmdbApiBaseUrl.id) || 'https://api.themoviedb.org';
            const url = `${tmdbBaseUrl}/3/tv/${tmdbId}/episode_groups?api_key=${tmdbApiKey}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`TMDB API 请求失败: ${response.status}`);
            }
            const data = await response.json();
            const results = data.results || [];

            // 写入 IndexedDB 缓存（7天 TTL）
            if (results.length > 0) {
                IndexedDBCache.saveTmdb(cacheKey, results, 7);
            }

            return results;
        } catch (error) {
            logger.error('[集数映射] 获取 TMDB Episode Groups 失败:', error);
            return null;
        }
    }

    async function getTmdbEpisodeGroup(episodeGroupId, tmdbApiKey) {
        // 先查内存缓存
        if (episodeMappingCache.has(episodeGroupId)) {
            logger.debug('[集数映射] 使用内存缓存的 TMDB Episode Group 数据');
            return episodeMappingCache.get(episodeGroupId);
        }

        try {
            // 再查 IndexedDB 缓存（TTL 30天）
            const cacheKey = `eg-detail:${episodeGroupId}`;
            const cached = await IndexedDBCache.loadTmdb(cacheKey);
            if (cached) {
                logger.info(`[集数映射] Episode Group 详情缓存命中 (groupId: ${episodeGroupId})`);
                episodeMappingCache.set(episodeGroupId, cached);
                return cached;
            }

            const tmdbBaseUrl = lsGetItem(lsKeys.tmdbApiBaseUrl.id) || 'https://api.themoviedb.org';
            const url = `${tmdbBaseUrl}/3/tv/episode_group/${episodeGroupId}?api_key=${tmdbApiKey}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`TMDB API 请求失败: ${response.status}`);
            }
            const data = await response.json();

            // 写入内存缓存 + IndexedDB 缓存（30天 TTL）
            episodeMappingCache.set(episodeGroupId, data);
            IndexedDBCache.saveTmdb(cacheKey, data, 30);

            return data;
        } catch (error) {
            logger.error('[集数映射] 获取 TMDB Episode Group 失败:', error);
            return null;
        }
    }

    function buildEpisodeMapping(episodeGroup) {
        if (!episodeGroup || !episodeGroup.groups) {
            return null;
        }

        const mapping = {
            absoluteToSeason: {},
            seasonToAbsolute: {},
            totalEpisodes: 0,
            tmdbToCustom: {},  // 反向映射: TMDB季集 → Custom季集
            customToTmdb: {}   // 正向映射: Custom季集 → TMDB季集
        };

        let absoluteEpisode = 1;
        const mappingLines = []; // 收集映射日志

        episodeGroup.groups.forEach((group, groupIndex) => {
            if (group.episodes && Array.isArray(group.episodes)) {
                group.episodes.forEach((episode, episodeIndex) => {
                    // customSeasonNumber = group.order（TMDB 返回的分组顺序号）
                    // customEpisodeNumber = episodeIndex + 1（从1开始）
                    // tmdbSeasonNumber/tmdbEpisodeNumber = TMDB 原始季集号
                    const customSeason = group.order !== undefined ? group.order : (groupIndex + 1);
                    const customEpisode = episodeIndex + 1;
                    const tmdbSeason = episode.season_number;
                    const tmdbEpisode = episode.episode_number;

                    const seasonEpisodeKey = `S${String(customSeason).padStart(2, '0')}E${String(customEpisode).padStart(2, '0')}`;

                    mapping.absoluteToSeason[absoluteEpisode] = {
                        season: customSeason,
                        episode: customEpisode,
                        tmdbSeason: tmdbSeason,
                        tmdbEpisode: tmdbEpisode
                    };

                    mapping.seasonToAbsolute[seasonEpisodeKey] = absoluteEpisode;

                    // 双向映射表
                    const tmdbKey = `S${String(tmdbSeason).padStart(2, '0')}E${String(tmdbEpisode).padStart(2, '0')}`;
                    mapping.customToTmdb[seasonEpisodeKey] = { season: tmdbSeason, episode: tmdbEpisode };
                    mapping.tmdbToCustom[tmdbKey] = { season: customSeason, episode: customEpisode };

                    // 收集映射信息（不立即打印）
                    mappingLines.push(`  Custom ${seasonEpisodeKey} <-> TMDB ${tmdbKey}`);

                    absoluteEpisode++;
                });
            }
        });

        mapping.totalEpisodes = absoluteEpisode - 1;

        // 一次性输出所有映射（换行分隔）
        if (mappingLines.length > 0) {
            logger.debug('[集数映射] 映射表:\n' + mappingLines.join('\n'));
        }

        return mapping;
    }

    function convertSeasonEpisode(season, episode, mapping) {
        if (!mapping) {
            return null;
        }

        const key = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;

        // 方向1: 作为 Custom 季集查 → 返回 TMDB 季集
        if (mapping.customToTmdb[key]) {
            const mapped = mapping.customToTmdb[key];
            logger.info(`[集数映射] Custom ${key} -> TMDB S${String(mapped.season).padStart(2, '0')}E${String(mapped.episode).padStart(2, '0')} (custom_to_tmdb)`);
            return { season: mapped.season, episode: mapped.episode, direction: 'custom_to_tmdb' };
        }

        // 方向2: 作为 TMDB 季集查 → 返回 Custom 季集
        if (mapping.tmdbToCustom[key]) {
            const mapped = mapping.tmdbToCustom[key];
            logger.info(`[集数映射] TMDB ${key} -> Custom S${String(mapped.season).padStart(2, '0')}E${String(mapped.episode).padStart(2, '0')} (tmdb_to_custom)`);
            return { season: mapped.season, episode: mapped.episode, direction: 'tmdb_to_custom' };
        }

        logger.debug(`[集数映射] ${key} 未找到任何映射`);
        return null;
    }

    async function getEpisodeMappingForCurrentItem(itemId) {
        try {
            const tmdbApiKey = lsGetItem(lsKeys.tmdbApiKey.id);
            const mappingEnabled = lsGetItem(lsKeys.tmdbEpisodeMappingEnable.id);

            if (!mappingEnabled || !tmdbApiKey) {
                logger.debug('[集数映射] 未启用或未配置 TMDB API Key');
                return null;
            }

            const itemInfo = await getEmbyItemProviderIds(itemId);
            if (!itemInfo || !itemInfo.providerIds) {
                logger.debug('[集数映射] 无法获取 ProviderIds');
                return null;
            }

            // 只对电视节目类型（Episode）进行映射，电影不触发
            const itemDetail = await fatchEmbyItemInfo(itemId);
            if (!itemDetail || itemDetail.Type !== 'Episode') {
                logger.debug(`[集数映射] 当前类型为 ${itemDetail?.Type}，跳过映射（仅支持 Episode 类型）`);
                return null;
            }

            let tmdbEgId = itemInfo.providerIds.TmdbEg;

            // 冗余处理：如果没有 TmdbEg，尝试通过 Tmdb ID 获取 Episode Groups
            if (!tmdbEgId && itemInfo.providerIds.Tmdb) {
                logger.info(`[集数映射] 未找到 TmdbEg，尝试通过 Tmdb ID (${itemInfo.providerIds.Tmdb}) 获取 Episode Groups`);
                const episodeGroups = await getTmdbEpisodeGroups(itemInfo.providerIds.Tmdb, tmdbApiKey);

                if (episodeGroups && episodeGroups.length > 0) {
                    // 优先选择 type 为 "Original air date" 的分组
                    const originalAirDateGroup = episodeGroups.find(g => g.type === 7); // type 7 = Original air date
                    const selectedGroup = originalAirDateGroup || episodeGroups[0];

                    tmdbEgId = selectedGroup.id;
                    logger.info(`[集数映射] 自动选择 Episode Group: ${selectedGroup.name} (ID: ${tmdbEgId}, Type: ${selectedGroup.type})`);
                } else {
                    logger.debug('[集数映射] 该剧集没有可用的 Episode Groups');
                    return null;
                }
            }

            if (!tmdbEgId) {
                logger.debug('[集数映射] 该剧集没有 TMDB Episode Group ID');
                return null;
            }

            logger.info(`[集数映射] 发现 TMDB Episode Group ID: ${tmdbEgId}`);

            const episodeGroup = await getTmdbEpisodeGroup(tmdbEgId, tmdbApiKey);
            if (!episodeGroup) {
                logger.debug('[集数映射] 无法获取 Episode Group 数据');
                return null;
            }

            const mapping = buildEpisodeMapping(episodeGroup);
            if (!mapping) {
                logger.debug('[集数映射] 无法构建映射表');
                return null;
            }

            logger.info(`[集数映射] 成功构建映射表，共 ${mapping.totalEpisodes} 集`);

            return {
                mapping,
                currentSeason: itemInfo.season,
                currentEpisode: itemInfo.episode,
                seriesName: itemInfo.seriesName,
                tmdbEgId
            };
        } catch (error) {
            logger.error('[集数映射] 获取集数映射失败:', error);
            return null;
        }
    }

    /**
     * 构建媒体库排除设置界面
     */
    function buildExcludedLibrariesSetting(container) {
        const excludedDiv = getById(eleIds.excludedLibrariesDiv, container);
        if (!excludedDiv) return;
         // 初始模板 - 显示加载中
        excludedDiv.innerHTML = `
            <div class="${classes.embyFieldDesc}" style="margin-bottom: 0.5em;">
                勾选不需要加载弹幕的媒体库：
            </div>
            <div id="libraryListContainer" style="padding: 0.5em;">
                <span style="color: #888;">正在加载媒体库列表...</span>
            </div>
        `;

        // 异步加载媒体库列表
        getAllLibraries().then(libraries => {
            const listContainer = getById('libraryListContainer');
            if (!listContainer) return;

            if (libraries.length === 0) {
                listContainer.innerHTML = '<span style="color: #f44;">无法获取媒体库列表，请确保已登录</span>';
                return;
            }

            const excludedList = lsGetItem(lsKeys.excludedLibraries.id) || [];
            // 构建复选框列表
            let checkboxHtml = '';
            libraries.forEach(lib => {
                const isChecked = excludedList.includes(lib.name) || excludedList.includes(lib.id);
                const typeLabel = lib.collectionType ? ` <span style="color: #888; font-size: 0.85em;">(${lib.collectionType})</span>` : '';
                checkboxHtml += `
                    <label class="emby-checkbox-label" style="display: flex; align-items: center; padding: 0.4em 0; cursor: pointer;">
                        <input type="checkbox" is="emby-checkbox" class="libraryExcludeCheckbox"
                            data-library-id="${lib.id}" data-library-name="${lib.name}"
                            ${isChecked ? 'checked' : ''} />
                        <span style="margin-left: 0.5em;">${lib.name}${typeLabel}</span>
                    </label>
                `;
            });

            listContainer.innerHTML = `
                <div style="max-height: 200px; overflow-y: auto; border: 1px solid rgba(128,128,128,0.3); border-radius: 4px; padding: 0.5em;">
                    ${checkboxHtml}
                </div>
                <div style="margin-top: 0.5em; color: #888; font-size: 0.85em;">
                    共 ${libraries.length} 个媒体库，已排除 ${excludedList.length} 个
                </div>
            `;

            // 绑定复选框事件 - 实时保存
            const checkboxes = listContainer.querySelectorAll('.libraryExcludeCheckbox');
            checkboxes.forEach(checkbox => {
                checkbox.addEventListener('change', () => {
                    const newExcludedList = [];
                    listContainer.querySelectorAll('.libraryExcludeCheckbox:checked').forEach(cb => {
                        newExcludedList.push(cb.dataset.libraryName);
                    });
                    lsSetItem(lsKeys.excludedLibraries.id, newExcludedList);
                    logger.info('[dd-danmaku] 已更新排除媒体库列表:', newExcludedList);

                    // 检查当前播放的视频是否受影响
                    if (window.ede && window.ede.currentLibraryInfo) {
                        const currentLibName = window.ede.currentLibraryInfo.libraryName;
                        const isNowExcluded = newExcludedList.includes(currentLibName);

                        // 如果当前播放的媒体库刚被排除 -> 清空弹幕
                        if (isNowExcluded) {
                            if (window.ede.danmaku) {
                                logger.info(`[设置] 媒体库 "${currentLibName}" 被排除，关闭弹幕`);
                                // 传入空数组，清空弹幕
                                createDanmaku([]);
                                // 可选：给个提示
                                // embyToast({ text: '当前媒体库弹幕已关闭' });
                            }
                        }
                        // 如果当前播放的媒体库刚被允许 -> 重新加载
                        else {
                            logger.info(`[设置] 媒体库 "${currentLibName}" 已允许，重新加载`);
                            loadDanmaku(LOAD_TYPE.RELOAD);
                        }
                    }
                });
            });
        });
    }

    /**
     * 构建搜索内容黑名单设置界面
     */
    function buildSearchBlacklistSetting(container) {
        const blacklistDiv = getById(eleIds.searchBlacklistDiv, container);
        if (!blacklistDiv) return;

        // 获取当前保存的值
        const animeTitleBlacklist = lsGetItem(lsKeys.animeTitleBlacklist.id) || '';
        const episodeTitleBlacklist = lsGetItem(lsKeys.episodeTitleBlacklist.id) || lsKeys.episodeTitleBlacklist.defaultValue;
        const blacklistApplyToCustomApi = lsGetItem(lsKeys.blacklistApplyToCustomApi.id) ?? lsKeys.blacklistApplyToCustomApi.defaultValue;

        blacklistDiv.innerHTML = `
            <div class="${classes.embyFieldDesc}" style="margin-bottom: 0.8em;">
                用于过滤官方搜索接口返回的内容，支持正则表达式。匹配到的内容将被排除。
            </div>

            <div style="margin-bottom: 1.5em;">
                <label class="${classes.embyCheckboxLabel}">
                    <input type="checkbox" is="emby-checkbox" id="${eleIds.blacklistApplyToCustomApiCheckbox}"
                        ${blacklistApplyToCustomApi ? 'checked' : ''} />
                    <span>应用黑名单到自定义接口</span>
                </label>
                <div class="${classes.embyFieldDesc}" style="margin-top: 0.3em;">
                    默认仅对官方接口生效，开启后自定义接口也会应用黑名单过滤
                </div>
            </div>

            <div style="margin-bottom: 1.2em; margin-top: 1.5em;">
                <label class="${classes.embyLabel}" style="font-size: 1em;">番剧标题黑名单（过滤整个番剧）:</label>
                <div class="${classes.embyFieldDesc}" style="margin-bottom: 0.5em;">
                    示例: <code>剧场版|OVA|特别篇</code> 将过滤标题包含这些关键词的番剧
                </div>
                <input type="text" is="emby-input" id="${eleIds.animeTitleBlacklistInput}"
                    class="${classes.embyInput}"
                    value="${escapeHtml(animeTitleBlacklist)}"
                    placeholder="留空表示不过滤，示例: 剧场版|OVA|特别篇" />
            </div>

            <div style="margin-bottom: 1.2em;">
                <label class="${classes.embyLabel}" style="font-size: 1em;">分集名称黑名单（过滤番剧下的分集）:</label>
                <div class="${classes.embyFieldDesc}" style="margin-bottom: 0.5em;">
                    用于过滤 OP、ED、特典、PV 等非正片内容
                </div>
                <textarea is="emby-textarea" id="${eleIds.episodeTitleBlacklistInput}"
                    class="${classes.embyInput}"
                    style="min-height: 100px; font-family: monospace;"
                    placeholder="留空表示不过滤">${escapeHtml(episodeTitleBlacklist)}</textarea>
            </div>

            <div style="display: flex; gap: 0.5em;">
                <button is="emby-button" type="button" class="raised" id="saveBlacklistBtn">
                    <span>保存设置</span>
                </button>
                <button is="emby-button" type="button" class="raised" id="resetBlacklistBtn">
                    <span>恢复默认</span>
                </button>
                <button is="emby-button" type="button" class="raised" id="testBlacklistBtn">
                    <span>测试正则</span>
                </button>
            </div>
            <div id="blacklistTestResult" style="margin-top: 0.5em; padding: 0.5em; display: none;"></div>
        `;

        // 保存按钮事件
        blacklistDiv.querySelector('#saveBlacklistBtn').addEventListener('click', () => {
            const animeInput = getById(eleIds.animeTitleBlacklistInput);
            const episodeInput = getById(eleIds.episodeTitleBlacklistInput);
            const applyToCustomCheckbox = getById(eleIds.blacklistApplyToCustomApiCheckbox);

            const animeValue = animeInput.value.trim();
            const episodeValue = episodeInput.value.trim();
            const applyToCustomValue = applyToCustomCheckbox.checked;

            // 验证正则表达式是否有效
            try {
                if (animeValue) new RegExp(animeValue, 'i');
                if (episodeValue) new RegExp(episodeValue, 'i');
            } catch (e) {
                embyToast({ text: `正则表达式语法错误: ${e.message}` });
                return;
            }

            lsSetItem(lsKeys.animeTitleBlacklist.id, animeValue);
            lsSetItem(lsKeys.episodeTitleBlacklist.id, episodeValue);
            lsSetItem(lsKeys.blacklistApplyToCustomApi.id, applyToCustomValue);
            embyToast({ text: '搜索内容黑名单设置已保存' });
            logger.info('[设置] 搜索内容黑名单已更新:', { animeValue, episodeValue, applyToCustomValue });
        });

        // 恢复默认按钮事件
        blacklistDiv.querySelector('#resetBlacklistBtn').addEventListener('click', () => {
            const animeInput = getById(eleIds.animeTitleBlacklistInput);
            const episodeInput = getById(eleIds.episodeTitleBlacklistInput);
            const applyToCustomCheckbox = getById(eleIds.blacklistApplyToCustomApiCheckbox);

            animeInput.value = '';
            episodeInput.value = lsKeys.episodeTitleBlacklist.defaultValue;
            applyToCustomCheckbox.checked = lsKeys.blacklistApplyToCustomApi.defaultValue;

            lsSetItem(lsKeys.animeTitleBlacklist.id, '');
            lsSetItem(lsKeys.episodeTitleBlacklist.id, lsKeys.episodeTitleBlacklist.defaultValue);
            lsSetItem(lsKeys.blacklistApplyToCustomApi.id, lsKeys.blacklistApplyToCustomApi.defaultValue);
            embyToast({ text: '已恢复默认设置' });
        });

        // 测试按钮事件
        blacklistDiv.querySelector('#testBlacklistBtn').addEventListener('click', () => {
            const animeInput = getById(eleIds.animeTitleBlacklistInput);
            const episodeInput = getById(eleIds.episodeTitleBlacklistInput);
            const resultDiv = blacklistDiv.querySelector('#blacklistTestResult');

            const animeRegex = animeInput.value.trim();
            const episodeRegex = episodeInput.value.trim();

            // 测试用例
            const testAnimeTitles = ['刀剑神域', '刀剑神域剧场版', '进击的巨人 OVA', '鬼灭之刃', '某科学的超电磁炮 特别篇'];
            const testEpisodeTitles = ['第1话 开始', 'C1 Opening 1a', 'S1 Special Edition', '第15话 决战', 'NCED', 'PV1', '特番 放送直前'];

            let html = '<div style="font-size: 0.9em;">';

            // 测试番剧标题
            html += '<div style="margin-bottom: 0.5em;"><strong>番剧标题测试:</strong></div>';
            if (animeRegex) {
                try {
                    const regex = new RegExp(animeRegex, 'i');
                    testAnimeTitles.forEach(title => {
                        const matched = regex.test(title);
                        const color = matched ? '#f44336' : '#4caf50';
                        const status = matched ? '✗ 过滤' : '✓ 保留';
                        html += `<div style="color: ${color}; padding: 0.2em 0;">${status}: ${title}</div>`;
                    });
                } catch (e) {
                    html += `<div style="color: #f44336;">正则错误: ${e.message}</div>`;
                }
            } else {
                html += '<div style="color: #888;">未设置，全部保留</div>';
            }

            // 测试分集名称
            html += '<div style="margin: 0.5em 0;"><strong>分集名称测试:</strong></div>';
            if (episodeRegex) {
                try {
                    const regex = new RegExp(episodeRegex, 'i');
                    testEpisodeTitles.forEach(title => {
                        const matched = regex.test(title);
                        const color = matched ? '#f44336' : '#4caf50';
                        const status = matched ? '✗ 过滤' : '✓ 保留';
                        html += `<div style="color: ${color}; padding: 0.2em 0;">${status}: ${title}</div>`;
                    });
                } catch (e) {
                    html += `<div style="color: #f44336;">正则错误: ${e.message}</div>`;
                }
            } else {
                html += '<div style="color: #888;">未设置，全部保留</div>';
            }

            html += '</div>';
            resultDiv.innerHTML = html;
            resultDiv.style.display = 'block';
            resultDiv.style.backgroundColor = 'rgba(0,0,0,0.3)';
            resultDiv.style.borderRadius = '4px';
        });
    }

    // HTML 转义函数
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
    }

    function buildCustomUrlSetting(container) {
        const getTemplate = (obj) => `
            <label class="${classes.embyLabel}">${obj.lsKey.name}(${obj.msg1}): </label>
            <div id="${obj.divId}" style="display: flex;" ></div>
            <div class="${classes.embyFieldDesc}">${obj.msg2 ? obj.msg2 : ''}</div>
        `;
        customeUrl.mapping.map(obj => { getById(eleIds.customeUrlsDiv, container).innerHTML += getTemplate(obj); return obj; })
        .map(obj => {
            const inputDiv = getById(obj.divId, container);
            const onEnter = (e) => {
                const target = getTargetInput(e);
                let value = target.value.trim();
                if (!value) {
                    value = obj.lsKey.defaultValue;
                    target.value = value;
                }
                lsSetItem(obj.lsKey.id, value);
                obj.rewrite(value);
            };
            inputDiv.append(embyInput({ type: 'search', value: lsGetItem(obj.lsKey.id) }, onEnter));
            inputDiv.append(embyButton({ label: '确认', iconKey: iconKeys.check }, onEnter));
        });
    }

    function buildAbout(containerId) {
        const container = getById(containerId);
        if (!container) { return; }
        const template = `
            <div style="height: 30em;">
                <div id="${eleIds.consoleLogCtrl}" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;">
                    <div id="${eleIds.consoleLogCtrlLeft}" style="display: flex; align-items: center;"></div>
                    <div id="${eleIds.logLevelDiv}" style="display: flex; align-items: center;"></div>
                </div>
                <div id="${eleIds.consoleLogSearchInput}" style="margin-top:4px;"></div>
                <div id="${eleIds.consoleLogInfo}">
                    <!-- 恢复 Emby 主题组件；锁定日志视口，避免自动增高把滚动转移到外层弹窗。 -->
                    <textarea id="${eleIds.consoleLogText}" readOnly style="resize: none; width: 100%; box-sizing: border-box; height: min(24em, 60vh) !important; min-height: 0 !important; max-height: min(24em, 60vh) !important; overflow-y: auto !important; scroll-behavior: auto; margin-top: 0.6em;"
                        rows="12" is="emby-textarea" class="txtOverview emby-textarea"></textarea>
                    <textarea id="${eleIds.consoleLogTextInput}" hidden style="resize: vertical;"
                        rows="1" is="emby-textarea" class="txtOverview emby-textarea"></textarea>
                </div>
                <div class="${classes.embyFieldDesc}">注意开启后原本控制台中调用方信息将被覆盖,不使用请保持关闭状态</div>
                <div id="${eleIds.consoleLogCtrl}"></div>
                <div is="emby-collapse" title="开发者选项">
                    <div class="${classes.collapseContentNav}">
                        <label class="${classes.embyLabel}">调试开关: </label>
                        <div id="${eleIds.debugCheckbox}" class="${classes.embyCheckboxList}" style="${styles.embyCheckboxList}"></div>
                        <label class="${classes.embyLabel}">调试按钮: </label>
                        <div id="${eleIds.debugButton}"></div>
                    </div>
                </div>
                <div is="emby-collapse" title="开放源代码许可" data-expanded="true" style="margin-top: 0.6em;">
                    <div id="${eleIds.openSourceLicenseDiv}" class="${classes.collapseContentNav}" style="display: flex; flex-direction: column;"></div>
                </div>
            </div>
        `;
        container.innerHTML = template.trim();
        buildConsoleLog(container);
        buildDebugCheckbox(container);
        buildDebugButton(container);
        buildOpenSourceLicense(container);
    }

    // 合并密集日志更新，并在 Emby 组件完成本轮布局后再次校正底部。
    function scrollConsoleLogToBottom(textEle) {
        if (!textEle || textEle.dataset.autoScroll === 'false' || textEle._logScrollPending) return;
        textEle._logScrollPending = true;
        const followLatest = () => {
            // 隐藏页签、关闭弹窗或取消跟随后不移动阅读位置，也不滚动外层弹窗。
            if (!textEle.isConnected || textEle.dataset.autoScroll === 'false' || !textEle.clientHeight) return;
            textEle.scrollTop = Math.max(0, textEle.scrollHeight - textEle.clientHeight);
        };
        requestAnimationFrame(() => {
            followLatest();
            requestAnimationFrame(() => {
                textEle._logScrollPending = false;
                followLatest();
            });
        });
    }

    function buildConsoleLog(container) {
        const consoleLogEnable = lsGetItem(lsKeys.consoleLogEnable.id);
        getById(eleIds.consoleLogInfo, container).style.display = consoleLogEnable ? '' : 'none';
        if (consoleLogEnable) { doConsoleLogChange(consoleLogEnable); }
        // 左侧：日志开关、清空按钮、搜索框
        const consoleLogCtrlLeftEle = getById(eleIds.consoleLogCtrlLeft, container);
        consoleLogCtrlLeftEle.append(embyCheckbox({ label: lsKeys.consoleLogEnable.name }, consoleLogEnable, doConsoleLogChange));
        const consoleLogCountLabel = document.createElement('label');
        consoleLogCountLabel.id = eleIds.consoleLogCountLabel;
        consoleLogCtrlLeftEle.append(
            embyButton({ label: '清空', iconKey: iconKeys.block }, () => {
                getById(eleIds.consoleLogText, container).value = '';
                getById(eleIds.consoleLogCountLabel).innerHTML = '';
                if (window.ede.appLogAspect) { window.ede.appLogAspect.value = ''; }
                // 清空时同步清空搜索框
                const searchInput = getById(eleIds.consoleLogSearchInput);
                if (searchInput) { searchInput.value = ''; }
            })
            , consoleLogCountLabel
        );
        // 搜索框：独立一行，全宽，挂到第二行容器（template 里已预留 consoleLogSearchInput div）
        const searchRow = getById(eleIds.consoleLogSearchInput, container);
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '搜索日志...';
        searchInput.style.cssText = 'display:block;width:100%;box-sizing:border-box;padding:3px 8px;font-size:0.85em;background:rgba(255,255,255,0.08);color:inherit;border:1px solid rgba(255,255,255,0.2);border-radius:3px;outline:none;';
        searchInput.addEventListener('input', () => {
            const keyword = searchInput.value.trim().toLowerCase();
            const textEle = getById(eleIds.consoleLogText, container);
            if (!textEle || !window.ede.appLogAspect) { return; }
            if (!keyword) {
                // 搜索词清空时恢复完整日志
                textEle.value = window.ede.appLogAspect.value;
            } else {
                // 只显示包含关键词的行
                textEle.value = window.ede.appLogAspect.value.split('\n')
                    .filter(line => line.toLowerCase().includes(keyword)).join('\n');
            }
            // 搜索刷新也遵循自动滚动开关。
            scrollConsoleLogToBottom(textEle);
        });
        searchRow.appendChild(searchInput);
        // 局部紧凑下拉，不沿用占满宽度的公共 tabs，不影响其他设置项。
        const levelSelect = document.createElement('select');
        levelSelect.setAttribute('aria-label', '日志级别');
        levelSelect.style.cssText = 'width:8em;max-width:100%;flex:0 0 auto;min-height:2.4em;padding:0.3em 0.5em;background:#242424;color:#fff;border:1px solid #666;border-radius:4px;';
        [{ id: '0', name: '关闭' }, { id: '1', name: 'ERROR' }, ...logLevelOpts].forEach(item => {
            const option = document.createElement('option');
            option.value = item.id; option.textContent = item.name;
            levelSelect.appendChild(option);
        });
        levelSelect.value = String(logLevel);
        levelSelect.addEventListener('change', () => doLogLevelChange({
            id: levelSelect.value, name: levelSelect.options[levelSelect.selectedIndex].text
        }));
        getById(eleIds.logLevelDiv, container).append(levelSelect);
        // 默认跟随最新日志；关闭后保持阅读位置，重新开启立即跳到底部。
        const logText = getById(eleIds.consoleLogText, container);
        logText.dataset.autoScroll = 'true';
        const autoScrollLabel = document.createElement('label');
        autoScrollLabel.style.cssText = 'display:inline-flex;align-items:center;gap:0.3em;margin-left:0.6em;white-space:nowrap;';
        const autoScroll = document.createElement('input');
        autoScroll.type = 'checkbox';
        autoScroll.checked = true;
        autoScroll.addEventListener('change', () => {
            logText.dataset.autoScroll = String(autoScroll.checked);
            scrollConsoleLogToBottom(logText);
        });
        autoScrollLabel.append(autoScroll, document.createTextNode('自动滚动'));
        const logControls = getById(eleIds.logLevelDiv, container);
        logControls.style.flexWrap = 'wrap';
        logControls.append(autoScrollLabel);
        const consoleLogTextInput = getById(eleIds.consoleLogTextInput, container);
        consoleLogTextInput.style.display = consoleLogEnable && lsGetItem(lsKeys.quickDebugOn.id) ? '' : 'none';
        consoleLogTextInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const inputVal = e.target.value.trim();
                logger.debug('输入内容为: \n', inputVal);
                eval(inputVal);
                e.target.value = '';
            }
        });
    }

    function buildDebugCheckbox(container) {
        const debugWrapper = getById(eleIds.debugCheckbox, container);
        debugWrapper.append(embyCheckbox({ label: lsKeys.debugShowDanmakuWrapper.name }
            , lsGetItem(lsKeys.debugShowDanmakuWrapper.id), (checked) => {
                lsSetItem(lsKeys.debugShowDanmakuWrapper.id, checked);
                const wrapper = getById(eleIds.danmakuWrapper);
                wrapper.style.backgroundColor = checked ? styles.colors.highlight : '';
                if (!checked) { return; }
                logger.debug(`弹幕容器(#${eleIds.danmakuWrapper})宽高像素:`, wrapper.offsetWidth, wrapper.offsetHeight);
                const stage = wrapper.firstChild;
                logger.debug(`实际舞台(${stage.tagName})宽高像素:`, stage.offsetWidth, stage.offsetHeight);
            }
        ));
        debugWrapper.append(embyCheckbox({ label: lsKeys.debugShowDanmakuCtrWrapper.name }
            , lsGetItem(lsKeys.debugShowDanmakuCtrWrapper.id), (checked) => {
                lsSetItem(lsKeys.debugShowDanmakuCtrWrapper.id, checked);
                const wrapper = getById(eleIds.danmakuCtr);
                wrapper.style.backgroundColor = checked ? styles.colors.highlight : '';
                if (!checked) { return; }
                logger.debug(`按钮容器(#${eleIds.danmakuCtr})宽高像素:`, wrapper.offsetWidth, wrapper.offsetHeight);
            }
        ));
        debugWrapper.append(embyCheckbox({ label: lsKeys.debugReverseDanmu.name }
            , lsGetItem(lsKeys.debugReverseDanmu.id), (checked) => {
                lsSetItem(lsKeys.debugReverseDanmu.id, checked);
                const comments = window.ede.danmuCache[window.ede.episode_info.episodeId];
                comments.map(c => {
                    const values = c.p.split(',');
                    values[1]= { '6': '1', '1': '6', '5': '4', '4': '5' }[values[1]];
                    c.p = values.join();
                });
                logger.debug('已' + lsKeys.debugReverseDanmu.name);
                createDanmaku(comments);
            }
        ));
        const toggleDanmuColor = (checked, lsKey, colorFn) => {
            lsSetItem(lsKey.id, checked);
            let comments = window.ede.danmuCache[window.ede.episode_info.episodeId];
            if (checked) {
                window.ede._oriComments = structuredClone(comments);
                comments = comments.map(c => {
                    const values = c.p.split(',');
                    values[2] = colorFn();
                    return { ...c, p: values.join() };
                });
                logger.debug('已' + lsKey.name);
            } else {
                comments = window.ede._oriComments;
                window.ede.danmuCache[window.ede.episode_info.episodeId] = comments;
                logger.debug('已还原' + lsKey.name);
            }
            createDanmaku(comments);
        };
        debugWrapper.append(embyCheckbox({ label: lsKeys.debugRandomDanmuColor.name }
            , lsGetItem(lsKeys.debugRandomDanmuColor.id), (checked) => {
                toggleDanmuColor(checked, lsKeys.debugRandomDanmuColor
                    , () => parseInt(Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'), 16));
            }
        ));
        debugWrapper.append(embyCheckbox({ label: lsKeys.debugForceDanmuWhite.name }
            , lsGetItem(lsKeys.debugForceDanmuWhite.id), (checked) => {
                toggleDanmuColor(checked, lsKeys.debugForceDanmuWhite
                    , () => parseInt(styles.colors.info.toString(16).padStart(6, '0'), 16));
            }
        ));
        // debugWrapper.append(embyCheckbox({ label: lsKeys.debugGenerateLarge.name }, lsGetItem(lsKeys.debugGenerateLarge.id), (checked) => {
        //     lsSetItem(lsKeys.debugGenerateLarge.id, checked);
        //     let intervalId;
        //     if (checked) {
        //         intervalId = setInterval(() => {
        //             document.childNodes.forEach(node => {
        //                 toastByDanmaku(node.type + ' : class : ' + node.className, 'info');
        //             });
        //         }, check_interval)
        //         window.ede.destroyIntervalIds.push(intervalId);
        //     } else {
        //         clearInterval(intervalId);
        //     }
        // }));
        const dialogContainer = document.querySelector('.' + classes.dialogContainer);
        const centeredDialog = dialogContainer.firstChild;
        // lsKeys.debugDialogHyalinize
        const isExist1 = dialogContainer.classList.contains(classes.dialogBackdropOpened);
        const isExist2 = centeredDialog.classList.contains(classes.dialogBlur);
        const debugDialogHyalinizeOnChange = (checked) => {
            lsSetItem(lsKeys.debugDialogHyalinize.id, checked);
            if (checked) {
                centeredDialog.classList.remove(classes.dialog);
                isExist1 && dialogContainer.classList.remove(classes.dialogBackdropOpened);
                isExist2 && centeredDialog.classList.remove(classes.dialogBlur);
            } else {
                centeredDialog.classList.add(classes.dialog);
                // 跳过魔改版客户端上已经被移除的 css
                isExist1 && dialogContainer.classList.add(classes.dialogBackdropOpened);
                isExist2 && centeredDialog.classList.add(classes.dialogBlur);
            }
        }
        const debugDialogHyalinizeChecked = lsGetItem(lsKeys.debugDialogHyalinize.id);
        debugDialogHyalinizeOnChange(debugDialogHyalinizeChecked);
        debugWrapper.append(embyCheckbox({ label: lsKeys.debugDialogHyalinize.name }
            , debugDialogHyalinizeChecked, debugDialogHyalinizeOnChange)
        );
        // lsKeys.debugDialogWindow
        const isExist3 = centeredDialog.classList.contains(classes.dialogFullscreen);
        const isExist4 = centeredDialog.classList.contains(classes.dialogFullscreenLowres);
        const debugDialogWindowOnChange = (checked) => {
            lsSetItem(lsKeys.debugDialogWindow.id, checked);
            isExist3 && centeredDialog.classList.toggle(classes.dialogFullscreen, !checked);
            isExist4 && centeredDialog.classList.toggle(classes.dialogFullscreenLowres, !checked);
        }
        const debugDialogWindowChecked = lsGetItem(lsKeys.debugDialogWindow.id);
        debugDialogWindowOnChange(debugDialogWindowChecked);
        debugWrapper.append(embyCheckbox({ label: lsKeys.debugDialogWindow.name }
            , debugDialogWindowChecked, debugDialogWindowOnChange)
        );
        // lsKeys.debugDialogRight
        const debugDialogRightOnChange = (checked) => {
            lsSetItem(lsKeys.debugDialogRight.id, checked);
            dialogContainer.classList.toggle(classes.dialogBackdropOpened, !checked);
            centeredDialog.style = checked ? styles.rightLayout : '';
            if (checked) {
                isExist3 && centeredDialog.classList.remove(classes.dialogFullscreen);
                isExist4 && centeredDialog.classList.remove(classes.dialogFullscreenLowres, !checked);
            }
        }
        const debugDialogRightChecked = lsGetItem(lsKeys.debugDialogRight.id);
        debugDialogRightOnChange(debugDialogRightChecked);
        debugWrapper.append(embyCheckbox({ label: lsKeys.debugDialogRight.name }
            , debugDialogRightChecked, debugDialogRightOnChange)
        );
        // lsKeys.debugTabIframeEnable
        if (lsGetItem(lsKeys.quickDebugOn.id)) { // @deprecated 已废弃,因跨域无法登录网站,无太大意义
            debugWrapper.append(embyCheckbox({ label: lsKeys.debugTabIframeEnable.name }
                , lsGetItem(lsKeys.debugTabIframeEnable.id), (checked) => {
                    lsSetItem(lsKeys.debugTabIframeEnable.id, checked);
                    getById(tabIframeId + 'Btn').style.display = checked ? '' : 'none';
                }
            ));
        }
        // lsKeys.debugH5VideoAdapterEnable
        const h5VideoAdapter = getById(eleIds.h5VideoAdapter);
        if (h5VideoAdapter) {
            debugWrapper.append(embyCheckbox({ label: lsKeys.debugH5VideoAdapterEnable.name }
                , lsGetItem(lsKeys.debugH5VideoAdapterEnable.id), (checked) => {
                    lsSetItem(lsKeys.debugH5VideoAdapterEnable.id, checked);
                    h5VideoAdapter.style.display = checked ? '' : 'none';
                    h5VideoAdapter.style.backgroundColor = checked ? styles.colors.highlight : '';
                }
            ));
        }
    }

    function buildDebugButton(container) {
        const debugWrapper = getById(eleIds.debugButton, container);
        debugWrapper.append(embyButton({ label: '打印环境信息', style: 'margin: 0.3em;' }, () => {
            require(['browser'], (browser) => {
                logger.debug('Emby 内部自身判断: ', browser);
            });
        }));
        debugWrapper.append(embyButton({ label: '打印弹幕引擎信息', style: 'margin: 0.3em;' }, () => {
            const msg = `弹幕引擎是否存在: ${!!window.Danmaku}, 弹幕引擎是否实例化成功: ${!!window.ede.danmaku}`;
            logger.debug(msg);
            embyToast({ text: msg });
        }));
        debugWrapper.append(embyButton({ label: '打印视频加载方', style: 'margin: 0.3em;' }, () => {
            const _media = document.querySelector(mediaQueryStr);
            if (!_media) { return logger.error('严重错误,页面中依旧不存在 <video> 标签') }
            if (_media.currentTime < 1) { logger.error('严重错误,<video> 的 currentTime < 1') }
            if (!_media.id) {
                logger.debug('视频加载方为 Web 端 <video> 标签:', _media.parentNode.outerHTML);
            } else {
                logger.debug('当前 <video> 标签为虚拟适配器:', _media.outerHTML);
                const _embed = document.querySelector('embed');
                if (_embed) {
                    logger.debug('视频加载方为 <embed> 标签占位的 Native 播放器:', _embed.parentNode.outerHTML);
                } else {
                    logger.debug('视频加载方为无占位标签的 Native 播放器,无信息');
                }
            }
        }));
        debugWrapper.append(embyButton({ label: '清空章节引用缓存', class: classes.embyButtons.submit, style: 'margin: 0.3em;' }, () => {
            lsBatchRemove([lsLocalKeys.animeEpisodePrefix, lsLocalKeys.bangumiEpInfoPrefix]);
            logger.debug('已清空章节引用缓存');
            embyToast({ text: '已清空章节引用缓存' });
        }));
        debugWrapper.append(embyButton({ label: '重置设置', class: classes.embyButtons.submit, style: 'margin: 0.3em;' }, () => {
            settingsReset();
            logger.debug(`已重置设置, 跳过了 ${lsKeys.filterKeywords.name} 重置`);
            embyToast({ text: `已重置设置, 跳过了 ${lsKeys.filterKeywords.name} 重置` });
            loadDanmaku(LOAD_TYPE.INIT);
            closeEmbyDialog();
        }));
    }

    function buildOpenSourceLicense(container) {
        const openSourceWrapper = getById(eleIds.openSourceLicenseDiv, container);
        objectEntries(openSourceLicense).map(([key, val]) => {
            openSourceWrapper.append(embyALink(val.url, [key, val.name, val.version, val.license].join(' : ')));
        });
    }

    /**
     * 创建内嵌网页调试页；该功能仅供旧版调试入口使用。
     */
    function buildEmbeddedPage(containerId) {
        const container = getById(containerId);
        const template = `
            <div>
                <div class="${classes.embyFieldDesc}">注意内嵌网页不支持控制器输入,且被禁止内嵌(CSP)的网页无法显示,且跨域无法登录</div>
                <div style="${styles.embySlider + 'margin: 0.8em 0;'}">
                    <label class="${classes.embyLabel}" style="width: 5em;">网页高度: </label>
                    <div id="${eleIds.tabIframeHeightDiv}" style="width: 40.5em; text-align: center;"></div>
                    <label>
                        <label id="${eleIds.tabIframeHeightLabel}" style="${styles.embySliderLabel}">auto</label>
                        <label>em</label>
                    </label>
                </div>
                <div id="${eleIds.tabIframeCtrlDiv}"></div>
                <div id="${eleIds.tabIframeSrcInputDiv}" style="display: flex; margin-top: 0.6em;"></div>
                <iframe id="${eleIds.tabIframe}" style="border: 0;width: 100%;" src=""></iframe>
            </div>
        `;
        container.innerHTML = template.trim();
        getById(eleIds.tabIframeHeightDiv, container).append(embySlider(
            { labelId: eleIds.tabIframeHeightLabel, value: '29', min: 28, max: 100, step: 1 }
            , (val, opts) => {
                if (val === '28') { val = 'auto'; }
                onSliderChangeLabel(val, opts);
                getById(eleIds.tabIframe).style.height = val === 'auto' ? val : val + 'em';
            }
        ));
        getById(eleIds.tabIframeSrcInputDiv, container).append(embyInput(
            { type: 'search', value: window.ede.bangumiInfo ? window.ede.bangumiInfo.bangumiUrl : '' }
            , (e) => { getById(eleIds.tabIframe).src = e.target.value.trim(); }
        ));
    }

    /**
     * [工具函数] 获取或创建 OSD 弹幕信息元素，直接写入任意文字。
     * appendvideoOsdDanmakuInfo 内部调用此函数。
     */
    function setOsdDanmakuText(text) {
        if (!lsGetItem(lsKeys.osdTitleEnable.id)) return;
        const videoOsdContainer = document.querySelector(`${mediaContainerQueryStr} .videoOsdSecondaryText`);
        let el = getById(eleIds.videoOsdDanmakuTitle, videoOsdContainer);
        if (!el) {
            el = document.createElement('h3');
            el.id = eleIds.videoOsdDanmakuTitle;
            el.classList.add(classes.videoOsdTitle);
            el.style = 'margin-left: auto; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; position: absolute; right: 0px; bottom: 0px;';
            if (videoOsdContainer) videoOsdContainer.append(el);
        }
        el.innerText = text;
    }

    function appendvideoOsdDanmakuInfo(loadSum) {
        if (!lsGetItem(lsKeys.osdTitleEnable.id)) {
            return;
        }

        const episode_info = window.ede.episode_info || {};
        const { episodeId, animeTitle, episodeTitle } = episode_info;

        // 检查排除状态
        const currentLibName = window.ede && window.ede.currentLibraryInfo ? window.ede.currentLibraryInfo.libraryName : null;
        const excludedList = lsGetItem(lsKeys.excludedLibraries.id) || [];
        const isExcluded = currentLibName && excludedList.includes(currentLibName);

        let text = '弹幕：';
        if (isExcluded) {
            // 情况1：已被排除
            text += '已禁用';
        } else {
            // 情况2：正常加载
            if (episodeId) {
                text += `${animeTitle} - ${episodeTitle} - ${loadSum}条`;
            } else {
                text += `未匹配`;
            }
        }
        setOsdDanmakuText(text);
    }

    function toggleSettingBtn2Header() {
        const targetBtn = getById(eleIds.danmakuSettingBtnDebug);
        if (targetBtn) {
            targetBtn.remove();
            return false;
        }
        const opt = mediaBtnOpts[1];
        opt.id = eleIds.danmakuSettingBtnDebug;
        getByClass(classes.headerRight).prepend(embyButton(opt, opt.onClick));
        return true;
    }

    function quickDebug() {
        const flag = toggleSettingBtn2Header();
        embyToast({ text: `${lsKeys.quickDebugOn.name}: ${flag}!` });
        if (!window.ede) { window.ede = new EDE(); }
        lsSetItem(lsKeys.quickDebugOn.id, flag);
        checkRuntimeVars();
    }

    function checkRuntimeVars(exposeGlobalThis = true) {
        logger.debug('运行时变量检查');
        logger.debug(lsKeys.customeCorsProxyUrl.name ,corsProxy);
        logger.debug(lsKeys.customeDanmakuUrl.name, requireDanmakuPath);
        logger.debug('弹弹play API 模板', dandanplayApi);
        if (exposeGlobalThis) { window.checkRuntimeVars = checkRuntimeVars; }
    }

    function doDanmakuSwitch() {
        logger.debug('切换' + lsKeys.switch.name);
        const flag = !lsGetItem(lsKeys.switch.id);
        if (window.ede.danmaku) {
            // [优化] 使用 CSS visibility 切换弹幕显隐，而非引擎的 hide()/show()
            // hide() 会调用 clear() 清空 runningList，导致弹幕位置信息丢失
            // visibility:hidden 保留引擎运行状态，弹幕位置完全保留
            const wrapper = getById(eleIds.danmakuWrapper);
            if (flag) {
                // 开启弹幕：恢复可见性
                if (wrapper) { wrapper.style.visibility = 'visible'; }
                // 确保引擎处于 show 状态（首次可能是 hide 状态）
                window.ede.danmaku.show();
                // [修复] 如果视频处于暂停状态，确保弹幕也暂停
                const _media = document.querySelector(mediaQueryStr);
                if (_media) {
                    logger.debug('[弹幕开关] 开启弹幕, video.paused=' + _media.paused);
                    if (_media.paused) {
                        _media.dispatchEvent(new Event('pause'));
                    } else {
                        try {
                            require(['playbackManager'], function (playbackManager) {
                                try {
                                    var isPaused = playbackManager.getPlayerState().PlayState.IsPaused;
                                    if (isPaused) {
                                        logger.debug('[弹幕开关] Emby 暂停但 video.paused=false, 强制 dispatch pause');
                                        _media.dispatchEvent(new Event('pause'));
                                    }
                                } catch (e) { /* ignore */ }
                            });
                        } catch (e) { /* ignore */ }
                    }
                }
            } else {
                // 关闭弹幕：仅隐藏容器，引擎继续运行
                if (wrapper) { wrapper.style.visibility = 'hidden'; }
            }
        }
        // 同步高能进度条显隐（弹幕关闭时一并隐藏）
        const chartEle = getById(eleIds.progressBarLineChart);
        if (chartEle) { chartEle.style.display = flag ? '' : 'none'; }
        const osdDanmakuSwitchBtn = getById(eleIds.danmakuSwitchBtn);
        if (osdDanmakuSwitchBtn) {
            // danmakuTextBtn 模式：只改内层透明度，保持按钮整体 opacity=1（避免影响加载环亮度）
            const inner = osdDanmakuSwitchBtn.querySelector('.dd-btn-inner');
            if (inner) inner.style.opacity = flag ? '1' : '0.4';
            // 关闭时在"弹"字上叠加 SVG 斜线（左上→右下），开启时移除
            const textSpan = osdDanmakuSwitchBtn.querySelector('.dd-btn-text');
            if (textSpan) {
                const existingLine = textSpan.querySelector('.dd-off-line');
                if (!flag && !existingLine) {
                    // 创建 SVG：用 preserveAspectRatio="none" + viewBox 保证始终从左上到右下
                    const svgNS = 'http://www.w3.org/2000/svg';
                    const svg = document.createElementNS(svgNS, 'svg');
                    svg.setAttribute('class', 'dd-off-line');
                    svg.setAttribute('viewBox', '0 0 10 10');
                    svg.setAttribute('preserveAspectRatio', 'none');
                    const line = document.createElementNS(svgNS, 'line');
                    line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
                    line.setAttribute('x2', '10'); line.setAttribute('y2', '10');
                    // 关闭状态斜线用灰色，与灰色"弹"字视觉一致
                    line.setAttribute('stroke', 'rgba(255,255,255,0.8)');
                    line.setAttribute('stroke-width', '1.5');
                    line.setAttribute('stroke-linecap', 'round');
                    svg.appendChild(line);
                    textSpan.appendChild(svg);
                } else if (flag && existingLine) {
                    existingLine.remove();
                }
            }
        }
        const switchElement = getById(eleIds.danmakuSwitch);
        if (switchElement) {
            switchElement.firstChild.innerHTML = flag ? iconKeys.switch_on : iconKeys.switch_off;
            switchElement.style.color = flag ? styles.colors.switchActiveColor : '';
        }
        lsSetItem(lsKeys.switch.id, flag);
    }

    /**
     * 防重叠开关
     * 开启后会根据显示区域计算可用轨道数，过滤掉超出轨道的弹幕，避免弹幕重叠
     * 适用于显示区域较小（如 10%-50%）时，防止弹幕挤在一起
     */
    function doAntiOverlapSwitch() {
        logger.debug('切换' + lsKeys.antiOverlap.name);
        const flag = !lsGetItem(lsKeys.antiOverlap.id);
        lsSetItem(lsKeys.antiOverlap.id, flag);
        // 更新弹幕设置弹窗中的按钮状态
        const antiOverlapBtn = getById(eleIds.antiOverlapBtn);
        if (antiOverlapBtn) {
            antiOverlapBtn.firstChild.innerHTML = flag ? iconKeys.switch_on : iconKeys.switch_off;
            antiOverlapBtn.style.color = flag ? styles.colors.switchActiveColor : '';
        }
        // 重新加载弹幕以应用过滤
        loadDanmaku(LOAD_TYPE.RELOAD);
        embyToast({ text: `防重叠: ${flag ? '开启 - 超出轨道的弹幕将被过滤' : '关闭 - 允许弹幕重叠显示'}` });
    }

    // --- 手动搜索：并行模式 (速度优先，聚合结果) ---
    async function doDanmakuSearchEpisode() {
        let embySearch = getById(eleIds.danmakuSearchName);
        if (!embySearch) { return; }
        let searchName = embySearch.value;
        const danmakuRemarkEle = getById(eleIds.danmakuRemark);
        danmakuRemarkEle.parentNode.hidden = false;
        danmakuRemarkEle.innerText = searchName ? '' : '请填写标题';
        const spinnerEle = getByClass(classes.mdlSpinner);
        spinnerEle && spinnerEle.classList.remove('hide');

        // --- 1. 准备 API 配置 ---
        const apiPriority = lsGetItem(lsKeys.apiPriority.id);
        const customApiList = getCustomApiList();
        const apiConfigs = {
            official: { name: '弹弹play', prefix: corsProxy + 'https://api.dandanplay.net/api/v2', enabled: lsGetItem(lsKeys.useOfficialApi.id) },
        };
        if (lsGetItem(lsKeys.useCustomApi.id) && customApiList.length > 0) {
            customApiList.forEach((item, index) => {
                if (item.enabled) {
                    apiConfigs[`custom_${index}`] = { name: item.name || `自定义源${index + 1}`, prefix: normalizeCustomApiPrefix(item.url, item.appId, item.appSecret), enabled: true, appId: item.appId || "", appSecret: item.appSecret || "" };
                }
            });
        }

        const actualPriority = [];
        for (const key of apiPriority) {
            if (key === 'official') actualPriority.push('official');
            else if (key === 'custom') customApiList.forEach((item, i) => item.enabled && actualPriority.push(`custom_${i}`));
        }

        let allAnimes = [];
        logger.info(`[手动匹配] 开始并行搜索: ${searchName}`);

        // --- 2. 定义单个搜索任务 ---
        const searchTask = async (apiKey) => {
            const config = apiConfigs[apiKey];
            if (!config?.enabled || !config?.prefix) return [];

            let manualSearchTitle = searchName;
            let manualSearchEpisode = null;

            if (apiKey === 'official') {
                const parsed = parseAnimeName(searchName);
                if (parsed.season !== null) {
                    manualSearchTitle = parsed.season === 1 ? parsed.title : `${parsed.title} 第${parsed.season}季`;
                    manualSearchEpisode = parsed.episode;
                    logger.info(`[手动匹配][弹弹play优化] 格式化搜索: 标题='${manualSearchTitle}', 集数=${manualSearchEpisode}`);
                }
            }

            try {
                const animaInfo = await fetchSearchEpisodes(manualSearchTitle, manualSearchEpisode, config.prefix, config.appId, config.appSecret);
                if (animaInfo && animaInfo.animes.length > 0) {
                    // [黑名单] 对搜索结果应用黑名单过滤
                    animaInfo.animes = applySearchBlacklist(animaInfo.animes, true, apiKey);

                    // 标记来源
                    animaInfo.animes.forEach(anime => {
                        anime.apiPrefix = config.prefix;
                        anime.apiName = config.name;
                        anime.apiAppId = config.appId || "";
                        anime.apiAppSecret = config.appSecret || "";
                    });
                    return animaInfo.animes;
                }
            } catch (e) {
                logger.warn(`[手动匹配] 源 ${config.name} 搜索失败`, e);
            }
            return [];
        };

        // --- 3. 并行执行所有任务 ---
        const promises = actualPriority.map(key => searchTask(key));
        const results = await Promise.allSettled(promises);

        // --- 4. 按优先级顺序合并结果 ---
        // 虽然是并行请求，但展示顺序依然遵循你的优先级设置
        for (let i = 0; i < actualPriority.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled' && result.value.length > 0) {
                allAnimes.push(...result.value);
            }
        }

        logger.info(`[手动匹配] 搜索完成，共找到 ${allAnimes.length} 个结果`);

        // [降级] 主源搜索为空且开启 BGM 搜索兜底时，用 Bangumi 搜索 + 弹弹play新接口兜底
        // 仅在手动搜索页生效（本函数即手动搜索入口）
        if (allAnimes.length < 1 && lsGetItem(lsKeys.bgmSearchFallbackEnable.id)) {
            danmakuRemarkEle.innerText = '主源无结果，正在尝试 BGM 搜索兜底...';
            logger.info(`[手动匹配] 主源无结果，启用 BGM 搜索兜底: ${searchName}`);
            const officialPrefix = corsProxy + 'https://api.dandanplay.net/api/v2';
            const fallbackAnimes = await fetchBgmSearchFallback(searchName, officialPrefix);
            if (fallbackAnimes.length > 0) {
                fallbackAnimes.forEach(anime => {
                    anime.apiPrefix = officialPrefix;
                    anime.apiName = '弹弹play(BGM兜底)';
                });
                allAnimes.push(...fallbackAnimes);
                logger.info(`[手动匹配] BGM 兜底补充 ${fallbackAnimes.length} 个结果`);
            }
        }

        spinnerEle && spinnerEle.classList.add('hide');
        if (allAnimes.length < 1) {
            danmakuRemarkEle.innerText = '搜索结果为空';
            getById(eleIds.danmakuSwitchEpisode).disabled = true;
            getById(eleIds.danmakuEpisodeFlag).hidden = true;
            return;
        } else {
            danmakuRemarkEle.innerText = '';
        }


        const danmakuAnimeDiv = getById(eleIds.danmakuAnimeDiv);
        const danmakuEpisodeNumDiv = getById(eleIds.danmakuEpisodeNumDiv);
        danmakuAnimeDiv.innerHTML = '';
        danmakuEpisodeNumDiv.innerHTML = '';
        window.ede.searchDanmakuOpts.animes = allAnimes;

        let selectAnimeIdx = allAnimes.findIndex(anime => anime.animeId == window.ede.searchDanmakuOpts.animeId);
        selectAnimeIdx = selectAnimeIdx !== -1 ? selectAnimeIdx : 0;
        const animeSelect = embySelect({ id: eleIds.danmakuAnimeSelect, label: '剧集: ', style: 'width: auto;max-width: 100%;' }
            , selectAnimeIdx, allAnimes, 'animeId', opt => `${opt.animeTitle} 类型：${opt.typeDescription} 来源：${opt.apiName}`, doDanmakuAnimeSelect);
        danmakuAnimeDiv.append(animeSelect);

        getById(eleIds.danmakuEpisodeFlag).hidden = false;
        getById(eleIds.danmakuSwitchEpisode).disabled = false;

        // [修复] 初始渲染后直接调用 doDanmakuAnimeSelect 走统一的分集加载逻辑，
        // 避免静态检查 episodes 导致分集列表为空（初始选中项不触发 onChange）
        doDanmakuAnimeSelect(null, selectAnimeIdx, allAnimes[selectAnimeIdx]);
    }

    function doSearchTitleSwtich(e) {
        const searchInputEle = getById(eleIds.danmakuSearchName);
        const attrKey = 'isOriginalTitle';
        if ('1' === e.target.getAttribute(attrKey)) {
            e.target.setAttribute(attrKey, '0');
            const opts = window.ede.searchDanmakuOpts;
            const appendSE = lsGetItem(lsKeys.appendSeasonEpisode.id);
            return searchInputEle.value = appendSE ? opts.animeName : (opts.seriesName || opts.animeName);
        }
        const { _episode_key, seriesOrMovieId } = window.ede.searchDanmakuOpts;
        const episode_info = JSON.parse(localStorage.getItem(_episode_key) || 'null');
        const animeOriginalTitle = episode_info?.animeOriginalTitle;
        if (animeOriginalTitle) {
            e.target.setAttribute(attrKey, '1');
            return searchInputEle.value = animeOriginalTitle;
        }
        const client = getHostApiClient();
        if (!client?.getItem || !client.getCurrentUserId) return;
        client.getItem(client.getCurrentUserId(), seriesOrMovieId).then(item => {
            if (item.OriginalTitle) {
                e.target.setAttribute(attrKey, '1');
                searchInputEle.value = item.OriginalTitle;
                if (episode_info) {
                    episode_info.animeOriginalTitle = item.OriginalTitle;
                    localStorage.setItem(_episode_key, JSON.stringify(episode_info));
                }
                if (window.ede.episode_info) {
                    window.ede.episode_info.animeOriginalTitle = item.OriginalTitle;
                }
            } else {
                embyToast({ text: '未找到原始标题' });
            }
        });
    }

    async function doDanmakuAnimeSelect(value, index, option) {
        void value;
        void option;
        const numDiv = getById(eleIds.danmakuEpisodeNumDiv);
        numDiv.innerHTML = '';
        const anime = window.ede.searchDanmakuOpts.animes[index];
        if (!anime) return;

        // [修复] 条件修正：episodes 不存在或为空数组时都需要拉取分集
        // 原条件 `!anime.episodes` 会导致空数组 [] 跳过获取
        const needFetch = (!anime.episodes || anime.episodes.length === 0) && anime.bangumiId;
        if (needFetch) {
            logger.debug(`[手动匹配] 动画 ${anime.animeTitle} 缺少分集信息，正在获取...`);
            numDiv.innerHTML = '<span style="color: #52b54b;">正在加载分集信息...</span>';

            const apiPrefix = anime.apiPrefix || window.ede.searchDanmakuOpts.apiPrefix;
            const bangumiUrl = `${apiPrefix}/bangumi/${anime.bangumiId}`;

            try {
                const bangumiSignHeaders = anime.apiAppId && anime.apiAppSecret ? await buildCustomApiSignHeaders(anime.apiAppId, anime.apiAppSecret, bangumiUrl) : {};
                const bangumiResult = await fetchJson(bangumiUrl, Object.keys(bangumiSignHeaders).length > 0 ? { headers: bangumiSignHeaders } : {});
                // [修复] 兼容多种返回格式：{ bangumi: { episodes } } 或 { episodes }
                const eps = bangumiResult?.bangumi?.episodes || bangumiResult?.episodes;
                const seas = bangumiResult?.bangumi?.seasons || bangumiResult?.seasons;
                if (eps && eps.length > 0) {
                    anime.episodes = eps;
                    anime.seasons = seas;
                    logger.info(`[手动匹配] 获取分集信息成功: ${anime.animeTitle}, 共 ${anime.episodes.length} 集`);
                } else {
                    logger.error(`[手动匹配] 获取分集信息失败: 返回数据为空或格式错误`);
                    numDiv.innerHTML = '<span style="color: #e23636;">获取分集信息失败（返回为空）</span>';
                    return;
                }
            } catch (error) {
                logger.error(`[手动匹配] 获取分集信息失败: ${error.message}`);
                numDiv.innerHTML = '<span style="color: #e23636;">获取分集信息失败</span>';
                return;
            }

            numDiv.innerHTML = '';
        }

        // [黑名单] 对官方 API 的分集列表应用黑名单过滤（用于显示）
        let displayEpisodes = anime.episodes || [];
        if (anime.apiName && anime.apiName.includes('弹弹play')) {
            const episodeTitleBlacklist = lsGetItem(lsKeys.episodeTitleBlacklist.id) || '';
            if (episodeTitleBlacklist) {
                try {
                    const regex = new RegExp(episodeTitleBlacklist, 'i');
                    const originalCount = displayEpisodes.length;
                    displayEpisodes = displayEpisodes.filter(ep => {
                        if (ep.episodeTitle && regex.test(ep.episodeTitle)) {
                            logger.debug(`[黑名单] 过滤分集显示: "${ep.episodeTitle}"`);
                            return false;
                        }
                        return true;
                    });
                    if (displayEpisodes.length < originalCount) {
                        logger.info(`[黑名单] 分集显示过滤: ${originalCount} -> ${displayEpisodes.length}`);
                    }
                } catch (e) {
                    logger.warn(`[黑名单] 分集名称正则表达式无效: ${e.message}`);
                }
            }
        }

        // [修复] 分集列表为空时给出明确提示，而不是渲染空下拉框
        if (displayEpisodes.length === 0) {
            numDiv.innerHTML = '<span style="color: #aaa;">该条目暂无分集信息</span>';
            anime.filteredEpisodes = [];
        } else {
            // 切换剧集时，默认选中第一个分集
            const episodeNumSelect = embySelect({ id: eleIds.danmakuEpisodeNumSelect, label: '集数: ' }, 0, displayEpisodes, 'episodeId', (opt, i) => `${i + 1} - ${opt.episodeTitle}`);
            episodeNumSelect.style.maxWidth = '100%';
            numDiv.append(episodeNumSelect);
            // [黑名单] 存储过滤后的分集列表，供 doDanmakuSwitchEpisode 使用
            anime.filteredEpisodes = displayEpisodes;
        }

        // [修正] 始终使用匹配到的海报
        getById(eleIds.searchImg).src = anime.imageUrl || dandanplayApi.posterImg(anime.animeId);

        // [新增] 更新API来源显示
        const apiSourceDiv = getById(eleIds.searchApiSource);
        if (apiSourceDiv) apiSourceDiv.innerText = `来源: ${anime.apiName}`;
    }

    async function doDanmakuSwitchEpisode() {
        // 先保存弹窗选择，再读取当前播放条目，避免使用路由留下的空 ID。
        const generation = playbackViewGeneration;
        const media = getPlaybackMedia();
        const animeSelect = getById(eleIds.danmakuAnimeSelect);
        const episodeNumSelect = getById(eleIds.danmakuEpisodeNumSelect);
        const anime = window.ede.searchDanmakuOpts.animes[animeSelect.selectedIndex];

        // [修正] 构造一个更完整的 episodeInfo 对象，并使用正确的 unique_episode_key
        const { _episode_key, seriesOrMovieId } = window.ede.searchDanmakuOpts;
        const episodeInfo = {
            episodeId: episodeNumSelect.value,
            episodeTitle: episodeNumSelect.options[episodeNumSelect.selectedIndex].text,
            episodeIndex: episodeNumSelect.selectedIndex,
            bgmEpisodeIndex: episodeNumSelect.selectedIndex,
            animeId: anime.animeId,
            bangumiId: anime.bangumiId || anime.animeId,
            animeTitle: anime.animeTitle,
            animeOriginalTitle: '',
            imageUrl: anime.imageUrl,
            apiPrefix: anime.apiPrefix,
            apiName: anime.apiName,
            apiAppId: anime.apiAppId || "",
            apiAppSecret: anime.apiAppSecret || "",
            seriesOrMovieId: seriesOrMovieId,
        };

        const seasonInfo = {
            name: anime.animeTitle,
            episodeOffset: episodeNumSelect.selectedIndex - window.ede.searchDanmakuOpts.episode,
        }
        writeLsSeasonInfo(window.ede.searchDanmakuOpts._season_key, seasonInfo);

        // [修正] 使用与 getEpisodeInfo 中相同的逻辑来构造缓存键
        const useOfficialApi = lsGetItem(lsKeys.useOfficialApi.id);
        const useCustomApi = lsGetItem(lsKeys.useCustomApi.id);
        const apiPriority = lsGetItem(lsKeys.apiPriority.id);
        const enabledApis = apiPriority.filter(apiKey => {
            if (apiKey === 'official') return useOfficialApi;
            if (apiKey === 'custom') return useCustomApi;
            return false;
        });
        const unique_episode_key = `_api_${enabledApis.join('_')}_` + _episode_key;
        localStorage.setItem(unique_episode_key, JSON.stringify(episodeInfo));

        // 与加载入口使用同一媒体身份；读取失败时保留弹窗，不悄悄改走自动匹配。
        let item;
        try { item = await getEmbyItemInfo(); }
        catch (error) {
            embyToast({ text: '无法获取当前媒体，请重新确认来源' });
            return;
        }
        if (generation !== playbackViewGeneration || media !== getPlaybackMedia()) return;
        if (!item?.Id) {
            embyToast({ text: '当前媒体尚未就绪，请重新确认来源' });
            return;
        }
        window.ede.itemId = item.Id;
        // 保存本次明确选择，独立于清理 UI 时被置空的 episode_info。
        manualDanmakuSelection = {
            key: manualDanmakuKey(item.Id),
            info: { ...episodeInfo }
        };
        logger.info('[手动匹配] 已确认来源，准备加载弹幕');

        // [改造6] 记录用户手动选择偏好，供下次自动匹配时优先使用
        try {
            const searchName = getById(eleIds.danmakuSearchName)?.value || '';
            const parsedForPrefer = parseSearchKeyword(searchName || anime.animeTitle);
            const preferKey = `_prefer_${normalizeTitle(parsedForPrefer.title)}`;
            localStorage.setItem(preferKey, JSON.stringify({
                animeId: anime.animeId,
                animeTitle: anime.animeTitle,
                timestamp: Date.now()
            }));
            logger.info(`[偏好记忆] 已记录: "${anime.animeTitle}" (ID: ${anime.animeId})`);
        } catch(e) {
            logger.debug(`[偏好记忆] 记录失败:`, e);
        }

        loadDanmaku(LOAD_TYPE.RELOAD);
        closeEmbyDialog();
    }

    function writeLsSeasonInfo(_season_key, newSeasonInfo) {
        if (!_season_key) {
            return logger.debug(`_season_key is undefined, skip`);
        }
        let seasonInfoListStr = localStorage.getItem(_season_key);
        let seasonInfoList = seasonInfoListStr ? JSON.parse(seasonInfoListStr) : [];
        // 检查是否已经存在相同的 seasonInfo，避免重复添加
        const existingSeasonInfo = seasonInfoList.find(si => si.name === newSeasonInfo.name);
        if (!existingSeasonInfo) {
            seasonInfoList.push(newSeasonInfo);
        } else {
            // 如果存在，更新已有的 seasonInfo
            Object.assign(existingSeasonInfo, newSeasonInfo);
        }
        localStorage.setItem(_season_key, JSON.stringify(seasonInfoList));
    }

    function doDanmakuEngineSelect(value) {
        let selectedValue = value.id;
        if (lsCheckSet(lsKeys.engine.id, selectedValue)) {
            logger.debug(`已更改弹幕引擎为: ${selectedValue}`);
            loadDanmaku(LOAD_TYPE.RELOAD);
        }
    }

    function doDanmakuChConverChange(value) {
        window.ede.chConvert = value.id;
        lsSetItem(lsKeys.chConvert.id, window.ede.chConvert);
        loadDanmaku(LOAD_TYPE.REFRESH);
        logger.debug(`简繁转换已切换为: ${value.name}`);
    }

    function doDanmuListOptsChange(value, index) {
    const container = getById(eleIds.danmuListText);
    const phantom = getById('danmuListPhantom');
    const content = getById('danmuListContent');

    // 1. 清理旧事件
    if (container._scrollHandler) {
        container.removeEventListener('scroll', container._scrollHandler);
    }

    // 2. 处理“不展示”
    if (index == lsKeys.danmuList.defaultValue) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';

    // 3. 获取数据
    const list = value.onChange(window.ede);
    if (!list || list.length === 0) {
        content.innerHTML = '无数据';
        phantom.style.height = '0px';
        return;
    }

    // --- 配置项 ---
    const ITEM_HEIGHT = 28; // 单行高度(px)，根据字号微调
    const TOTAL_COUNT = list.length;
    const CONTAINER_HEIGHT = container.clientHeight || 350;

    // 设置幽灵高度，撑开滚动条
    phantom.style.height = `${TOTAL_COUNT * ITEM_HEIGHT}px`;

    // 辅助函数：时间格式化 mm:ss
    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    // 核心渲染函数
    const render = () => {
        const scrollTop = container.scrollTop;

        // 计算渲染范围 (缓冲区加大一点，防止快速滚动白屏)
        const BUFFER = 10;
        let startIndex = Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER;
        let endIndex = Math.ceil((scrollTop + CONTAINER_HEIGHT) / ITEM_HEIGHT) + BUFFER;

        if (startIndex < 0) startIndex = 0;
        if (endIndex > TOTAL_COUNT) endIndex = TOTAL_COUNT;

        let html = '';
        const hasShowSourceIds = lsGetItem(lsKeys.showSource.id).length > 0;

        for (let i = startIndex; i < endIndex; i++) {
            const c = list[i];
            const textContent =
                `[${i + 1}][${formatTime(c.time)}] : `
                + (hasShowSourceIds ? c.originalText : c.text)
                + (c.source ? ` [${c.source}]` : '')
                + (c.originalUserId ? `[${c.originalUserId}]` : '')
                + (c.cid ? `[${c.cid}]` : '')
                + `[${c.mode}]`;

            // 使用 div 包裹纯文本，单行显示
            html += `<div style="height:${ITEM_HEIGHT}px; line-height:${ITEM_HEIGHT}px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${textContent.replace(/</g, '&lt;')}</div>`;
        }

        content.innerHTML = html;
        // 关键：偏移 content 位置，让它永远处于可视区域
        content.style.transform = `translateY(${startIndex * ITEM_HEIGHT}px)`;
    };

    // 首次渲染
    render();

    // 绑定滚动事件 (使用 rAF 保证丝滑)
    // rafPending 标志确保每帧最多安排一次 render，避免快速滚动时 rAF 堆积
    let _rafPending = false;
    container._scrollHandler = () => {
        if (_rafPending) return;
        _rafPending = true;
        window.requestAnimationFrame(() => {
            _rafPending = false;
            render();
        });
    };
    container.addEventListener('scroll', container._scrollHandler);
}

    function doDanmakuTypeFilterSelect() {
        const checkList = Array.from(document.getElementsByName(eleIds.danmakuTypeFilterSelectName))
            .filter(item => item.checked).map(item => item.value);
        lsSetItem(lsKeys.typeFilter.id, checkList);
        loadDanmaku(LOAD_TYPE.RELOAD);
        const idNameMap = new Map(Object.values(danmakuTypeFilterOpts).map(opt => [opt.id, opt.name]));
        logger.debug(`当前弹幕类型过滤为: ${JSON.stringify(checkList.map(s => idNameMap.get(s)))}`);
    }

    function doDanmakuSourceFilterSelect() {
        const checkList = Array.from(document.getElementsByName(eleIds.danmakuSourceFilterSelectName))
            .filter(item => item.checked).map(item => item.value);
        lsSetItem(lsKeys.sourceFilter.id, checkList);
        loadDanmaku(LOAD_TYPE.RELOAD);
        logger.debug(`当前弹幕来源平台过滤为: ${JSON.stringify(checkList)}`);
    }

    function doDanmakuShowSourceSelect() {
        const checkList = Array.from(document.getElementsByName(eleIds.danmakuShowSourceSelectName))
            .filter(item => item.checked).map(item => item.value);
        lsSetItem(lsKeys.showSource.id, checkList);
        loadDanmaku(LOAD_TYPE.RELOAD);
        const idNameMap = new Map(Object.values(showSource).map(opt => [opt.id, opt.name]));
        logger.debug(`当前弹幕显示来源为: ${JSON.stringify(checkList.map(s => idNameMap.get(s)))}`);
    }

    function onSliderChange(val, opts) {
        onSliderChangeLabel(val, opts);
        if (opts.key && lsCheckSet(opts.key, val)) {
            let needReload = opts.needReload !== false;
            if (opts.isManual) {
                needReload = false;
            }
            // [优化] 只在需要重载时打印 INFO，否则降级为 DEBUG
            if (needReload) {
                logger.info(`配置变更需要重载: ${opts.key} = ${val}`);
                changeFontStylePreview();
                loadDanmaku(LOAD_TYPE.RELOAD);
            } else {
                logger.debug(`配置变更: ${opts.key} = ${val}`);
            }
        }
    }

    function onSliderChangeLabel(val, opts) {
        if (opts.labelId) {
            const labelEle = getById(opts.labelId);
            if (labelEle) {
                labelEle.innerText = val;
            }
        }
        const nextEle = opts.labelEle?.parentNode;
        if (nextEle && nextEle.children) {
            (nextEle.children.length > 0 ? nextEle.children[0] : nextEle).innerText = val;
        }
    }

    function doDanmakuFilterKeywordsBtnClick(event) {
        const btn = event.currentTarget;
        if (btn) {
            btn.style = '';
            btn.disabled = true;
        }
        let keywords = getById(eleIds.filterKeywordsId).value.trim();
        let enable = getById(eleIds.filterKeywordsEnableId).checked;
        lsCheckSet(lsKeys.filterKeywordsEnable.id, enable);

        if (!lsCheckSet(lsKeys.filterKeywords.id, keywords) && keywords === '') { return; }
        loadDanmaku(LOAD_TYPE.RELOAD);
    }

    function updateFilterKeywordsBtn(btn, flag, keywords) {
        const isSame = lsCheckOld(lsKeys.filterKeywordsEnable.id, flag) && lsCheckOld(lsKeys.filterKeywords.id, keywords);
        btn.firstChild.innerHTML = isSame ? iconKeys.done_disabled : iconKeys.done;
        btn.disabled = isSame;
    }

    function doConsoleLogChange(checked) {
        lsSetItem(lsKeys.consoleLogEnable.id, checked);
        // consoleLogTextEle.style.display = checked ? '' : 'none';
        getById(eleIds.consoleLogInfo).style.display = checked ? '' : 'none';
        const consoleLogTextEle = getById(eleIds.consoleLogText);
        if (checked) {
            if (!window.ede.appLogAspect) {
                window.ede.appLogAspect = new AppLogAspect().init();
            }
            consoleLogTextEle.value = window.ede.appLogAspect.value;
            // 首次填充已有日志也需跟随；等当前布局完成后再计算底部。
            scrollConsoleLogToBottom(consoleLogTextEle);
            window.ede.appLogAspect.on(newValue => {
                // 旧弹窗的监听不再操作已移除的文本框。
                if (!consoleLogTextEle.isConnected) return;
                // 新日志保持当前搜索条件；关闭跟随后恢复原阅读位置。
                const keyword = getById(eleIds.consoleLogSearchInput)?.querySelector('input')?.value.trim().toLowerCase();
                const visible = keyword ? newValue.split('\n').filter(line => line.toLowerCase().includes(keyword)).join('\n') : newValue;
                if (consoleLogTextEle.value !== visible) {
                    const position = consoleLogTextEle.scrollTop;
                    consoleLogTextEle.value = visible;
                    consoleLogTextEle.scrollTop = position;
                    scrollConsoleLogToBottom(consoleLogTextEle);
                    const consoleLogCountLabel = getById(eleIds.consoleLogCountLabel);
                    if (consoleLogCountLabel) {
                        consoleLogCountLabel.innerHTML = `清空 ${newValue.split('\n').length - 1} 行`;
                    }
                }
            });
        } else {
            consoleLogTextEle.value = '';
            window.ede.appLogAspect.destroy();
            window.ede.appLogAspect = null;
        }
    }

    function doLogLevelChange(value) {
        logLevel = parseInt(value.id);
        lsSetItem(lsKeys.logLevel.id, value.id);
        logger.info(`日志级别已切换为: ${value.name}`);
    }

    function getById(childId, parentNode = document) {
        // [优化] 只有在 document 级别查询时使用缓存
        if (parentNode === document) {
            return domCache.getById(childId);
        }
        return parentNode.querySelector(`#${childId}`);
    }

    /**
     * @param {string} className - 元素的类名不带点
     * * @param {HTMLElement | null} [parentNode] - 父元素,默认为 document
     * @returns {HTMLElement | null} - 返回找到的单个元素或 null
     */
    function getByClass(className, parentNode = document) {
        // [优化] 只有在 document 级别查询时使用缓存
        if (parentNode === document) {
            return domCache.getByClass(className);
        }
        return parentNode.querySelector(`.${className}`);
    }

    /** 仅适用于 input 元素和下一个临近元素的事件 */
    function getTargetInput(e) {
        return e.target.tagName === 'INPUT' ? e.target : e.target.previousElementSibling;
    }

    /** props: {id: 'inputId', value: '', type: '', style: '',...} for setAttribute(key, value)
     * function will not setAttribute
     */
    function embyInput(props, onEnter, onChange) {
        const input = document.createElement('input', { is: 'emby-input' });
        objectEntries(props).forEach(([key, value]) => {
            if (typeof value !== 'function') {
                input.setAttribute(key, value);
                // [修复] 对于 value 属性，需要同时设置 DOM 属性才能正确显示
                if (key === 'value') {
                    input.value = value;
                }
            }
        });
        input.className = classes.embyInput; // searchfields-txtSearch: 半圆角
        if (typeof onEnter === 'function') {
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { onEnter(e); } });
        }
        if (typeof onChange === 'function') { input.addEventListener('change', onChange); }
        // 控制器输入左右超出边界时切换元素
        input.addEventListener('keydown', (event) => {
            if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
                    ((input.selectionStart === 0 && event.key === 'ArrowLeft') ||
                        (input.selectionEnd === input.value.length && event.key === 'ArrowRight'))) {
                event.stopPropagation();
                event.preventDefault()
                var options = {sourceElement: event.target, repeat: event.repeat, originalEvent: event };
                require(['inputmanager'], (inputmanager) => {
                    inputmanager.trigger(event.key.replace('Arrow', '').toLowerCase(), options);
                });
            }
        });
        return input;
    }

    function embyI(iconKey, extClassName) {
        const iNode = document.createElement('i');
        iNode.className = 'md-icon' + (extClassName ? ' ' + extClassName : '');
        iNode.style = 'pointer-events: none;';
        iNode.innerHTML = iconKey;
        return iNode;
    }



    // ─── 弹字按钮圆形加载环工具函数 ─────────────────────────────────────────────

    /** 懒创建全局 tooltip div（固定定位，跟随按钮位置） */
    function getDanmakuTooltip() {
        let tip = document.getElementById('dd-ring-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'dd-ring-tooltip';
            document.body.appendChild(tip);
        }
        return tip;
    }

    /**
     * 显示并更新"弹"按钮的圆形加载环。
     * @param {number} progress  0~100 显示具体进度；< 0 为 indeterminate（持续旋转）
     * @param {string} [tip]     鼠标悬停时显示的状态描述文本
     */
    function ddSetLoadingRing(progress, tip) {
        const btn = getById(eleIds.danmakuSwitchBtn);
        if (!btn) {
            // [修复] 按钮 DOM 尚未创建（initUI 还未执行），记录 pending 状态
            // initUI 创建按钮后会检查并补触发
            if (window.ede) { window.ede._pendingLoadingRing = { progress, tip }; }
            return;
        }
        // 按钮已就绪，清除 pending 状态
        if (window.ede) { window.ede._pendingLoadingRing = null; }
        const C = 69.1; // 周长 = 2π×11
        const fg = btn.querySelector('.dd-ring-fg');
        if (fg) {
            if (progress < 0) {
                fg.style.strokeDashoffset = String(C * 0.75); // 仅显示 25% 弧段
            } else {
                fg.style.strokeDashoffset = String(C * (1 - Math.min(100, Math.max(0, progress)) / 100));
            }
        }
        btn.classList.add('dd-ring-active');
        btn.classList.toggle('dd-ring-spin', progress < 0);
        if (tip !== undefined && window.ede) {
            // 同时存储结构化进度数据，供 tooltip 渲染用
            window.ede._danmakuLoadStatus = tip;
            window.ede._danmakuLoadProgress = progress >= 0 ? progress : -1;
            // [修改] 轮询阶段调用时（有实际进度描述）清除搜索阶段的动态标题，回退到默认标题
            if (tip && tip !== '正在请求弹幕…') {
                window.ede._danmakuLoadTitle = '';
            }
        }
    }

    /** 清除"弹"按钮圆形加载环及 tooltip */
    function ddClearLoadingRing() {
        const btn = getById(eleIds.danmakuSwitchBtn);
        if (btn) { btn.classList.remove('dd-ring-active', 'dd-ring-spin'); }
        if (window.ede) {
            window.ede._danmakuLoadStatus = '';
            window.ede._danmakuLoadProgress = -1;
            // [修改] 清除搜索阶段动态标题，加载完成后 tooltip 改为显示弹幕信息
            window.ede._danmakuLoadTitle = '';
        }
        const tip = document.getElementById('dd-ring-tooltip');
        if (tip) { tip.style.display = 'none'; }
    }

    // ─────────────────────────────────────────────────────────────────────────

    /** props: {id: 'btnId', label: 'label text', style: '', iconKey: '',...} for setAttribute(key, value)
     * 'iconKey' will innerHTML <i>iconKey</i>|function will not setAttribute
     * 'danmakuTextBtn: true' 渲染"弹"字按钮，带 SVG 圆形加载环和悬停状态 tooltip
     */
    function embyButton(props, onClick) {
        const button = document.createElement('button');
        // !!! important: this is must setAttribute('is', 'emby-xxx'), unknown reason
        button.setAttribute('is', 'emby-button');
        button.setAttribute('type', 'button');
        objectEntries(props).forEach(([key, value]) => {
            if (key !== 'iconKey' && key !== 'danmakuTextBtn' && typeof value !== 'function') { button.setAttribute(key, value); }
        });
        if (props.danmakuTextBtn) {
            // "弹"字按钮：SVG 圆形加载环（默认隐藏）+ 文字 + 悬停 tooltip
            button.setAttribute('title', '');          // 禁用浏览器原生 title 遮挡
            button.setAttribute('aria-label', props.label);
            button.className = classes.embyButtons.iconButton;
            button.style.cssText = 'position:relative;overflow:visible;display:inline-flex;align-items:center;justify-content:center;';
            // 圆环半径 11，周长 ≈ 69.1；初始 dashoffset=69.1 → 不显示弧段
            button.innerHTML = `<span class="dd-btn-inner">`
                + `<svg class="dd-ring" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28">`
                + `<circle class="dd-ring-track" cx="14" cy="14" r="11"/>`
                + `<circle class="dd-ring-fg" cx="14" cy="14" r="11" stroke-dasharray="69.1" stroke-dashoffset="69.1"/>`
                + `</svg>`
                + `<span class="dd-btn-text">弹</span>`
                + `</span>`;
            // 悬停显示 tooltip：搜索阶段/轮询阶段/已匹配三种状态
            button.addEventListener('mouseenter', () => {
                const desc = (window.ede && window.ede._danmakuLoadStatus) || '';
                const pct = (window.ede && typeof window.ede._danmakuLoadProgress === 'number')
                    ? window.ede._danmakuLoadProgress : -1;
                const loadTitle = (window.ede && window.ede._danmakuLoadTitle) || '';

                let html = '';

                if (loadTitle) {
                    // 状态1：搜索/获取阶段 — 第一行状态，第二行视频名，无进度条
                    let statusText = '弹幕：正在搜索';
                    let animeName = loadTitle;
                    if (loadTitle.startsWith('正在获取弹幕：')) {
                        statusText = '弹幕：正在获取';
                        animeName = loadTitle.replace(/^正在获取弹幕：/, '');
                    } else if (loadTitle.startsWith('正在搜索弹幕：')) {
                        animeName = loadTitle.replace(/^正在搜索弹幕：/, '');
                    }
                    html = `<div class="dd-tip-title">${statusText}</div>`
                        + `<div class="dd-tip-desc">${animeName}</div>`;
                } else if (desc || pct >= 0) {
                    // 状态2：轮询阶段 — 第一行"正在生成弹幕"，进度条，第二行描述
                    const fillWidth = pct >= 0 ? Math.min(100, pct) : 0;
                    const pctLabel = pct >= 0 ? `${pct}%` : '';
                    html = `<div class="dd-tip-title">正在生成弹幕</div>`
                        + `<div class="dd-tip-bar-row">`
                        + `<div class="dd-tip-track"><div class="dd-tip-fill" style="width:${fillWidth}%"></div></div>`
                        + (pctLabel ? `<span class="dd-tip-pct">${pctLabel}</span>` : '')
                        + `</div>`
                        + (desc ? `<div class="dd-tip-desc">${desc}</div>` : '');
                } else if (window.ede?.localDanmakuInfo) {
                    // 本地加载不依赖在线 episodeId，媒体名称和来源按纯文本转义展示。
                    const info = window.ede.localDanmakuInfo;
                    const commentCount = window.ede.danmaku?.comments?.length ?? info.commentCount;
                    const details = [info.title, info.episode, `来源：${info.source}`, `${commentCount} 条`]
                        .filter(Boolean).map(value => escapeHtml(String(value))).join('　');
                    html = `<div class="dd-tip-title">弹幕：本地已加载</div>`
                        + `<div class="dd-tip-desc">${details}</div>`;
                } else {
                    // 状态3：已匹配 — 第一行"弹幕：已匹配"，第二行"番剧名  集名  XX条"
                    const info = window.ede && window.ede.episode_info;
                    if (!info || !info.episodeId) return; // 未匹配时不显示
                    const commentCount = (window.ede.danmaku && window.ede.danmaku.comments)
                        ? window.ede.danmaku.comments.length : 0;
                    html = `<div class="dd-tip-title">弹幕：已匹配</div>`
                        + `<div class="dd-tip-desc">${info.animeTitle}　${info.episodeTitle}　${commentCount} 条</div>`;
                }

                const tooltip = getDanmakuTooltip();
                tooltip.innerHTML = html;
                tooltip.style.visibility = 'hidden';
                tooltip.style.display = 'block';
                requestAnimationFrame(() => {
                    const rect = button.getBoundingClientRect();
                    // [修复] position:absolute 需要加 scrollX/scrollY 才能在全屏/滚动场景下正确定位
                    const left = rect.left + window.scrollX + rect.width / 2 - tooltip.offsetWidth / 2;
                    const top = rect.top + window.scrollY - tooltip.offsetHeight - 6;
                    tooltip.style.left = Math.max(0, left) + 'px';
                    tooltip.style.top = Math.max(0, top) + 'px';
                    tooltip.style.visibility = 'visible';
                });
            });
            button.addEventListener('mouseleave', () => {
                const tooltip = document.getElementById('dd-ring-tooltip');
                if (tooltip) { tooltip.style.display = 'none'; }
            });
        } else if (props.svgHtml) {
            // 自定义 SVG 图标分支（如弹幕设置按钮）
            button.setAttribute('title', props.label);
            button.setAttribute('aria-label', props.label);
            button.innerHTML = props.svgHtml;
            button.className = classes.embyButtons.iconButton;
        } else if (props.iconKey) {
            button.setAttribute('title', props.label);
            button.setAttribute('aria-label', props.label);
            button.innerHTML = embyI(props.iconKey).outerHTML;
            button.className = classes.embyButtons.iconButton;
        } else {
            button.classList.add(...classes.embyButtons.basic.split(' '));
            button.textContent = props.label;
        }
        if (typeof onClick === 'function') { button.addEventListener('click', onClick); }
        return button;
    }

    function embyALink(href, text) {
        const aEle = document.createElement('a');
        // !!! important: this is must setAttribute('is', 'emby-xxx'), unknown reason
        aEle.setAttribute('is', 'emby-linkbutton');
        aEle.href = href;
        aEle.textContent = text || href;
        aEle.target = '_blank';
        aEle.className = 'button-link button-link-color-inherit button-link-fontweight-inherit emby-button';
        if (OS.isMobile()) {
            aEle.addEventListener('click', (event) => {
                event.preventDefault();
                navigator.clipboard.writeText(href).then(() => {
                    logger.debug('Link copied to clipboard:', href);
                    const label = document.createElement('label');
                    label.textContent = '已复制';
                    label.style.color = 'green';
                    label.style.paddingLeft = '0.5em';
                    aEle.append(label);
                    setTimeout(() => {
                        aEle.removeChild(label);
                    }, 3000);
                }, (err) => {
                    logger.error('Failed to copy link:', err);
                });
            });
        }
        return aEle;
    }

    function embyTabs(options, selectedValue, optionValueKey, optionTitleKey, onChange) {
        // !!! important: this is must { is: 'emby-xxx' }, unknown reason
        const tabs = document.createElement('div', { is: 'emby-tabs' });
        tabs.setAttribute('data-index', '0');
        tabs.className = classes.embyTabsDiv1;
        tabs.style.width = 'fit-content';
        const tabsSlider = document.createElement('div');
        tabsSlider.className = classes.embyTabsDiv2;
        tabsSlider.style.padding = '0.25em';
        options.forEach((option, index) => {
            const value = getValueOrInvoke(option, optionValueKey);
            const title = getValueOrInvoke(option, optionTitleKey);
            const tabButton = document.createElement('button');
            tabButton.id = option.id + 'Btn';
            tabButton.className = `${classes.embyTabsButton}${value == selectedValue ? ' emby-tab-button-active' : ''}`;
            tabButton.setAttribute('data-index', index);
            tabButton.textContent = title;
            tabButton.style.display = option.hidden ? 'none' : '';
            tabsSlider.append(tabButton);
        });
        tabs.append(tabsSlider);
        if (typeof onChange === 'function') {
            tabs.addEventListener('tabchange', e => onChange(options[e.detail.selectedTabIndex], e.detail.selectedTabIndex));
        }
        return tabs;
    }

    function embySelect(props, selectedIndexOrValue, options, optionValueKey, optionTitleKey, onChange) {
        const defaultProps = { class: 'emby-select' };
        props = { ...defaultProps, ...props };
        if (!Number.isInteger(selectedIndexOrValue)) {
            selectedIndexOrValue = options.indexOf(selectedIndexOrValue);
        }
        // !!! important: this is must { is: 'emby-select' }
        const selectElement = document.createElement('select', { is: 'emby-select'});
        require(['browser'], (browser) => {
            if (browser.tv) {
                selectElement.classList.add(classes.embySelectTv);
            }
        });
        objectEntries(props).forEach(([key, value]) => {
            if (typeof value !== 'function') { selectElement.setAttribute(key, value); }
        });
        options.forEach((option, index) => {
            const value = getValueOrInvoke(option, optionValueKey);
            const title = getValueOrInvoke(option, optionTitleKey, index);
            const optionElement = document.createElement('option');
            optionElement.value = value;
            optionElement.textContent = title;
            if (index === selectedIndexOrValue) {
                optionElement.selected = true;
            }
            selectElement.append(optionElement);
        });
        if (typeof onChange === 'function') {
            selectElement.addEventListener('change', e => {
                onChange(e.target.value, e.target.selectedIndex, options[e.target.selectedIndex]);
            });
        }
        // return selectElement;
        // !!! important, only emby-select must have selectLabel class wrapper
        const selectLabel = document.createElement('label');
        selectLabel.classList.add('selectLabel');
        selectLabel.appendChild(selectElement);
        return selectLabel;
    }

    function embyCheckboxList(id, checkBoxName, selectedStrArray, options, onChange, isVertical = false) {
        const checkboxContainer = document.createElement('div');
        checkboxContainer.setAttribute('class', classes.embyCheckboxList);
        checkboxContainer.setAttribute('style', isVertical ? '' : styles.embyCheckboxList);
        checkboxContainer.setAttribute('id', id);
        options.forEach(option => {
            checkboxContainer.append(embyCheckbox({ name: checkBoxName, label: option.name, value: option.id }
                , (selectedStrArray ? selectedStrArray.indexOf(option.id) > -1 : false) , onChange));
        });
        return checkboxContainer;
    }

    function embyCheckbox({ id, name, label, value }, checked = false, onChange) {
        const checkboxLabel = document.createElement('label');
        checkboxLabel.classList.add('emby-checkbox-label');
        checkboxLabel.setAttribute('style', 'width: auto;');
        // !!! important: this is must { is: 'emby-xxx' }, unknown reason
        const checkbox = document.createElement('input', { is: 'emby-checkbox' });
        checkbox.setAttribute('type', 'checkbox');
        checkbox.setAttribute('id', id);
        checkbox.setAttribute('name', name);
        checkbox.setAttribute('value', value);
        checkbox.checked = checked;
        checkbox.classList.add('emby-checkbox', 'chkEnableLiveTvAccess');
        if (typeof onChange === 'function') {
            checkbox.addEventListener('change', e => onChange(e.target.checked));
        }
        const span = document.createElement('span');
        span.setAttribute('class', 'checkboxLabel');
        span.textContent = label;
        checkboxLabel.append(checkbox);
        checkboxLabel.append(span);
        return checkboxLabel;
    }

    /** props: {id: 'textareaId',value: '', rows: 10,style: '', styleResize:''|'vertical'|'horizontal'
     *      , style: '', readonly: false} for setAttribute(key, value)
     * function will not setAttribute
     */
    function embyTextarea(props, onBlur) {
        const defaultProps = { rows: 10, styleResize: 'vertical', readonly: false };
        props = { ...defaultProps, ...props };
        const textarea = document.createElement('textarea', { is: 'emby-textarea' });
        objectEntries(props).forEach(([key, value]) => {
            if (typeof value !== 'function' && key !== 'readonly'
                && key !== 'styleResize' && key !== 'value') { textarea.setAttribute(key, value); }
        });
        textarea.className = 'txtOverview emby-textarea';
        textarea.readOnly = props.readonly;
        textarea.style.resize = props.styleResize;
        textarea.value = props.value;
        if (typeof onBlur === 'function') { textarea.addEventListener('blur', onBlur); }
        return textarea;
    }

   /**
    * @param {Object} opts { id: 'slider id', labelId: 'label id', orient: 'vertical' | 'horizontal' 垂直/水平, ... }
    *   , will return to the callback
    * @param {Function} onChange Trigger after end of tap/swipe, AndroidTV use this
    * @param {Function} onSliding when init/clicking/sliding, trigger every step, AndroidTV not trigger
    *   , but not trigger when init and options.value === options.min
    * @returns HTMLElement
    */
    function embySlider(opts = {}, onChange, onSliding) {
        const defaultOpts = {
            orient: 'horizontal',
            'data-bubble': false, 'data-hoverthumb': true , style: '',
        };
        const options = { ...defaultOpts, ...opts };
        // !!! important: this is must { is: 'emby-xxx' }, unknown reason
        const slider = document.createElement('input', { is: 'emby-slider' });
        slider.setAttribute('type', 'range');
        if (opts.id) { slider.setAttribute('id', opts.id); }
        objectEntries(options).forEach(([key, value]) => {
            if (key === 'lsKey') {
                opts.key = value.id;
                const optsKeys = Object.keys(opts);
                if (!optsKeys.includes('value')) { options['value'] = lsGetItem(value.id); }
                if (!optsKeys.includes('min') && value.min !== undefined) { slider.setAttribute('min', value.min); }
                if (!optsKeys.includes('max') && value.max !== undefined) { slider.setAttribute('max', value.max); }
                if (!optsKeys.includes('step') && value.step !== undefined) { slider.setAttribute('step', value.step); }
            } else {
                slider.setAttribute(key, value);
            }
        });
        // other EventListeners : 'beginediting'(every step), 'endediting'(end of tap/swipe)
        if (typeof onChange === 'function') {
            slider.addEventListener('change', e => {
                opts.isManual = e.isManual;
                const nextEle = e.target.parentNode.nextElementSibling;
                opts.labelEle = nextEle.children.length > 0 ? nextEle.children[0] : nextEle;
                return onChange(e.target.value, opts);
            });
        }
        if (typeof onSliding === 'function') {
            slider.addEventListener('input', e => {
                const nextEle = e.target.parentNode.nextElementSibling;
                opts.labelEle = nextEle.children.length > 0 ? nextEle.children[0] : nextEle;
                return onSliding(e.target.value, opts);
            });
        }
        if (options.value) {
            slider.setValue(options.value);
            waitForElement({ element: slider, needParent: true }, (ele) => {
                const e = new Event('change');
                e.isManual = true;
                slider.dispatchEvent(e);
            }).catch(error => {
                logger.warn('waitForElement error:', error);
            });
        }
        require(['browser'], (browser) => {
            if (browser.electron && browser.windows) { // Emby Theater
                // 以下兼容旧版本emby,控制器操作锁定滑块焦点
                slider.addEventListener('keydown', e => {
                    const orient = slider.getAttribute('orient') || 'horizontal';
                    if ((orient === 'horizontal' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) ||
                        (orient === 'vertical' && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) {
                        e.stopPropagation();
                    }
                });
            }
        });
        return slider;
    }

    /**
     * see: ../web/modules/dialog/dialog.js
     * opts have type props: unknown
     * dialog have buttons prop: [{ type: 'submit', id: 'cancel', name:'取消', description: '无操作', href: 'index.html',  }]
     */
    async function embyDialog(opts = {}) {
        const defaultOpts = { text: '', title: '', timeout: 0, html: '', buttons: [] };
        opts = { ...defaultOpts, ...opts };
        return require(['dialog']).then(items => items[0](opts))
            .catch(error => { logger.debug('点击弹出框外部取消: ' + error) });
    }

    function closeEmbyDialog() {
        getByClass(classes.formDialogFooterItem).dispatchEvent(new Event('click'));
    }

    function embyImg(src, style, id, draggable = false) {
        const img = document.createElement('img');
        img.id = id;
        // 处理混合内容问题：如果当前页面是 HTTPS，将 HTTP 图片 URL 转换为 HTTPS
        let imgSrc = src;
        if (src && window.location.protocol === 'https:' && src.startsWith('http:')) {
            imgSrc = src.replace('http:', 'https:');
        }
        img.src = imgSrc;
        img.style = style;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.draggable = draggable;
        img.className = 'coveredImage-noScale cardImage';
        return img;
    }

    function embyImgButton(childNode, btnStyle) {
        const btn = document.createElement('button');
        btn.style = btnStyle;
        btn.className = 'cardContent-button cardImageContainer cardPadder-portrait defaultCardBackground';
        btn.append(childNode);
        btn.addEventListener('focus', () => {
            btn.style.boxShadow = '0 0 0 5px green';
        });
        btn.addEventListener('blur', () => {
            btn.style.boxShadow = '';
        });
        return btn;
    }

    // see: ../web/modules/common/dialogs/alert.js
    async function embyAlert(opts = {}) {
        const defaultOpts = { text: '', title: '', timeout: 0, html: ''};
        opts = { ...defaultOpts, ...opts };
        return require(['alert']).then(items => items[0](opts))
            .catch(error => { logger.debug('点击弹出框外部取消: ' + error) });
    }

    // see: ../web/modules/toast/toast.js, 严禁滥用,因遮挡画面影响体验,不建议使用 icon,会导致小秘版弹窗居中且图标过大
    async function embyToast(opts = {}) {
        const defaultOpts = { text: '', secondaryText: '', icon: '', iconStrikeThrough: false};
        opts = { ...defaultOpts, ...opts };
        return require(['toast'], toast => toast(opts));
    }



    function getValueOrInvoke(option, keyOrFunc) {
        if (typeof keyOrFunc === 'function') {
            const args = [option, ...Array.from(arguments).slice(2)];
            return keyOrFunc.apply(null, args);
        }
        return option[keyOrFunc];
    }

    function getSettingsJson(space = 4) {
        return JSON.stringify(Object.fromEntries(objectEntries(lsKeys).map(
            ([, value]) => [value.id, lsGetItem(value.id)])), null, space);
            // ([key, value]) => [value.id, { value: lsGetItem(value.id), name: value.name }])), null, space);
    }

    function settingsReset() {
        const defaultSettings = Object.fromEntries(
            objectEntries(lsKeys)
            .filter(([, value]) => lsKeys.filterKeywords.id !== value.id)
            .map(([, value]) => [value.id, value.defaultValue])
        );
        lsBatchSet(defaultSettings);
    }

    // --- 自定义弹幕源列表操作函数 ---

    /**
     * 获取自定义弹幕源列表
     * 数据结构: [{name: string, url: string, enabled: boolean}]
     * 兼容旧版单一 customApiPrefix 配置和旧版字符串数组
     */
    function getCustomApiList() {
        let list = lsGetItem(lsKeys.customApiList.id) || [];

        // 兼容旧版字符串数组格式，转换为新格式
        if (list.length > 0 && typeof list[0] === 'string') {
            list = list
                .filter(url => url && (url.startsWith('http://') || url.startsWith('https://')))  // [修复] 过滤掉不合法的 URL
                .map((url, index) => ({
                    name: `自定义源${index + 1}`,
                    url: url,
                    enabled: true,
                    appId: "",
                    appSecret: ""
                }));
            lsSetItem(lsKeys.customApiList.id, list);
        }

        // 兼容旧版：如果列表为空但旧配置有值，则迁移
        if (list.length === 0) {
            const oldPrefix = lsGetItem(lsKeys.customApiPrefix.id);
            // [修复] 旧配置迁移时校验 URL 格式，防止不完整 URL 导致 Worker 报错
            if (oldPrefix && oldPrefix.trim() && (oldPrefix.trim().startsWith('http://') || oldPrefix.trim().startsWith('https://'))) {
                list.push({ name: '自定义源1', url: oldPrefix.trim(), enabled: true, appId: "", appSecret: "" });
                lsSetItem(lsKeys.customApiList.id, list);
            }
        }

        // [初始化校验] 对所有启用的条目在后台异步做服务端连通校验，不阻塞返回
        // 用 Session 级 Set 记录本次已验证的 URL，避免 getCustomApiList 被频繁调用时重复发请求
        if (!window._ddValidatedApiUrls) { window._ddValidatedApiUrls = new Set(); }
        const needValidateItems = list.filter(item => item.url && item.enabled && !window._ddValidatedApiUrls.has(item.url));
        if (needValidateItems.length > 0) {
            // 立即标记为"本次已提交校验"，防止并发重入
            needValidateItems.forEach(item => window._ddValidatedApiUrls.add(item.url));
            (async () => {
                let changed = false;
                for (const item of needValidateItems) {
                    try {
                        const meta = await detectApiServerType(item.url);
                        if (meta && meta.serverName) {
                            item.serverName = meta.serverName;
                            item.serverVersion = meta.version || '';
                            changed = true;
                            logger.debug(`[自定义源] 服务端校验成功: ${item.name || item.url} → ${meta.serverName} ${meta.version || ''}`);
                        } else {
                            logger.warn(`[自定义源] 服务端校验未返回 serverName，可能不可达或不兼容: ${item.url}`);
                        }
                    } catch (_) {
                        logger.warn(`[自定义源] 服务端校验异常: ${item.url}`);
                    }
                }
                if (changed) {
                    lsSetItem(lsKeys.customApiList.id, list);
                    logger.debug('[自定义源] 初始化服务端校验完成，已更新 serverName/serverVersion');
                }
            })();
        }

        return list;
    }

    /**
     * 规范化自定义 API 前缀：
     * 1. URL 为空且配置了官方 key → 默认使用 dandanplay 官方地址
     * 2. 检测到 dandanplay 官方域名但缺少 /api/v2 → 自动补全
     * 3. 其他 URL 原样返回
     */
    function normalizeCustomApiPrefix(url, appId, appSecret) {
        const DANDANPLAY_ORIGIN = 'https://api.dandanplay.net';
        const DANDANPLAY_PREFIX = DANDANPLAY_ORIGIN + '/api/v2';
        // 官方源需经 corsProxy 代理才能带 wasm 签名，直连会绕过签名验证
        const PROXIED_PREFIX = corsProxy ? (corsProxy.replace(/\/+$/, '') + '/' + DANDANPLAY_PREFIX) : DANDANPLAY_PREFIX;

        // 情况1：未填 URL 但开启了官方 key → 走 corsProxy 代理的官方地址
        if (!url && appId && appSecret) {
            logger.debug('[自定义源] URL 为空但已配置官方 key，自动使用代理官方地址:', PROXIED_PREFIX);
            return PROXIED_PREFIX;
        }
        if (!url) return url;

        const trimmed = url.replace(/\/+$/, ''); // 去掉末尾斜杠

        // 情况2：填的是纯 dandanplay 域名（缺少 /api/v2），补全并走 corsProxy
        if (trimmed === DANDANPLAY_ORIGIN || trimmed === DANDANPLAY_ORIGIN + '/api') {
            logger.debug('[自定义源] dandanplay 官方域名缺少 /api/v2，补全并走代理:', PROXIED_PREFIX);
            return PROXIED_PREFIX;
        }

        // 情况3：填的是带 /api/v2 的 dandanplay 裸地址（无 corsProxy 前缀）→ 补上 corsProxy
        if (corsProxy && trimmed === DANDANPLAY_PREFIX) {
            logger.debug('[自定义源] dandanplay 裸地址未经代理，自动补上 corsProxy:', PROXIED_PREFIX);
            return PROXIED_PREFIX;
        }

        // 其他 URL（自建服务、已包含 corsProxy 的地址）原样返回
        return trimmed;
    }

    /**
     * 添加自定义弹幕源（支持附带服务器检测结果）
     */
    function addCustomApiSource(name, url, appId, appSecret, serverMeta) {
        // [修复] 函数级别校验 URL 格式，防止非法 URL 进入配置
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            console.warn('[dd-danmaku] 拒绝添加不合法的自定义源 URL:', url);
            return;
        }
        const list = getCustomApiList();
        // 检查URL是否已存在
        if (!list.some(item => item.url === url)) {
            const entry = { name: name || `自定义源${list.length + 1}`, url: url, enabled: true, appId: appId || "", appSecret: appSecret || "" };
            // 保存服务器检测结果（serverName / serverVersion）
            if (serverMeta && serverMeta.serverName) {
                entry.serverName = serverMeta.serverName;
                entry.serverVersion = serverMeta.version || '';
            }
            list.push(entry);
            lsSetItem(lsKeys.customApiList.id, list);
            // 同时更新旧配置（兼容性）
            if (list.length === 1) {
                lsSetItem(lsKeys.customApiPrefix.id, url);
            }
        }
    }

    /**
     * 删除自定义弹幕源
     */
    function removeCustomApiSource(index) {
        const list = getCustomApiList();
        if (index >= 0 && index < list.length) {
            list.splice(index, 1);
            lsSetItem(lsKeys.customApiList.id, list);
            // 更新旧配置（兼容性）
            const enabledUrls = list.filter(item => item.enabled).map(item => item.url);
            lsSetItem(lsKeys.customApiPrefix.id, enabledUrls[0] || '');
        }
    }

    /**
     * 切换自定义弹幕源启用状态
     */
    function toggleCustomApiSource(index, enabled) {
        const list = getCustomApiList();
        if (index >= 0 && index < list.length) {
            list[index].enabled = enabled;
            lsSetItem(lsKeys.customApiList.id, list);
            // 更新旧配置（兼容性）
            const enabledUrls = list.filter(item => item.enabled).map(item => item.url);
            lsSetItem(lsKeys.customApiPrefix.id, enabledUrls[0] || '');
        }
    }

    /**
     * 移动自定义弹幕源位置
     */
    function moveCustomApiSource(fromIndex, toIndex) {
        const list = getCustomApiList();
        if (fromIndex >= 0 && fromIndex < list.length && toIndex >= 0 && toIndex < list.length) {
            const [item] = list.splice(fromIndex, 1);
            list.splice(toIndex, 0, item);
            lsSetItem(lsKeys.customApiList.id, list);
            // 更新旧配置（兼容性）
            const enabledUrls = list.filter(item => item.enabled).map(item => item.url);
            lsSetItem(lsKeys.customApiPrefix.id, enabledUrls[0] || '');
        }
    }

    /**
     * 更新自定义弹幕源信息（URL 变更时重新写入服务器检测结果）
     */
    function updateCustomApiSource(index, name, url, appId, appSecret, serverMeta) {
        const list = getCustomApiList();
        if (index >= 0 && index < list.length) {
            list[index].name = name;
            list[index].url = url.endsWith('/') ? url.slice(0, -1) : url;
            if (typeof appId !== 'undefined') list[index].appId = appId || '';
            if (typeof appSecret !== 'undefined') list[index].appSecret = appSecret || '';
            // 如果有新的检测结果则写入，否则保留原有（URL 未变时 serverMeta 传 undefined）
            if (serverMeta !== undefined) {
                list[index].serverName = serverMeta ? (serverMeta.serverName || '') : '';
                list[index].serverVersion = serverMeta ? (serverMeta.version || '') : '';
            }
            lsSetItem(lsKeys.customApiList.id, list);
            const enabledUrls = list.filter(item => item.enabled).map(item => item.url);
            lsSetItem(lsKeys.customApiPrefix.id, enabledUrls[0] || '');
        }
    }

    // [优化] localStorage 内存缓存层，减少同步 I/O
    const lsCache = new Map();

    // [优化] DOM 查询缓存
    const domCache = {
        cache: new Map(),

        // 获取元素（带缓存）
        get(selector, forceRefresh = false) {
            if (!forceRefresh && this.cache.has(selector)) {
                const cached = this.cache.get(selector);
                // 验证缓存是否仍在 DOM 中
                if (cached && document.contains(cached)) {
                    return cached;
                }
                // 缓存失效，删除
                this.cache.delete(selector);
            }

            // 查询并缓存
            const element = document.querySelector(selector);
            if (element) {
                this.cache.set(selector, element);
            }
            return element;
        },

        // 获取所有匹配元素（不缓存，因为 NodeList 是动态的）
        getAll(selector) {
            return document.querySelectorAll(selector);
        },

        // 按 ID 获取（带缓存）
        getById(id) {
            return this.get(`#${id}`);
        },

        // 按 Class 获取第一个（带缓存）
        getByClass(className, parent) {
            const selector = parent ? `${parent} .${className}` : `.${className}`;
            return this.get(selector);
        },

        // 清空指定缓存
        invalidate(selector) {
            this.cache.delete(selector);
        },

        // 清空所有缓存（页面导航时调用）
        clear() {
            this.cache.clear();
            logger.debug('[DOM缓存] 已清空所有缓存');
        }
    };

    // [优化] 事件监听器统一管理
    const eventManager = {
        listeners: new Map(),

        // 添加事件监听器（自动管理）
        add(target, event, handler, options) {
            if (!target) return;

            const key = `${this.getTargetKey(target)}_${event}`;

            // 如果已存在相同的监听器，先移除
            if (this.listeners.has(key)) {
                this.remove(target, event);
            }

            target.addEventListener(event, handler, options);
            this.listeners.set(key, { target, event, handler, options });

            logger.debug(`[事件管理] 添加监听器: ${key}`);
        },

        // 移除事件监听器
        remove(target, event) {
            if (!target) return;

            const key = `${this.getTargetKey(target)}_${event}`;
            const listener = this.listeners.get(key);

            if (listener) {
                listener.target.removeEventListener(listener.event, listener.handler, listener.options);
                this.listeners.delete(key);
                logger.debug(`[事件管理] 移除监听器: ${key}`);
            }
        },

        // 生成目标键（用于标识不同的 target）
        getTargetKey(target) {
            if (target === window) return 'window';
            if (target === document) return 'document';
            if (target.id) return `#${target.id}`;
            if (target.className) return `.${target.className.split(' ')[0]}`;
            return target.tagName || 'unknown';
        },

        // 清理所有监听器
        cleanup() {
            logger.debug(`[事件管理] 开始清理 ${this.listeners.size} 个监听器`);

            this.listeners.forEach(({ target, event, handler, options }) => {
                try {
                    target.removeEventListener(event, handler, options);
                } catch (error) {
                    logger.warn(`[事件管理] 清理监听器失败: ${event}`, error);
                }
            });

            this.listeners.clear();
            logger.debug('[事件管理] 所有监听器已清理');
        }
    };

    // [优化] 用户友好的错误提示管理器
    const ErrorNotifier = {
        // 显示错误提示（优先使用 Emby 原生 toast）
        show(message, type = 'error', duration = 5000) {
            // 方案1: 使用 Emby 自带的提示
            if (window.Dashboard && window.Dashboard.alert) {
                window.Dashboard.alert({
                    message: message,
                    title: 'dd-danmaku'
                });
            }
            // 方案2: 在视频 OSD 上显示
            else {
                const icon = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
                setOsdDanmakuText(`${icon} ${message}`, duration);
            }

            // 始终记录到控制台
            const logFn = type === 'error' ? logger.error : type === 'warning' ? logger.warn : logger.info;
            logFn(`[提示] ${message}`);
        },

        // 预定义的常见错误提示
        networkError(context = '数据') {
            this.show(`网络错误：${context}加载失败，请检查网络连接`, 'error', 5000);
        },

        apiError(apiName = 'API') {
            this.show(`${apiName}暂时不可用，正在尝试备用方案...`, 'warning', 3000);
        },

        parseError(dataType = '数据') {
            this.show(`${dataType}格式异常，弹幕可能不完整`, 'warning', 3000);
        },

        cacheSuccess(source = '缓存') {
            this.show(`已从${source}加载弹幕`, 'info', 2000);
        },

        noDanmaku() {
            this.show('当前视频暂无弹幕', 'info', 2000);
        },

        loadSuccess(count) {
            this.show(`成功加载 ${count} 条弹幕`, 'success', 2000);
        }
    };

    // [优化] IndexedDB 离线缓存管理器
    const IndexedDBCache = {
        db: null,
        dbName: 'dd-danmaku-cache',
        dbVersion: 2,  // v2: 新增 tmdb store
        storeName: 'episodes',
        tmdbStoreName: 'tmdb',

        // 初始化数据库
        async init() {
            if (this.db) return true;

            // 检查浏览器是否支持 IndexedDB
            if (!window.indexedDB) {
                logger.warn('[IndexedDB] 浏览器不支持 IndexedDB，将使用 localStorage 降级');
                return false;
            }

            try {
                this.db = await new Promise((resolve, reject) => {
                    const request = indexedDB.open(this.dbName, this.dbVersion);

                    request.onerror = () => {
                        logger.error('[IndexedDB] 打开数据库失败:', request.error);
                        reject(request.error);
                    };

                    request.onsuccess = () => {
                        logger.info('[IndexedDB] 数据库已就绪');
                        resolve(request.result);
                    };

                    request.onupgradeneeded = (event) => {
                        const db = event.target.result;

                        // v1: 弹幕缓存 store
                        if (!db.objectStoreNames.contains(this.storeName)) {
                            const store = db.createObjectStore(this.storeName, { keyPath: 'episodeId' });
                            store.createIndex('animeId', 'animeId', { unique: false });
                            store.createIndex('timestamp', 'timestamp', { unique: false });
                            logger.info('[IndexedDB] 弹幕缓存 store 已创建');
                        }

                        // v2: TMDB 集数映射缓存 store
                        if (!db.objectStoreNames.contains(this.tmdbStoreName)) {
                            const tmdbStore = db.createObjectStore(this.tmdbStoreName, { keyPath: 'cacheKey' });
                            tmdbStore.createIndex('timestamp', 'timestamp', { unique: false });
                            logger.info('[IndexedDB] TMDB 缓存 store 已创建');
                        }
                    };
                });

                return true;
            } catch (error) {
                logger.error('[IndexedDB] 初始化失败:', error);
                return false;
            }
        },

        // 保存弹幕到 IndexedDB
        async save(episodeId, animeId, comments) {
            if (!await this.init()) {
                // 降级到 localStorage
                return this.saveToLocalStorage(episodeId, comments);
            }

            try {
                const data = {
                    episodeId: episodeId,
                    animeId: animeId,
                    comments: comments,
                    timestamp: Date.now(),
                    size: comments.length
                };

                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                await store.put(data);

                logger.debug(`[IndexedDB] 已缓存 ${comments.length} 条弹幕 (episodeId: ${episodeId})`);
                return true;
            } catch (error) {
                logger.error('[IndexedDB] 保存失败:', error);
                // 降级到 localStorage
                return this.saveToLocalStorage(episodeId, comments);
            }
        },

        // 从 IndexedDB 加载弹幕
        async load(episodeId) {
            if (!await this.init()) {
                // 降级到 localStorage
                return this.loadFromLocalStorage(episodeId);
            }

            try {
                const transaction = this.db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.get(episodeId);

                const data = await new Promise((resolve, reject) => {
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });

                if (data && data.comments) {
                    logger.debug(`[IndexedDB] 缓存命中 (episodeId: ${episodeId}, ${data.size} 条弹幕)`);
                    return data.comments;
                }

                return null;
            } catch (error) {
                logger.error('[IndexedDB] 读取失败:', error);
                // 降级到 localStorage
                return this.loadFromLocalStorage(episodeId);
            }
        },

        // 降级：保存到 localStorage
        saveToLocalStorage(episodeId, comments) {
            try {
                const key = `danmaku_cache_${episodeId}`;
                const data = JSON.stringify({ comments, timestamp: Date.now() });
                localStorage.setItem(key, data);
                logger.debug(`[localStorage降级] 已缓存弹幕 (episodeId: ${episodeId})`);
                return true;
            } catch (error) {
                logger.error('[localStorage降级] 保存失败:', error);
                return false;
            }
        },

        // 降级：从 localStorage 加载
        loadFromLocalStorage(episodeId) {
            try {
                const key = `danmaku_cache_${episodeId}`;
                const data = localStorage.getItem(key);
                if (data) {
                    const parsed = JSON.parse(data);
                    logger.debug(`[localStorage降级] 缓存命中 (episodeId: ${episodeId})`);
                    return parsed.comments;
                }
                return null;
            } catch (error) {
                logger.error('[localStorage降级] 读取失败:', error);
                return null;
            }
        },

        // ========== TMDB 集数映射缓存 ==========

        // 保存 TMDB 数据到 IndexedDB
        async saveTmdb(cacheKey, data, ttlDays = 7) {
            if (!await this.init()) return false;
            try {
                const record = {
                    cacheKey: cacheKey,
                    data: data,
                    timestamp: Date.now(),
                    expireAt: Date.now() + ttlDays * 86400000
                };
                const tx = this.db.transaction([this.tmdbStoreName], 'readwrite');
                const store = tx.objectStore(this.tmdbStoreName);
                await new Promise((resolve, reject) => {
                    const req = store.put(record);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
                logger.debug(`[IndexedDB] TMDB 缓存已写入: ${cacheKey}`);
                return true;
            } catch (error) {
                logger.warn('[IndexedDB] TMDB 缓存写入失败:', error);
                return false;
            }
        },

        // 从 IndexedDB 加载 TMDB 数据（自动过期检查）
        async loadTmdb(cacheKey) {
            if (!await this.init()) return null;
            try {
                const tx = this.db.transaction([this.tmdbStoreName], 'readonly');
                const store = tx.objectStore(this.tmdbStoreName);
                const record = await new Promise((resolve, reject) => {
                    const req = store.get(cacheKey);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
                if (!record) return null;
                // TTL 过期检查
                if (record.expireAt && Date.now() > record.expireAt) {
                    logger.debug(`[IndexedDB] TMDB 缓存已过期: ${cacheKey}`);
                    return null;
                }
                logger.debug(`[IndexedDB] TMDB 缓存命中: ${cacheKey}`);
                return record.data;
            } catch (error) {
                logger.warn('[IndexedDB] TMDB 缓存读取失败:', error);
                return null;
            }
        },

        // 清空 TMDB 缓存（清除所有缓存时调用）
        async clearTmdb() {
            if (!await this.init()) return;
            try {
                const tx = this.db.transaction([this.tmdbStoreName], 'readwrite');
                const store = tx.objectStore(this.tmdbStoreName);
                await new Promise((resolve, reject) => {
                    const req = store.clear();
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
                logger.info('[IndexedDB] TMDB 缓存已清空');
            } catch (error) {
                logger.warn('[IndexedDB] TMDB 缓存清空失败:', error);
            }
        }
    };

    // 按服务器和用户隔离配置；无用户或无宿主客户端时保留纯 JS 回退。
    const persistenceIdentity = () => {
        const client = getHostApiClient();
        return `${client?.serverAddress?.() || ''}|${client?.getCurrentUserId?.() || ''}`;
    };
    const localParameterKey = id => getHostApiClient()?.getCurrentUserId?.()
        ? `dd-user:${encodeURIComponent(persistenceIdentity())}:${id}` : id;
    let persistenceSession = '';
    let persistenceReady = Promise.resolve();
    async function prepareUserParameters() {
        const client = getHostApiClient();
        const identity = persistenceIdentity();
        if (!client?.getCurrentUserId?.()) return;
        if (identity === persistenceSession) return persistenceReady;
        // 先按各自用户键落盘待写入值，再切换内存缓存；旧请求不得同步到新账号。
        if (lsWriteTimer) clearTimeout(lsWriteTimer);
        lsFlushAllWrites();
        lsCache.clear();
        persistenceSession = identity;
        persistenceReady = (async () => {
            const state = await ddBackend.prepare();
            if (!state || !ddBackend.has('ParameterPersistence') || identity !== persistenceIdentity()) return;
            const count = await persistenceLoadAll(identity);
            if (count > 0 && identity === persistenceIdentity()) {
                logLevel = readLogLevel();
                logger.info(`[持久化] 已恢复当前用户 ${count} 项配置`);
            }
        })().catch(error => logger.warn('[持久化] 加载个人配置失败', error));
        return persistenceReady;
    }

    // 缓存相关方法
    function lsGetItem(id) {
        const storageKey = localParameterKey(id);
        // 内存缓存也使用会话键，切换账号不会复用上一用户的值。
        if (lsCache.has(storageKey)) return lsCache.get(storageKey);
        const key = lsGetKeyById(id);
        if (!key) { return null; }
        const defaultValue = lsKeys[key].defaultValue;
        const item = localStorage.getItem(storageKey);

        let value;
        // DLL 仅提供会话级默认值；用户已有 localStorage 值始终优先，避免覆盖主动配置。
        const backendDefault = item === null ? ddBackend.defaultValue(key) : undefined;
        if (backendDefault !== undefined && backendDefault !== null) {
            value = backendDefault;
        }
        // [修复] 如果 localStorage 中没有值，或者值为空字符串且默认值不为空，则返回默认值
        else if (item === null || (item === '' && defaultValue !== '')) {
            value = defaultValue;
        }
        // JSON.parse 加 try/catch，防止单个损坏的 localStorage 值中断初始化
        else if (typeof defaultValue === 'object' && defaultValue !== null) {
            try {
                value = JSON.parse(item);
            } catch (_) {
                logger.warn(`[lsGetItem] localStorage 值解析失败，键=${id}，使用默认值`);
                value = defaultValue;
            }
        }
        else if (typeof defaultValue === 'boolean') {
            value = item === 'true';
        }
        else if (typeof defaultValue === 'number') {
            value = parseFloat(item);
        }
        else {
            value = item;
        }

        // 存入缓存
        lsCache.set(storageKey, value);
        return value;
    }
    function lsCheckOld(id, value) {
        return JSON.stringify(lsGetItem(id)) === JSON.stringify(value);
    }
    function lsCheckSet(id, value) {
        if (lsCheckOld(id, value)) { return false; }
        lsSetItem(id, value);
        return true;
    }
    /** 批量设置缓存
     * @param {object} keyValues - 键值对对象,如 {key1: value1, key2: value2}
     * @returns {boolean} - 是否有更新
     */
    function lsBatchSet(keyValues, needCheck = true) {
        if (needCheck) {
            return objectEntries(keyValues).reduce((acc, [id, value]) => (acc || lsCheckSet(id, value)), false);
        } else {
            objectEntries(keyValues).forEach(([key, value]) => lsSetItem(key, value));
        }
    }
    // [优化] 批量延迟写入队列
    const lsPendingWrites = new Map();
    let lsWriteTimer = null;

    function lsSetItem(id, value, skipSync, immediate = false) {
        if (!lsGetKeyById(id)) { return; }

        const storageKey = localParameterKey(id);
        lsCache.set(storageKey, value);
        if (immediate) {
            lsFlushWrite(storageKey, value);
            // 持久化同步
            if (!skipSync
                && lsGetItem(lsKeys.configPersistenceEnable.id)
                && lsGetItem(lsKeys.configPersistenceAutoSync.id)
                && id !== lsKeys.configPersistenceEnable.id
                && id !== lsKeys.configPersistenceAutoSync.id) {
                persistenceSaveOneDebounced(id, value);
            }
            return;
        }

        // 加入批量写入队列
        lsPendingWrites.set(storageKey, { id, value, skipSync, identity: persistenceIdentity() });

        // 启动延迟写入定时器（500ms 后批量写入）
        if (lsWriteTimer) {
            clearTimeout(lsWriteTimer);
        }
        lsWriteTimer = setTimeout(() => {
            lsFlushAllWrites();
        }, 500);
    }

    // 执行单个写入
    function lsFlushWrite(id, value) {
        let stringValue;
        if (Array.isArray(value)) {
            stringValue = JSON.stringify(value);
        } else if (typeof value === 'object' && value !== null) {
            stringValue = JSON.stringify(value);
        } else {
            stringValue = String(value);
        }
        localStorage.setItem(id, stringValue);
    }

    // 批量写入所有待写入项
    function lsFlushAllWrites() {
        if (lsPendingWrites.size === 0) return;

        logger.debug(`[localStorage] 批量写入 ${lsPendingWrites.size} 项`);

        lsPendingWrites.forEach(({ id, value, skipSync, identity }, storageKey) => {
            lsFlushWrite(storageKey, value);
            // 防抖回调必须属于当前账号，不能把上一用户的参数写进新用户文件。
            if (identity !== persistenceIdentity()) return;
            if (!skipSync
                && lsGetItem(lsKeys.configPersistenceEnable.id)
                && lsGetItem(lsKeys.configPersistenceAutoSync.id)
                && id !== lsKeys.configPersistenceEnable.id
                && id !== lsKeys.configPersistenceAutoSync.id) {
                persistenceSaveOneDebounced(id, value);
            }
        });

        lsPendingWrites.clear();
        lsWriteTimer = null;
    }
    // [优化] 构建 id→key 反向索引 Map，lsGetItem/lsSetItem 查找从 O(n) 降到 O(1)
    const _lsIdToKeyMap = new Map();
    Object.keys(lsKeys).forEach(key => _lsIdToKeyMap.set(lsKeys[key].id, key));

    function lsGetKeyById(id) {
        return _lsIdToKeyMap.get(id) || null;
    }
    function lsBatchRemove(prefixes) {
        const keysToRemove = Object.keys(localStorage)
            .filter(key => prefixes.some(prefix => key.startsWith(prefix)));
        keysToRemove.forEach(key => { logger.debug('Removing cache key:', key); localStorage.removeItem(key); });
        return keysToRemove.length > 0;
    }

    function destroyAllInterval() {
        // [优化] forEach 做副作用，map 应用于需要返回值的场景
        window.ede.destroyIntervalIds.forEach(id => clearInterval(id));
        window.ede.destroyIntervalIds = [];
    }

    /**
     * [优化] 使用 MutationObserver 替代 setInterval 轮询
     * @param {string|object} target - 等待目标,string 为 selector,object 目标高级自定义 { element: ele, needParent: true }
     * @param {function} callback - 等待目标获取成功后的回调函数,参数为元素
     * @param {number} [timeout=10000] - 超时时间,默认10秒,0则不设置超时
     * @param {number} [interval=check_interval] - 降级轮询间隔（仅在 MutationObserver 不可用时）
     * @returns {Promise<HTMLElement|null>} - 返回一个 Promise 对象:
     *   - 如果目标元素在超时时间内被找到,Promise 将 resolve 为目标元素 (HTMLElement)
     *   - 如果超时且未找到目标元素,Promise 将 reject 为一个 Error 对象,表示查找失败
    */
    function waitForElement(target, callback, timeout = 10000, interval = check_interval) {
        const isSelector = typeof target === 'string';
        const elementMark = isSelector ? target : target.element.tagName;

        // 立即检查元素是否已存在
        function checkElementImmediate() {
            let element = null;
            if (isSelector) {
                element = document.querySelector(target);
            } else {
                if (target.needParent) {
                    if (target.element) {
                        element = target.element.parentNode;
                    }
                } else {
                    element = target.element;
                }
            }
            return element;
        }

        const existingElement = checkElementImmediate();
        if (existingElement) {
            if (callback) callback(existingElement);
            return Promise.resolve(existingElement);
        }

        // [优化] 优先使用 MutationObserver
        if (typeof MutationObserver !== 'undefined') {
            return waitForElementWithObserver(target, callback, timeout, elementMark);
        } else {
            // 降级：使用 setInterval
            return waitForElementWithPolling(target, callback, timeout, interval, elementMark);
        }
    }

    // [优化] 使用 MutationObserver 监听 DOM 变化
    function waitForElementWithObserver(target, callback, timeout, elementMark) {
        let observer = null;
        let timeoutId = null;
        const isSelector = typeof target === 'string';

        return new Promise((resolve, reject) => {
            function checkElement() {
                let element = null;
                if (isSelector) {
                    element = document.querySelector(target);
                } else {
                    if (target.needParent) {
                        if (target.element) {
                            element = target.element.parentNode;
                        }
                    } else {
                        element = target.element;
                    }
                }

                if (element) {
                    cleanup();
                    if (callback) callback(element);
                    resolve(element);
                    return true;
                }
                return false;
            }

            function cleanup() {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            }

            // 创建 MutationObserver
            observer = new MutationObserver(() => {
                checkElement();
            });

            // 监听 DOM 树变化
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // 设置超时
            if (timeout > 0) {
                timeoutId = setTimeout(() => {
                    cleanup();
                    logger.warn(`[waitForElement] 查找元素 [${elementMark}] 超时 (${timeout}ms)`);
                    reject(new Error(`Element [${elementMark}] not found within ${timeout}ms`));
                }, timeout);
            }
        });
    }

    // [降级] 使用 setInterval 轮询
    function waitForElementWithPolling(target, callback, timeout, interval, elementMark) {
        let intervalId = null;
        let timeoutId = null;
        const isSelector = typeof target === 'string';

        return new Promise((resolve, reject) => {
            function checkElement() {
                // [优化] 降低日志级别，避免刷屏
                // logger.debug(`waitForElement: checking element[${elementMark}]`);
                let element = null;
                if (isSelector) {
                    element = document.querySelector(target);
                } else {
                    if (target.needParent) {
                        if (target.element) {
                            element = target.element.parentNode;
                        }
                    } else {
                        element = target.element;
                    }
                }
                if (element) {
                    clearInterval(intervalId);
                    clearTimeout(timeoutId);
                    // [优化] 找到元素后从清理数组中移除，避免 ID 累积
                    const idx = window.ede.destroyIntervalIds.indexOf(intervalId);
                    if (idx > -1) window.ede.destroyIntervalIds.splice(idx, 1);
                    if (callback) {
                        callback(element);
                    }
                    resolve(element);
                }
            }

            intervalId = setInterval(checkElement, interval);
            window.ede.destroyIntervalIds.push(intervalId);

            if (timeout > 0) {
                timeoutId = setTimeout(() => {
                    clearInterval(intervalId);
                    // [优化] 超时后也从清理数组中移除
                    const idx = window.ede.destroyIntervalIds.indexOf(intervalId);
                    if (idx > -1) window.ede.destroyIntervalIds.splice(idx, 1);
                    logger.warn(`[waitForElement] 查找元素 [${elementMark}] 超时 (${timeout}ms)`);
                    reject(new Error(`Element [${elementMark}] not found within ${timeout}ms`));
                }, timeout);
            }
        });
    }

    function addEasterEggListener() {
        const target = getByClass(classes.headerUserButton);
        if (!target) { return; }
        let longPressTimeout;
        function startLongPress() {
            longPressTimeout = setTimeout(() => {
                logger.debug('恭喜你发现了隐藏功能, 长按了 2 秒!');
                quickDebug();
            }, 2000);
        }
        function cancelLongPress() {
            clearTimeout(longPressTimeout);
        }
        const isMobile = OS.isMobile();
        let startEventName = isMobile ? 'touchstart' : 'mousedown';
        let endEventName = isMobile ? 'touchend' : 'mouseup';
        require(['browser'], (browser) => {
            if (browser.tv) {
                startEventName = 'focus';
                endEventName = 'blur';
            }
            if (target.getAttribute('startFlag') !== '1') {
                target.addEventListener(startEventName, startLongPress);
                target.setAttribute('startFlag', '1');
            }
            if (target.getAttribute('endFlag') !== '1') {
                target.addEventListener(endEventName, cancelLongPress);
                target.setAttribute('endFlag', '1');
            }
        });
        return () => {
            target.removeEventListener(startEventName, startLongPress);
            target.removeEventListener(endEventName, cancelLongPress);
            clearTimeout(longPressTimeout);
        };
    }

    function initCss() {
        // 修复emby小秘版播放过程中toast消息提示框不显示问题
        if (OS.isEmbyNoisyX()) {
            const existingStyle = document.querySelector('style[css-emby-noisyx-fix]');
            if (!existingStyle) {
                const style = document.createElement('style');
                style.setAttribute('css-emby-noisyx-fix', '');
                style.innerHTML = `
                    [class*="accent-"].noScrollY.transparentDocument .toast-group {
                        position: fixed;
                        top: auto;
                    }
                `;
                document.head.appendChild(style);
            }
        }
        // 注入"弹"按钮圆形加载环 CSS（只注入一次）
        if (!document.querySelector('style[dd-danmaku-ring]')) {
            const ringStyle = document.createElement('style');
            ringStyle.setAttribute('dd-danmaku-ring', '');
            ringStyle.innerHTML = `
                /* 按钮内层容器 */
                #${eleIds.danmakuSwitchBtn} .dd-btn-inner {
                    position: relative;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 2em;
                    height: 2em;
                }
                /* "弹"文字 */
                #${eleIds.danmakuSwitchBtn} .dd-btn-text {
                    font-size: 1em;
                    font-weight: bold;
                    line-height: 1;
                    pointer-events: none;
                    z-index: 1;
                    position: relative;
                }
                /* SVG 圆环：默认完全隐藏 */
                #${eleIds.danmakuSwitchBtn} .dd-ring {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    opacity: 0;
                    transform: rotate(-90deg);
                    transition: opacity 0.2s;
                    pointer-events: none;
                }
                /* 底层轨道环 */
                #${eleIds.danmakuSwitchBtn} .dd-ring-track {
                    fill: none;
                    stroke: rgba(0,164,255,0.25);
                    stroke-width: 2;
                }
                /* 进度弧段 */
                #${eleIds.danmakuSwitchBtn} .dd-ring-fg {
                    fill: none;
                    stroke: rgba(0,164,255,0.9);
                    stroke-width: 2;
                    stroke-linecap: round;
                    transition: stroke-dashoffset 0.3s ease;
                }
                /* 激活时显示圆环 */
                #${eleIds.danmakuSwitchBtn}.dd-ring-active .dd-ring {
                    opacity: 1;
                }
                /* 弹幕关闭时：斜线由 JS 动态插入 SVG 实现，CSS 只负责定位容器 */
                #${eleIds.danmakuSwitchBtn} .dd-btn-text {
                    position: relative;
                }
                /* SVG 斜线覆盖层：绝对定位铺满文字包围盒 */
                #${eleIds.danmakuSwitchBtn} .dd-off-line {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    overflow: visible;
                    z-index: 2;
                }
                /* indeterminate（progress<0）时整体旋转 */
                @keyframes dd-ring-rotate {
                    0%   { transform: rotate(-90deg); }
                    100% { transform: rotate(270deg); }
                }
                #${eleIds.danmakuSwitchBtn}.dd-ring-spin .dd-ring {
                    animation: dd-ring-rotate 1s linear infinite;
                }
                /* 全局悬停 tooltip */
                #dd-ring-tooltip {
                    display: none;
                    position: absolute;
                    z-index: 2147483647;
                    background: rgba(0,0,0,0.82);
                    color: #fff;
                    font-size: 0.78em;
                    padding: 6px 10px;
                    border-radius: 5px;
                    pointer-events: none;
                    white-space: normal;
                    min-width: 160px;
                    max-width: 240px;
                    line-height: 1.5;
                }
                /* 进度条区域：百分比文字右对齐 */
                #dd-ring-tooltip .dd-tip-title {
                    font-size: 0.95em;
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                #dd-ring-tooltip .dd-tip-bar-row {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-bottom: 4px;
                }
                /* 进度条轨道 */
                #dd-ring-tooltip .dd-tip-track {
                    flex: 1;
                    height: 4px;
                    background: rgba(255,255,255,0.22);
                    border-radius: 2px;
                    overflow: hidden;
                }
                /* 进度条填充 */
                #dd-ring-tooltip .dd-tip-fill {
                    height: 100%;
                    background: rgba(255,255,255,0.85);
                    border-radius: 2px;
                    transition: width 0.3s ease;
                }
                /* 百分比数字 */
                #dd-ring-tooltip .dd-tip-pct {
                    flex: none;
                    min-width: 2.8em;
                    text-align: right;
                    font-size: 0.95em;
                    opacity: 0.9;
                }
                /* 描述文字 */
                #dd-ring-tooltip .dd-tip-desc {
                    font-size: 0.9em;
                    opacity: 0.8;
                    word-break: break-all;
                }
            `;
            document.head.appendChild(ringStyle);
        }
    }

    function removeHeaderClock() {
        const headerClockEle = getById('headerClock');
        if (headerClockEle) {
            headerClockEle.remove();
        }
        // removeHeaderClock 只清理时钟自己的 interval，不调用 destroyAllInterval()
        // 避免隐藏 OSD 时意外中断 waitForElement 等其他初始化轮询
        if (window.ede && typeof window.ede._headerClockIntervalId !== 'undefined') {
            clearInterval(window.ede._headerClockIntervalId);
            window.ede._headerClockIntervalId = undefined;
            // 同步从 destroyIntervalIds 中移除（避免销毁时重复 clearInterval）
            if (Array.isArray(window.ede.destroyIntervalIds)) {
                const idx = window.ede.destroyIntervalIds.indexOf(window.ede._headerClockIntervalId);
                if (idx !== -1) window.ede.destroyIntervalIds.splice(idx, 1);
            }
        }
    }

    function addHeaderClock() {
        const warpper = getByClass('headerMiddle');
        let headerClockEle = getById('headerClock');
        if (!warpper) {
            return;
        }
        if (headerClockEle) {
            headerClockEle.remove();
        }

        const clockElement = document.createElement('div');
        clockElement.id = 'headerClock';
        warpper.append(clockElement);

        function updateClock() {
            const timeString = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            clockElement.textContent = timeString;
            // console.log(timeString);
            headerClockEle = getById('headerClock');
            if (!headerClockEle) {
                clearInterval(intervalId);
            }
        }
        updateClock();
        const intervalId = setInterval(updateClock, 1000);

        // 记录时钟专属 intervalId，供 removeHeaderClock 精准清理
        window.ede._headerClockIntervalId = intervalId;
        window.ede.destroyIntervalIds.push(intervalId);
        return intervalId;
    }

    function refreshEventListener(eventsMap) {
        objectEntries(eventsMap).forEach(([eventName, fn]) => {
            document.removeEventListener(eventName, fn);
            document.addEventListener(eventName, fn);
        });
    }

    /**
     * 添加事件并先移除事件
     * from emby videoosd.js bindToPlayer events, warning: not dom event
     * @param {Object} eventsMap { eventName: fn } fn 请勿使用匿名函数,off 时无法移除事件
     * @returns null
     */
    // 未确认 DLL 能力时保持原监听；专用连接不触碰 Emby 自身连接。
    const ddPlaybackSocket = (() => {
        let socket = null, timer = null, key = '', generation = -1, epoch = '', session = '';
        let sequence = 0, lastReply = 0, retryAt = 0, playSession = '', itemId = '', itemGuid = '', remote = false;
        let pendingStop = null, manager = null, player = null;
        const identity = () => {
            const client = getHostApiClient();
            return `${client?.serverAddress?.() || ''}|${client?.getCurrentUserId?.() || ''}|${client?.accessToken?.() || ''}|${client?.deviceId?.() || ''}`;
        };
        const enabled = () => ddBackend.isDll() && ddBackend.has('WebSocketPlayback') && typeof WebSocket === 'function';
        function finishStop() {
            const pending = pendingStop; pendingStop = null;
            if (!pending) return;
            clearTimeout(pending.timer);
            if (pending.generation === playbackViewGeneration && pending.key === identity()
                && pending.loadId === window.ede?.lastLoadId) pending.fn(...pending.args);
            else logger.debug('[播放联动] 已丢弃过期停止动作，保留当前播放');
        }
        function close() {
            const hadConnection = !!socket;
            // 连接失效立即切回真实媒体，不继续沿用后端暂停或倍速状态。
            danmakuClock?.fallback();
            remote = false; epoch = ''; session = ''; sequence = 0;
            // 重连可能错过下一集 started；清空旧播放标识，允许当前媒体的状态重新确认。
            playSession = ''; itemId = ''; itemGuid = '';
            const previous = socket; socket = null;
            if (previous) { previous.onopen = previous.onmessage = previous.onclose = previous.onerror = null; previous.close(); }
            retryAt = Date.now() + 5000;
            if (hadConnection) logger.info('[播放联动] 专用连接已关闭，继续本地事件处理');
            finishStop(); // 传输失败不能丢掉已收到的本地停止事件。
        }
        function active() {
            return enabled() && remote && socket?.readyState === WebSocket.OPEN
                && generation === playbackViewGeneration && key === identity()
                && manager?.getCurrentPlayer() === player && Date.now() - lastReply < 20000;
        }
        function sameItem(data, id) {
            return !!id && (String(id) === data.itemId
                || String(id).replace(/-/g, '').toLowerCase() === data.itemGuid);
        }
        function send(type, data = '') {
            try { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ MessageType: type, Data: data })); }
            catch (_) { close(); }
        }
        function receive(message) {
            if (!enabled()) return close();
            const data = message.Data;
            if (message.MessageType === 'DDDanmaku.Ready') {
                if (data?.protocolVersion !== 1 || !data.connectionEpoch || !data.sessionId
                    || (epoch && epoch !== data.connectionEpoch) || (session && session !== data.sessionId)) return close();
                if (!epoch) logger.info('[播放联动] 后端订阅已确认，本地事件继续主导开始与切集');
                epoch = data.connectionEpoch; session = data.sessionId; lastReply = Date.now();
                return; // 握手不等于当前媒体已获确认。
            }
            if (message.MessageType !== 'DDDanmaku.State' || !epoch || !data
                || data.connectionEpoch !== epoch || data.sessionId !== session || data.protocolVersion !== 1
                || !Number.isSafeInteger(data.sequence) || data.sequence <= sequence || !data.playSessionId || !data.itemId) return;
            sequence = data.sequence; lastReply = Date.now();
            if (data.event === 'stopped') {
                // 停止必须保留本地 state（进度提交需要它），不能无参数调用 onPlaybackStop。
                if (pendingStop && pendingStop.playSession === data.playSessionId && sameItem(data, pendingStop.itemId)) {
                    logger.debug('[播放联动] 后端已确认停止，执行本地停止动作');
                    finishStop();
                }
                if (playSession === data.playSessionId) remote = false;
                return;
            }
            const media = getPlaybackMedia();
            if (!media || !window.ede || manager?.getCurrentPlayer() !== player
                || !sameItem(data, manager.currentItem(player)?.Id)) { remote = false; return; }
            if (playSession && playSession !== data.playSessionId && data.event !== 'started') return;
            itemId = data.itemId; itemGuid = data.itemGuid || ''; playSession = data.playSessionId; remote = true;
            // 已通过连接、顺序、会话及媒体校验，驱动弹幕而非回写真实视频。
            danmakuClock?.accept(data);
            if (data.event === 'started') logger.debug('[播放联动] 后端状态已同步至弹幕时钟');
            if (media.id === eleIds.h5VideoAdapter && ['paused', 'resumed'].includes(data.event)) {
                media.dispatchEvent(new Event(data.isPaused ? 'pause' : 'play'));
                videoTimeUpdateInterval(media, !data.isPaused);
            }
        }
        function tick() {
            if (!enabled() || generation !== playbackViewGeneration || key !== identity()) {
                close(); clearInterval(timer); timer = null; return;
            }
            const client = getHostApiClient();
            if (!client?.serverAddress || !client.accessToken || !client.deviceId) {
                close(); return;
            }
            // 换流暂时没有媒体或播放器时保留重连循环；同页恢复后重新订阅。
            // 不能清掉 timer 后依赖未必再次发生的事件绑定来启动连接。
            const currentPlayer = manager?.getCurrentPlayer();
            if (!currentPlayer || !getPlaybackMedia()) { if (socket) close(); return; }
            if (currentPlayer !== player) { close(); player = currentPlayer; retryAt = 0; }
            if (socket) {
                if (Date.now() - lastReply > 20000) return close();
                send(epoch ? 'DDDanmaku.Heartbeat' : 'DDDanmaku.Subscribe', client.deviceId?.() || '');
                return;
            }
            if (Date.now() < retryAt) return;
            try {
                const url = new URL(String(client.serverAddress()).replace(/\/$/, '') + '/embywebsocket');
                url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
                url.searchParams.set('api_key', client.accessToken());
                url.searchParams.set('deviceId', client.deviceId());
                const current = socket = new WebSocket(url.href);
                lastReply = Date.now();
                current.onopen = () => { if (socket === current) send('DDDanmaku.Subscribe', client.deviceId()); };
                current.onmessage = event => {
                    if (socket !== current || generation !== playbackViewGeneration || key !== identity()) return;
                    try { receive(JSON.parse(event.data)); } catch (_) { close(); }
                };
                current.onclose = current.onerror = () => { if (socket === current) close(); };
            } catch (_) { close(); }
        }
        return {
            dispose() {
                // 页面退出立即释放专用连接、定时器和待执行停止，绝不触碰 Emby 自身连接。
                if (pendingStop) clearTimeout(pendingStop.timer);
                pendingStop = null;
                clearInterval(timer); timer = null;
                send('DDDanmaku.Unsubscribe');
                close(); manager = null; player = null;
            },
            start(playbackManager, currentPlayer) {
                if (!enabled()) return; // 普通模式不建立连接，也不启动心跳/重连定时器。
                if (timer && generation === playbackViewGeneration && key === identity() && player === currentPlayer) return;
                close(); if (timer) clearInterval(timer);
                manager = playbackManager; player = currentPlayer;
                generation = playbackViewGeneration; key = identity();
                retryAt = 0; timer = setInterval(tick, 5000); tick();
            },
            stop(fn, args) {
                const stoppedItem = args[1]?.NowPlayingItem?.Id;
                // 同时接受 Emby 内部 ID 和 GUID，避免 GUID 播放状态绕过停止确认。
                if (!active() || !sameItem({ itemId, itemGuid }, stoppedItem)) return fn(...args);
                // 重复 stop 不提前执行旧动作，也不延长等待窗口。
                if (pendingStop?.playSession === playSession && pendingStop.loadId === window.ede?.lastLoadId) return;
                finishStop();
                const loadId = window.ede?.lastLoadId;
                pendingStop = { fn, args, generation, key, playSession, itemId: stoppedItem,
                    loadId, timer: setTimeout(() => {
                        logger.debug('[播放联动] 停止确认超时，执行本地兜底');
                        finishStop();
                    }, 1200) };
            }
        };
    })();

    async function playbackEventsRefresh(eventsMap) {
        const generation = playbackViewGeneration;
        const [playbackManager, events] = await Promise.all([new Promise(resolve => require(['playbackManager'], resolve)), new Promise(resolve => require(['events'], resolve))]);
        if (generation !== playbackViewGeneration) return;
        const player = playbackManager.getCurrentPlayer();
        if (!player) { return; }
        // 同播放器、同原始回调保留现有绑定，包括 DLL 包装后的停止回调。
        let changed = false;
        objectEntries(eventsMap).forEach(([eventName, fn]) => {
            const previous = playbackBindings.get(eventName);
            if (previous?.player === player && previous.original === fn) return;
            if (previous) previous.events.off(previous.player, eventName, previous.handler);
            events.off(player, eventName, fn);
            events.on(player, eventName, fn);
            playbackBindings.set(eventName, { player, events, handler: fn, original: fn });
            changed = true;
        });
        if (!changed) return;
        logger.info('播放事件监听器已绑定至当前播放器');
        // 探测只是旁路；失败、无能力或页面已切换，都保留上面的原监听。
        ddBackend.prepare().then(state => {
            if (!state || !ddBackend.isDll() || !ddBackend.has('WebSocketPlayback') || typeof WebSocket !== 'function'
                || generation !== playbackViewGeneration || playbackManager.getCurrentPlayer() !== player) return;
            ddPlaybackSocket.start(playbackManager, player);
            const fn = eventsMap.playbackstop;
            const binding = playbackBindings.get('playbackstop');
            if (!fn || binding?.player !== player || binding.handler !== fn) return;
            const handler = (...args) => ddPlaybackSocket.stop(fn, args);
            events.off(player, 'playbackstop', fn);
            events.on(player, 'playbackstop', handler);
            playbackBindings.set('playbackstop', { player, events, handler, original: fn });
        }).catch(() => {});
    }

    async function initH5VideoAdapter() {
        const generation = playbackViewGeneration;
        let _media = getPlaybackMedia();
        if (_media) {
            if (_media.id) { // 若是手动创建的<video>
                videoTimeUpdateInterval(_media, true);
            }
            return;
        }
        logger.info('播放页不存在 video 标签,适配器处理开始');
        _media = document.createElement('video');
        // !!! Apple 设备上此属性必须存在,否则 currentTime = 0 无法更新; 而其他设备反而不能有
        if (OS.isApple()) { _media.src = ''; }
        _media.style.display = 'none';
        _media.id = eleIds.h5VideoAdapter;
        _media.classList.add('htmlvideoplayer', 'moveUpSubtitles');   // 沿用 Emby class
        document.body.prepend(_media);

        _media.play();
        videoTimeUpdateInterval(_media, true);
         // 以下暂未遇到匿名函数导致的事件重复,等出现时再匿名转命名函数
        // [修复] 添加seeking检测的防抖和初始化标志
        let lastSeekingTime = 0;
        let isFirstTimeUpdate = true;
        const SEEKING_THRESHOLD = 2;    // 时间差阈值（秒）
        const SEEKING_DEBOUNCE = 500;   // 防抖时间（毫秒）

        require(['playbackManager'], (playbackManager) => {
            if (generation !== playbackViewGeneration || !_media.isConnected) return;
            playbackEventsRefresh({
                'timeupdate': () => {
                    // [修复] 安全获取播放器状态，防止报错
                    const player = playbackManager.getCurrentPlayer();
                    if (!player) return; // 播放器都没了，直接退出

                    // conver to seconds from Ticks
                    const realCurrentTime = playbackManager.currentTime(player) / 10000000;
                    const mediaTime = _media.currentTime;
                    const timeDiff = Math.abs(mediaTime - realCurrentTime);

                    _media.currentTime = realCurrentTime;

                    // [关键修复] 安全获取 PlaybackRate
                    const playerState = playbackManager.getPlayerState();
                    // 使用可选链 (?.) 避免 undefined 报错
                    const embyPlaybackRate = playerState?.PlayState?.PlaybackRate;
                    _media.playbackRate = embyPlaybackRate ? embyPlaybackRate : 1;

                     // [修复] 跳过第一次时间更新（初始化时可能有大的时间差）
                    if (isFirstTimeUpdate) {
                        isFirstTimeUpdate = false;
                        if (lsGetItem(lsKeys.debugH5VideoAdapterEnable.id)) {
                             logger.debug(`[虚拟播放器] 初始化时间: ${realCurrentTime}, 跳过seeking检测`);
                        }
                        return;
                    }
                     // [修复] 当前时间与上次记录时间差值大于阈值,且距离上次seeking超过防抖时间,则判定为用户操作进度
                     // seeking 事件必须在 currentTime 更改后触发,否则回退后弹幕将消失
                    const now = Date.now();
                    if (timeDiff > SEEKING_THRESHOLD && (now - lastSeekingTime) > SEEKING_DEBOUNCE) {
                        lastSeekingTime = now;
                        _media.dispatchEvent(new Event('seeking'));
                        // console.warn(`[虚拟播放器] seeking detected...`);
                    }
                },
            });
        });

        playbackEventsRefresh({
            'pause': () => {
                logger.debug('[虚拟播放器] 监听到暂停事件 (pause)');
                _media.dispatchEvent(new Event('pause'));
                videoTimeUpdateInterval(_media, false);
            },
            'unpause': () => {
                logger.debug('[虚拟播放器] 监听到取消暂停/播放事件 (unpause)');
                // [修复] 播放开始时重置seeking检测标志
                isFirstTimeUpdate = true;
                _media.dispatchEvent(new Event('play'));
                videoTimeUpdateInterval(_media, true);
            },
        });
       logger.info('已创建虚拟 video 标签,适配器处理正确结束');
    }

   // 平滑补充<video> timeupdate 中秒级间隔缺失的 100ms 间隙
    function videoTimeUpdateInterval(media, enable) {
        const _media = media || document.querySelector(mediaQueryStr);
        if (!_media) { return; }
        if (enable && !_media.timeupdateIntervalId) {
             // [修复] 移除重复的 setInterval 调用，只保留一个
             _media.timeupdateIntervalId = setInterval(() => { _media.currentTime += 100 / 1000 }, 100);
        } else if (!enable && _media.timeupdateIntervalId) {
             clearInterval(_media.timeupdateIntervalId);
             _media.timeupdateIntervalId = null;
        }
    }

    function beforeDestroy(e) {
        if (e?.detail?.type !== 'video-osd') { return; }
        const view = getPlaybackView(e);
        if (view && activePlaybackView && view !== activePlaybackView) return;
        // 先失效旧页任务，再释放资源，防止迟到回调恢复已销毁的弹幕。
        playbackViewGeneration++;
        // 退出时立即释放弹幕时钟，避免旧页计时器继续推进。
        clearStoppedDanmaku();
        danmakuClock?.dispose();
        // 退出播放立即释放手动来源和凭据，不带入下一次播放。
        manualDanmakuSelection = null;
        activeLocalPlayback = null;
        ddPlaybackSocket.dispose(); // 不等待下一次心跳才回收已退出页面的连接。
        danmakuPlaybackSnapshot = null; // 退出时释放原始弹幕数据与旧播放器引用。
        if (cancelDanmakuUIWait) cancelDanmakuUIWait();
        playbackBindings.forEach(({ player, events, handler }, name) => events.off(player, name, handler));
        playbackBindings.clear();
        domCache.clear();
        activePlaybackView = null;

        // [备份逻辑] 智能推断需要这个，必须放在清空前
        if (window.ede && window.ede.episode_info) {
            window.ede.previous_episode_info = { ...window.ede.episode_info };
        }

        // =========== [UI 瞬间清空区] ===========
        // 1. 立即清空 OSD 文字 (解决右下角残留)
        const videoOsdDanmakuTitle = getById(eleIds.videoOsdDanmakuTitle);
        if (videoOsdDanmakuTitle) {
            videoOsdDanmakuTitle.innerText = ''; // <--- 关键：直接置空 DOM，不要等数据
        }

        // 2. 立即隐藏/清空弹幕画布 (解决屏幕弹幕残留)
        // [优化] 统一使用 destroy() 一步到位，包含 hide+clear+解绑事件+释放内部引用
        if (window.ede && window.ede.danmaku) {
            try { window.ede.danmaku.destroy(); } catch (e) {
                logger.warn('弹幕实例销毁异常', e);
            }
            window.ede.danmaku = null;
        }

        // 3. 移除高能进度条 (如果有)
        const chartEle = getById(eleIds.progressBarLineChart);
        if (chartEle) chartEle.remove();

        // 4. 清除"弹"按钮加载环及悬停 tooltip，避免退出时残留显示
        ddClearLoadingRing();
        // =====================================

        // [数据清空]
        if (window.ede) {
            window.ede.episode_info = null; // 防止数据串台
            window.ede.localDanmakuInfo = null; // 退出时同步释放本地悬停展示信息。
            window.ede.lastLoadId = 'DESTROYED_' + Date.now();

            // [新增] 终止所有挂起的网络请求 (Fetch/Worker)
            if (window.ede.abortControllers) {
                for (const controller of window.ede.abortControllers) {
                    controller.abort();
                }
                window.ede.abortControllers.clear();
                logger.debug('[GC] 已终止所有挂起的网络请求');
            }

            // [新增] 修复 ResizeObserver 内存泄漏：必须显式断开连接
            if (window.ede.ob) {
                window.ede.ob.disconnect();
                window.ede.ob = null;
                logger.debug('[GC] ResizeObserver 已断开');
            }
        }

        // 销毁弹幕按钮容器简单,双 mediaContainerQueryStr 下免去 DOM 位移操作
        const danmakuCtr = getById(eleIds.danmakuCtr);
        if (danmakuCtr) {
            danmakuCtr.remove();
        }
        // 虚拟 video 的监听已解除，下次必须重建，不能复用失去事件源的适配器。
        const adapter = document.getElementById(eleIds.h5VideoAdapter);
        if (adapter) {
            videoTimeUpdateInterval(adapter, false);
            adapter.remove();
        }
        document.querySelectorAll(`#${eleIds.danmakuWrapper}`).forEach(el => el.remove());
        removeHeaderClock();
        danmakuAutoFilterCancel();

         // 销毁可能残留的定时器
        destroyAllInterval();

        // 退出播放页面重置轴偏秒
        lsSetItem(lsKeys.timelineOffset.id, lsKeys.timelineOffset.defaultValue);

        logger.debug('[生命周期] 播放页环境已销毁 (beforeDestroy)');
    }

    function onViewShow(e) {
        console.log('[dd-danmaku] onViewShow 触发, type:', e && e.detail && e.detail.type);
        logger.debug(`监听到视图切换事件 (viewshow), 类型: ${e.detail.type}`);
        customeUrl.init();
        lsGetItem(lsKeys.quickDebugOn.id) && !getById(eleIds.danmakuSettingBtnDebug) && quickDebug();
        addEasterEggListener();

        // 仅在进入播放页(video-osd)时才初始化和设置数据
        if (e.detail.type === 'video-osd') {
            const view = getPlaybackView(e);
            if (activePlaybackView && view && activePlaybackView !== view) {
                beforeDestroy({ detail: { type: 'video-osd' }, target: activePlaybackView });
            }
            activePlaybackView = view;
            domCache.clear(); // 仍在文档中的隐藏旧页不能作为新页缓存。
            // 1. 确保对象已初始化
            if (!window.ede) { window.ede = new EDE(); }

            // 路由恢复事件可能没有媒体 ID；媒体身份统一由 currentItem() 更新。
            // 此处不能用空路由参数覆盖已确认的手动选择所对应的条目。

            // 提前探测 DLL 并加载会话级默认值；失败静默回退普通 JS 模式。
            ddBackend.prepare().then(() => {
                if (window.ede && !window.ede.danmaku) {
                    lsCache.clear();
                }
            }).catch(error => logger.debug('[DLL] 能力探测失败，使用普通 JS 模式', error));

            if (!window.ede.appLogAspect && lsGetItem(lsKeys.consoleLogEnable.id)) {
                window.ede.appLogAspect = new AppLogAspect().init();
            }
            initUI();
            initH5VideoAdapter();
            // loadDanmaku(LOAD_TYPE.INIT);
            initListener();
            initCss();
            // 进入播放页时提前预热 wasm，确保后续签名请求时 wasm 已就绪（无条件触发，内部判断 URL）
            ddSign.warmup();
        }
    }

    // emby/jellyfin CustomEvent. see: https://github.com/MediaBrowser/emby-web-defaultskin/blob/822273018b82a4c63c2df7618020fb837656868d/nowplaying/videoosd.js#L698
    // 关闭值 0 必须保留，只有非法配置才回退 INFO。
    function readLogLevel() {
        const value = Number.parseInt(lsGetItem(lsKeys.logLevel.id), 10);
        return Number.isInteger(value) && value >= 0 && value <= 4 ? value : 3;
    }
    logLevel = readLogLevel();

    // 启动恢复与播放前准备共用同一 Promise，避免首次初始化标记被后台查询抢走。
    if (getHostApiClient()?.getCurrentUserId?.()) {
        prepareUserParameters().catch(error => logger.warn('[持久化] 启动加载失败', error));
    }

    refreshEventListener({ 'viewshow': onViewShow });
    refreshEventListener({ 'viewbeforehide': beforeDestroy });

    // [修复] CustomCssJS 兼容：如果脚本在页面已加载后注入，viewshow 事件可能已经错过
    // 需要立即检查当前是否已在播放页面，如果是则手动触发初始化
    logger.info('[dd-danmaku] 插件已加载，正在检查当前页面状态...');

    // 延迟执行，确保 Emby 的路由系统已经就绪
    setTimeout(() => {
        // 检查当前 URL 是否包含 videoosd（播放页面）
        const currentPath = window.location.hash || window.location.pathname;
        const isVideoOsdPage = currentPath.includes('videoosd') ||
                               document.querySelector(mediaContainerQueryStr + ' video');

        // 检查是否已经有视频元素（说明已经在播放页面）
        const hasVideoElement = document.querySelector('video');

        logger.debug(`[dd-danmaku] 当前路径: ${currentPath}, 是否播放页: ${isVideoOsdPage}, 是否有视频元素: ${!!hasVideoElement}`);

        if (isVideoOsdPage || hasVideoElement) {
            logger.info('[dd-danmaku] 检测到已在播放页面，手动触发初始化...');

            // 模拟 viewshow 事件的参数
            const mockEvent = {
                detail: {
                    type: 'video-osd',
                    params: {
                        id: new URLSearchParams(window.location.search).get('id') || ''
                    }
                }
            };

            // 手动调用初始化
            onViewShow(mockEvent);
        }
    }, 500); // 延迟 500ms 确保 DOM 已就绪

    // ------  检测弹幕服务器类型 start ------
    /**
     * 检测自定义 API 的服务器类型。
     * 依次尝试 /api/v2/version 和 /version，取第一个成功且含 serverName 的响应。
     * @param {string} url  API 根地址（末尾不含 /）
     * @returns {Promise<{serverName:string, version:string}|null>}
     */
    async function detectApiServerType(url) {
        const paths = ['/api/v2/version', '/version'];
        for (const path of paths) {
            try {
                const resp = await fetch(url + path, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
                });
                if (!resp.ok) continue;
                const data = await resp.json().catch(() => null);
                if (data && data.serverName) {
                    return { serverName: data.serverName, version: data.version || '' };
                }
            } catch (_) { /* 超时或网络错误，继续尝试下一条路径 */ }
        }
        return null;
    }
    // ------  检测弹幕服务器类型 end ------

    // ------  WASM 签名模块 start ------

    const ddSign = {
        _instance: null,
        _loading: null,
        _failed: false,
        _failedAt: 0,

        get _wasmUrl() {
            return requireSparkMD5Path.replace(/\/tools\/.*$/, '/tools/sign.wasm');
        },

        async _ensure() {
            if (this._instance) return this._instance;
            const RETRY_COOLDOWN_MS = 3000;
            if (this._failed) {
                if (Date.now() - this._failedAt < RETRY_COOLDOWN_MS) return null;
                this._failed = false;
                try { logger.info('[签名] wasm 加载冷却期结束，尝试重新加载'); } catch (_) {}
            }
            // 已有正在进行中的加载，等待其完成
            if (this._loading) return this._loading;
            const imports = { env: { abort: () => { throw new Error('wasm abort'); } } };
            this._loading = (async () => {
                // 优先使用 instantiateStreaming（浏览器更友好，无需先转 ArrayBuffer）
                if (typeof WebAssembly.instantiateStreaming === 'function') {
                    try {
                        const resp = await fetch(this._wasmUrl);
                        if (!resp.ok) throw new Error('HTTP ' + resp.status);
                        const { instance } = await WebAssembly.instantiateStreaming(resp, imports);
                        this._instance = instance.exports;
                        try { logger.info('[签名] wasm 加载成功 (streaming)'); } catch (_) {}
                        return this._instance;
                    } catch (streamErr) {
                        // streaming 失败（如 CSP / Content-Type 不匹配），回退到 arrayBuffer 方式
                        try { logger.warn('[签名] streaming 失败，回退 arrayBuffer:', streamErr && (streamErr.message || streamErr)); } catch (_) {}
                    }
                }
                // 回退：先下载字节再实例化
                const resp2 = await fetch(this._wasmUrl);
                if (!resp2.ok) throw new Error('HTTP ' + resp2.status);
                const bytes = await resp2.arrayBuffer();
                const { instance } = await WebAssembly.instantiate(bytes, imports);
                this._instance = instance.exports;
                try { logger.info('[签名] wasm 加载成功 (arrayBuffer)'); } catch (_) {}
                return this._instance;
            })();
            try {
                return this._loading;
            } catch (e) {
                this._failed = true;
                this._failedAt = Date.now();
                // 打完整错误对象，方便排查 CSP / 网络 / 实例化具体原因
                try { logger.warn('[签名] wasm 加载失败，3s后将重试:', e); } catch (_) {}
                return null;
            } finally {
                this._loading = null;
            }
        },

        /**
         * 预热加载：在页面初始化时主动触发一次 wasm 加载，
         * 避免首次业务请求时 wasm 还未就绪导致签名头缺失。
         * 失败时静默，_ensure 的重试机制会在后续请求时接管。
         */
        warmup() {
            if (this._instance || this._loading) return;
            try { logger.info('[签名] wasm 预热加载开始'); } catch (_) {}
            this._ensure().then(inst => {
                if (!inst) {
                    // 预热失败，3s 后再试一次（此时冷却也结束了）
                    setTimeout(() => this._ensure(), 3500);
                }
            }).catch(() => {});
        },

        _writeStr(ex, str) {
            const ptr = ex.__new(str.length << 1, 2);
            const mem = new Uint16Array(ex.memory.buffer, ptr, str.length);
            for (let i = 0; i < str.length; i++) mem[i] = str.charCodeAt(i);
            return ptr;
        },
        _readStr(ex, ptr) {
            const len = new Uint32Array(ex.memory.buffer, ptr - 4, 1)[0] >>> 1;
            const mem = new Uint16Array(ex.memory.buffer, ptr, len);
            let s = '';
            for (let i = 0; i < len; i++) s += String.fromCharCode(mem[i]);
            return s;
        },

        async compute(userId, ts, path) {
            const ex = await this._ensure();
            if (!ex) return null;
            try {
                const raw = `${userId}:${ts}:${path}`;
                const p = ex.__pin ? ex.__pin(this._writeStr(ex, raw)) : this._writeStr(ex, raw);
                const rp = ex.sign(p);
                const out = this._readStr(ex, rp);
                if (ex.__unpin) ex.__unpin(p);
                return out;
            } catch (e) {
                try { logger.warn('[签名] 计算异常,本次不带签名', e && e.message); } catch (_) {}
                return null;
            }
        },

        _obfUser: null,
        _obfUserSrc: '',
        async userMark() {
            let uid = '';
            try { uid = (typeof ApiClient !== 'undefined' && ApiClient.getCurrentUserId) ? (ApiClient.getCurrentUserId() || '') : ''; } catch (_) {}
            if (!uid) return '';
            if (this._obfUser && this._obfUserSrc === uid) return this._obfUser;

            const ex = await this._ensure();
            if (!ex || !ex.obfuscateUser) return uid;
            try {
                const p = ex.__pin ? ex.__pin(this._writeStr(ex, uid)) : this._writeStr(ex, uid);
                const out = this._readStr(ex, ex.obfuscateUser(p));
                if (ex.__unpin) ex.__unpin(p);
                if (!out) return uid;
                this._obfUserSrc = uid;
                this._obfUser = out;
                return out;
            } catch (e) {
                try { logger.warn('[签名] 异常,回退原始ID', e && e.message); } catch (_) {}
                return uid;
            }
        },

        async buildHeaders(url) {
            const userId = await this.userMark();
            const ts = Math.floor(Date.now() / 1000);
            let path = '';
            try {
                const real = url.replace(corsProxy, '');
                path = new URL(real).pathname;
            } catch (_) {
                const m = url.match(/\/api\/v2\/[^?]*/);
                path = m ? m[0] : '';
            }
            const sig = await this.compute(userId, ts, path);
            if (!sig) return {};
            return { 'X-Ddd-User': String(userId), 'X-Ddd-Ts': String(ts), 'X-Ddd-Sign': sig };
        },

        isProxiedOfficial(url) {
            return typeof url === 'string' && !!corsProxy && url.startsWith(corsProxy);
        },

        /**
         * wasm 自检：主动验证 wasm 是否可正常加载并运行
         * 在浏览器控制台执行 window.ddSign.selfTest() 即可诊断
         * 返回 { ok: boolean, detail: string }
         */
        async selfTest() {
            const log = (msg) => { try { logger.info('[签名自检] ' + msg); } catch (_) { console.log(DD_LOG_PREFIX, '[INFO]', '[签名自检] ' + msg); } };
            const warn = (msg) => { try { logger.warn('[签名自检] ' + msg); } catch (_) { console.warn(DD_LOG_PREFIX, '[WARN]', '[签名自检] ' + msg); } };

            log('开始...');
            log('wasm URL: (已隐藏)');
            log('WebAssembly 支持: ' + (typeof WebAssembly !== 'undefined' ? '✓' : '✗ 不支持'));

            if (typeof WebAssembly === 'undefined') {
                warn('当前环境不支持 WebAssembly，签名功能不可用');
                return { ok: false, detail: 'WebAssembly 不支持' };
            }

            // 强制重新加载（忽略缓存实例，直接测fetch+instantiate）
            log('正在 fetch wasm 文件...');
            let bytes;
            try {
                const resp = await fetch(this._wasmUrl);
                log('fetch 响应状态: ' + resp.status + ' ' + resp.statusText);
                if (!resp.ok) {
                    warn('fetch 失败: HTTP ' + resp.status);
                    return { ok: false, detail: 'fetch HTTP ' + resp.status };
                }
                bytes = await resp.arrayBuffer();
                log('fetch 成功，文件大小: ' + bytes.byteLength + ' 字节');
            } catch (e) {
                warn('fetch 异常: ' + (e && e.message));
                return { ok: false, detail: 'fetch 异常: ' + (e && e.message) };
            }

            // 尝试实例化
            log('正在 WebAssembly.instantiate...');
            let exports;
            try {
                const { instance } = await WebAssembly.instantiate(bytes, {
                    env: { abort: () => { throw new Error('wasm abort'); } },
                });
                exports = instance.exports;
                log('instantiate 成功，导出函数: ' + Object.keys(exports).join(', '));
            } catch (e) {
                warn('instantiate 失败: ' + (e && e.message));
                return { ok: false, detail: 'instantiate 失败: ' + (e && e.message) };
            }

            // 检查必要导出
            const required = ['sign', 'obfuscateUser', '__new'];
            for (const fn of required) {
                if (typeof exports[fn] !== 'function') {
                    warn('缺少导出函数: ' + fn);
                    return { ok: false, detail: '缺少导出: ' + fn };
                }
            }
            log('必要导出函数检查通过: ' + required.join(', '));

            // 试算一次签名
            log('正在试算签名...');
            try {
                const testRaw = 'testUser:1234567890:/api/v2/match';
                const pRaw = exports.__pin ? exports.__pin(this._writeStr(exports, testRaw)) : this._writeStr(exports, testRaw);
                const pSig = exports.sign(pRaw);
                const sig = this._readStr(exports, pSig);
                if (exports.__unpin) exports.__unpin(pRaw);
                log('sign() 试算结果: ' + sig.substring(0, 20) + '...(长度' + sig.length + ')');
                if (!sig || sig.length < 10) {
                    warn('sign() 返回结果异常');
                    return { ok: false, detail: 'sign() 结果异常' };
                }
            } catch (e) {
                warn('sign() 调用异常: ' + (e && e.message));
                return { ok: false, detail: 'sign() 异常: ' + (e && e.message) };
            }

            // 试算一次用户混淆
            log('正在试算 obfuscateUser...');
            try {
                const testUid = 'test-user-id';
                const pUid = exports.__pin ? exports.__pin(this._writeStr(exports, testUid)) : this._writeStr(exports, testUid);
                const pObf = exports.obfuscateUser(pUid);
                const obf = this._readStr(exports, pObf);
                if (exports.__unpin) exports.__unpin(pUid);
                log('obfuscateUser() 试算结果: ' + obf.substring(0, 20) + '...(长度' + obf.length + ')');
            } catch (e) {
                warn('obfuscateUser() 调用异常: ' + (e && e.message));
                return { ok: false, detail: 'obfuscateUser() 异常: ' + (e && e.message) };
            }

            log('✅ 自检全部通过，wasm 工作正常');
            log('当前实例状态: _instance=' + (this._instance ? '已加载' : '未加载') + ' _failed=' + this._failed);
            return { ok: true, detail: 'wasm 工作正常' };
        },
    };
    // 方便在控制台直接调用：window.ddSign.selfTest()
    window.ddSign = ddSign;

    // ------  WASM 签名模块 end ------

    // ------ 自定义API签名验证 start ------
    // FIPS 180-4 标准的 SHA-256 算法的纯 JS 实现
    const sha256Pure = (() => {
        const K = [
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
        ];
        function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
        return function (data) {
            var bytes = new TextEncoder().encode(data);
            var bitLen = bytes.length * 8;
            var paddedLen = ((bytes.length + 9 + 63) >>> 6) << 6;
            var buf = new Uint8Array(paddedLen);
            buf.set(bytes);
            buf[bytes.length] = 0x80;
            var hi = Math.floor(bitLen / 0x100000000);
            var lo = bitLen >>> 0;
            var v = new DataView(buf.buffer, paddedLen - 8, 8);
            v.setUint32(0, hi, false);
            v.setUint32(4, lo, false);
            var w = new Uint32Array(64);
            var h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
            for (var off = 0; off < paddedLen; off += 64) {
                for (var i = 0; i < 16; i++) {
                    w[i] = (buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) | (buf[off + i * 4 + 2] << 8) | buf[off + i * 4 + 3];
                }
                for (var i = 16; i < 64; i++) {
                    var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                    var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
                }
                var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
                for (var i = 0; i < 64; i++) {
                    var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                    var ch = (e & f) ^ (~e & g);
                    var t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
                    var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                    var maj = (a & b) ^ (a & c) ^ (b & c);
                    var t2 = (S0 + maj) >>> 0;
                    hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
                }
                h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
                h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
            }
            var out = new Uint8Array(32);
            var dv = new DataView(out.buffer);
            for (var i = 0; i < 8; i++) dv.setUint32(i * 4, h[i], false);
            return out;
        };
    })();

    async function generateCustomApiSignature(appId, timestamp, path, appSecret) {
        var data = appId + timestamp + path + appSecret;
        var hashBuffer;
        // 优先使用 crypto.subtle，网站为 HTTP 时降级为纯 JS 的 SHA-256
        if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest) {
            try {
                var dataUint8 = new TextEncoder().encode(data);
                hashBuffer = await crypto.subtle.digest("SHA-256", dataUint8);
            } catch (_) { hashBuffer = sha256Pure(data); }
        } else { hashBuffer = sha256Pure(data); }
        var hashArray = Array.from(new Uint8Array(hashBuffer));
        return btoa(hashArray.map(function (b) { return String.fromCharCode(b); }).join(""));
    }

    async function buildCustomApiSignHeaders(appId, appSecret, url) {
        if (!appId || !appSecret) return {};
        try {
            var ts = Math.floor(Date.now() / 1000);
            var path = new URL(url).pathname;
            var sig = await generateCustomApiSignature(appId, ts, path, appSecret);
            var headers = { "X-AppId": appId, "X-Signature": sig, "X-Timestamp": String(ts) };
            return headers;
        } catch (e) {
            try { logger.warn("[签名] 自定义API签名计算失败,本次不带签名", e && e.message); } catch (_) {}
            return {};
        }
    }
    // ------ 自定义API签名验证 end ------

    // [优化] 页面卸载时清理资源
    window.addEventListener('beforeunload', () => {
        // localStorage 批量写入
        if (lsPendingWrites.size > 0) {
            logger.debug('[localStorage] 页面卸载，立即刷新待写入数据');
            lsFlushAllWrites();
        }

        // DOM 缓存清理
        domCache.clear();

        // 事件监听器清理
        eventManager.cleanup();
    });

})();