// ==UserScript==
// @name         Emby danmaku extension - Emby style
// @description  Emby弹幕插件 - Emby风格
// @namespace    https://github.com/l429609201/dd-danmaku
// @author       misaka10876, chen3861229
// @version      1.1.7
// @copyright    2024, misaka10876 (https://github.com/l429609201)
// @license      MIT; https://raw.githubusercontent.com/RyoLee/emby-danmaku/master/LICENSE
// @icon         https://github.githubassets.com/pinned-octocat.svg
// @grant        none
// @match        *://*/web/index.html
// @match        *://*/web/
// ==/UserScript==

(async function () {
    'use strict';
    // ------ 用户配置 start ------
    let requireDanmakuPath = 'https://danmaku.7o7o.cc/danmaku.min.js';
    // 跨域代理 cf_worker
    let corsProxy = 'https://danmu-api.misaka10876.top/cors/';
    // 用户代理标识
    let userAgent = 'misaka10876/v1.0.0';
    // ------ 用户配置 end ------
    // note01: 部分 AndroidTV 仅支持最高 ES9 (支持 webview 内核版本 60 以上)
    // note02: url 禁止使用相对路径,非 web 环境的根路径为文件路径,非 http
    // ------ 程序内部使用,请勿更改 start ------
    const openSourceLicense = {
        self: { version: '1.1.7', name: 'Emby Danmaku Extension (misaka10876 Fork)', license: 'MIT License', url: 'https://github.com/l429609201/dd-danmaku' },
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
            const custom = customList.length > 0 ? customList[0] : lsGetItem(lsKeys.customApiPrefix.id);
            if (custom && custom.length > 0 && !lsGetItem(lsKeys.useOfficialApi.id)) {
                return custom;
            }
            // 官方API强制走代理
            return corsProxy + 'https://api.dandanplay.net/api/v2';
        },
        getSearchEpisodes: (anime, episode) => `${dandanplayApi.prefix}/search/episodes?anime=${anime}${episode ? `&episode=${episode}` : ''}`,
        getComment: (episodeId, chConvert) => `${dandanplayApi.prefix}/comment/${episodeId}?withRelated=true&chConvert=${chConvert}`,
        getExtcomment: (url) => `${dandanplayApi.prefix}/extcomment?url=${encodeURI(url)}`,
        getBangumi: (animeId) => `${dandanplayApi.prefix}/bangumi/${animeId}`,
        posterImg: (animeId) => `https://img.dandanplay.net/anime/${animeId}.jpg`,
    };
    const dandanplayApiCustom = {
        get prefix() {
            // [修改] 支持多源：使用第一个自定义源
            const customList = typeof getCustomApiList === 'function' ? getCustomApiList() : [];
            const custom = customList.length > 0 ? customList[0] : lsGetItem(lsKeys.customApiPrefix.id);
            // 自定义API可以不走代理
            return custom && custom.length > 0 ? custom : dandanplayApi.prefix;
        },
        getMatchUrl: () => `${dandanplayApiCustom.prefix}/match`,
    }
    const bangumiApi = {
        prefix: 'https://api.bgm.tv/v0',
        accessTokenUrl: 'https://next.bgm.tv/demo/access-token',
        getCharacters: (subjectId) => `${bangumiApi.prefix}/subjects/${subjectId}/characters`,
        // need auth
        getMe: () => `${bangumiApi.prefix}/me`,
        getUserCollection: (userName, subjectId) => `${bangumiApi.prefix}/users/${userName}/collections/${subjectId}`,
        postUserCollection: (subjectId) => `${bangumiApi.prefix}/users/-/collections/${subjectId}`,
        getUserSubjectEpisodeCollection: (subjectId) => `${bangumiApi.prefix}/users/-/collections/${subjectId}/episodes?offset=0&limit=100`,
        putUserEpisodeCollection: (episodeId ) => `${bangumiApi.prefix}/users/-/collections/-/episodes/${episodeId}`,
    };
    const check_interval = 200;
    const LOAD_TYPE = {
        CHECK: 'check',
        INIT: 'init',
        REFRESH: 'refresh',
        RELOAD: 'reload', // 优先走缓存,其余类型走接口
        SEARCH: 'search',
    };
    let isVersionOld = false;
    // htmlVideoPlayerContainer
    let mediaContainerQueryStr = '.graphicContentContainer';
    const notHide = ':not(.hide)';
    const mediaQueryStr = 'video';

    // https://fonts.google.com/icons
    const iconKeys = {
        replay_30: 'replay_30',
        replay_10: 'replay_10',
        replay_5: 'replay_5',
        replay: 'replay',
        reset: 'repeat',
        forward_media: 'forward_media', // electron 中图标不正确,使用 replay 反转
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
        layers_clear: 'layers_clear',  // 防重叠图标
    };
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
        { id: tabIframeId, name: '内嵌网页', hidden: true, buildMethod: buildIframe },
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
        DanDanPlay: { id: 'DanDanPlay', name: '弹弹(DanDanPlay)' }, // 无弹幕来源的默认值
        D: { id: 'D', name: 'D' }, // 未知平台
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
        cid: { id: 'cid', name: '弹幕CID' }, // 非弹幕 id,唯一性需自行用 uid + cid 拼接的 cuid
    };
    const danmakuEngineOpts = [
        { id: 'canvas', name: 'canvas' },
        { id: 'dom', name: 'dom' },
    ];
    const danmakuChConverOpts = [
        { id: '0', name: '未启用' },
        { id: '1', name: '转换为简体' },
        { id: '2', name: '转换为繁体' },
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
        antiOverlap: { id: 'danmakuAntiOverlap', defaultValue: false, name: '防重叠' },
        filterLevel: { id: 'danmakuFilterLevel', defaultValue: 0, name: '过滤强度', min: 0, max: 3, step: 1 },
        heightPercent: { id: 'danmakuHeightPercent', defaultValue: 70, name: '显示区域', min: 3, max: 100, step: 1 },
        fontSizeRate: { id: 'danmakuFontSizeRate', defaultValue: 150, name: '弹幕大小', min: 10, max: 300, step: 10 },
        fontOpacity: { id: 'danmakuFontOpacity', defaultValue: 100, name: '透明度', min: 10, max: 100, step: 10 },
        speed: { id: 'danmakuBaseSpeed', defaultValue: 100, name: '速度', min: 10, max: 300, step: 10 },
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
        consoleLogEnable: { id: 'danmakuConsoleLogEnable', defaultValue: false, name: '控制台日志' },
        useFetchPluginXml: { id: 'danmakuUseFetchPluginXml', defaultValue: false, name: '加载媒体服务端xml弹幕' },
        // refreshPluginXml: { id: 'danmakuRefreshPluginXml', defaultValue: false, name: '加载前刷新媒体服务端xml弹幕' },
        useOfficialApi: { id: 'danmakuUseOfficialApi', defaultValue: true, name: '使用官方API' },
        useCustomApi: { id: 'danmakuUseCustomApi', defaultValue: false, name: '使用自定义API' },
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
        // [新增] 排除的媒体库列表（不加载弹幕）
        excludedLibraries: { id: 'danmakuExcludedLibraries', defaultValue: [], name: '排除的媒体库' },
    };
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
        bangumiSettingsDiv: 'bangumiSettingsDiv',
        bangumiTokenInput: 'bangumiTokenInput',
        bangumiTokenInputDiv: 'bangumiTokenInputDiv',
        bangumiTokenLabel: 'bangumiTokenInputLabel',
        bangumiTokenLinkDiv: 'bangumiTokenLinkDiv',
        bangumiPostPercentDiv: 'bangumiPostPercentDiv',
        customeUrlsDiv: 'customeUrlsDiv',
        customeCorsProxyDiv: 'customeCorsProxyDiv',
        customeDanmakuDiv: 'customeDanmakuDiv',
        customeGetCommentDiv: 'customeGetCommentDiv',
        customeGetExtcommentDiv: 'customeGetExtcommentDiv',
        customePosterImgDiv: 'customePosterImgDiv',
        consoleLogCtrl: 'consoleLogCtrl',
        consoleLogInfo: 'consoleLogInfo',
        consoleLogText: 'consoleLogText',
        consoleLogTextInput: 'consoleLogTextInput',
        consoleLogCountLabel: 'consoleLogCountLabel',
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
        danmuPluginDiv: 'danmuPluginDiv',
        danmakuSettingBtnDebug: 'danmakuSettingBtnDebug',
        progressBarLineChart: 'progressBarLineChart',
        antiOverlapBtn: 'antiOverlapBtn',
        antiOverlapDiv: 'antiOverlapDiv',
        // [新增] 媒体库排除设置
        excludedLibrariesDiv: 'excludedLibrariesDiv',
        excludedLibrariesInput: 'excludedLibrariesInput',
        currentLibraryInfo: 'currentLibraryInfo',
    };
    // 播放界面下方按钮
    const mediaBtnOpts = [
        { id: eleIds.danmakuSwitchBtn, label: '弹幕开关', iconKey: iconKeys.comment, onClick: doDanmakuSwitch },
        { label: '弹幕设置', iconKey: iconKeys.setting, onClick: createDialog },
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
                dandanplayApi.getComment = (episodeId, chConvert) => eval('`' + tl + '`');
            }, msg1: customeUrlMsg1, msg2: '变量: { episodeId: 章节 ID, chConvert: 简繁转换, }' },
            { divId: eleIds.customeGetExtcommentDiv, lsKey: lsKeys.customeGetExtcommentUrl, rewrite: (tl) => {
                dandanplayApi.getExtcomment = (url) => eval('`' + tl + '`');
            }, msg1: customeUrlMsg1, msg2: '变量: { url: 附加弹幕输入框中的网址, }' },
            { divId: eleIds.customePosterImgDiv, lsKey: lsKeys.customePosterImgUrl, rewrite: (tl) => {
                dandanplayApi.posterImg = (animeId) => eval('`' + tl + '`');
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
    const OS = {
        isAndroid: () => /android/i.test(navigator.userAgent),
        isIOS: () => /iPad|iPhone|iPod/i.test(navigator.userAgent),
        isMacOS: () => /Macintosh|MacIntel/i.test(navigator.userAgent),
        isApple: () => OS.isMacOS() || OS.isIOS(),
        isWindows: () => /compatible|Windows/i.test(navigator.userAgent),
        isMobile: () => OS.isAndroid() || OS.isIOS(),
        isUbuntu: () => /Ubuntu/i.test(navigator.userAgent),
        isAndroidEmbyNoisyX: () => OS.isAndroid() && ApiClient.appVersion().includes('-'),
        isEmbyNoisyX: () => ApiClient.appVersion().includes('-'),
        isOthers: () => objectEntries(OS).filter(([key, val]) => key !== 'isOthers').every(([key, val]) => !val()),
    };
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}]/gu;

    // ------ 程序内部使用,请勿更改 end ------

    // ------ require start ------
    let skipInnerModule = false;
    try {
        throw new Error();
    } catch(e) {
        skipInnerModule = e.stack && e.stack.includes('CustomCssJS');
        // console.log('ignore this not error, callee:', e);
    }
    if (!skipInnerModule) {
        // 这里内置依赖是工作在浏览器油猴和服务端 index.html 环境下, requireDanmakuPath 是特殊环境 CustomCssJS 下网络加载使用
        /* https://cdn.jsdelivr.net/npm/danmaku@2.0.8/dist/danmaku.min.js */
        /* eslint-disable */
        // prettier-ignore
        // 注意: 原版使用 this 作为全局对象，但在严格模式下 this 为 undefined，改用 window 确保兼容性
        !function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t="undefined"!=typeof globalThis?globalThis:t||self).Danmaku=e()}(window,(function(){"use strict";var t=function(){if("undefined"==typeof document)return"transform";for(var t=["oTransform","msTransform","mozTransform","webkitTransform","transform"],e=document.createElement("div").style,i=0;i<t.length;i++)if(t[i]in e)return t[i];return"transform"}();function e(t){var e=document.createElement("div");if(e.style.cssText="position:absolute;","function"==typeof t.render){var i=t.render();if(i instanceof HTMLElement)return e.appendChild(i),e}if(e.textContent=t.text,t.style)for(var n in t.style)e.style[n]=t.style[n];return e}var i={name:"dom",init:function(){var t=document.createElement("div");return t.style.cssText="overflow:hidden;white-space:nowrap;transform:translateZ(0);",t},clear:function(t){for(var e=t.lastChild;e;)t.removeChild(e),e=t.lastChild},resize:function(t,e,i){t.style.width=e+"px",t.style.height=i+"px"},framing:function(){},setup:function(t,i){var n=document.createDocumentFragment(),s=0,r=null;for(s=0;s<i.length;s++)(r=i[s]).node=r.node||e(r),n.appendChild(r.node);for(i.length&&t.appendChild(n),s=0;s<i.length;s++)(r=i[s]).width=r.width||r.node.offsetWidth,r.height=r.height||r.node.offsetHeight},render:function(e,i){i.node.style[t]="translate("+i.x+"px,"+i.y+"px)"},remove:function(t,e){t.removeChild(e.node),this.media||(e.node=null)}},n="undefined"!=typeof window&&window.devicePixelRatio||1,s=Object.create(null);function r(t,e){if("function"==typeof t.render){var i=t.render();if(i instanceof HTMLCanvasElement)return t.width=i.width,t.height=i.height,i}var r=document.createElement("canvas"),h=r.getContext("2d"),o=t.style||{};o.font=o.font||"10px sans-serif",o.textBaseline=o.textBaseline||"bottom";var a=1*o.lineWidth;for(var d in a=a>0&&a!==1/0?Math.ceil(a):1*!!o.strokeStyle,h.font=o.font,t.width=t.width||Math.max(1,Math.ceil(h.measureText(t.text).width)+2*a),t.height=t.height||Math.ceil(function(t,e){if(s[t])return s[t];var i=12,n=t.match(/(\d+(?:\.\d+)?)(px|%|em|rem)(?:\s*\/\s*(\d+(?:\.\d+)?)(px|%|em|rem)?)?/);if(n){var r=1*n[1]||10,h=n[2],o=1*n[3]||1.2,a=n[4];"%"===h&&(r*=e.container/100),"em"===h&&(r*=e.container),"rem"===h&&(r*=e.root),"px"===a&&(i=o),"%"===a&&(i=r*o/100),"em"===a&&(i=r*o),"rem"===a&&(i=e.root*o),void 0===a&&(i=r*o)}return s[t]=i,i}(o.font,e))+2*a,r.width=t.width*n,r.height=t.height*n,h.scale(n,n),o)h[d]=o[d];var u=0;switch(o.textBaseline){case"top":case"hanging":u=a;break;case"middle":u=t.height>>1;break;default:u=t.height-a}return o.strokeStyle&&h.strokeText(t.text,a,u),h.fillText(t.text,a,u),r}function h(t){return 1*window.getComputedStyle(t,null).getPropertyValue("font-size").match(/(.+)px/)[1]}var o={name:"canvas",init:function(t){var e=document.createElement("canvas");return e.context=e.getContext("2d"),e._fontSize={root:h(document.getElementsByTagName("html")[0]),container:h(t)},e},clear:function(t,e){t.context.clearRect(0,0,t.width,t.height);for(var i=0;i<e.length;i++)e[i].canvas=null},resize:function(t,e,i){t.width=e*n,t.height=i*n,t.style.width=e+"px",t.style.height=i+"px"},framing:function(t){t.context.clearRect(0,0,t.width,t.height)},setup:function(t,e){for(var i=0;i<e.length;i++){var n=e[i];n.canvas=r(n,t._fontSize)}},render:function(t,e){t.context.drawImage(e.canvas,e.x*n,e.y*n)},remove:function(t,e){e.canvas=null}},a=("undefined"!=typeof window&&(window.requestAnimationFrame||window.mozRequestAnimationFrame||window.webkitRequestAnimationFrame)||function(t){return setTimeout(t,50/3)}).bind(window),d=("undefined"!=typeof window&&(window.cancelAnimationFrame||window.mozCancelAnimationFrame||window.webkitCancelAnimationFrame)||clearTimeout).bind(window);function u(t,e,i){for(var n=0,s=0,r=t.length;s<r-1;)i>=t[n=s+r>>1][e]?s=n:r=n;return t[s]&&i<t[s][e]?s:r}function m(t){return/^(ltr|top|bottom)$/i.test(t)?t.toLowerCase():"rtl"}function c(){var t=9007199254740991;return[{range:0,time:-t,width:t,height:0},{range:t,time:t,width:0,height:0}]}function l(t){t.ltr=c(),t.rtl=c(),t.top=c(),t.bottom=c()}function f(){return void 0!==window.performance&&window.performance.now?window.performance.now():Date.now()}function p(t){var e=this,i=this.media?this.media.currentTime:f()/1e3,n=this.media?this.media.playbackRate:1;function s(t,s){if("top"===s.mode||"bottom"===s.mode)return i-t.time<e._.duration;var r=(e._.width+t.width)*(i-t.time)*n/e._.duration;if(t.width>r)return!0;var h=e._.duration+t.time-i,o=e._.width+s.width,a=e.media?s.time:s._utc,d=o*(i-a)*n/e._.duration,u=e._.width-d;return h>e._.duration*u/(e._.width+s.width)}for(var r=this._.space[t.mode],h=0,o=0,a=1;a<r.length;a++){var d=r[a],u=t.height;if("top"!==t.mode&&"bottom"!==t.mode||(u+=d.height),d.range-d.height-r[h].range>=u){o=a;break}s(d,t)&&(h=a)}var m=r[h].range,c={range:m+t.height,time:this.media?t.time:t._utc,width:t.width,height:t.height};return r.splice(h+1,o-h-1,c),"bottom"===t.mode?this._.height-t.height-m%this._.height:m%(this._.height-t.height)}function g(){if(!this._.visible||!this._.paused)return this;if(this._.paused=!1,this.media)for(var t=0;t<this._.runningList.length;t++){var e=this._.runningList[t];e._utc=f()/1e3-(this.media.currentTime-e.time)}var i=this,n=function(t,e,i,n){return function(s){t(this._.stage);var r=(s||f())/1e3,h=this.media?this.media.currentTime:r,o=this.media?this.media.playbackRate:1,a=null,d=0,u=0;for(u=this._.runningList.length-1;u>=0;u--)a=this._.runningList[u],h-(d=this.media?a.time:a._utc)>this._.duration&&(n(this._.stage,a),this._.runningList.splice(u,1));for(var m=[];this._.position<this.comments.length&&(a=this.comments[this._.position],!((d=this.media?a.time:a._utc)>=h));)h-d>this._.duration||(this.media&&(a._utc=r-(this.media.currentTime-a.time)),m.push(a)),++this._.position;for(e(this._.stage,m),u=0;u<m.length;u++)(a=m[u]).y=p.call(this,a),this._.runningList.push(a);for(u=0;u<this._.runningList.length;u++){a=this._.runningList[u];var c=(this._.width+a.width)*(r-a._utc)*o/this._.duration;"ltr"===a.mode&&(a.x=c-a.width),"rtl"===a.mode&&(a.x=this._.width-c),"top"!==a.mode&&"bottom"!==a.mode||(a.x=this._.width-a.width>>1),i(this._.stage,a)}}}(this._.engine.framing.bind(this),this._.engine.setup.bind(this),this._.engine.render.bind(this),this._.engine.remove.bind(this));return this._.requestID=a((function t(e){n.call(i,e),i._.requestID=a(t)})),this}function _(){return!this._.visible||this._.paused||(this._.paused=!0,d(this._.requestID),this._.requestID=0),this}function v(){if(!this.media)return this;this.clear(),l(this._.space);var t=u(this.comments,"time",this.media.currentTime);return this._.position=Math.max(0,t-1),this}function w(t){t.play=g.bind(this),t.pause=_.bind(this),t.seeking=v.bind(this),this.media.addEventListener("play",t.play),this.media.addEventListener("pause",t.pause),this.media.addEventListener("playing",t.play),this.media.addEventListener("waiting",t.pause),this.media.addEventListener("seeking",t.seeking)}function y(t){this.media.removeEventListener("play",t.play),this.media.removeEventListener("pause",t.pause),this.media.removeEventListener("playing",t.play),this.media.removeEventListener("waiting",t.pause),this.media.removeEventListener("seeking",t.seeking),t.play=null,t.pause=null,t.seeking=null}function x(t){this._={},this.container=t.container||document.createElement("div"),this.media=t.media,this._.visible=!0,this.engine=(t.engine||"DOM").toLowerCase(),this._.engine="canvas"===this.engine?o:i,this._.requestID=0,this._.speed=Math.max(0,t.speed)||144,this._.duration=4,this.comments=t.comments||[],this.comments.sort((function(t,e){return t.time-e.time}));for(var e=0;e<this.comments.length;e++)this.comments[e].mode=m(this.comments[e].mode);return this._.runningList=[],this._.position=0,this._.paused=!0,this.media&&(this._.listener={},w.call(this,this._.listener)),this._.stage=this._.engine.init(this.container),this._.stage.style.cssText+="position:relative;pointer-events:none;",this.resize(),this.container.appendChild(this._.stage),this._.space={},l(this._.space),this.media&&this.media.paused||(v.call(this),g.call(this)),this}function b(){if(!this.container)return this;for(var t in _.call(this),this.clear(),this.container.removeChild(this._.stage),this.media&&y.call(this,this._.listener),this)Object.prototype.hasOwnProperty.call(this,t)&&(this[t]=null);return this}var L=["mode","time","text","render","style"];function T(t){if(!t||"[object Object]"!==Object.prototype.toString.call(t))return this;for(var e={},i=0;i<L.length;i++)void 0!==t[L[i]]&&(e[L[i]]=t[L[i]]);if(e.text=(e.text||"").toString(),e.mode=m(e.mode),e._utc=f()/1e3,this.media){var n=0;void 0===e.time?(e.time=this.media.currentTime,n=this._.position):(n=u(this.comments,"time",e.time))<this._.position&&(this._.position+=1),this.comments.splice(n,0,e)}else this.comments.push(e);return this}function E(){return this._.visible?this:(this._.visible=!0,this.media&&this.media.paused||(v.call(this),g.call(this)),this)}function k(){return this._.visible?(_.call(this),this.clear(),this._.visible=!1,this):this}function C(){return this._.engine.clear(this._.stage,this._.runningList),this._.runningList=[],this}function z(){return this._.width=this.container.offsetWidth,this._.height=this.container.offsetHeight,this._.engine.resize(this._.stage,this._.width,this._.height),this._.duration=this._.width/this._.speed,this}var D={get:function(){return this._.speed},set:function(t){return"number"!=typeof t||isNaN(t)||!isFinite(t)||t<=0?this._.speed:(this._.speed=t,this._.width&&(this._.duration=this._.width/t),t)}};function M(t){t&&x.call(this,t)}return M.prototype.destroy=function(){return b.call(this)},M.prototype.emit=function(t){return T.call(this,t)},M.prototype.show=function(){return E.call(this)},M.prototype.hide=function(){return k.call(this)},M.prototype.clear=function(){return C.call(this)},M.prototype.resize=function(){return z.call(this)},Object.defineProperty(M.prototype,"speed",D),M}));
        /* eslint-enable */
    } else {
        window.Danmaku || Emby.importModule(requireDanmakuPath).then(f => {
            console.log(f);
            window.Danmaku = f;
        }).catch(error => {
            console.error(`fail Emby.importModule error:`, error);
        });
    }
    // ------ require end ------
    // ================== Worker 核心定义开始 ==================
    // 1. 通用 Worker 创建器
    function createWorker(workerFunction) {
        const dataObj = `(${workerFunction})();`;
        const blob = new Blob([dataObj], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);
        // 创建完实例后，URL 就可以释放了，不影响 worker 运行
        URL.revokeObjectURL(workerUrl); 
        return worker;
    }

    // 2. MD5 Worker (使用真正的 SparkMD5 库计算文件哈希)
    const md5WorkerBody = function() {
        /*
     * A JavaScript implementation of the RSA Data Security, Inc. MD5 Message
     * Digest Algorithm, as defined in RFC 1321.
     * Version 2.2 Copyright (C) Paul Johnston 1999 - 2009
     * Other contributors: Greg Holt, Andrew Kepert, Ydnar, Lostinet
     * Distributed under the BSD License
     * See http://pajhome.org.uk/crypt/md5 for more info.
     */
        // SparkMD5 库 - 真正的 MD5 实现 (v3.0.2)
        // https://github.com/nicmart/SparkMD5
        (function(factory){if(typeof exports==="object"){module.exports=factory()}else if(typeof define==="function"&&define.amd){define(factory)}else{var glob;try{glob=window}catch(e){glob=self}glob.SparkMD5=factory()}})(function(undefined){"use strict";var add32=function(a,b){return a+b&4294967295},hex_chr=["0","1","2","3","4","5","6","7","8","9","a","b","c","d","e","f"];function cmn(q,a,b,x,s,t){a=add32(add32(a,q),add32(x,t));return add32(a<<s|a>>>32-s,b)}function md5cycle(x,k){var a=x[0],b=x[1],c=x[2],d=x[3];a+=(b&c|~b&d)+k[0]-680876936|0;a=(a<<7|a>>>25)+b|0;d+=(a&b|~a&c)+k[1]-389564586|0;d=(d<<12|d>>>20)+a|0;c+=(d&a|~d&b)+k[2]+606105819|0;c=(c<<17|c>>>15)+d|0;b+=(c&d|~c&a)+k[3]-1044525330|0;b=(b<<22|b>>>10)+c|0;a+=(b&c|~b&d)+k[4]-176418897|0;a=(a<<7|a>>>25)+b|0;d+=(a&b|~a&c)+k[5]+1200080426|0;d=(d<<12|d>>>20)+a|0;c+=(d&a|~d&b)+k[6]-1473231341|0;c=(c<<17|c>>>15)+d|0;b+=(c&d|~c&a)+k[7]-45705983|0;b=(b<<22|b>>>10)+c|0;a+=(b&c|~b&d)+k[8]+1770035416|0;a=(a<<7|a>>>25)+b|0;d+=(a&b|~a&c)+k[9]-1958414417|0;d=(d<<12|d>>>20)+a|0;c+=(d&a|~d&b)+k[10]-42063|0;c=(c<<17|c>>>15)+d|0;b+=(c&d|~c&a)+k[11]-1990404162|0;b=(b<<22|b>>>10)+c|0;a+=(b&c|~b&d)+k[12]+1804603682|0;a=(a<<7|a>>>25)+b|0;d+=(a&b|~a&c)+k[13]-40341101|0;d=(d<<12|d>>>20)+a|0;c+=(d&a|~d&b)+k[14]-1502002290|0;c=(c<<17|c>>>15)+d|0;b+=(c&d|~c&a)+k[15]+1236535329|0;b=(b<<22|b>>>10)+c|0;a+=(b&d|c&~d)+k[1]-165796510|0;a=(a<<5|a>>>27)+b|0;d+=(a&c|b&~c)+k[6]-1069501632|0;d=(d<<9|d>>>23)+a|0;c+=(d&b|a&~b)+k[11]+643717713|0;c=(c<<14|c>>>18)+d|0;b+=(c&a|d&~a)+k[0]-373897302|0;b=(b<<20|b>>>12)+c|0;a+=(b&d|c&~d)+k[5]-701558691|0;a=(a<<5|a>>>27)+b|0;d+=(a&c|b&~c)+k[10]+38016083|0;d=(d<<9|d>>>23)+a|0;c+=(d&b|a&~b)+k[15]-660478335|0;c=(c<<14|c>>>18)+d|0;b+=(c&a|d&~a)+k[4]-405537848|0;b=(b<<20|b>>>12)+c|0;a+=(b&d|c&~d)+k[9]+568446438|0;a=(a<<5|a>>>27)+b|0;d+=(a&c|b&~c)+k[14]-1019803690|0;d=(d<<9|d>>>23)+a|0;c+=(d&b|a&~b)+k[3]-187363961|0;c=(c<<14|c>>>18)+d|0;b+=(c&a|d&~a)+k[8]+1163531501|0;b=(b<<20|b>>>12)+c|0;a+=(b&d|c&~d)+k[13]-1444681467|0;a=(a<<5|a>>>27)+b|0;d+=(a&c|b&~c)+k[2]-51403784|0;d=(d<<9|d>>>23)+a|0;c+=(d&b|a&~b)+k[7]+1735328473|0;c=(c<<14|c>>>18)+d|0;b+=(c&a|d&~a)+k[12]-1926607734|0;b=(b<<20|b>>>12)+c|0;a+=(b^c^d)+k[5]-378558|0;a=(a<<4|a>>>28)+b|0;d+=(a^b^c)+k[8]-2022574463|0;d=(d<<11|d>>>21)+a|0;c+=(d^a^b)+k[11]+1839030562|0;c=(c<<16|c>>>16)+d|0;b+=(c^d^a)+k[14]-35309556|0;b=(b<<23|b>>>9)+c|0;a+=(b^c^d)+k[1]-1530992060|0;a=(a<<4|a>>>28)+b|0;d+=(a^b^c)+k[4]+1272893353|0;d=(d<<11|d>>>21)+a|0;c+=(d^a^b)+k[7]-155497632|0;c=(c<<16|c>>>16)+d|0;b+=(c^d^a)+k[10]-1094730640|0;b=(b<<23|b>>>9)+c|0;a+=(b^c^d)+k[13]+681279174|0;a=(a<<4|a>>>28)+b|0;d+=(a^b^c)+k[0]-358537222|0;d=(d<<11|d>>>21)+a|0;c+=(d^a^b)+k[3]-722521979|0;c=(c<<16|c>>>16)+d|0;b+=(c^d^a)+k[6]+76029189|0;b=(b<<23|b>>>9)+c|0;a+=(b^c^d)+k[9]-640364487|0;a=(a<<4|a>>>28)+b|0;d+=(a^b^c)+k[12]-421815835|0;d=(d<<11|d>>>21)+a|0;c+=(d^a^b)+k[15]+530742520|0;c=(c<<16|c>>>16)+d|0;b+=(c^d^a)+k[2]-995338651|0;b=(b<<23|b>>>9)+c|0;a+=(c^(b|~d))+k[0]-198630844|0;a=(a<<6|a>>>26)+b|0;d+=(b^(a|~c))+k[7]+1126891415|0;d=(d<<10|d>>>22)+a|0;c+=(a^(d|~b))+k[14]-1416354905|0;c=(c<<15|c>>>17)+d|0;b+=(d^(c|~a))+k[5]-57434055|0;b=(b<<21|b>>>11)+c|0;a+=(c^(b|~d))+k[12]+1700485571|0;a=(a<<6|a>>>26)+b|0;d+=(b^(a|~c))+k[3]-1894986606|0;d=(d<<10|d>>>22)+a|0;c+=(a^(d|~b))+k[10]-1051523|0;c=(c<<15|c>>>17)+d|0;b+=(d^(c|~a))+k[1]-2054922799|0;b=(b<<21|b>>>11)+c|0;a+=(c^(b|~d))+k[8]+1873313359|0;a=(a<<6|a>>>26)+b|0;d+=(b^(a|~c))+k[15]-30611744|0;d=(d<<10|d>>>22)+a|0;c+=(a^(d|~b))+k[6]-1560198380|0;c=(c<<15|c>>>17)+d|0;b+=(d^(c|~a))+k[13]+1309151649|0;b=(b<<21|b>>>11)+c|0;a+=(c^(b|~d))+k[4]-145523070|0;a=(a<<6|a>>>26)+b|0;d+=(b^(a|~c))+k[11]-1120210379|0;d=(d<<10|d>>>22)+a|0;c+=(a^(d|~b))+k[2]+718787259|0;c=(c<<15|c>>>17)+d|0;b+=(d^(c|~a))+k[9]-343485551|0;b=(b<<21|b>>>11)+c|0;x[0]=a+x[0]|0;x[1]=b+x[1]|0;x[2]=c+x[2]|0;x[3]=d+x[3]|0}function md5blk(s){var md5blks=[],i;for(i=0;i<64;i+=4){md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24)}return md5blks}function md5blk_array(a){var md5blks=[],i;for(i=0;i<64;i+=4){md5blks[i>>2]=a[i]+(a[i+1]<<8)+(a[i+2]<<16)+(a[i+3]<<24)}return md5blks}function md51(s){var n=s.length,state=[1732584193,-271733879,-1732584194,271733878],i,length,tail,tmp,lo,hi;for(i=64;i<=n;i+=64){md5cycle(state,md5blk(s.substring(i-64,i)))}s=s.substring(i-64);length=s.length;tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];for(i=0;i<length;i+=1){tail[i>>2]|=s.charCodeAt(i)<<(i%4<<3)}tail[i>>2]|=128<<(i%4<<3);if(i>55){md5cycle(state,tail);for(i=0;i<16;i+=1){tail[i]=0}}tmp=n*8;tmp=tmp.toString(16).match(/(.*?)(.{0,8})$/);lo=parseInt(tmp[2],16);hi=parseInt(tmp[1],16)||0;tail[14]=lo;tail[15]=hi;md5cycle(state,tail);return state}function md51_array(a){var n=a.length,state=[1732584193,-271733879,-1732584194,271733878],i,length,tail,tmp,lo,hi;for(i=64;i<=n;i+=64){md5cycle(state,md5blk_array(a.subarray(i-64,i)))}a=i-64<n?a.subarray(i-64):new Uint8Array(0);length=a.length;tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];for(i=0;i<length;i+=1){tail[i>>2]|=a[i]<<(i%4<<3)}tail[i>>2]|=128<<(i%4<<3);if(i>55){md5cycle(state,tail);for(i=0;i<16;i+=1){tail[i]=0}}tmp=n*8;tmp=tmp.toString(16).match(/(.*?)(.{0,8})$/);lo=parseInt(tmp[2],16);hi=parseInt(tmp[1],16)||0;tail[14]=lo;tail[15]=hi;md5cycle(state,tail);return state}function rhex(n){var s="",j;for(j=0;j<4;j+=1){s+=hex_chr[n>>j*8+4&15]+hex_chr[n>>j*8&15]}return s}function hex(x){var i;for(i=0;i<x.length;i+=1){x[i]=rhex(x[i])}return x.join("")}if(hex(md51("hello"))!=="5d41402abc4b2a76b9719d911017c592"){add32=function(x,y){var lsw=(x&65535)+(y&65535),msw=(x>>16)+(y>>16)+(lsw>>16);return msw<<16|lsw&65535}}if(typeof ArrayBuffer!=="undefined"&&!ArrayBuffer.prototype.slice){(function(){function clamp(val,length){val=val|0||0;if(val<0){return Math.max(val+length,0)}return Math.min(val,length)}ArrayBuffer.prototype.slice=function(from,to){var length=this.byteLength,begin=clamp(from,length),end=length,num,target,targetArray,sourceArray;if(to!==undefined){end=clamp(to,length)}if(begin>end){return new ArrayBuffer(0)}num=end-begin;target=new ArrayBuffer(num);targetArray=new Uint8Array(target);sourceArray=new Uint8Array(this,begin,num);targetArray.set(sourceArray);return target}})()}function toUtf8(str){if(/[\u0080-\uFFFF]/.test(str)){str=unescape(encodeURIComponent(str))}return str}function utf8Str2ArrayBuffer(str,returnUInt8Array){var length=str.length,buff=new ArrayBuffer(length),arr=new Uint8Array(buff),i;for(i=0;i<length;i+=1){arr[i]=str.charCodeAt(i)}return returnUInt8Array?arr:buff}function arrayBuffer2Utf8Str(buff){return String.fromCharCode.apply(null,new Uint8Array(buff))}function concatenateArrayBuffers(first,second,returnUInt8Array){var result=new Uint8Array(first.byteLength+second.byteLength);result.set(new Uint8Array(first));result.set(new Uint8Array(second),first.byteLength);return returnUInt8Array?result:result.buffer}function hexToBinaryString(hex){var bytes=[],length=hex.length,x;for(x=0;x<length-1;x+=2){bytes.push(parseInt(hex.substr(x,2),16))}return String.fromCharCode.apply(String,bytes)}function SparkMD5(){this.reset()}SparkMD5.prototype.append=function(str){this.appendBinary(toUtf8(str));return this};SparkMD5.prototype.appendBinary=function(contents){this._buff+=contents;this._length+=contents.length;var length=this._buff.length,i;for(i=64;i<=length;i+=64){md5cycle(this._hash,md5blk(this._buff.substring(i-64,i)))}this._buff=this._buff.substring(i-64);return this};SparkMD5.prototype.end=function(raw){var buff=this._buff,length=buff.length,i,tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],ret;for(i=0;i<length;i+=1){tail[i>>2]|=buff.charCodeAt(i)<<(i%4<<3)}this._finish(tail,length);ret=hex(this._hash);if(raw){ret=hexToBinaryString(ret)}this.reset();return ret};SparkMD5.prototype.reset=function(){this._buff="";this._length=0;this._hash=[1732584193,-271733879,-1732584194,271733878];return this};SparkMD5.prototype.getState=function(){return{buff:this._buff,length:this._length,hash:this._hash.slice()}};SparkMD5.prototype.setState=function(state){this._buff=state.buff;this._length=state.length;this._hash=state.hash;return this};SparkMD5.prototype.destroy=function(){delete this._hash;delete this._buff;delete this._length};SparkMD5.prototype._finish=function(tail,length){var i=length,tmp,lo,hi;tail[i>>2]|=128<<(i%4<<3);if(i>55){md5cycle(this._hash,tail);for(i=0;i<16;i+=1){tail[i]=0}}tmp=this._length*8;tmp=tmp.toString(16).match(/(.*?)(.{0,8})$/);lo=parseInt(tmp[2],16);hi=parseInt(tmp[1],16)||0;tail[14]=lo;tail[15]=hi;md5cycle(this._hash,tail)};SparkMD5.hash=function(str,raw){return SparkMD5.hashBinary(toUtf8(str),raw)};SparkMD5.hashBinary=function(content,raw){var hash=md51(content),ret=hex(hash);return raw?hexToBinaryString(ret):ret};SparkMD5.ArrayBuffer=function(){this.reset()};SparkMD5.ArrayBuffer.prototype.append=function(arr){var buff=concatenateArrayBuffers(this._buff.buffer,arr,true),length=buff.length,i;this._length+=arr.byteLength;for(i=64;i<=length;i+=64){md5cycle(this._hash,md5blk_array(buff.subarray(i-64,i)))}this._buff=i-64<length?new Uint8Array(buff.buffer.slice(i-64)):new Uint8Array(0);return this};SparkMD5.ArrayBuffer.prototype.end=function(raw){var buff=this._buff,length=buff.length,tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],i,ret;for(i=0;i<length;i+=1){tail[i>>2]|=buff[i]<<(i%4<<3)}this._finish(tail,length);ret=hex(this._hash);if(raw){ret=hexToBinaryString(ret)}this.reset();return ret};SparkMD5.ArrayBuffer.prototype.reset=function(){this._buff=new Uint8Array(0);this._length=0;this._hash=[1732584193,-271733879,-1732584194,271733878];return this};SparkMD5.ArrayBuffer.prototype.getState=function(){var state=SparkMD5.prototype.getState.call(this);state.buff=arrayBuffer2Utf8Str(state.buff);return state};SparkMD5.ArrayBuffer.prototype.setState=function(state){state.buff=utf8Str2ArrayBuffer(state.buff,true);return SparkMD5.prototype.setState.call(this,state)};SparkMD5.ArrayBuffer.prototype.destroy=SparkMD5.prototype.destroy;SparkMD5.ArrayBuffer.prototype._finish=SparkMD5.prototype._finish;SparkMD5.ArrayBuffer.hash=function(arr,raw){var hash=md51_array(new Uint8Array(arr)),ret=hex(hash);return raw?hexToBinaryString(ret):ret};return SparkMD5});


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
                // 注意这里取的是 root.t (text) 和 root.m (time)
                const rootText = root.t;
                const rootLen = rootText.length;
                let count = 1;

                for (let j = i + 1; j < totalLen; j++) {
                    if (mergedIndices.has(j)) continue;
                    const compare = lightComments[j];
                    if ((compare.m - root.m) > timeWindow) break;

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
            this.asymmetricAuthEnabled = false;
            this.publicKeyPem = null;   // 客户端公钥（用于验证Worker签名）
            this.abortControllers = new Set();  // 全局请求控制器集合 (用于组件销毁时取消所有网络请求)
        }
    }

    class AppLogAspect {
        constructor() {
            this.initialized = false;
            this.originalError = console.error;
            this.originalWarn = console.warn;
            this.originalLog = console.log;
            this.originalOnerror = null;
            this.value = '';
            this.listeners = [];
            this.ERROR = { text: 'ERROR', emoji: '❗️' };
            this.WARN = { text: 'WARN', emoji: '⚠️' };
            this.INFO = { text: 'INFO', emoji: '❕' };
        }
        init() {
            if (this.initialized) { return this; }
            console.error = (...args) => {
                this.originalError.apply(console, args);
                this.value += this.format(this.ERROR, args);
                this.notifyListeners();
            };
            console.warn = (...args) => {
                this.originalWarn.apply(console, args);
                this.value += this.format(this.WARN, args);
                this.notifyListeners();
            };
            console.log = (...args) => {
                this.originalLog.apply(console, args);
                this.value += this.format(this.INFO, args);
                this.notifyListeners();
            };
            this.originalOnerror = window.onerror;
            window.onerror = (...args) => {
                console.error(args);
                if (typeof this.originalOnerror === 'function') {
                    this.originalOnerror(...args);
                }
            };
            this.initialized = true;
            return this;
        }
        destroy(clearValue = true) {
            if (this.initialized) {
                console.error = this.originalError;
                console.warn = this.originalWarn;
                console.log = this.originalLog;
                window.onerror = this.originalOnerror;
                clearValue && (this.value = '');
                this.listeners = [];
                this.initialized = false;
            }
            return this;
        }
        format(level, args) {
            const emoji = level.emoji ? `[${level.emoji}] ` : '';
            return `[${new Date(Date.now()).toLocaleString()}] [${level.text}] ${emoji}: `
                + args.map(arg => arg instanceof Error ? arg.message : (typeof arg === 'string' ? arg : JSON.stringify(arg)))
                .join(' ') + '\n';
        }
        on(valueChangedCallback) {
            if (valueChangedCallback.toString().includes('console.log')
                || valueChangedCallback.toString().includes('console.error')) {
                throw new Error('The callback function must not contain console.log or console.error to avoid infinite loops.');
            }
            this.listeners.push(() => valueChangedCallback(this.value));
        }
        notifyListeners() { this.listeners.forEach(listener => listener()); }
        clearValue() { this.value = ''; this.notifyListeners(); }
    }

    function initListener() {
        const _media = document.querySelector(mediaQueryStr);
        // 页面未加载
        if (!_media) {
            window.ede.episode_info && (window.ede.episode_info = null);
            return;
        }
        if (_media.getAttribute('ede_listening')) { return; }
        console.log('正在初始化事件监听器 (Listener)');
        playbackEventsRefresh({ 'playbackstart': onPlaybackStart });
        playbackEventsRefresh({ 'playbackstop': onPlaybackStop });
        _media.setAttribute('ede_listening', true);
        refreshEventListener({ 'video-osd-show': onVideoOsdShow });
        refreshEventListener({ 'video-osd-hide': onVideoOsdHide });
        console.log('事件监听器 (Listener) 初始化完成');
        if (OS.isAndroidEmbyNoisyX()) {
            console.log('检测为安卓魔改版客户端，首次播放可能不触发 playbackstart 事件，在此手动初始化弹幕环境');
            loadDanmaku(LOAD_TYPE.INIT);
        }
    }

    function onPlaybackStart(e, state) {
        console.log('监听到事件: 播放开始 (playbackstart)');
        loadDanmaku(LOAD_TYPE.INIT);
    }

    function onPlaybackStop(e, state) {
        console.log('监听到事件: 播放停止 (playbackstop)');
        onPlaybackStopPct(e, state);
        removeHeaderClock();
        danmakuAutoFilterCancel();
    }

    function onVideoOsdShow(e) {
        console.log('监听到事件: OSD显示 (video-osd-show)');
        if (lsGetItem(lsKeys.osdLineChartEnable.id)) {
            buildProgressBarChart(20);
        }
        if (lsGetItem(lsKeys.osdHeaderClockEnable.id)) {
          addHeaderClock();
        }
    }

    function onVideoOsdHide(e) {
        console.log('监听到事件: OSD隐藏 (video-osd-hide)');
        if (lsGetItem(lsKeys.osdHeaderClockEnable.id)) {
          removeHeaderClock();
        }
    }

    function initUI() {
        // 已初始化
        if (getById(eleIds.danmakuCtr)) { return; }
        console.log('正在初始化UI');

        // [修复] 使用 Emby 提供的版本比较方法，避免 parseFloat("4.10.0.1") = 4.1 的问题
        // ApiClient.isMinServerVersion("4.8.0.0") 返回 true 表示当前版本 >= 4.8.0.0
        const serverVersion = ApiClient.serverVersion ? ApiClient.serverVersion() : '';
        console.log('[dd-danmaku] 服务器版本:', serverVersion);

        let isOldVersion = false;
        if (ApiClient.isMinServerVersion) {
            // 使用 Emby 官方的版本比较方法
            isOldVersion = !ApiClient.isMinServerVersion("4.8.0.0");
        } else {
            // 回退方案：手动比较版本号
            const versionParts = serverVersion.split('.').map(Number);
            const major = versionParts[0] || 0;
            const minor = versionParts[1] || 0;
            isOldVersion = major < 4 || (major === 4 && minor < 8);
        }

        console.log('[dd-danmaku] 是否旧版本 (<4.8):', isOldVersion);

        if (isOldVersion) {
            mediaContainerQueryStr = 'div[data-type="video-osd"]';
            isVersionOld = true;
        }
        if (!mediaContainerQueryStr.includes(notHide)) {
            mediaContainerQueryStr += notHide;
        }

        // 弹幕按钮父容器 div,延时判断,精确 dom query 时播放器 UI 小概率暂未渲染
        const ctrlWrapperQueryStr = `${mediaContainerQueryStr} .videoOsdBottom-maincontrols`;
        waitForElement(ctrlWrapperQueryStr, (wrapper) => {
            const commonWrapper = getByClass(classes.videoOsdBottomButtons += notHide, wrapper);
            if (commonWrapper) {
                wrapper = commonWrapper;
            } else {
                // Emby 客户端启动时会检测鼠标设备,无鼠标时, commonWrapper 将会 hide
                // 手动模拟无鼠标步骤为浏览器页签打开后不要动鼠标,仅使用键盘操作
                wrapper = getByClass(classes.videoOsdBottomButtonsTopRight, wrapper);
            }
            // 在老客户端上存在右侧按钮,在右侧按钮前添加
            const rightButtons = getByClass(classes.videoOsdBottomButtonsRight, wrapper);
            const menubar = document.createElement('div');
            menubar.id = eleIds.danmakuCtr;
            if (!window.ede.episode_info) {
                menubar.style.opacity = 0.5;
            }
            if (rightButtons) {
                wrapper.insertBefore(menubar, rightButtons);
            } else {
                wrapper.append(menubar);
            }
            mediaBtnOpts.forEach(opt => {
                menubar.appendChild(embyButton(opt, opt.onClick));
            });
            // [修复] 初始化时检查弹幕开关状态，确保按钮图标与实际状态一致
            const danmakuEnabled = lsGetItem(lsKeys.switch.id);
            const osdDanmakuSwitchBtn = getById(eleIds.danmakuSwitchBtn);
            if (osdDanmakuSwitchBtn && osdDanmakuSwitchBtn.firstChild) {
                osdDanmakuSwitchBtn.firstChild.innerHTML = danmakuEnabled ? iconKeys.comment : iconKeys.comments_disabled;
            }
            console.log('播放器弹幕UI初始化完成');
        }, 0);
    }

    async function getEmbyItemInfo() {
        return require(['playbackManager']).then((items) => items[0].currentItem());
    }

    async function fatchEmbyItemInfo(id) {
        if (!id) { return; }
        return await ApiClient.getItem(ApiClient.getCurrentUserId(), id);
    }

    async function fetchSearchEpisodes(anime, episode, prefix) {
        if (!anime) { throw new Error('anime is required'); }

        // 步骤1: 使用 /api/v2/search/anime 搜索动画
        const searchUrl = `${prefix}/search/anime?keyword=${encodeURIComponent(anime)}`;
        const searchResult = await fetchJson(searchUrl)
            .catch((error) => {
                console.error(`[API请求] /search/anime 查询失败: ${error.message}`);
                return null;
            });

        if (!searchResult || !searchResult.animes || searchResult.animes.length === 0) {
            console.log(`[API请求] /search/anime 查询结果为空`);
            return { animes: [] };
        }

        console.log(`[API请求] /search/anime 查询成功，共 ${searchResult.animes.length} 个结果`);

        // 步骤2: 只为第一个动画获取详细的分集信息（默认选择）
        if (searchResult.animes.length > 0 && searchResult.animes[0].bangumiId) {
            const firstAnime = searchResult.animes[0];
            const bangumiUrl = `${prefix}/bangumi/${firstAnime.bangumiId}`;
            const bangumiResult = await fetchJson(bangumiUrl)
                .catch((error) => {
                    console.error(`[API请求] /bangumi/${firstAnime.bangumiId} 查询失败: ${error.message}`);
                    return null;
                });

            // 兼容不同 API 的返回格式：
            // - 标准格式: { bangumi: { episodes: [...] } }
            // - 简化格式: { episodes: [...] } 或直接返回 bangumi 对象
            let episodes = null;
            let seasons = null;
            if (bangumiResult) {
                if (bangumiResult.bangumi && bangumiResult.bangumi.episodes) {
                    // 标准格式: { bangumi: { episodes: [...] } }
                    episodes = bangumiResult.bangumi.episodes;
                    seasons = bangumiResult.bangumi.seasons;
                } else if (bangumiResult.episodes) {
                    // 简化格式: { episodes: [...] }
                    episodes = bangumiResult.episodes;
                    seasons = bangumiResult.seasons;
                }
            }

            if (episodes && episodes.length > 0) {
                // 为第一个动画添加分集信息
                searchResult.animes[0] = {
                    ...firstAnime,
                    episodes: episodes,
                    seasons: seasons
                };
                console.log(`[API请求] 已获取第一个动画的分集信息: ${firstAnime.animeTitle}, 共 ${episodes.length} 集`);
            } else {
                console.log(`[API请求] 未能获取分集信息，bangumiResult 结构:`, bangumiResult ? Object.keys(bangumiResult) : 'null');
            }
        }

        // 如果指定了集数，过滤第一个动画的集数
        if (episode && searchResult.animes.length > 0 && searchResult.animes[0].episodes) {
            const firstAnime = searchResult.animes[0];
            const matchedEpisode = firstAnime.episodes.find(ep =>
                ep.episodeId === episode ||
                ep.episodeNumber === String(episode) ||
                ep.episodeTitle.includes(`第${episode}集`) ||
                ep.episodeTitle.includes(`${episode}话`)
            );

            if (matchedEpisode) {
                console.log(`[API请求] 匹配到集数 ${episode}: ${matchedEpisode.episodeTitle}`);
            } else {
                console.log(`[API请求] 未匹配到集数 ${episode}`);
            }
        }

        return searchResult;
    }

    // 智能匹配函数：从候选列表中选择最佳匹配
    function selectBestMatch(searchTitle, candidates) {
        if (!candidates || candidates.length === 0) return null;

        console.log(`[智能匹配] 搜索标题: "${searchTitle}", 候选数量: ${candidates.length}`);

        // 解析搜索标题
        const parsedSearch = parseSearchKeyword(searchTitle);
        console.log(`[智能匹配] 解析搜索标题: ${JSON.stringify(parsedSearch)}`);

        // 计算相似度得分
        const scoredCandidates = candidates.map(candidate => {
            const score = calculateMatchScore(parsedSearch.title, candidate);

            // 季度和集数匹配加分
            if (parsedSearch.season && candidate.animeTitle) {
                const candidateParsed = parseSearchKeyword(candidate.animeTitle);
                if (candidateParsed.season === parsedSearch.season) {
                    score.total += 0.15; // 季度匹配加分
                    console.log(`[智能匹配] 季度匹配加分: ${candidate.animeTitle}`);
                }
            }

            // 集数匹配加分 (多种方式检测)
            if (parsedSearch.episode) {
                let episodeMatched = false;

                // 方式1: 从episodeId末尾提取集数 (如181180001 -> 1)
                if (candidate.episodeId) {
                    const episodeFromId = parseInt(candidate.episodeId.toString().slice(-3));
                    if (episodeFromId === parsedSearch.episode) {
                        score.total += 0.25; // episodeId匹配加分更高
                        episodeMatched = true;
                        console.log(`[智能匹配] episodeId集数匹配加分: ${candidate.animeTitle} (${episodeFromId})`);
                    }
                }

                // 方式2: 从episodeTitle提取集数
                if (!episodeMatched && candidate.episodeTitle) {
                    const episodeMatch = candidate.episodeTitle.match(/第?(\d+)[话集]/);
                    if (episodeMatch && parseInt(episodeMatch[1]) === parsedSearch.episode) {
                        score.total += 0.2; // episodeTitle匹配加分
                        console.log(`[智能匹配] episodeTitle集数匹配加分: ${candidate.animeTitle} - ${candidate.episodeTitle}`);
                    }
                }
            }

            console.log(`[智能匹配] "${candidate.animeTitle}" (${candidate.typeDescription}) - 得分: ${score.total.toFixed(2)}`);
            return { ...candidate, score: score.total, scoreDetails: score };
        });

        // 按得分排序
        scoredCandidates.sort((a, b) => b.score - a.score);

        // 选择得分最高的候选
        const bestMatch = scoredCandidates[0];
        if (bestMatch.score > 0.15) { // 进一步降低阈值，提高匹配成功率
            console.log(`[智能匹配] 选择最佳匹配: "${bestMatch.animeTitle}" (得分: ${bestMatch.score.toFixed(2)})`);
            return bestMatch;
        }

        console.log(`[智能匹配] 没有找到足够好的匹配 (最高得分: ${bestMatch.score.toFixed(2)})`);
        return null;
    }

    // 计算匹配得分
    function calculateMatchScore(searchTitle, candidate) {
        const score = {
            titleSimilarity: 0,
            typeBonus: 0,
            keywordMatch: 0,
            exactMatch: 0,
            total: 0
        };

        // 0. 精确匹配检查 (权重: 0.4)
        const normalizedSearch = normalizeTitle(searchTitle);
        const normalizedCandidate = normalizeTitle(candidate.animeTitle);
        if (normalizedSearch === normalizedCandidate) {
            score.exactMatch = 0.4;
        } else if (normalizedCandidate.includes(normalizedSearch) || normalizedSearch.includes(normalizedCandidate)) {
            score.exactMatch = 0.3;
        }

        // 1. 标题相似度 (权重: 0.5)
        score.titleSimilarity = calculateStringSimilarity(searchTitle, candidate.animeTitle) * 0.5;

        // 2. 类型加分 (权重: 0.1)
        if (candidate.type === 'tvseries') {
            score.typeBonus = 0.1; // TV动画优先
        } else if (candidate.type === 'tvspecial') {
            score.typeBonus = 0.08; // TV特别版次优先
        } else if (candidate.type === 'web') {
            score.typeBonus = 0.06; // 网络放送
        } else if (candidate.type === 'ova') {
            score.typeBonus = 0.04; // OVA
        } else if (candidate.type === 'movie') {
            score.typeBonus = 0.02; // 剧场版权重降低
        }

        // 3. 关键词匹配 (权重: 0.1)
        const searchKeywords = extractKeywords(searchTitle);
        const candidateKeywords = extractKeywords(candidate.animeTitle);
        const keywordMatches = searchKeywords.filter(keyword =>
            candidateKeywords.some(ck => ck.includes(keyword) || keyword.includes(ck))
        ).length;
        score.keywordMatch = (keywordMatches / Math.max(searchKeywords.length, 1)) * 0.1;

        score.total = score.exactMatch + score.titleSimilarity + score.typeBonus + score.keywordMatch;
        return score;
    }

    // 标题标准化函数
    function normalizeTitle(title) {
        return title
            .toLowerCase()
            .replace(/[：:]/g, '')
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s\u4e00-\u9fff]/g, '') // 保留中文、英文、数字和空格
            // 处理常见的同义词替换
            .replace(/柜台/g, '前台')
            .replace(/讨伐/g, '讨伐')
            .replace(/头目/g, 'boss')
            .replace(/迷宫/g, '迷宫')
            .trim();
    }

    // 解析搜索关键词，提取标题、季数和集数
    function parseSearchKeyword(keyword) {
        keyword = keyword.trim();

        // 1. 优先匹配 SXXEXX 格式
        const sePattern = /^(.+?)\s*S(\d{1,2})E(\d{1,4})$/i;
        const seMatch = sePattern.exec(keyword);
        if (seMatch) {
            return {
                title: seMatch[1].trim(),
                season: parseInt(seMatch[2]),
                episode: parseInt(seMatch[3])
            };
        }

        // 2. 匹配季度信息
        const seasonPatterns = [
            // S01, Season 1
            { pattern: /^(.*?)\s*(?:S|Season)\s*(\d{1,2})$/i, handler: (m) => parseInt(m[2]) },
            // 第一季, 第二部
            { pattern: /^(.*?)\s*第\s*([一二三四五六七八九十\d]+)\s*[季部]$/i,
              handler: (m) => {
                  const seasonMap = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10};
                  return seasonMap[m[2]] || parseInt(m[2]);
              }
            },
            // 罗马数字 Ⅰ-Ⅻ
            { pattern: /^(.*?)\s*([Ⅰ-Ⅻ])$/,
              handler: (m) => {
                  const romanMap = {'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4, 'Ⅴ': 5, 'Ⅵ': 6, 'Ⅶ': 7, 'Ⅷ': 8, 'Ⅸ': 9, 'Ⅹ': 10, 'Ⅺ': 11, 'Ⅻ': 12};
                  return romanMap[m[2].toUpperCase()];
              }
            },
            // 普通数字
            { pattern: /^(.*?)\s+(\d{1,2})$/, handler: (m) => parseInt(m[2]) }
        ];

        for (const {pattern, handler} of seasonPatterns) {
            const match = pattern.exec(keyword);
            if (match) {
                try {
                    const title = match[1].trim();
                    const season = handler(match);
                    // 避免将年份误认为季度
                    if (season && !(title.length > 4 && /\d{4}$/.test(title))) {
                        return { title, season, episode: null };
                    }
                } catch (e) {
                    continue;
                }
            }
        }

        // 3. 如果没有匹配到特定格式，则返回原始标题
        return { title: keyword, season: null, episode: null };
    }

    // 计算字符串相似度 (简化版编辑距离)
    function calculateStringSimilarity(str1, str2) {
        const s1 = str1.toLowerCase().replace(/[：:]/g, '');
        const s2 = str2.toLowerCase().replace(/[：:]/g, '');

        if (s1 === s2) return 1.0;
        if (s1.includes(s2) || s2.includes(s1)) return 0.8;

        // 计算编辑距离
        const matrix = [];
        for (let i = 0; i <= s1.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= s2.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                if (s1.charAt(i - 1) === s2.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        const maxLength = Math.max(s1.length, s2.length);
        return maxLength === 0 ? 1 : (maxLength - matrix[s1.length][s2.length]) / maxLength;
    }

    // 提取关键词
    function extractKeywords(title) {
        // 移除常见的无意义词汇
        const stopWords = ['第', '季', '部', '篇', '章', '话', '集', '期', 'season', 'episode', 'ep', 'ova', 'tv', 'movie', 'special', 'the', 'of', 'and', 'in', 'to', 'a', 'an'];

        return title
            .toLowerCase()
            .replace(/[：:]/g, ' ')
            .replace(/[^\w\s\u4e00-\u9fff]/g, ' ') // 保留中文、英文、数字和空格
            .split(/[\s\u3000]+/)
            .filter(word => word.length > 1) // 过滤单字符
            .filter(word => !stopWords.includes(word)) // 过滤停用词
            .filter(word => !/^\d+$/.test(word)) // 过滤纯数字
            .map(word => word.trim());
    }

    async function fetchMatchApi(payload, prefix) {
        // [测试] 尝试不同的路径格式
        const url = `${prefix}/match`;
        console.log(`[API请求] match 请求详情 - URL: ${url}`);
        console.log(`[API请求] match 请求详情 - Payload:`, payload);
        console.log(`[API请求] match 请求详情 - Prefix: ${prefix}`);
        try {
            // [修复] 判断是否为自定义 API（非弹弹play官方API）
            // 自定义 API 不发送 X-User-Agent 头，避免 CORS 问题
            const isDandanplayApi = prefix.includes('api.dandanplay.net') || prefix.includes('dandanplay');

            const requestHeaders = {
                'Accept-Encoding': 'gzip',
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            };

            // 只有弹弹play官方API才发送 X-User-Agent
            if (isDandanplayApi) {
                requestHeaders['X-User-Agent'] = userAgent;
            } else {
                console.log(`[API请求] match 跳过 X-User-Agent (自定义API)`);
            }

            // [新增] 如果启用了非对称验证，添加挑战响应头
            if (window.ede && window.ede.asymmetricAuthEnabled) {
                const challengeResponse = await getChallengeResponse(prefix);
                if (challengeResponse) {
                    requestHeaders['X-Challenge-Response'] = challengeResponse;
                }
            }
            const requestBody = JSON.stringify(payload);

            console.log(`[API请求] match 请求头:`, requestHeaders);
            console.log(`[API请求] match 请求体长度:`, requestBody.length);
            console.log(`[API请求] match 请求体内容:`, requestBody);

            // [修复] 直接使用 fetch，模仿 fetchJson 的请求头设置
            const response = await fetch(url, {
                method: 'POST',
                headers: requestHeaders,
                body: requestBody
            });

            console.log(`[API请求] match 响应状态:`, response.status);
            console.log(`[API请求] match 响应头:`, [...response.headers.entries()]);

            if (!response.ok) {
                const responseText = await response.text();
                console.log(`[API请求] match 错误响应体:`, responseText);
                throw new Error(`HTTP error! Status: ${response.status}, Body: ${responseText}`);
            }

            const matchResult = await response.json();
            console.log(`[API请求] match 查询响应:`, matchResult);

            // 统一 /match 和 /search/episodes 的返回格式
            if (matchResult && matchResult.matches) {
                matchResult.animes = matchResult.matches;
                delete matchResult.matches;
            }
            return matchResult;
        } catch (error) {
            console.warn(`[API请求] match 查询失败:`, error.message || error);
            console.warn(`[API请求] match 失败详情 - URL: ${url}, Payload:`, payload);
            return null; // 匹配失败时返回 null
        }
    }
    async function fetchComment(episodeId) {
         // [修正] 优先使用当前匹配信息中记录的 API 地址
        const prefix = window.ede.episode_info?.apiPrefix || dandanplayApi.prefix;
        const url = `${prefix}/comment/${episodeId}?withRelated=true&chConvert=${window.ede.chConvert}`;
        
        const startTime = performance.now(); // [Log] 开始计时

        return fetchJson(url)   // 直接使用 fetchJson
            .then((data) => {
                const endTime = performance.now();
                const duration = (endTime - startTime).toFixed(0);
                
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
                    console.log(`[API请求] comment 获取弹幕成功, 耗时: ${duration}ms, 数量: ${comments.length}`);
                    return comments;
                } else {
                    console.error(`[API请求] comment 返回数据格式不兼容，结构: ${data ? JSON.stringify(Object.keys(data)) : 'null'}, 耗时: ${duration}ms`);
                    return null;
                }
            })
            .catch((error) => {
                console.error(`[API请求] comment 获取弹幕失败: ${error.message}`);
                return null;
            });
    }

    async function fetchExtcommentActual(extUrl, comments) {
        if (!extUrl) {
            return null;
        }
        let extComments  = (await fetchJson(dandanplayApi.getExtcomment(extUrl))).comments;
        if (extComments.length === 0) { // 只重试一遍进行弹弹 play 服务器缓存覆盖加载触发
            extComments = (await fetchJson(dandanplayApi.getExtcomment(extUrl))).comments;
        }
        extComments.map(c => c.fromUrl = extUrl);
        const itemId = window.ede.itemId;
        if (!window.ede.extCommentCache[itemId]) {
            window.ede.extCommentCache = { [itemId]: {} };
        }
        if (comments) {
            console.log(`[附加弹幕] 正在为 ${extUrl} 的结果与已有弹幕取差集并覆盖`);
            extComments = extComments.filter(extC => !comments.some(c => c.cid === extC.cid));
        }
        window.ede.extCommentCache[itemId][extUrl] = extComments;
        return extComments;
    }

    function onPlaybackStopPct(e, state) {
        if (!state.NowPlayingItem) { return console.log('跳过 Web 端自身错误触发的第二次播放停止事件'); }
        console.log('监听到事件: 播放停止 (playbackstop)');
        const positionTicks = state.PlayState.PositionTicks;
        const runtimeTicks = state.NowPlayingItem.RunTimeTicks;
        if (!runtimeTicks) { return console.log('无可播放时长,跳过处理'); }
        const pct = parseInt(positionTicks / runtimeTicks * 100);
        console.log(`结束播放百分比: ${pct}%`);
        const bangumiPostPercent = lsGetItem(lsKeys.bangumiPostPercent.id);
        const bangumiToken = lsGetItem(lsKeys.bangumiToken.id);
        if (lsGetItem(lsKeys.bangumiEnable.id) && bangumiToken
            && pct >= bangumiPostPercent && window.ede.episode_info.episodeId
        ) {
            console.log(`大于需提交的设定百分比: ${bangumiPostPercent}%`);
            const { animeTitle, episodeTitle } = window.ede.episode_info;
            const targetName = `${animeTitle} - ${episodeTitle}`;
            putBangumiEpStatus(bangumiToken).then(res => {
                embyToast({ text: `Bangumi收藏更新成功, 目标: ${targetName}, 结束播放百分比: ${pct}%, 大于需提交的设定百分比: ${bangumiPostPercent}%`});
                console.log(`Bangumi收藏更新成功, 目标: ${targetName}`);
            }).catch(error => {
                embyToast({ text: `Bangumi收藏更新失败, 目标: ${targetName}, ${error.message}` });
                console.error(`putBangumiEpStatus 失败, 目标: ${targetName}`, error);
            });
        }
    }

    async function getEpisodeBangumiRel() {
        const episode_info = window.ede.episode_info;
        const _bangumi_key = lsLocalKeys.bangumiEpInfoPrefix + episode_info.episodeId;
        let bangumiInfoLs = localStorage.getItem(_bangumi_key);
        if (bangumiInfoLs) {
            bangumiInfoLs = JSON.parse(bangumiInfoLs);
        }
        let bangumiEpsRes = bangumiInfoLs ? bangumiInfoLs.bangumiEpsRes : null;
        let subjectId = bangumiInfoLs ? bangumiInfoLs.subjectId : null;
        let bangumiUrl = bangumiInfoLs ? bangumiInfoLs.bangumiUrl : null;
        const animeId = episode_info.animeId;
        if (!subjectId) {
            if (!animeId) { throw new Error('未获取到 animeId'); }
            const danDanPlayBangumiRes = await fetchJson(dandanplayApi.getBangumi(animeId));
            episode_info.bgmEpisodeIndex = offsetBgmEpisodeIndex(episode_info.bgmEpisodeIndex, danDanPlayBangumiRes.bangumi);
            bangumiUrl = danDanPlayBangumiRes.bangumi.bangumiUrl;
            if (!bangumiUrl) { throw new Error('未请求到 bangumiUrl'); }
            subjectId = parseInt(bangumiUrl.match(/\/(\d+)$/)[1]);
        }
        const episodeIndex = episode_info ? episode_info.episodeIndex : null;
        const bgmEpisodeIndex = episode_info ? episode_info.bgmEpisodeIndex : null;
        const bangumiInfo = { animeId, bangumiUrl, subjectId, episodeIndex, bgmEpisodeIndex, bangumiEpsRes, _bangumi_key };
        window.ede.bangumiInfo = bangumiInfo;
        localStorage.setItem(bangumiInfo._bangumi_key, JSON.stringify(bangumiInfo));
        return bangumiInfo;
    }

    function offsetBgmEpisodeIndex(currentBgmEpisodeIndex, danDanPlayBangumi) {
        if (!danDanPlayBangumi) {
            return currentBgmEpisodeIndex;
        }
        let bangumiEp = danDanPlayBangumi.episodes[currentBgmEpisodeIndex];
        if (!bangumiEp) {
            console.log(`未匹配到 danDanPlayBangumi 番剧集数,剧集不为第一季,尝试切换接口数据匹配返回修正后的 bgmEpisodeIndex`);
            return danDanPlayBangumi.episodes.findIndex(ep => ep.episodeNumber == currentBgmEpisodeIndex + 1);
        } else {
            return currentBgmEpisodeIndex;
        }
    }

    async function putBangumiEpStatus(token) {
        const bangumiInfo = await getEpisodeBangumiRel();
        const { subjectId, bgmEpisodeIndex, } = bangumiInfo;
        const episodeIndex = bgmEpisodeIndex ? bgmEpisodeIndex : bangumiInfo.episodeIndex;
        console.log('准备校验 Bangumi 条目收藏状态是否为看过');
        let bangumiMe = localStorage.getItem(lsLocalKeys.bangumiMe);
        if (bangumiMe) {
            bangumiMe = JSON.parse(bangumiMe);
        } else {
            bangumiMe = await fetchBangumiApiGetMe(token);
        }
        let msg = '';
        const bangumiUserColl = await fetchJson(bangumiApi.getUserCollection(bangumiMe.username, subjectId), { token });
        if (bangumiUserColl.type === 2) { // 看过状态
            msg = 'Bangumi 条目已为看过状态,跳过更新';
            console.log(msg, bangumiUserColl);
            throw new Error(msg);
        }
        console.log('准备修改 Bangumi 条目收藏状态为在看, 如果不存在则创建, 如果存在则修改');
        let body = { type: 3 }; // 在看状态
        await fetchJson(bangumiApi.postUserCollection(subjectId), { token, body });
        if (!bangumiInfo.bangumiEpsRes) {
            const fetchUrl = bangumiApi.getUserSubjectEpisodeCollection(subjectId);
            const bangumiEpsRes = await fetchJson(fetchUrl, { token });
            bangumiInfo.bangumiEpsRes = bangumiEpsRes;
            const bangumiEpColl = bangumiEpsRes.data[episodeIndex];
            if (!bangumiEpColl) { throw new Error('未匹配到 bangumiEpColl'); }
            // bangumiInfo.episodeIndex = episodeIndex;
        }
        const bangumiEpColl = bangumiInfo.bangumiEpsRes.data[episodeIndex];
        const bangumiEp = bangumiEpColl.episode;
        if (bangumiEpColl.type === 2) {
            msg = 'Bangumi 章节收藏已是看过状态,跳过更新';
            console.log(msg, bangumiEp);
            throw new Error(msg);
        }
        console.log('准备更新 Bangumi 章节收藏状态, 详情: ', bangumiEp);
        body.type = 2; // 看过状态
        await fetchJson(bangumiApi.putUserEpisodeCollection(bangumiEp.id), { token, body, method: 'PUT' });
        bangumiEp.type = body.type;
        console.log(`成功更新 Bangumi 章节收藏状态, 在看 => 看过, 详情: `, bangumiEp);
        window.ede.bangumiInfo = bangumiInfo;
        localStorage.setItem(bangumiInfo._bangumi_key, JSON.stringify(bangumiInfo));
        return bangumiInfo;
    }

    async function fetchJson(url, opts = {}) {
    const { token, headers, body } = opts;
    let { method = 'GET' } = opts;
    if (method === 'GET' && body) method = 'POST';
    
    // 判断是否为弹弹play 或 Bangumi 官方 API，用于决定是否发送 X-User-Agent
    const isDandanplayApi = url.includes('api.dandanplay.net') || url.includes('dandanplay');
    const isBangumiApi = url.includes('api.bgm.tv') || url.includes('bgm.tv');
    const shouldSendUserAgent = isDandanplayApi || isBangumiApi;

    const requestHeaders = {
        'Accept-Encoding': 'gzip',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    };
    // 只有弹弹play和Bangumi官方API才发送 X-User-Agent
    if (shouldSendUserAgent) {
        requestHeaders['X-User-Agent'] = userAgent;
        console.log(`[DEBUG] fetchJson 使用的 X-User-Agent: ${userAgent}`);
    } else {
        console.log(`[DEBUG] fetchJson 跳过 X-User-Agent (自定义API): ${url.substring(0, 80)}...`);
    }

    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    if (headers) Object.assign(requestHeaders, headers);

    const requestBody = body ? JSON.stringify(body) : null;

    // 统一生命周期管理：可中止的请求
    const controller = new AbortController();
    const timeoutMs = 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs); // 30s 超时

    // 将控制器注册到全局集合，便于销毁时统一取消
    if (window.ede?.abortControllers) {
        window.ede.abortControllers.add(controller);
    }

    const startTime = performance.now(); // 网络请求开始时间（用于测量耗时）
    try {
        // 优先使用传入的 signal，否则使用内部创建的
        const signal = opts.signal || controller.signal;

        // 发起请求（fetch resolves when response headers are received）
        const response = await fetch(url, {
            method,
            headers: requestHeaders,
            body: requestBody,
            signal: signal,
        });

        const ttfbMs = (performance.now() - startTime).toFixed(0); // time to first byte (近似: fetch resolve 时刻)

        clearTimeout(timeoutId);

        // 试图从 PerformanceResourceTiming 获取更细粒度的网络阶段耗时（若可用）
        let perfTiming = null;
        try {
            // Performance entries 可能需要服务器返回 Timing-Allow-Origin 才能看到跨域详细信息
            const entries = performance.getEntriesByName(url);
            if (entries && entries.length > 0) {
                // 取最近的一条同名记录
                const entry = entries[entries.length - 1];
                perfTiming = {
                    name: entry.name,
                    startTime: entry.startTime,
                    fetchStart: entry.fetchStart,
                    domainLookupTime: (entry.domainLookupEnd && entry.domainLookupStart) ? (entry.domainLookupEnd - entry.domainLookupStart) : null,
                    connectTime: (entry.connectEnd && entry.connectStart) ? (entry.connectEnd - entry.connectStart) : null,
                    secureConnectionTime: (entry.secureConnectionStart && entry.connectEnd) ? (entry.connectEnd - entry.secureConnectionStart) : null,
                    requestStartToResponseStart: (entry.responseStart && entry.requestStart) ? (entry.responseStart - entry.requestStart) : null,
                    responseDownloadTime: (entry.responseEnd && entry.responseStart) ? (entry.responseEnd - entry.responseStart) : null,
                    totalTime: (entry.responseEnd && entry.startTime) ? (entry.responseEnd - entry.startTime) : null,
                };
            } else {
                // 另一次尝试：按短名匹配（有些平台会在 URL 加上额外查询）
                const all = performance.getEntries();
                for (let i = all.length - 1; i >= 0; i--) {
                    if (all[i].name && all[i].name.indexOf(url) !== -1) {
                        const entry = all[i];
                        perfTiming = {
                            name: entry.name,
                            startTime: entry.startTime,
                            domainLookupTime: (entry.domainLookupEnd && entry.domainLookupStart) ? (entry.domainLookupEnd - entry.domainLookupStart) : null,
                            connectTime: (entry.connectEnd && entry.connectStart) ? (entry.connectEnd - entry.connectStart) : null,
                            secureConnectionTime: (entry.secureConnectionStart && entry.connectEnd) ? (entry.connectEnd - entry.secureConnectionStart) : null,
                            requestStartToResponseStart: (entry.responseStart && entry.requestStart) ? (entry.responseStart - entry.requestStart) : null,
                            responseDownloadTime: (entry.responseEnd && entry.responseStart) ? (entry.responseEnd - entry.responseStart) : null,
                            totalTime: (entry.responseEnd && entry.startTime) ? (entry.responseEnd - entry.startTime) : null,
                        };
                        break;
                    }
                }
            }
        } catch (perfErr) {
            // ignore perf errors
            perfTiming = null;
        }

        // 读取 body（测量下载耗时）
        const downloadStart = performance.now();
        const responseText = await response.text();
        const downloadMs = (performance.now() - downloadStart).toFixed(0);
        const totalMs = (performance.now() - startTime).toFixed(0);

        // 统一日志输出（包含 PerformanceResourceTiming 的更精细数据，如果可用）
        if (perfTiming) {
            console.log(`[Network] fetch ${url} | status=${response.status} | ttfb=${ttfbMs}ms | download=${downloadMs}ms | total=${totalMs}ms | perfTiming=`, perfTiming);
        } else {
            console.log(`[Network] fetch ${url} | status=${response.status} | ttfb=${ttfbMs}ms | download=${downloadMs}ms | total=${totalMs}ms`);
            console.log(`[Network] Tip: 若需更详细的 DNS/TCP/TLS/响应头到首字节等分段耗时，请确保后端返回 Timing-Allow-Origin 响应头以允许 PerformanceResourceTiming 获取跨域详细信息。`);
        }

        if (!response.ok) {
            console.warn(`[Network] fetch 错误响应: ${url} | status=${response.status} | total=${totalMs}ms | bodySnippet=${responseText?.slice(0,200)}`);
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        if (responseText?.length > 0) {
            try {
                return JSON.parse(responseText);
            } catch (parseError) {
                console.warn('responseText is not JSON:', parseError);
            }
        }
        return { success: true };
    } catch (error) {
        clearTimeout(timeoutId);
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(0);

        if (error.name === 'AbortError') {
            // 区分是被组件销毁取消的(人为)，还是超时取消的
            if (window.ede?.lastLoadId?.toString().startsWith('DESTROYED')) {
                console.log(`[Network] 请求已因组件销毁而取消: ${url} | duration=${duration}ms`);
            } else {
                console.warn(`[Network] 请求超时或被中断: ${url} | duration=${duration}ms`);
            }
            throw error;
        }

        console.error(`[Network] fetch 异常: ${url} | duration=${duration}ms | error: ${error.message || error}`);
        throw error;
    } finally {
        // 请求结束（无论成功失败），从集合中移除控制器
        if (window.ede?.abortControllers) {
            window.ede.abortControllers.delete(controller);
        }
    }
}

    /**
     * 获取所有媒体库列表
     * @returns {Promise<Array<{id: string, name: string, collectionType: string}>>}
     */
    async function getAllLibraries() {
        try {
            const userId = ApiClient.getCurrentUserId();
            // 通过 Views API 获取用户可见的媒体库
            const viewsUrl = ApiClient.getUrl(`Users/${userId}/Views`);
            const viewsResult = await ApiClient.getJSON(viewsUrl).catch(() => null);

            if (viewsResult && viewsResult.Items && viewsResult.Items.length > 0) {
                return viewsResult.Items.map(item => ({
                    id: item.Id,
                    name: item.Name,
                    collectionType: item.CollectionType || item.Type || ''
                }));
            }
        } catch (error) {
            console.error('[dd-danmaku] 获取媒体库列表失败:', error);
        }
        return [];
    }

    /**
     * 获取当前播放项目所属的媒体库信息
     * 使用多种方法尝试获取，确保稳定性（兼容网盘/302反代用户）
     * @param {Object} item - Emby item 对象
     * @returns {Promise<{libraryId: string, libraryName: string, collectionType: string}|null>}
     */
    async function getItemLibraryInfo(item) {
        if (!item) return null;

        try {
            // 获取所有媒体库列表
            const libraries = await getAllLibraries();
            console.log('[dd-danmaku] 媒体库列表:', libraries.map(l => ({ id: l.id, name: l.name })));
            if (!libraries || libraries.length === 0) {
                console.warn('[dd-danmaku] 无法获取媒体库列表');
                return null;
            }

            // 通过 API 获取完整的 item 信息（包含 ParentId 等字段）
            const userId = ApiClient.getCurrentUserId();
            const itemUrl = ApiClient.getUrl(`Users/${userId}/Items/${item.Id}`, {
                Fields: 'ParentId,Path,SeriesId,SeasonId,ProviderIds,LocationType'
            });
            const fullItem = await ApiClient.getJSON(itemUrl).catch(() => null) || item;

            console.log('[dd-danmaku] Item 完整信息:', {
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
            console.log('[dd-danmaku] 开始 ParentId 递归查找, 起始ID:', currentId);

            let maxDepth = 10;
            let lastFolderBeforeRoot = null; // 记录 root 之前的最后一个文件夹

            while (currentId && maxDepth > 0) {
                // 检查当前 ID 是否是媒体库
                const matchedLib = libraries.find(lib => lib.id === currentId);
                if (matchedLib) {
                    console.log(`[dd-danmaku] 通过 ParentId 匹配到媒体库: ${matchedLib.name}`);
                    return {
                        libraryId: matchedLib.id,
                        libraryName: matchedLib.name,
                        collectionType: matchedLib.collectionType || ''
                    };
                }

                // 获取父级信息继续查找
                const parentUrl = ApiClient.getUrl(`Users/${userId}/Items/${currentId}`, {
                    Fields: 'ParentId,Name,Type,CollectionType'
                });
                const parentItem = await ApiClient.getJSON(parentUrl).catch(() => null);
                console.log('[dd-danmaku] 递归查找父级:', parentItem ? { Id: parentItem.Id, Name: parentItem.Name, ParentId: parentItem.ParentId, Type: parentItem.Type } : 'null');

                if (!parentItem) break;

                // 检查父级名称是否匹配媒体库名称
                const matchedByName = libraries.find(lib => lib.name === parentItem.Name);
                if (matchedByName) {
                    console.log(`[dd-danmaku] 通过父级名称匹配到媒体库: ${matchedByName.name}`);
                    return {
                        libraryId: matchedByName.id,
                        libraryName: matchedByName.name,
                        collectionType: matchedByName.collectionType || ''
                    };
                }

                // 检查父级类型是否为 CollectionFolder（媒体库根目录）
                if (parentItem.Type === 'CollectionFolder' || parentItem.Type === 'UserView') {
                    console.log(`[dd-danmaku] 找到媒体库根目录: ${parentItem.Name}`);
                    return {
                        libraryId: parentItem.Id,
                        libraryName: parentItem.Name,
                        collectionType: parentItem.CollectionType || ''
                    };
                }

                // 如果遇到 AggregateFolder (root)，使用之前记录的文件夹通过 VirtualFolders 匹配
                if (parentItem.Type === 'AggregateFolder') {
                    console.log('[dd-danmaku] 到达 AggregateFolder (root)，尝试通过 VirtualFolders 匹配');
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
                console.log('[dd-danmaku] 尝试通过 Path 匹配媒体库, Path:', fullItem.Path);

                // 标准化 item 路径（统一使用正斜杠，转小写用于比较）
                const normalizedItemPath = fullItem.Path.replace(/\\/g, '/').toLowerCase();

                // 获取媒体库的路径信息（需要管理员权限，可能失败）
                try {
                    const virtualFoldersUrl = ApiClient.getUrl('Library/VirtualFolders');
                    const virtualFolders = await ApiClient.getJSON(virtualFoldersUrl).catch(() => null);

                    if (virtualFolders && virtualFolders.length > 0) {
                        console.log('[dd-danmaku] VirtualFolders:', virtualFolders.map(f => ({ Name: f.Name, Locations: f.Locations })));

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
                                            console.log(`[dd-danmaku] 通过 Path 匹配到媒体库: ${matchedLib.name}`);
                                            return {
                                                libraryId: matchedLib.id,
                                                libraryName: matchedLib.name,
                                                collectionType: matchedLib.collectionType || ''
                                            };
                                        }
                                        // 即使在 libraries 中找不到，也返回 folder 信息
                                        console.log(`[dd-danmaku] 通过 Path 匹配到媒体库 (VirtualFolder): ${folder.Name}`);
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
                    console.log('[dd-danmaku] VirtualFolders API 失败 (可能需要管理员权限):', e);
                }

                // 方法3: 从 Path 中提取可能的媒体库名称（最后的回退方案）
                // 路径格式可能是: /媒体库名/子文件夹/文件名 或 D:\媒体库名\子文件夹\文件名
                const pathParts = fullItem.Path.replace(/\\/g, '/').split('/').filter(p => p);
                console.log('[dd-danmaku] Path 分段:', pathParts);

                // 尝试匹配路径中的每个部分与媒体库名称
                for (const part of pathParts) {
                    const matchedLib = libraries.find(lib =>
                        lib.name === part ||
                        lib.name.toLowerCase() === part.toLowerCase()
                    );
                    if (matchedLib) {
                        console.log(`[dd-danmaku] 通过 Path 分段匹配到媒体库: ${matchedLib.name}`);
                        return {
                            libraryId: matchedLib.id,
                            libraryName: matchedLib.name,
                            collectionType: matchedLib.collectionType || ''
                        };
                    }
                }
            }

            console.warn('[dd-danmaku] 无法匹配到媒体库');
        } catch (error) {
            console.warn('[dd-danmaku] 获取媒体库信息失败:', error);
        }

        return null;
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
            const virtualFoldersUrl = ApiClient.getUrl('Library/VirtualFolders');
            const virtualFolders = await ApiClient.getJSON(virtualFoldersUrl).catch(() => null);

            if (virtualFolders && virtualFolders.length > 0) {
                console.log('[dd-danmaku] VirtualFolders:', virtualFolders.map(f => ({ Name: f.Name, Locations: f.Locations, ItemId: f.ItemId })));

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
                                    console.log(`[dd-danmaku] 通过 VirtualFolders 匹配到媒体库: ${matchedLib.name} (文件夹: ${folderName})`);
                                    return {
                                        libraryId: matchedLib.id,
                                        libraryName: matchedLib.name,
                                        collectionType: matchedLib.collectionType || ''
                                    };
                                }
                                // 即使在 libraries 中找不到，也返回 folder 信息
                                console.log(`[dd-danmaku] 通过 VirtualFolders 匹配到媒体库: ${folder.Name} (文件夹: ${folderName})`);
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
            console.log('[dd-danmaku] VirtualFolders API 失败:', e);
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
        console.log(`[dd-danmaku] 检查媒体库排除: "${libraryInfo.libraryName}" 在排除列表 [${excludedLibraries.join(', ')}] 中: ${isExcluded}`);
        return isExcluded;
    }

    async function getMapByEmbyItemInfo() {
        let item = await getEmbyItemInfo();
        if (!item) {
            // this only working on quickDebug
            item = await fatchEmbyItemInfo(window.ede.itemId);
        }
        if (!item) { return null; } // getEmbyItemInfo from playbackManager null, will next called
        if (!['Episode', 'Movie'].includes(item.Type)) {
            return console.error('不支持的类型');
        }

        // [新增] 获取并记录媒体库信息（仅记录，不在此处检查排除）
        const libraryInfo = await getItemLibraryInfo(item);
        if (libraryInfo) {
            console.log(`[dd-danmaku] 媒体库信息 - ID: ${libraryInfo.libraryId}, 名称: ${libraryInfo.libraryName}, 类型: ${libraryInfo.collectionType}`);
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
        let _episode_key = lsLocalKeys.animeEpisodePrefix + _id + '_' + episode;
        if (window.localStorage.getItem(_id_key)) {
            animeId = window.localStorage.getItem(_id_key);
        }
        // 检查是否需要重新获取完整的item信息
        if (!item.MediaSources || item.MediaSources.length === 0) {
            console.log(`[Stream] MediaSources为空，通过API重新获取完整信息...`);
            try {
                const fullItem = await fatchEmbyItemInfo(item.Id);
                if (fullItem && fullItem.MediaSources && fullItem.MediaSources.length > 0) {
                    item = fullItem;
                    console.log(`[Stream] 重新获取成功，MediaSources数量: ${item.MediaSources.length}`);
                } else {
                    console.warn(`[Stream] 重新获取失败或仍无MediaSources`);
                }
            } catch (error) {
                console.error(`[Stream] 重新获取item信息失败:`, error);
            }
        }

        const mediaSource = item.MediaSources && item.MediaSources[0];
        console.log(`[Stream] 最终MediaSources数量: ${item.MediaSources ? item.MediaSources.length : 0}`);

        // 参考embyToLocalPlayer项目的方式构建流媒体URL
        let streamUrl = null;
        if (mediaSource) {
            const itemId = item.Id;
            const mediaSourceId = mediaSource.Id;
            const deviceId = ApiClient.deviceId();
            const apiKey = ApiClient.accessToken();
            const serverAddress = ApiClient.serverAddress();

            // 检测是否为Emby服务器
            const isEmby = serverAddress.includes('/emby/') || ApiClient.appName().toLowerCase().includes('emby');
            const extraStr = isEmby ? '/emby' : '';

            // 构建流媒体URL，参考embyToLocalPlayer的方式
            const container = item.Path ? item.Path.split('.').pop() : 'mkv';
            streamUrl = `${serverAddress}${extraStr}/videos/${itemId}/stream?DeviceId=${deviceId}&MediaSourceId=${mediaSourceId}&api_key=${apiKey}&Static=true&Container=${container}`;

            console.log(`[Stream] 认证信息 - ApiKey: ${apiKey ? '已获取' : '未获取'}, DeviceId: ${deviceId ? '已获取' : '未获取'}`);
        } else {
            console.warn(`[Stream] 无MediaSource，无法构建流媒体URL`);
        }

        const map = {
            _id: _id,
            _id_key: _id_key,
            _season_key: _season_key,
            _episode_key: _episode_key,
            animeId: animeId,
            episode: episode, // this is episode index, not a program index
            animeName: animeName,
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
            console.log(`命中seasonInfo缓存: ${selectedSeasonInfo.name},偏移量: ${selectedSeasonInfo.episodeOffset},集: ${newEpisode}`);
            const animaInfo = await fetchSearchEpisodes(selectedSeasonInfo.name, newEpisode);
            return { animaInfo, newEpisode, };
        }
        return null;
    }

    async function autoFailback(animeName, episodeIndex, seriesOrMovieId) {
        console.log(`自动匹配未查询到结果,可能为非番剧,将移除章节过滤,重试一次`);
        let animaInfo = await fetchSearchEpisodes(animeName);
        if (animaInfo.animes.length > 0) {
            console.log(`移除章节过滤,自动匹配成功,转换为目标章节索引 0`);
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
        console.log(`标题名: ${animeName},自动匹配未查询到结果,将使用原标题名,重试一次`);
        const animeOriginalTitle = seriesOrMovieInfo.OriginalTitle;
        animaInfo = await fetchSearchEpisodes(animeOriginalTitle, episodeIndex);
        if (animaInfo.animes.length < 1) { return null; }
        console.log(`使用原标题名: ${animeOriginalTitle},自动匹配成功`);
        return { animeName, animeOriginalTitle, animaInfo, };
    }

    // --- 替换后的 calculateFileHash (使用 Worker) ---
    async function calculateFileHash(streamUrl, fileSize) {
        if (!streamUrl || !fileSize) {
            console.warn('缺少 streamUrl 或 fileSize，无法计算哈希。');
            return null;
        }

        return new Promise(async (resolve, reject) => {
            const worker = createWorker(md5WorkerBody);
            worker.onmessage = (e) => {
                if (e.data.success) {
                    console.log(`[Hash-Worker] 计算完成: ${e.data.hash}`);
                    resolve(e.data.hash);
                    worker.terminate();
                }
            };
            worker.onerror = (err) => {
                console.error("[Hash-Worker] Error:", err);
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
                    console.log(`[Hash] 文件较小，下载全量计算...`);
                    const response = await fetch(streamUrl, { headers: authHeaders });
                    if (!response.ok) throw new Error(`Fetch error: ${response.status}`);
                    const buffer = await response.arrayBuffer();
                    worker.postMessage({ type: 'APPEND', chunk: buffer, isLast: true }, [buffer]);
                } else {
                    console.log(`[Hash] 文件较大，下载头尾分片计算...`);
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
                console.error('[Hash] 下载或通信失败:', error);
                worker.terminate();
                resolve(null);
            }
        });
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

    // --- 优化：串行请求 (节省流量) & 耗时日志 ---
    async function searchEpisodes(itemInfoMap) {
        const { animeName, episode, seriesOrMovieId, streamUrl, size, duration } = itemInfoMap;
        console.log(`[Debug] searchEpisodes调用 - streamUrl: ${streamUrl ? '已获取' : '未获取'}, size: ${size}, duration: ${duration}`);
        const startTime = performance.now(); 
        
        // 读取用户定义的API优先级
        const apiPriority = lsGetItem(lsKeys.apiPriority.id);
        // 构建API配置，支持多个自定义源（新数据结构）
        const customApiList = getCustomApiList();
        const apiConfigs = {
            official: { name: '官方API', prefix: corsProxy + 'https://api.dandanplay.net/api/v2', enabled: lsGetItem(lsKeys.useOfficialApi.id) },
        };
        // 为每个启用的自定义源创建配置
        if (lsGetItem(lsKeys.useCustomApi.id) && customApiList.length > 0) {
            customApiList.forEach((item, index) => {
                if (item.enabled) {
                    apiConfigs[`custom_${index}`] = { name: item.name || `自定义源${index + 1}`, prefix: item.url, enabled: true };
                }
            });
        }
        
        // 构建优先级队列
        const actualPriority = [];
        for (const key of apiPriority) {
            if (key === 'official') actualPriority.push('official');
            else if (key === 'custom') customApiList.forEach((item, i) => item.enabled && actualPriority.push(`custom_${i}`));
        }
        
        // 准备 /match 接口的请求体
        const matchPayload = {
            fileName: animeName,
            fileHash: null,
            fileSize: size || 0,
            videoDuration: Math.floor(duration || 0), // [修复] 转换为整数
            matchMode: "hashAndFileName"// [修正] 始终使用 hashAndFileName 模式
        };
        
        // 计算哈希 (Worker) - 使用真正的 SparkMD5 库计算文件 MD5
        // 如果计算失败，使用 fallback 值（仅用于 API 兼容，不会匹配到正确的弹幕）
        const FALLBACK_HASH = 'a1b2c3d4e5f67890abcd1234ef567890';
        if (streamUrl && size > 0) {
             matchPayload.fileHash = await calculateFileHash(streamUrl, size) || FALLBACK_HASH;
        } else {
             matchPayload.fileHash = FALLBACK_HASH;
        }

        console.log(`[自动匹配] 开始串行搜索... 目标: ${animeName}`);

        // --- 3. 串行执行逻辑 (回归) ---
        for (const apiKey of actualPriority) {
            const config = apiConfigs[apiKey];
            // 跳过未启用或配置错误的源
            if (!config?.enabled || !config?.prefix) continue;

            console.log(`[自动匹配] 正在尝试源: ${config.name}...`);
            const providerStart = performance.now();
            
            try {
                let result = null;

                // A. 尝试 /match 接口
                const matchResult = await fetchMatchApi(matchPayload, config.prefix);
                
                if (matchResult?.isMatched && matchResult?.animes?.length > 0) {
                    const match = matchResult.animes[0];
                    result = { directMatch: true, apiPrefix: config.prefix, apiName: config.name, episodeInfo: { ...match, episodes: [{ episodeId: match.episodeId, episodeTitle: match.episodeTitle }], imageUrl: match.imageUrl } };
                }
                // 智能匹配 (Candidate Selection)
                else if (matchResult?.animes?.length > 0) {
                    const bestMatch = selectBestMatch(animeName, matchResult.animes);
                    if (bestMatch) {
                        result = { directMatch: true, apiPrefix: config.prefix, apiName: config.name, episodeInfo: { ...bestMatch, episodes: [{ episodeId: bestMatch.episodeId, episodeTitle: bestMatch.episodeTitle }], imageUrl: bestMatch.imageUrl } };
                    }
                }

                // B. 尝试 /search/episodes 接口 (如果 match 没结果)
                if (!result) {
                    let searchTitle = animeName;
                    let searchEpisode = episode;
                    
                    // 官方源特殊优化
                    if (apiKey === 'official') {
                        const parsed = parseAnimeName(animeName);
                        if (parsed.season !== null) {
                            searchTitle = parsed.season === 1 ? parsed.title : `${parsed.title} 第${parsed.season}季`;
                            searchEpisode = parsed.episode;
                        }
                    }

                    // 带集数搜索
                    let animaInfo = await fetchSearchEpisodes(searchTitle, searchEpisode, config.prefix);
                    
                    if (animaInfo?.animes?.length > 0) {
                        result = { animaInfo, apiPrefix: config.prefix, apiName: config.name };
                    } 
                    // 降级：不带集数搜索
                    else {
                        animaInfo = await fetchSearchEpisodes(animeName, null, config.prefix);
                        if (animaInfo?.animes?.length > 0) {
                            result = { animaInfo, apiPrefix: config.prefix, apiName: config.name };
                        }
                        // 降级：原始标题搜索
                        else {
                            const seriesOrMovieInfo = await fatchEmbyItemInfo(seriesOrMovieId);
                            if (seriesOrMovieInfo?.OriginalTitle) {
                                animaInfo = await fetchSearchEpisodes(seriesOrMovieInfo.OriginalTitle, episode, config.prefix);
                                if (animaInfo?.animes?.length > 0) {
                                    result = { animaInfo, animeOriginalTitle: seriesOrMovieInfo.OriginalTitle, apiPrefix: config.prefix, apiName: config.name };
                                }
                            }
                        }
                    }
                }

                // --- 4. 关键：如果找到了，直接返回 (Short-Circuit) ---
                if (result) {
                    const totalTime = (performance.now() - startTime).toFixed(0);
                    console.log(`[自动匹配] 在源 [${config.name}] 匹配成功! 耗时: ${(performance.now() - providerStart).toFixed(0)}ms (累计: ${totalTime}ms)`);
                    appendvideoOsdDanmakuInfo(null, `匹配耗时: ${totalTime}ms`);
                    return result; // <--- 之后的循环不会执行，请求被节省了
                }

            } catch (e) {
                console.warn(`[自动匹配] 源 ${config.name} 发生错误:`, e);
                // 继续下一个循环
            }
        }

        console.log(`[自动匹配] 所有源均未匹配成功, 总耗时: ${(performance.now() - startTime).toFixed(0)}ms`);
        return null;
    }

    async function getEpisodeInfo(is_auto = true) {
        const itemInfoMap = await getMapByEmbyItemInfo();
        if (!itemInfoMap) { return null; }
        const { _episode_key, animeId, episode, seriesOrMovieId } = itemInfoMap;

        // [新增] 下一集/上一集推理逻辑
        const previous_info = window.ede.previous_episode_info;
        // ... (下一集/上一集推理逻辑保持不变)
        if (is_auto && previous_info && previous_info.episodeId && previous_info.seriesOrMovieId === seriesOrMovieId) {
            const previousEpisodeIndex = previous_info.episodeIndex; // 0-based
            const currentEpisodeNumber = episode; // 1-based
            const previousEpisodeId = parseInt(previous_info.episodeId, 10);

            let predictedEpisodeId = null;
            let direction = '';

            // 播放下一集 (e.g., from ep1(index 0) to ep2(number 2))
            if (currentEpisodeNumber === previousEpisodeIndex + 2) {
                predictedEpisodeId = previousEpisodeId + 1;
                direction = '下一集';
            }
            // 播放上一集 (e.g., from ep2(index 1) to ep1(number 1))
            else if (currentEpisodeNumber === previousEpisodeIndex) {
                predictedEpisodeId = previousEpisodeId - 1;
                direction = '上一集';
            }

            if (predictedEpisodeId) {
                console.log(`[推理匹配] 检测到播放'${direction}'，尝试使用推断的 episodeId: ${predictedEpisodeId}`);
                const comments = await fetchComment(predictedEpisodeId);
                if (comments && comments.length > 0) {
                    console.log(`[推理匹配] 成功！使用 episodeId: ${predictedEpisodeId}`);
                    const predictedEpisodeInfo = {
                        ...itemInfoMap,
                        episodeId: predictedEpisodeId,
                        episodeTitle: `第 ${currentEpisodeNumber} 集 (推断)`,
                        animeId: previous_info.animeId,
                        animeTitle: previous_info.animeTitle,
                        imageUrl: previous_info.imageUrl,
                        seriesOrMovieId: seriesOrMovieId, // 确保系列ID更新
                        episodeIndex: currentEpisodeNumber - 1,
                    };
                    // 不写入缓存，因为这只是一个快速的推断
                    return predictedEpisodeInfo;
                } else {
                    console.log(`[推理匹配] 失败，episodeId: ${predictedEpisodeId} 无弹幕，回退到常规匹配。`);
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
        if (is_auto && window.localStorage.getItem(unique_episode_key)) {
            return JSON.parse(window.localStorage.getItem(unique_episode_key));
        }

        const res = await searchEpisodes(itemInfoMap);

        const useOfficial = lsGetItem(lsKeys.useOfficialApi.id);
        const useCustom = lsGetItem(lsKeys.useCustomApi.id);
        if (!useOfficial && !useCustom) {
            return null;
        }
        if (!res || (!res.directMatch && (!res.animaInfo || res.animaInfo.animes.length === 0))) {
            console.log(`弹弹 Play 章节匹配失败`);
            // 播放界面右下角添加弹幕信息
            appendvideoOsdDanmakuInfo();
            // toastByDanmaku('弹弹 Play 章节匹配失败', 'error');
            return null;
        }
        // 处理来自 /match 的直接匹配结果
        if (res.directMatch) {
            const episodeInfo = {
                episodeId: res.episodeInfo.episodeId,
                episodeTitle: res.episodeInfo.episodeTitle,
                episodeIndex: 0,
                animeId: res.episodeInfo.animeId,
                animeTitle: res.episodeInfo.animeTitle,
                animeOriginalTitle: '',
                imageUrl: res.episodeInfo.imageUrl,
                apiName: res.apiName, // [新增] 保存API名称
                apiPrefix: res.apiPrefix,
            };
        // 将系列ID也存入，用于下一集/上一集的判断
        episodeInfo.seriesOrMovieId = seriesOrMovieId;
            localStorage.setItem(unique_episode_key, JSON.stringify(episodeInfo));
            return episodeInfo;
        }

        // [修正] 从 res 中解构出 apiPrefix 和 apiName
        const { animeOriginalTitle, animaInfo, apiPrefix, apiName } = res;
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
            console.error('匹配逻辑错误：未能找到有效的分集信息。');
            return null;
        }
        const episodeInfo = {
            episodeId: animaInfo.animes[selectAnime_id].episodes[0].episodeId,
            episodeTitle: animaInfo.animes[selectAnime_id].episodes[0].episodeTitle,
            episodeIndex,
            bgmEpisodeIndex: res.bgmEpisodeIndex ? res.bgmEpisodeIndex : episodeIndex,
            animeId: animaInfo.animes[selectAnime_id].animeId,
            animeTitle: animaInfo.animes[selectAnime_id].animeTitle,
            animeOriginalTitle,
            imageUrl: animaInfo.animes[selectAnime_id].imageUrl,
            seriesOrMovieId: seriesOrMovieId,
            apiPrefix: apiPrefix, // [修正] 保存API前缀
            apiName: apiName, // [新增] 保存API名称
        };
        localStorage.setItem(unique_episode_key, JSON.stringify(episodeInfo));
        return episodeInfo;
    }

    // copy from https://github.com/Izumiko/jellyfin-danmaku/blob/74598c7bcb388f1288d6f7c7b03103e31af248ef/ede.js#L1069
    // thanks for Izumiko
    async function getCommentsByPluginApi(mediaServerItemId) {
        // const path = window.location.pathname.replace(/\/web\/(index\.html)?/, '/api/danmu/');
        // const url = window.location.origin + path + jellyfinItemId + '/raw';
        const url = `${ApiClient.serverAddress()}/api/danmu/${mediaServerItemId}/raw?X-Emby-Token=${ApiClient.accessToken()}`;
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }
        const xmlText = await response.text();
        if (!xmlText || xmlText.length === 0) {
            return null;
        }

        // parse the xml data
        // xml data: <d p="392.00000,1,25,16777215,0,0,[BiliBili]e6860b30,1723088443,1">弹幕内容</d>
        //           <d p="stime, type, fontSize, color, date, pool, sender, dbid, unknown">content</d>
        // comment data: {cid: "1723088443", p: "392.00,1,16777215,[BiliBili]e6860b30", m: "弹幕内容"}
        //               {cid: "dbid", p: "stime, type, color, sender", m: "content"}
        try {
            const parser = new DOMParser();
            const data = parser.parseFromString(xmlText, 'text/xml');
            const comments = [];

            for (const comment of data.getElementsByTagName('d')) {
                const p = comment.getAttribute('p').split(',').map(Number);
                const commentData = {
                    cid: p[7],
                    p: p[0] + ',' + p[1] + ',' + p[3] + ',' + p[6],
                    m: comment.textContent
                };
                comments.push(commentData);
            }

            return comments;
        } catch (error) {
            console.error('Failed to parse XML data:', error);
            return null;
        }
    }

    async function refreshPluginXml(mediaServerItemId) {
        const url = `${ApiClient.serverAddress()}/api/danmu/${mediaServerItemId}?option=Refresh&X-Emby-Token=${ApiClient.accessToken()}`;
        const response = await fetch(url);
        if (response.ok) {
            console.log(lsKeys.refreshPluginXml.name + ':成功');
        } else {
            throw new Error(lsKeys.refreshPluginXml.name + ':失败');
        }
    }

    async function createDanmaku(comments, sessionId) {
        // [核心修复] 1. 入口身份核验
        // 如果调用者传了身份证(sessionId)，必须和全局最新的(lastLoadId)一致
        if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) {
            console.warn(`[防串台] 拦截旧任务(入口): ${sessionId}, 当前: ${window.ede.lastLoadId}`);
            return;
        }

        if (!comments) { return; }

        if (window.ede.danmaku) {
            try { window.ede.danmaku.hide(); window.ede.danmaku.destroy(); } catch (e) {
                console.warn('旧弹幕实例销毁异常', e);
            }
            window.ede.danmaku = null;
        }
        
        const ghostWrappers = document.querySelectorAll(`#${eleIds.danmakuWrapper}`);
        ghostWrappers.forEach(el => el.remove());

        const commentsParsed = danmakuParser(comments);
        window.ede.commentsParsed = commentsParsed;

        console.log('开始过滤和合并弹幕 (异步)...');
        
        // --- 异步等待 (这里耗时 1秒左右) ---
        let _comments = await danmakuFilter(commentsParsed); 
        
        // [核心修复] 2. 出口身份核验 (防止 await 期间切集)
        if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) {
            console.warn(`[防串台] 拦截旧任务(出口): ${sessionId}, 当前: ${window.ede.lastLoadId}`);
            return;
        }
        
        console.log('弹幕加载成功: ' + _comments.length);

        const _media = document.querySelector(mediaQueryStr);
        if (!_media) {
            // this only working on quickDebug
            if (!window.ede.danmaku) {
                window.ede.danmaku = { comments: _comments, };
            }
            // 设置弹窗内的弹幕信息
            buildCurrentDanmakuInfo(currentDanmakuInfoContainerId);
            // throw new Error('创建弹幕失败：用户已退出视频播放页面。');
            console.warn('用户已退出视频播放页面，停止创建。');
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
        // const _container = document.querySelector(mediaContainerQueryStr);
        const _container = await waitForElement(mediaContainerQueryStr);
        _container.prepend(wrapper);
        let _speed = 144 * (lsGetItem(lsKeys.speed.id) / 100);
        // 检查 Danmaku 库是否已加载，如果未加载则等待
        if (typeof Danmaku === 'undefined' && typeof window.Danmaku === 'undefined') {
            console.log('[Danmaku] 弹幕库未加载，尝试等待加载...');
            // 尝试等待 Danmaku 库加载完成，最多等待 3 秒
            let waitCount = 0;
            const maxWait = 30; // 30 * 100ms = 3秒
            while (typeof window.Danmaku === 'undefined' && waitCount < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }
            if (typeof window.Danmaku === 'undefined') {
                console.error('[Danmaku] 弹幕库加载超时，尝试重新加载...');
                // 尝试重新加载
                try {
                    const module = await Emby.importModule(requireDanmakuPath);
                    window.Danmaku = module;
                    console.log('[Danmaku] 弹幕库重新加载成功');
                } catch (error) {
                    console.error('[Danmaku] 弹幕库加载失败:', error);
                    throw new Error('创建弹幕失败：Danmaku 库未能加载。请检查网络连接或刷新页面重试。');
                }
            } else {
                console.log('[Danmaku] 弹幕库加载完成');
            }
        }
        const DanmakuClass = window.Danmaku || Danmaku;
        window.ede.danmaku = new DanmakuClass({
            container: wrapper,
            media: _media,
            comments: _comments,
            engine: lsGetItem(lsKeys.engine.id),
            speed: _speed,
        });
        lsGetItem(lsKeys.switch.id) ? window.ede.danmaku.show() : window.ede.danmaku.hide();
        if (window.ede.ob) {
            window.ede.ob.disconnect();
        }
        window.ede.ob = new ResizeObserver(() => {
            if (window.ede.danmaku) {
                console.log('检测到播放器尺寸变化 (Resizing)，正在重置弹幕画布...');
                window.ede.danmaku.resize();
                if (lsGetItem(lsKeys.osdLineChartEnable.id)) {
                    buildProgressBarChart(20);
                }
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
        // 播放界面右下角添加弹幕信息
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
        console.log('进度条宽度 (progressBarWidth): ' + progressBarWidth);
        const bulletChartCanvas = document.createElement('canvas');
        bulletChartCanvas.id = eleIds.progressBarLineChart;
        bulletChartCanvas.width = progressBarWidth;
        bulletChartCanvas.height = chartHeightNum;
        bulletChartCanvas.style.position = 'absolute';
        bulletChartCanvas.style.top = OS.isEmbyNoisyX() ? '-24px' : '-21px';
        container.prepend(bulletChartCanvas);
        const ctx = bulletChartCanvas.getContext('2d');
        // 计算每个时间点的弹幕数量
        const maxTime = Math.max(...comments.map(c => c.time));
        const timeStep = lsGetItem(lsKeys.osdLineChartTime.id);
        const timeCounts = Array.from({ length: Math.ceil(maxTime / timeStep) }, () => 0);
        comments.forEach(c => {
            const index = Math.floor(c.time / timeStep);
            if (index < timeCounts.length) {
                timeCounts[index]++;
            }
        });
        function drawLineChart(data) {
            ctx.clearRect(0, 0, progressBarWidth, chartHeightNum);
            const maxY = Math.max(...data);
            const scale = chartHeightNum / maxY; // 用于拉长 y 轴间距
            ctx.beginPath();
            ctx.moveTo(0, chartHeightNum - data[0] * scale);
            for (let i = 1; i < data.length; i++) {
                const x = (i / (data.length - 1)) * progressBarWidth;
                const y = chartHeightNum - data[i] * scale;
                ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; // 与次标题同色
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        drawLineChart(timeCounts);
        console.log('已重绘进度条弹幕数量折线图');
    }

    // [新增] 强制清理 UI 函数
    function clearDanmakuUI() {
    // 1. 隐藏并清空现有弹幕
    if (window.ede.danmaku) {
        window.ede.danmaku.hide();
        window.ede.danmaku.clear(); 
    }

    // 2. [关键修改] 立即重置剧集元数据信息，防止旧标题残留
    if (window.ede) {
        window.ede.episode_info = null; 
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

    async function loadDanmaku(loadType = LOAD_TYPE.CHECK) {
        const _media = document.querySelector(mediaQueryStr);
        if (!_media) {
            return console.warn('用户已退出视频播放，停止加载弹幕');
        }

        // [新增] 先获取媒体库信息并检查排除
        console.log('[dd-danmaku] 开始检查媒体库排除...');
        const item = await getEmbyItemInfo();
        console.log('[dd-danmaku] getEmbyItemInfo 返回:', item ? item.Name : 'null');
        if (item) {
            const libraryInfo = await getItemLibraryInfo(item);
            console.log('[dd-danmaku] getItemLibraryInfo 返回:', libraryInfo);
            if (libraryInfo) {
                window.ede.currentLibraryInfo = libraryInfo;
                if (isLibraryExcluded(libraryInfo)) {
                    console.log(`[dd-danmaku] 媒体库 "${libraryInfo.libraryName}" 在排除列表中，跳过弹幕搜索和加载`);
                    return;
                }
            }
        }

        // [关键修复] 2. 在加载的最开始就生成新的任务 ID (Session ID)
        // 这样 B 剧集一开始加载，A 的 ID (上一个时间戳) 就已经失效了
        const currentSessionId = Date.now();
        if (window.ede) {
            window.ede.lastLoadId = currentSessionId;

            // =========== [修改开始] ===========
            // 在这里调用清理函数，确保发起请求前，上一集的 UI 已经被清除
            clearDanmakuUI();
            console.log('开始加载新弹幕，已清除上一集 UI');
            // =========== [修改结束] ===========
        }

        // 注意：这里不再设置 window.ede.loading = true，因为并发时无法准确控制
        // 我们改用 ID 校验来控制

        if (lsGetItem(lsKeys.useFetchPluginXml.id)) {
            // if (lsGetItem(lsKeys.refreshPluginXml.id)) {
            //     refreshPluginXml(window.ede.itemId).catch((error) => {
            //         console.error(error);
            //     });
            // }
            getMapByEmbyItemInfo().then((itemInfoMap) => {
                // 检查是否获取到信息
                if (!itemInfoMap) {
                    console.log('[dd-danmaku] 获取视频信息失败，停止弹幕加载');
                    return;
                }

                // [新增] 在插件API成功时也计算文件哈希
                if (itemInfoMap.streamUrl && itemInfoMap.size > 0) {
                    console.log(`[插件API] 准备计算文件哈希`);
                    calculateFileHash(itemInfoMap.streamUrl, itemInfoMap.size).then(hash => {
                        if (hash) {
                            console.log(`[插件API] 文件哈希计算完成: ${hash}`);
                        } else {
                            console.warn('[插件API] 文件哈希计算失败');
                        }
                    }).catch(error => {
                        console.error('[插件API] 文件哈希计算出错:', error);
                    });
                }

                getCommentsByPluginApi(window.ede.itemId)
                .then((comments) => {
                    if (comments && comments.length > 0) {
                        // [传证] 将 currentSessionId 传给 createDanmaku 进行核验
                        return createDanmaku(comments, currentSessionId).then(() => {
                            // 只有当全局 ID 依然匹配时，才做后续 UI 更新
                            if (window.ede && window.ede.lastLoadId === currentSessionId) {
                                console.log('服务端Danmu插件弹幕加载就位');
                                const danmakuCtrEle = getById(eleIds.danmakuCtr);
                                if (danmakuCtrEle && danmakuCtrEle.style.opacity !== '1') {
                                    danmakuCtrEle.style.opacity = '1';
                                }
                                const videoOsdDanmakuTitle = getById(eleIds.videoOsdDanmakuTitle);
                                if (videoOsdDanmakuTitle && videoOsdDanmakuTitle.innerText.includes('未匹配')) {
                                    videoOsdDanmakuTitle.innerText = `弹幕：${lsKeys.useFetchPluginXml.name} - ${comments.length}条`;
                                }
                            }
                        }).catch((error) => {
                            console.error(error);
                            console.error('使用服务端Danmu插件弹幕创建Danmaku实例时出错');
                        });
                    }
                    throw new Error('从服务端Danmu插件获取弹幕失败，尝试在线加载...');
                })
                .catch((error) => {
                    console.error(error);
                    // [传证] 将 ID 传给 loadOnlineDanmaku
                    return loadOnlineDanmaku(loadType, currentSessionId);
                });
            });
        } else {
            // [传证] 将 ID 传给 loadOnlineDanmaku
            loadOnlineDanmaku(loadType, currentSessionId);
        }
    }

    function loadOnlineDanmaku(loadType, sessionId) {
        // 安全检查：如果这个任务还没开始跑就已经过时了，直接停止
        if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) {
            console.warn('任务已过期，停止在线加载');
            return;
        }

        getEpisodeInfo(loadType !== LOAD_TYPE.SEARCH)
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
                            // [传证]
                            createDanmaku(window.ede.danmuCache[episodeId], sessionId)
                                .then(() => {
                                    if (window.ede && sessionId === window.ede.lastLoadId)
                                        console.log('弹幕已从缓存加载就位');
                                })
                                .catch((err) => {
                                    console.log(err);
                                });
                        } else {
                            fetchComment(episodeId).then((comments) => {
                                // [传证]
                                if (sessionId && window.ede && sessionId !== window.ede.lastLoadId) return;
                                
                                window.ede.danmuCache[episodeId] = comments;
                                createDanmaku(comments, sessionId)
                                    .then(() => {
                                        if (window.ede && sessionId === window.ede.lastLoadId)
                                            console.log('弹幕已从网络加载就位');
                                    })
                                    .catch((err) => {
                                        console.log(err);
                                    });
                            });
                        }
                    }
                },
                (msg) => {
                    if (msg) {
                        console.log(msg);
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
                const danmakuCtrEle = getById(eleIds.danmakuCtr);
                if (danmakuCtrEle && danmakuCtrEle.style.opacity !== '1') {
                    danmakuCtrEle.style.opacity = '1';
                }
            })
            .catch((err) => {
                console.log(err);
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
        const fontSizeRate = lsGetItem(lsKeys.fontSizeRate.id);
        const speedRate = lsGetItem(lsKeys.speed.id);

        // 计算弹幕高度（基础字体 25px * 缩放比例 * 行高系数 + 描边）
        const baseFontSize = 25;
        const fontSize = baseFontSize * (fontSizeRate / 100);
        const lineHeight = 1.2;
        const strokeWidth = 4;
        const danmakuHeight = fontSize * lineHeight + strokeWidth;

        // 获取容器尺寸
        const container = document.querySelector(mediaContainerQueryStr);
        const containerHeight = container ? container.offsetHeight : 720;
        const containerWidth = container ? container.offsetWidth : 1280;

        // 计算实际可用高度和轨道数
        const availableHeight = containerHeight * (heightPercent / 100);
        const maxTracks = Math.max(1, Math.floor(availableHeight / danmakuHeight));

        // 速度计算（像素/秒）- Danmaku 库基础速度是 144
        const baseSpeed = 144;
        const speed = baseSpeed * (speedRate / 100);

        // 弹幕飞行时间（整个屏幕宽度）
        const duration = containerWidth / speed;

        // 估算平均弹幕宽度（用于计算轨道占用时间）
        // 假设平均弹幕长度约 10 个字符，每个字符宽度约等于字体大小
        const avgDanmakuWidth = fontSize * 10;
        // 弹幕完全进入屏幕的时间（这是轨道的最小占用时间）
        const minOccupyTime = avgDanmakuWidth / speed;

        // 为不同弹幕类型维护独立的轨道释放时间表
        const tracks = {
            rtl: new Array(maxTracks).fill(-Infinity),
            ltr: new Array(maxTracks).fill(-Infinity),
            top: new Array(maxTracks).fill(-Infinity),
            bottom: new Array(maxTracks).fill(-Infinity),
        };

        // 按时间排序（确保按顺序分配轨道）
        const sortedComments = [...comments].sort((a, b) => a.time - b.time);

        const filteredComments = sortedComments.filter(c => {
            const mode = c.mode || 'rtl';
            const trackList = tracks[mode];
            if (!trackList) return true; // 未知模式，保留

            const time = c.time;

            // 计算轨道占用时间
            let occupyDuration;
            if (mode === 'top' || mode === 'bottom') {
                // 顶部/底部弹幕：占用整个显示时间
                occupyDuration = duration;
            } else {
                // 滚动弹幕：只需要等弹幕完全进入屏幕即可
                // 加一点缓冲时间（0.5秒）避免弹幕太紧凑
                occupyDuration = minOccupyTime + 0.5;
            }

            // 尝试找一个空闲轨道
            for (let i = 0; i < trackList.length; i++) {
                if (trackList[i] <= time) {
                    trackList[i] = time + occupyDuration;
                    return true; // 找到空闲轨道，保留弹幕
                }
            }
            return false; // 没有空闲轨道，丢弃弹幕
        });

        const afterCount = filteredComments.length;
        const filteredCount = beforeCount - afterCount;
        if (filteredCount > 0) {
            console.log(`[防重叠] 容器: ${containerWidth}x${containerHeight}, 可用高度: ${availableHeight.toFixed(0)}px, 弹幕高度: ${danmakuHeight.toFixed(1)}px, 可用轨道: ${maxTracks}, 过滤前: ${beforeCount}, 过滤后: ${afterCount}, 丢弃: ${filteredCount}`);
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
            console.log('[自动过滤] ' + msg);
        }
    }

    function danmakuAutoFilterCancel() {
        if (Object.keys(window.ede.tempLsValues).length > 0) {
            objectEntries(window.ede.tempLsValues).forEach(([key, val]) => lsSetItem(key, val));
            window.ede.tempLsValues = {};
            console.log('[自动过滤] 已从临时值恢复用户设置');
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
        let limit = 9 - level * 2;
        let vertical_limit = 6;
        let arr_comments = [];
        let vertical_comments = [];
        for (let index = 0; index < comments.length; index++) {
            let element = comments[index];
            let i = Math.ceil(element.time);
            let i_v = Math.ceil(element.time / 3);
            if (!arr_comments[i]) {
                arr_comments[i] = [];
            }
            if (!vertical_comments[i_v]) {
                vertical_comments[i_v] = [];
            }
            // TODO: 屏蔽过滤
            if (vertical_comments[i_v].length < vertical_limit) {
                vertical_comments[i_v].push(element);
            } else {
                element.mode = 'rtl';
            }
            if (arr_comments[i].length < limit) {
                arr_comments[i].push(element);
            }
        }
        return arr_comments.flat();
    }

    /** 通过屏蔽关键词过滤弹幕 */
    function danmakuKeywordsFilter(comments) {
        if (!lsGetItem(lsKeys.filterKeywordsEnable.id)) { return comments; }
        const keywords = lsGetItem(lsKeys.filterKeywords.id)
            .split(/\r?\n/).map(k => k.trim()).filter(k => k.length > 0 && !k.startsWith('// '));
        if (keywords.length === 0) { return comments; }
        const cKeys = [ 'text', ...Object.keys(showSource) ];
        return comments.filter(comment =>
            !keywords.some(keyword => {
                try {
                    return cKeys.some(key => new RegExp(keyword).test(comment[key]));
                } catch (error) {
                    return cKeys.some(key => comment[key].includes(keyword));
                }
            })
        );
    }

    // --- 优化：复用 Worker 实例的合并函数 ---
    function danmakuMergeSimilar(comments, threshold = 50, timeWindow = 15) {
        return new Promise((resolve) => {
            const enable = lsGetItem(lsKeys.mergeSimilarEnable.id);
            if (!enable || !comments || comments.length === 0) {
                resolve(comments);
                return;
            }

            // [优化] 复用 Worker，避免重复创建销毁的开销
            if (!window.ede.mergeWorker) {
                console.log('[合并Worker] 初始化新线程...');
                window.ede.mergeWorker = createWorker(mergeWorkerBody);
            }

            const worker = window.ede.mergeWorker;
            const startTime = performance.now();

            // 1. 数据精简 (Data Slimming)
            // 只提取 text(t) 和 time(m) 以及原始索引(i)
            // 5万条数据，这个 map 操作非常快 (<10ms)，但能减少传输体积 80%
            const lightComments = comments.map((c, index) => ({
                t: c.text,
                m: c.time,
                i: index
            }));

            const onMessage = (e) => {
                const results = e.data; // 这是一个轻量数组 [{i:0, t:null}, {i:3, t:"xxx [x2]"}...]
                const endTime = performance.now();
                
                worker.removeEventListener('message', onMessage);

                if (!results) { // Worker 说没开启或出错
                    resolve(comments);
                    return;
                }

                // 2. 数据重组 (Rehydration)
                // 根据 Worker 返回的“保留名单”和“新文本”，重建完整的弹幕对象数组
                const finalComments = results.map(item => {
                    const originalComment = comments[item.i]; // 通过索引找回原始完整对象(带style等)
                    if (item.t) {
                        // 如果有合并，创建一个新对象修改 text，避免污染源数据
                        // 浅拷贝速度很快
                        return { ...originalComment, text: item.t, xCount: true }; // 标记一下
                    }
                    return originalComment;
                });

                console.log(`[合并相似弹幕] 完成, 耗时: ${(endTime - startTime).toFixed(2)}ms, 屏蔽: ${comments.length - finalComments.length}`);
                resolve(finalComments);
            };

            worker.addEventListener('message', onMessage);

            // 发送精简数据
            worker.postMessage({
                lightComments: lightComments,
                threshold: threshold,
                timeWindow: timeWindow,
                enable: enable
            });
        });
    }

    /**
     * Levenshtein 距离算法 (高性能魔改版)
     * 特性: 
     * 1. Buffer Reuse: 复用传入的 Int32Array，零内存分配
     * 2. Early Exit: 差异超过 maxAllowedDiff 立即停止
     * 3. CharCode: 使用 charCodeAt 代替字符串访问，微幅提升速度
     */
    function similarityPercentage(a, b, maxAllowedDiff, buffer) {
        if (a === b) return 100;
        
        const n = a.length;
        const m = b.length;
        
        if (n === 0 || m === 0) return 0;

        // 确保 a 是短的，减少内层循环次数
        if (n > m) return similarityPercentage(b, a, maxAllowedDiff, buffer);
        
        // 检查 buffer 是否够用，不够则扩容并返回新 buffer (这种情况极少)
        if (buffer.length <= n + 1) {
            const newBuffer = new Int32Array(n + 128);
            const score = similarityPercentage(a, b, maxAllowedDiff, newBuffer);
            return { score: score, buffer: newBuffer };
        }

        const v = buffer; // 使用共享内存

        // 初始化第一行
        for (let i = 0; i <= n; i++) v[i] = i;

        for (let j = 1; j <= m; j++) {
            let pre = v[0];
            v[0] = j;
            
            // 记录当前行的最小值，用于提前退出判断
            let rowMin = j;
            
            // [微调] 使用 charCodeAt 提升比较速度
            const charB = b.charCodeAt(j - 1); 
            
            for (let i = 1; i <= n; i++) {
                const tmp = v[i];
                const cost = (a.charCodeAt(i - 1) === charB) ? 0 : 1;
                
                // 手写 Math.min 逻辑，JS中比调用 Math.min 快
                let val = v[i] + 1;       // 删除
                const ins = v[i-1] + 1;   // 插入
                if (ins < val) val = ins;
                const sub = pre + cost;   // 替换
                if (sub < val) val = sub;
                
                v[i] = val;
                pre = tmp;
                
                if (val < rowMin) rowMin = val;
            }

            // [核心优化] 提前退出：如果当前行所有位置的差异都已超过允许值，后续只会更大，直接放弃
            if (rowMin > maxAllowedDiff) {
                return 0; 
            }
        }

        const maxLen = m; // m 是较长的那个
        const distance = v[n];
        return ((maxLen - distance) / maxLen) * 100;
    }
 
    function danmakuParser($obj) {
        //const fontSize = Number(values[2]) || 25
        const fontSizeRate = lsGetItem(lsKeys.fontSizeRate.id) / 100;
        let fontSize = 25;
        // 播放页媒体次级标题 h3 元素
        const fontSizeReferent = getByClass(classes.videoOsdTitle);
        if (fontSizeReferent) {
            fontSize = parseFloat(getComputedStyle(fontSizeReferent).fontSize.replace('px', '')) * fontSizeRate;
        } else {
            fontSize = Math.round(
                (window.screen.height > window.screen.width
                    ? window.screen.width
                    : window.screen.height / 1080) * 18 * fontSizeRate
            );
        }
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
        // const removeEmojiEnable = lsGetItem(lsKeys.removeEmojiEnable.id);
        //const $xml = new DOMParser().parseFromString(string, 'text/xml')
        return $obj
            .map(($comment) => {
                const p = $comment.p;
                //if (p === null || $comment.childNodes[0] === undefined) return null;
                const values = p.split(',');
                const mode = { 6: 'ltr', 1: 'rtl', 5: 'top', 4: 'bottom' }[values[1]];
                if (!mode) return null;
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
                cmt.cuid = cmt[showSource.cid.id] + ',' + cmt[showSource.originalUserId.id];
                // if (removeEmojiEnable) {
                //     cmt.text = cmt.text.replace(emojiRegex, '');
                // }
                return cmt;
            })
            .filter((x) => x)
            .sort((a, b) => a.time - b.time);
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

        danmakuTabOpts.forEach((tab, index) => {
            const tabContainer = document.createElement('div');
            tabContainer.id = tab.id;
            tabContainer.style.textAlign = 'left';
            tabContainer.hidden = index != 0;
            dialogContainer.append(tabContainer);
            try {
                tab.buildMethod(tab.id);
            } catch (error) {
                console.error(error);
            }
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
        const timelineOffsetOpts = { lsKey: lsKeys.timelineOffset };
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
                console.error(err);
            });
        } else {
            console.info('queryLocalFonts 高级查询 API 不可用,使用预定字体列表');
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
                    console.log('fontFamilyDivChange: ', value, index, option);
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
            console.log(`The local font "${family}" has been added under the name "${family}"`);
        }).catch(err => {
            console.error(`Failed to load or add the local font "${family}"`, err);
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
                <div is="emby-collapse" title="附加弹幕">
                    <div class="${classes.collapseContentNav}">
                        <label class="${classes.embyLabel}">弹弹 play 支持解析的第三方 url: </label>
                        <div id="${eleIds.extCommentSearchDiv}" style="display: flex;"></div>
                        <div class="${classes.embyFieldDesc}">
                            原接口文档说明支持(如A/B/C站),自测另外支持[ 爱奇艺视频, 腾讯视频, 优酷视频, ],不支持[ 芒果 TV, ]
                        </div>
                        <div class="${classes.embyFieldDesc}">
                            仅[ 爱奇艺视频, ]需要注意网址后不能带 ? 的参数,其余网址带不带都可以
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="服务端 Danmu 插件">
                    <div class="${classes.collapseContentNav}">
                        <div id="${eleIds.danmuPluginDiv}" class="${classes.embyCheckboxList}" style="${styles.embyCheckboxList}"></div>
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
        buildExtCommentDiv();
        buildDanmuPluginDiv();

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
                    lsLocalKeys.bangumiMe // [修复] 添加Bangumi用户信息缓存
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

            // 添加表单
            const addForm = document.createElement('div');
            addForm.style.cssText = 'display: flex; gap: 0.5em; align-items: center; background: rgba(0, 0, 0, 0.3); padding: 1em; border-radius: 4px; margin-bottom: 1em; flex-wrap: wrap;';

            const nameInput = document.createElement('input');
            nameInput.setAttribute('is', 'emby-input');
            nameInput.className = classes.embyInput;
            nameInput.type = 'text';
            nameInput.placeholder = '源名称 (备注)';
            nameInput.style.cssText = 'flex: 1; min-width: 120px;';

            const urlInput = document.createElement('input');
            urlInput.setAttribute('is', 'emby-input');
            urlInput.className = classes.embyInput;
            urlInput.type = 'text';
            urlInput.placeholder = 'API 地址 (http://...)';
            urlInput.style.cssText = 'flex: 2; min-width: 200px;';

            const addBtn = document.createElement('button');
            addBtn.setAttribute('is', 'emby-button');
            addBtn.className = 'raised button-submit emby-button';
            addBtn.innerHTML = '<i class="md-icon">check</i> 添加';
            addBtn.style.cssText = 'height: 2.5em; flex: 0 0 auto;';
            addBtn.onclick = () => {
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
                addCustomApiSource(name, url);
                nameInput.value = '';
                urlInput.value = '';
                renderSourceList();
                embyToast({ text: '已添加弹幕源', secondaryText: name });
            };

            // 回车添加
            urlInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') addBtn.click();
            });

            addForm.append(nameInput, urlInput, addBtn);
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

                    // 启用开关
                    const switchDiv = document.createElement('div');
                    switchDiv.style.cssText = 'margin-right: 0.5em; flex-shrink: 0;';
                    switchDiv.append(embyCheckbox({ label: '' }, item.enabled, (checked) => {
                        toggleCustomApiSource(index, checked);
                        renderSourceList();
                    }));
                    row.append(switchDiv);

                    // 信息显示
                    const infoDiv = document.createElement('div');
                    infoDiv.style.cssText = 'flex: 1; min-width: 0; overflow: hidden;';
                    const nameStyle = item.enabled ? 'font-weight:bold;' : 'font-weight:bold; color: #999;';
                    const urlStyle = 'font-size:0.8em; opacity:0.7; word-break: break-all; overflow: hidden; text-overflow: ellipsis;';
                    infoDiv.innerHTML = `<div style="${nameStyle}">${item.name}</div><div style="${urlStyle}" title="${item.url}">${item.url}</div>`;
                    row.append(infoDiv);

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
        searchNameDiv.append(embyInput({ id: eleIds.danmakuSearchName, value: window.ede.searchDanmakuOpts.animeName, type: 'search' }
            , doDanmakuSearchEpisode));
        searchNameDiv.append(embyButton({ label: '搜索', iconKey: iconKeys.search}, doDanmakuSearchEpisode));

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
        prioritySwitch.style.cssText = 'position: relative; width: 110px; height: 32px; background-color: #333; border-radius: 16px; cursor: pointer; transition: all 0.3s ease; flex-shrink: 0;';

        const prioritySlider = document.createElement('div');
        prioritySlider.style.cssText = 'position: absolute; top: 2px; width: 58px; height: 28px; background-color: #4a90e2; border-radius: 14px; transition: all 0.3s ease; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;';

        const leftLabel = document.createElement('div');
        leftLabel.style.cssText = 'position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 11px; color: #999; pointer-events: none;';
        leftLabel.textContent = '自定义';

        const rightLabel = document.createElement('div');
        rightLabel.style.cssText = 'position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: 11px; color: #999; pointer-events: none;';
        rightLabel.textContent = '官方';

        prioritySwitch.append(leftLabel, rightLabel, prioritySlider);

        const currentPriority = lsGetItem(lsKeys.apiPriority.id);
        const isOfficialFirst = currentPriority[0] === 'official';

        const updatePrioritySwitch = (officialFirst) => {
            if (officialFirst) {
                prioritySlider.style.left = '50px';
                prioritySlider.textContent = '官方';
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

        // 官方API开关
        const officialCb = embyCheckbox({ label: '启用官方' }, lsGetItem(lsKeys.useOfficialApi.id), (checked) => {
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

    function buildExtCommentDiv() {
        const extCommentSearchDiv = getById(eleIds.extCommentSearchDiv);
        buildExtUrlsDiv();
        extCommentSearchDiv.append(embyInput({ type: 'search', placeholder: 'http(s)://' }, onEnterExtComment));
        extCommentSearchDiv.append(embyButton({ label: '搜索', iconKey: iconKeys.search}, onEnterExtComment));
    }

    function buildExtUrlsDiv() {
        const episodeId = window.ede.episode_info ? window.ede.episode_info.episodeId : null;
        const comments = window.ede.danmuCache[episodeId] || [];
        const curExtCommentCache = window.ede.extCommentCache[window.ede.itemId];
        const allComments = comments.concat(...Object.values(curExtCommentCache || {}));
        const extUrlsDiv = getById(eleIds.extUrlsDiv);
        extUrlsDiv.innerHTML = '';
        curExtCommentCache && objectEntries(curExtCommentCache).forEach(([key, val]) => {
            const extUrlDiv = document.createElement('div');
            extUrlDiv.append(embyButton({ label: '清空此加载', iconKey: iconKeys.close }, (e) => {
                delete curExtCommentCache[key];
                e.target.parentNode.remove();
                createDanmaku(allComments.filter(c => c.fromUrl !== key));
            }));
            extUrlDiv.append(embyALink(key), document.createTextNode(` 总量: ${val.length}`));
            extUrlsDiv.append(extUrlDiv);
        });
    }

    async function onEnterExtComment(e) {
        const extUrl = getTargetInput(e).value.trim();
        if (!extUrl.startsWith('http')) { return embyToast({ text: '输入的 url 应以 http 开头!' }); }
        addExtComments(extUrl);
    }

    async function addExtComments(extUrl, extComments) {
        const episode_info = window.ede.episode_info;
        const episodeId = episode_info ? episode_info.episodeId : null;
        const comments = window.ede.danmuCache[episodeId] || [];
        if (!extComments) {
            extComments = await fetchExtcommentActual(extUrl, comments);
        }
        if (extComments.length === 0) {
            return embyToast({ text: '附加弹幕不能为空!' });
        }
        const allComments = comments.concat(extComments);
        createDanmaku(allComments)
        .then(() => {
            const beforeLength = window.ede.commentsParsed.length - extComments.length;
            embyToast({ text: `此次附加总量: ${extComments.length}, 附加前总量: ${beforeLength}, 附加后总量: ${allComments.length}` });
            console.log(`附加弹幕就位, 附加前总量: ${beforeLength}`);
            buildExtUrlsDiv();
        })
        .catch(err => console.log(err));
    }

    function buildDanmuPluginDiv() {
        getById(eleIds.danmuPluginDiv).append(embyCheckbox(
            { label: lsKeys.useFetchPluginXml.name }, lsGetItem(lsKeys.useFetchPluginXml.id), (checked) => {
                lsSetItem(lsKeys.useFetchPluginXml.id, checked);
            }
        ));
        // getById(eleIds.danmuPluginDiv).append(embyCheckbox(
        //     { label: lsKeys.refreshPluginXml.name }, lsGetItem(lsKeys.refreshPluginXml.id), (checked) => {
        //         lsSetItem(lsKeys.refreshPluginXml.id, checked);
        //     }
        // ));
    }

    function buildCurrentDanmakuInfo(containerId) {
        const container = getById(containerId);
        if (!container) { return; }
        const { episodeTitle, animeId, animeTitle, imageUrl, apiName } = window.ede.episode_info || {};
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
        // 弹幕信息的来源（官方/自定义）在 getEpisodeInfo 中已经决定。
        // 如果 episode_info 中有 imageUrl，说明弹幕来自自定义API，应优先使用自定义海报。
        // 否则，使用官方海报。
        if (imageUrl) {
            posterSrc = imageUrl;
        } else if (animeId) {
            posterSrc = dandanplayApi.posterImg(animeId);
        }

        if (posterSrc) {
            getById(eleIds.posterImgDiv, container).append(
                embyImgButton(embyImg(posterSrc), 'width: calc((var(--videoosd-tabs-height) - 3em) * (2 / 3)); margin-right: 1em;')
            );
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
                    characters.map(c => {
                        const characterDiv = document.createElement('div');
                        characterDiv.style = 'width: 31%; display: flex; margin: .5em;';
                        let embyImgButtonInner = embyImg(c.images.large, 'object-position: top;');
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
                            characterCvDiv.append(embyImgButton(embyImg(c.actors[0].images.large)));
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
                        </div>
                    </div>
                </div>
                <div is="emby-collapse" title="媒体库排除设置">
                    <div id="${eleIds.excludedLibrariesDiv}" class="${classes.collapseContentNav}"></div>
                </div>
                <div is="emby-collapse" title="自定义接口地址">
                    <div id="${eleIds.customeUrlsDiv}" class="${classes.collapseContentNav}"></div>
                </div>
            </div>
        `;
        container.innerHTML = template.trim();
        buildDanmakuFilterSetting(container);
        buildExtSetting(container);
        buildOsdSetting();
        buildPlaySetting(container);
        buildBangumiSetting(container);
        buildExcludedLibrariesSetting(container);
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
        // getById(eleIds.extCheckboxDiv, container).append(embyCheckbox(
        //     { label: lsKeys.removeEmojiEnable.name }, lsGetItem(lsKeys.removeEmojiEnable.id), (checked) => {
        //         lsSetItem(lsKeys.removeEmojiEnable.id, checked);
        //     }
        // ));
        getById(eleIds.danmakuChConverDiv, container).append(
            embyTabs(danmakuChConverOpts, window.ede.chConvert, 'id', 'name', doDanmakuChConverChange)
        );
        getById(eleIds.danmakuEngineDiv, container).append(
            embyTabs(danmakuEngineOpts, lsGetItem(lsKeys.engine.id), 'id', 'name', doDanmakuEngineSelect)
        );
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
                buildProgressBarChart(20);
            }
        ));
        getById(eleIds.osdLineChartTimeDiv).append(
            embySlider({ lsKey: lsKeys.osdLineChartTime, needReload: false }
                , (val, opts) => { onSliderChange(val, opts);buildProgressBarChart(20); }, onSliderChangeLabel)
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
            throw error;
        });
    }

    async function fetchBangumiApiGetMe(bangumiToken) {
        try {
            const res = await fetchJson(bangumiApi.getMe(), { token: bangumiToken });
            console.log('Bangumi Token 验证成功', res);
            localStorage.setItem(lsLocalKeys.bangumiMe, JSON.stringify(res));
            return res;
        } catch (error) {
            console.error('Bangumi Token 验证失败', error);
            throw error;
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

            // 获取当前排除列表
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
                    console.log('[dd-danmaku] 已更新排除媒体库列表:', newExcludedList);
                });
            });
        });
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
                <div id="${eleIds.consoleLogCtrl}"></div>
                <div id="${eleIds.consoleLogInfo}">
                    <textarea id="${eleIds.consoleLogText}" readOnly style="resize: vertical;margin-top: 0.6em;"
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

    function buildConsoleLog(container) {
        const consoleLogEnable = lsGetItem(lsKeys.consoleLogEnable.id);
        getById(eleIds.consoleLogInfo, container).style.display = consoleLogEnable ? '' : 'none';
        if (consoleLogEnable) { doConsoleLogChange(consoleLogEnable); }
        const consoleLogCtrlEle = getById(eleIds.consoleLogCtrl, container);
        consoleLogCtrlEle.append(embyCheckbox({ label: lsKeys.consoleLogEnable.name }, consoleLogEnable, doConsoleLogChange));
        const consoleLogCountLabel = document.createElement('label');
        consoleLogCountLabel.id = eleIds.consoleLogCountLabel;
        consoleLogCtrlEle.append(
            embyButton({ label: '清空', iconKey: iconKeys.block }, () => {
                getById(eleIds.consoleLogText, container).value = '';
                getById(eleIds.consoleLogCountLabel).innerHTML = '';
                if (window.ede.appLogAspect) { window.ede.appLogAspect.value = ''; }
            })
            , consoleLogCountLabel
        );
        const consoleLogTextInput = getById(eleIds.consoleLogTextInput, container);
        consoleLogTextInput.style.display = consoleLogEnable && lsGetItem(lsKeys.quickDebugOn.id) ? '' : 'none';
        consoleLogTextInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const inputVal = e.target.value.trim();
                console.log('输入内容为: \n', inputVal);
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
                console.log(`弹幕容器(#${eleIds.danmakuWrapper})宽高像素:`, wrapper.offsetWidth, wrapper.offsetHeight);
                const stage = wrapper.firstChild;
                console.log(`实际舞台(${stage.tagName})宽高像素:`, stage.offsetWidth, stage.offsetHeight);
            }
        ));
        debugWrapper.append(embyCheckbox({ label: lsKeys.debugShowDanmakuCtrWrapper.name }
            , lsGetItem(lsKeys.debugShowDanmakuCtrWrapper.id), (checked) => {
                lsSetItem(lsKeys.debugShowDanmakuCtrWrapper.id, checked);
                const wrapper = getById(eleIds.danmakuCtr);
                wrapper.style.backgroundColor = checked ? styles.colors.highlight : '';
                if (!checked) { return; }
                console.log(`按钮容器(#${eleIds.danmakuCtr})宽高像素:`, wrapper.offsetWidth, wrapper.offsetHeight);
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
                console.log('已' + lsKeys.debugReverseDanmu.name);
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
                console.log('已' + lsKey.name);
            } else {
                comments = window.ede._oriComments;
                window.ede.danmuCache[window.ede.episode_info.episodeId] = comments;
                console.log('已还原' + lsKey.name);
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
                console.log('Emby 内部自身判断: ', browser);
            });
        }));
        debugWrapper.append(embyButton({ label: '打印弹幕引擎信息', style: 'margin: 0.3em;' }, () => {
            const msg = `弹幕引擎是否存在: ${!!window.Danmaku}, 弹幕引擎是否实例化成功: ${!!window.ede.danmaku}`;
            console.log(msg);
            embyToast({ text: msg });
        }));
        debugWrapper.append(embyButton({ label: '打印视频加载方', style: 'margin: 0.3em;' }, () => {
            const _media = document.querySelector(mediaQueryStr);
            if (!_media) { return console.error('严重错误,页面中依旧不存在 <video> 标签') }
            if (_media.currentTime < 1) { console.error('严重错误,<video> 的 currentTime < 1') }
            if (!_media.id) {
                console.log('视频加载方为 Web 端 <video> 标签:', _media.parentNode.outerHTML);
            } else {
                console.log('当前 <video> 标签为虚拟适配器:', _media.outerHTML);
                const _embed = document.querySelector('embed');
                if (_embed) {
                    console.log('视频加载方为 <embed> 标签占位的 Native 播放器:', _embed.parentNode.outerHTML);
                } else {
                    console.log('视频加载方为无占位标签的 Native 播放器,无信息');
                }
            }
        }));
        debugWrapper.append(embyButton({ label: '清空章节引用缓存', class: classes.embyButtons.submit, style: 'margin: 0.3em;' }, () => {
            lsBatchRemove([lsLocalKeys.animeEpisodePrefix, lsLocalKeys.bangumiEpInfoPrefix]);
            console.log('已清空章节引用缓存');
            embyToast({ text: '已清空章节引用缓存' });
        }));
        debugWrapper.append(embyButton({ label: '重置设置', class: classes.embyButtons.submit, style: 'margin: 0.3em;' }, () => {
            settingsReset();
            console.log(`已重置设置, 跳过了 ${lsKeys.filterKeywords.name} 重置`);
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
     * @deprecated 已废弃,无法登录网站,无太大意义
     */
    function buildIframe(containerId) {
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

    function appendvideoOsdDanmakuInfo(loadSum) {
        if (!lsGetItem(lsKeys.osdTitleEnable.id)) {
            return;
        }
        const episode_info = window.ede.episode_info || {};
        const { episodeId, animeTitle, episodeTitle } = episode_info;
        const videoOsdContainer = document.querySelector(`${mediaContainerQueryStr} .videoOsdSecondaryText`);
        let videoOsdDanmakuTitle = getById(eleIds.videoOsdDanmakuTitle, videoOsdContainer);
        if (!videoOsdDanmakuTitle) {
            videoOsdDanmakuTitle = document.createElement('h3');
            videoOsdDanmakuTitle.id = eleIds.videoOsdDanmakuTitle;
            videoOsdDanmakuTitle.classList.add(classes.videoOsdTitle);
            videoOsdDanmakuTitle.style = 'margin-left: auto; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; position: absolute; right: 0px; bottom: 0px;';
        }
        let text = '弹幕：';
        if (episodeId) {
            text += `${animeTitle} - ${episodeTitle} - ${loadSum}条`;
        } else {
            text += `未匹配`;
        }
        videoOsdDanmakuTitle.innerText = text;
        if (videoOsdContainer) {
            videoOsdContainer.append(videoOsdDanmakuTitle);
        }
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
        console.log('运行时变量检查');
        console.log(lsKeys.customeCorsProxyUrl.name ,corsProxy);
        console.log(lsKeys.customeDanmakuUrl.name, requireDanmakuPath);
        console.log('弹弹play API 模板', dandanplayApi);
        if (exposeGlobalThis) { window.checkRuntimeVars = checkRuntimeVars; }
    }

    function doDanmakuSwitch() {
        console.log('切换' + lsKeys.switch.name);
        const flag = !lsGetItem(lsKeys.switch.id);
        if (window.ede.danmaku) {
            flag ? window.ede.danmaku.show() : window.ede.danmaku.hide();
        }
        const osdDanmakuSwitchBtn = getById(eleIds.danmakuSwitchBtn);
        if (osdDanmakuSwitchBtn) {
            osdDanmakuSwitchBtn.firstChild.innerHTML = flag ? iconKeys.comment : iconKeys.comments_disabled;
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
        console.log('切换' + lsKeys.antiOverlap.name);
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
            official: { name: '官方API', prefix: corsProxy + 'https://api.dandanplay.net/api/v2', enabled: lsGetItem(lsKeys.useOfficialApi.id) },
        };
        if (lsGetItem(lsKeys.useCustomApi.id) && customApiList.length > 0) {
            customApiList.forEach((item, index) => {
                if (item.enabled) {
                    apiConfigs[`custom_${index}`] = { name: item.name || `自定义源${index + 1}`, prefix: item.url, enabled: true };
                }
            });
        }

        const actualPriority = [];
        for (const key of apiPriority) {
            if (key === 'official') actualPriority.push('official');
            else if (key === 'custom') customApiList.forEach((item, i) => item.enabled && actualPriority.push(`custom_${i}`));
        }

        let allAnimes = [];
        console.log(`[手动匹配] 开始并行搜索: ${searchName}`);

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
                    console.log(`[手动匹配][官方API优化] 格式化搜索: 标题='${manualSearchTitle}', 集数=${manualSearchEpisode}`);
                }
            }

            try {
                const animaInfo = await fetchSearchEpisodes(manualSearchTitle, manualSearchEpisode, config.prefix);
                if (animaInfo && animaInfo.animes.length > 0) {
                    // 标记来源
                    animaInfo.animes.forEach(anime => { 
                        anime.apiPrefix = config.prefix; 
                        anime.apiName = config.name; 
                    });
                    return animaInfo.animes;
                }
            } catch (e) {
                console.warn(`[手动匹配] 源 ${config.name} 搜索失败`, e);
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

        console.log(`[手动匹配] 搜索完成，共找到 ${allAnimes.length} 个结果`);

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
        // [修改] 只有当选中的动画有 episodes 时才显示集数选择器
        const selectedAnime = allAnimes[selectAnimeIdx];
        if (selectedAnime.episodes && selectedAnime.episodes.length > 0) {
            const episodeNumSelect = embySelect({ id: eleIds.danmakuEpisodeNumSelect, label: '集数: ', style: 'width: auto;max-width: 100%;' }
                , window.ede.searchDanmakuOpts.episode, selectedAnime.episodes, 'episodeId', (opt, i) => `${i + 1} - ${opt.episodeTitle}`);
            danmakuEpisodeNumDiv.append(episodeNumSelect);
        } else {
            danmakuEpisodeNumDiv.innerHTML = '<span style="color: #52b54b;">请选择动画以加载分集信息</span>';
        }

        getById(eleIds.danmakuEpisodeFlag).hidden = false;
        getById(eleIds.danmakuSwitchEpisode).disabled = false;
        getById(eleIds.searchImg).src = selectedAnime.imageUrl || dandanplayApi.posterImg(selectedAnime.animeId);
        const apiSourceDiv = getById(eleIds.searchApiSource);
        if (apiSourceDiv) apiSourceDiv.innerText = `来源: ${selectedAnime.apiName}`;
    }

    function doSearchTitleSwtich(e) {
        const searchInputEle = getById(eleIds.danmakuSearchName);
        const attrKey = 'isOriginalTitle';
        if ('1' === e.target.getAttribute(attrKey)) {
            e.target.setAttribute(attrKey, '0');
            return searchInputEle.value = window.ede.searchDanmakuOpts.animeName;
        }
        const { _episode_key, seriesOrMovieId } = window.ede.searchDanmakuOpts;
        const episode_info = JSON.parse(localStorage.getItem(_episode_key));
        const { animeOriginalTitle } = episode_info;
        if (animeOriginalTitle) {
            e.target.setAttribute(attrKey, '1');
            return searchInputEle.value = animeOriginalTitle;
        }
        ApiClient.getItem(ApiClient.getCurrentUserId(), seriesOrMovieId).then(item => {
            if (item.OriginalTitle) {
                e.target.setAttribute(attrKey, '1');
                searchInputEle.value = item.OriginalTitle;
                episode_info.animeOriginalTitle = item.OriginalTitle;
                localStorage.setItem(_episode_key, JSON.stringify(episode_info));
                window.ede.episode_info.animeOriginalTitle = item.OriginalTitle;
            }
        });
    }

    async function doDanmakuAnimeSelect(value, index, option) {
        const numDiv = getById(eleIds.danmakuEpisodeNumDiv);
        numDiv.innerHTML = '';
        const anime = window.ede.searchDanmakuOpts.animes[index];

        // [新增] 如果该动画还没有分集信息，先获取
        if (!anime.episodes && anime.bangumiId) {
            console.log(`[手动匹配] 动画 ${anime.animeTitle} 缺少分集信息，正在获取...`);
            numDiv.innerHTML = '<span style="color: #52b54b;">正在加载分集信息...</span>';

            const apiPrefix = anime.apiPrefix || window.ede.searchDanmakuOpts.apiPrefix;
            const bangumiUrl = `${apiPrefix}/bangumi/${anime.bangumiId}`;

            try {
                const bangumiResult = await fetchJson(bangumiUrl);
                if (bangumiResult && bangumiResult.bangumi && bangumiResult.bangumi.episodes) {
                    // 更新动画对象，添加分集信息
                    anime.episodes = bangumiResult.bangumi.episodes;
                    anime.seasons = bangumiResult.bangumi.seasons;
                    console.log(`[手动匹配] 获取分集信息成功: ${anime.animeTitle}, 共 ${anime.episodes.length} 集`);
                } else {
                    console.error(`[手动匹配] 获取分集信息失败: 返回数据格式错误`);
                    numDiv.innerHTML = '<span style="color: #e23636;">获取分集信息失败</span>';
                    return;
                }
            } catch (error) {
                console.error(`[手动匹配] 获取分集信息失败: ${error.message}`);
                numDiv.innerHTML = '<span style="color: #e23636;">获取分集信息失败</span>';
                return;
            }

            numDiv.innerHTML = '';
        }

        // 切换剧集时，默认选中第一个分集
        const episodeNumSelect = embySelect({ id: eleIds.danmakuEpisodeNumSelect, label: '集数: ' }, 0, anime.episodes, 'episodeId', (opt, i) => `${i + 1} - ${opt.episodeTitle}`);
        episodeNumSelect.style.maxWidth = '100%';
        numDiv.append(episodeNumSelect);

        // [修正] 始终使用匹配到的海报
        getById(eleIds.searchImg).src = anime.imageUrl || dandanplayApi.posterImg(anime.animeId);

        // [新增] 更新API来源显示
        const apiSourceDiv = getById(eleIds.searchApiSource);
        if (apiSourceDiv) apiSourceDiv.innerText = `来源: ${anime.apiName}`;
    }

    function doDanmakuSwitchEpisode() {
        const animeSelect = getById(eleIds.danmakuAnimeSelect);
        const episodeNumSelect = getById(eleIds.danmakuEpisodeNumSelect);
        const anime = window.ede.searchDanmakuOpts.animes[animeSelect.selectedIndex];

        // [修正] 构造一个更完整的 episodeInfo 对象，并使用正确的 unique_episode_key
        const { _episode_key, seriesOrMovieId } = window.ede.searchDanmakuOpts;
        const episodeInfo = {
            episodeId: episodeNumSelect.value,
            episodeTitle: episodeNumSelect.options[episodeNumSelect.selectedIndex].text,
            episodeIndex: episodeNumSelect.selectedIndex,
            bgmEpisodeIndex: episodeNumSelect.selectedIndex, // 假设与剧集索引相同
            animeId: anime.animeId,
            animeTitle: anime.animeTitle,
            animeOriginalTitle: '', // 手动匹配时通常没有
            imageUrl: anime.imageUrl,
            apiPrefix: anime.apiPrefix, // [修正] 携带API前缀
            apiName: anime.apiName, // [新增] 携带API名称
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

        console.log(`手动匹配成功，已加载新弹幕信息:`, episodeInfo);
        loadDanmaku(LOAD_TYPE.RELOAD);
        closeEmbyDialog();
    }

    function writeLsSeasonInfo(_season_key, newSeasonInfo) {
        if (!_season_key) {
            return console.log(`_season_key is undefined, skip`);
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
            console.log(`已更改弹幕引擎为: ${selectedValue}`);
            loadDanmaku(LOAD_TYPE.RELOAD);
        }
    }

    function doDanmakuChConverChange(value) {
        window.ede.chConvert = value.id;
        lsSetItem(lsKeys.chConvert.id, window.ede.chConvert);
        loadDanmaku(LOAD_TYPE.REFRESH);
        console.log(`简繁转换已切换为: ${value.name}`);
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
    container._scrollHandler = () => window.requestAnimationFrame(render);
    container.addEventListener('scroll', container._scrollHandler);
}

    function doDanmakuTypeFilterSelect() {
        const checkList = Array.from(document.getElementsByName(eleIds.danmakuTypeFilterSelectName))
            .filter(item => item.checked).map(item => item.value);
        lsSetItem(lsKeys.typeFilter.id, checkList);
        loadDanmaku(LOAD_TYPE.RELOAD);
        const idNameMap = new Map(Object.values(danmakuTypeFilterOpts).map(opt => [opt.id, opt.name]));
        console.log(`当前弹幕类型过滤为: ${JSON.stringify(checkList.map(s => idNameMap.get(s)))}`);
    }

    function doDanmakuSourceFilterSelect() {
        const checkList = Array.from(document.getElementsByName(eleIds.danmakuSourceFilterSelectName))
            .filter(item => item.checked).map(item => item.value);
        lsSetItem(lsKeys.sourceFilter.id, checkList);
        loadDanmaku(LOAD_TYPE.RELOAD);
        console.log(`当前弹幕来源平台过滤为: ${JSON.stringify(checkList)}`);
    }

    function doDanmakuShowSourceSelect() {
        const checkList = Array.from(document.getElementsByName(eleIds.danmakuShowSourceSelectName))
            .filter(item => item.checked).map(item => item.value);
        lsSetItem(lsKeys.showSource.id, checkList);
        loadDanmaku(LOAD_TYPE.RELOAD);
        const idNameMap = new Map(Object.values(showSource).map(opt => [opt.id, opt.name]));
        console.log(`当前弹幕显示来源为: ${JSON.stringify(checkList.map(s => idNameMap.get(s)))}`);
    }

    function onSliderChange(val, opts) {
        onSliderChangeLabel(val, opts);
        if (opts.key && lsCheckSet(opts.key, val)) {
            let needReload = opts.needReload !== false;
            if (opts.isManual) {
                needReload = false;
            }
            console.log(`${opts.key} changed to ${val}, needReload: ${needReload}`);
            if (needReload) {
                changeFontStylePreview();
                loadDanmaku(LOAD_TYPE.RELOAD);
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
            window.ede.appLogAspect.on(newValue => {
                if (consoleLogTextEle.value.length !== newValue.length) {
                    consoleLogTextEle.value = newValue;
                    consoleLogTextEle.scrollTop = consoleLogTextEle.scrollHeight;
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

    function getById(childId, parentNode = document) {
        return parentNode.querySelector(`#${childId}`);
    }

    /**
     * @param {string} className - 元素的类名不带点
     * * @param {HTMLElement | null} [parentNode] - 父元素,默认为 document
     * @returns {HTMLElement | null} - 返回找到的单个元素或 null
     */
    function getByClass(className, parentNode = document) {
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



    /** props: {id: 'btnId', label: 'label text', style: '', iconKey: '',...} for setAttribute(key, value)
     * 'iconKey' will innerHTML <i>iconKey</i>|function will not setAttribute
     */
    function embyButton(props, onClick) {
        const button = document.createElement('button');
        // !!! important: this is must setAttribute('is', 'emby-xxx'), unknown reason
        button.setAttribute('is', 'emby-button');
        button.setAttribute('type', 'button');
        objectEntries(props).forEach(([key, value]) => {
            if (key !== 'iconKey' &&  typeof value !== 'function') { button.setAttribute(key, value); }
        });
        if (props.iconKey) {
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
                    console.log('Link copied to clipboard:', href);
                    const label = document.createElement('label');
                    label.textContent = '已复制';
                    label.style.color = 'green';
                    label.style.paddingLeft = '0.5em';
                    aEle.append(label);
                    setTimeout(() => {
                        aEle.removeChild(label);
                    }, 3000);
                }, (err) => {
                    console.error('Failed to copy link:', err);
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
        span.innerHTML = label;
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
                if (!optsKeys.includes('value')) { options.value = lsGetItem(value.id); }
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
                console.warn('waitForElement error:', error);
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
            .catch(error => { console.log('点击弹出框外部取消: ' + error) });
    }

    function closeEmbyDialog() {
        getByClass(classes.formDialogFooterItem).dispatchEvent(new Event('click'));
    }

    function embyImg(src, style, id, draggable = false) {
        const img = document.createElement('img');
        img.id = id;
        img.src = src;
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
            .catch(error => { console.log('点击弹出框外部取消: ' + error) });
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
            ([key, value]) => [value.id, lsGetItem(value.id)])), null, space);
            // ([key, value]) => [value.id, { value: lsGetItem(value.id), name: value.name }])), null, space);
    }

    function settingsReset() {
        const defaultSettings = Object.fromEntries(
            objectEntries(lsKeys)
            .filter(([key, value]) => lsKeys.filterKeywords.id !== value.id)
            .map(([key, value]) => [value.id, value.defaultValue])
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
            list = list.map((url, index) => ({
                name: `自定义源${index + 1}`,
                url: url,
                enabled: true
            }));
            lsSetItem(lsKeys.customApiList.id, list);
        }

        // 兼容旧版：如果列表为空但旧配置有值，则迁移
        if (list.length === 0) {
            const oldPrefix = lsGetItem(lsKeys.customApiPrefix.id);
            if (oldPrefix && oldPrefix.trim()) {
                list.push({ name: '自定义源1', url: oldPrefix.trim(), enabled: true });
                lsSetItem(lsKeys.customApiList.id, list);
            }
        }
        return list;
    }

    /**
     * 获取启用的自定义弹幕源URL列表（用于搜索逻辑）
     */
    function getEnabledCustomApiUrls() {
        const list = getCustomApiList();
        return list.filter(item => item.enabled).map(item => item.url);
    }

    /**
     * 添加自定义弹幕源
     */
    function addCustomApiSource(name, url) {
        const list = getCustomApiList();
        // 检查URL是否已存在
        if (!list.some(item => item.url === url)) {
            list.push({ name: name || `自定义源${list.length + 1}`, url: url, enabled: true });
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

    // 缓存相关方法
    function lsGetItem(id) {
        const key = lsGetKeyById(id);
        if (!key) { return null; }
        const defaultValue = lsKeys[key].defaultValue;
        const item = localStorage.getItem(id);
        // [修复] 如果 localStorage 中没有值，或者值为空字符串且默认值不为空，则返回默认值
        if (item === null || (item === '' && defaultValue !== '')) { return defaultValue; }
        if (Array.isArray(defaultValue)) { return JSON.parse(item); }
        if (Array.isArray(defaultValue) || typeof defaultValue === 'object') { return JSON.parse(item); }
        if (typeof defaultValue === 'boolean') { return item === 'true'; }
        if (typeof defaultValue === 'number') { return parseFloat(item); }
        return item;
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
    function lsSetItem(id, value) {
        if (!lsGetKeyById(id)) { return; }
        let stringValue;
        if (Array.isArray(value)) {
            stringValue = JSON.stringify(value);
        } else if (typeof value === 'object') {
            stringValue = JSON.stringify(value);
        } else {
            stringValue = value;
        }
        localStorage.setItem(id, stringValue);
    }
    function lsGetKeyById(id) {
        return Object.keys(lsKeys).find(key => lsKeys[key].id === id);
    }
    function lsBatchRemove(prefixes) {
        return Object.keys(localStorage)
        .filter(key => prefixes.some(prefix => key.startsWith(prefix)))
            .map(key => { console.log('Removing cache key:', key); localStorage.removeItem(key); })
            .length > 0;
    }

    function destroyAllInterval() {
        window.ede.destroyIntervalIds.map(id => clearInterval(id));
        window.ede.destroyIntervalIds = [];
    }

    /**
     * @param {string|object} target - 等待目标,string 为 selector,object 目标高级自定义 { element: ele, needParent: true }
     * @param {function} callback - 等待目标获取成功后的回调函数,参数为元素
     * @param {number} [timeout=10000] - 超时时间,默认10秒,0则不设置超时
     * @param {number} [interval=check_interval] - 检查间隔,默认200ms
     * @returns {Promise<HTMLElement|null>} - 返回一个 Promise 对象:
     *   - 如果目标元素在超时时间内被找到,Promise 将 resolve 为目标元素 (HTMLElement)
     *   - 如果超时且未找到目标元素,Promise 将 reject 为一个 Error 对象,表示查找失败
    */
    function waitForElement(target, callback, timeout = 10000, interval = check_interval) {
        let intervalId = null;
        let timeoutId = null;
        const isSelector = typeof target === 'string';
        const elementMark = isSelector ? target : target.element.tagName;
    
        const promise = new Promise((resolve, reject) => {
            function checkElement() {
                console.log(`waitForElement: checking element[${elementMark}]`);
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
                    console.warn(`[waitForElement] 查找元素 [${elementMark}] 超时 (${timeout}ms)`);
                    reject(new Error(`Element [${elementMark}] not found within ${timeout}ms`));
                }, timeout);
            }
        });
    
        return promise;
    }

    function addEasterEggListener() {
        const target = getByClass(classes.headerUserButton);
        if (!target) { return; }
        let longPressTimeout;
        function startLongPress() {
            longPressTimeout = setTimeout(() => {
                console.log('恭喜你发现了隐藏功能, 长按了 2 秒!');
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
    }

    function removeHeaderClock() {
        const headerClockEle = getById('headerClock');
        if (headerClockEle) {
            headerClockEle.remove();
        }
        destroyAllInterval();
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
    async function playbackEventsRefresh(eventsMap) {
        const [playbackManager, events] = await Promise.all([new Promise(resolve => require(['playbackManager'], resolve)), new Promise(resolve => require(['events'], resolve))]);
        const player = playbackManager.getCurrentPlayer();
        if (!player) { return; }
        objectEntries(eventsMap).forEach(([eventName, fn]) => {
            // 无法修改 fn ,会导致引用变更重复添加,events.off 中的 array.indexOf(fn) 返回 -1
            events.off(player, eventName, fn);
            events.on(player, eventName, fn);
        });
    }

    async function initH5VideoAdapter() {
        let _media = document.querySelector(mediaQueryStr);
        if (_media) {
            if (_media.id) { // 若是手动创建的<video>
                videoTimeUpdateInterval(_media, true);
            }
            return;
        }
        console.log('播放页不存在 video 标签,适配器处理开始');
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
            playbackEventsRefresh({
                'timeupdate': (e) => {
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
                             console.log(`[虚拟播放器] 初始化时间: ${realCurrentTime}, 跳过seeking检测`);
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
            'pause': (e) => {
                console.warn('[虚拟播放器] 监听到暂停事件 (pause)');
                _media.dispatchEvent(new Event('pause'));
                videoTimeUpdateInterval(_media, false);
            },
            'unpause': (e) => {
                console.warn('[虚拟播放器] 监听到取消暂停/播放事件 (unpause)');
                // [修复] 播放开始时重置seeking检测标志
                isFirstTimeUpdate = true;
                _media.dispatchEvent(new Event('play'));
                videoTimeUpdateInterval(_media, true);
            },
        });
       console.log('已创建虚拟 video 标签,适配器处理正确结束');
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
        if (e.detail.type !== 'video-osd') { return; }

        // [备份逻辑] 智能推断需要这个，必须放在清空前
        if (window.ede && window.ede.episode_info) {
            window.ede.previous_episode_info = window.ede.episode_info;
        }

        // =========== [UI 瞬间清空区] ===========
        // 1. 立即清空 OSD 文字 (解决右下角残留)
        const videoOsdDanmakuTitle = getById(eleIds.videoOsdDanmakuTitle);
        if (videoOsdDanmakuTitle) {
            videoOsdDanmakuTitle.innerText = ''; // <--- 关键：直接置空 DOM，不要等数据
        }

        // 2. 立即隐藏/清空弹幕画布 (解决屏幕弹幕残留)
        if (window.ede && window.ede.danmaku) {
            window.ede.danmaku.hide();
            window.ede.danmaku.clear();
        }

        // 3. 移除高能进度条 (如果有)
        const chartEle = getById(eleIds.progressBarLineChart);
        if (chartEle) chartEle.remove();
        // =====================================

        // [数据清空]
        if (window.ede) {
            window.ede.episode_info = null; // 防止数据串台
            window.ede.lastLoadId = 'DESTROYED_' + Date.now();
            
            // [新增] 终止所有挂起的网络请求 (Fetch/Worker)
            if (window.ede.abortControllers) {
                for (const controller of window.ede.abortControllers) {
                    controller.abort();
                }
                window.ede.abortControllers.clear();
                console.log('[GC] 已终止所有挂起的网络请求');
            }

            // [新增] 修复 ResizeObserver 内存泄漏：必须显式断开连接
            if (window.ede.ob) {
                window.ede.ob.disconnect();
                window.ede.ob = null;
                console.log('[GC] ResizeObserver 已断开');
            }
        }

        // 清理弹幕实例
        if (window.ede.danmaku) { 
            window.ede.danmaku.clear();
        }

        // 销毁弹幕按钮容器简单,双 mediaContainerQueryStr 下免去 DOM 位移操作
        const danmakuCtr = getById(eleIds.danmakuCtr);
        if (danmakuCtr) { 
            danmakuCtr.remove();
        }
       // const h5VideoAdapterEle = getById(eleIds.h5VideoAdapter);
       // if (h5VideoAdapterEle) {
       //     h5VideoAdapterEle.remove();
       // }
       // 销毁平滑补充 timeupdate 定时器
        videoTimeUpdateInterval(null, false);
        
         // 销毁可能残留的定时器
        destroyAllInterval();
        
        // 退出播放页面重置轴偏秒
        lsSetItem(lsKeys.timelineOffset.id, lsKeys.timelineOffset.defaultValue);
        
        console.log('[生命周期] 播放页环境已销毁 (beforeDestroy)');
    }

    function onViewShow(e) {
        console.log(`监听到视图切换事件 (viewshow), 类型: ${e.detail.type}`);
        customeUrl.init();
        lsGetItem(lsKeys.quickDebugOn.id) && !getById(eleIds.danmakuSettingBtnDebug) && quickDebug();
        addEasterEggListener();

        // 仅在进入播放页(video-osd)时才初始化和设置数据
        if (e.detail.type === 'video-osd') {
            // 1. 确保对象已初始化
            if (!window.ede) { window.ede = new EDE(); }
            
            // [修复] 2. 移到这里：确保 window.ede 存在后再赋值
            window.ede.itemId = e.detail.params.id ? e.detail.params.id : '';

            if (!window.ede.appLogAspect && lsGetItem(lsKeys.consoleLogEnable.id)) {
                window.ede.appLogAspect = new AppLogAspect().init();
            }
            initUI();
            initH5VideoAdapter();
            // loadDanmaku(LOAD_TYPE.INIT);
            initListener();
            initCss();
        }
    }

    // [新增] 挑战-响应认证相关函数
    async function getChallengeResponse(proxyPrefix) {
        if (!window.ede.publicKeyPem) {
            console.warn('Public key not configured for asymmetric auth');
            return null;
        }

        try {
            // 生成随机挑战
            const challenge = generateChallenge();

            // 向Worker请求签名
            const response = await fetch(proxyPrefix + '/auth/challenge', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ challenge })
            });

            if (!response.ok) {
                throw new Error(`Challenge request failed: ${response.status}`);
            }

            const { signature } = await response.json();

            // 使用公钥验证Worker的签名
            const isValid = await verifySignatureWithPublicKey(challenge, signature, window.ede.publicKeyPem);

            if (!isValid) {
                throw new Error('Invalid signature from server');
            }

            // 返回验证成功的标识
            return `${challenge}:${signature}`;
        } catch (error) {
            console.error('Failed to get challenge response:', error);
            return null;
        }
    }

    function generateChallenge() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function verifySignatureWithPublicKey(data, signature, publicKeyPem) {
        try {
            // 导入公钥
            const publicKey = await crypto.subtle.importKey(
                'spki',
                pemToArrayBuffer(publicKeyPem),
                {
                    name: 'RSA-PSS',
                    hash: 'SHA-256',
                },
                false,
                ['verify']
            );

            // 验证签名
            const signatureBuffer = base64ToArrayBuffer(signature);
            const dataBuffer = new TextEncoder().encode(data);

            return await crypto.subtle.verify(
                {
                    name: 'RSA-PSS',
                    saltLength: 32,
                },
                publicKey,
                signatureBuffer,
                dataBuffer
            );
        } catch (error) {
            console.error('Signature verification failed:', error);
            return false;
        }
    }

    function pemToArrayBuffer(pem) {
        const b64 = pem.replace(/-----BEGIN (PRIVATE|PUBLIC) KEY-----/, '')
                       .replace(/-----END (PRIVATE|PUBLIC) KEY-----/, '')
                       .replace(/\s/g, '');
        return base64ToArrayBuffer(b64);
    }

    function base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // emby/jellyfin CustomEvent. see: https://github.com/MediaBrowser/emby-web-defaultskin/blob/822273018b82a4c63c2df7618020fb837656868d/nowplaying/videoosd.js#L698
    refreshEventListener({ 'viewshow': onViewShow });
    refreshEventListener({ 'viewbeforehide': beforeDestroy });

    // [修复] CustomCssJS 兼容：如果脚本在页面已加载后注入，viewshow 事件可能已经错过
    // 需要立即检查当前是否已在播放页面，如果是则手动触发初始化
    console.log('[dd-danmaku] 插件已加载，正在检查当前页面状态...');

    // 延迟执行，确保 Emby 的路由系统已经就绪
    setTimeout(() => {
        // 检查当前 URL 是否包含 videoosd（播放页面）
        const currentPath = window.location.hash || window.location.pathname;
        const isVideoOsdPage = currentPath.includes('videoosd') ||
                               document.querySelector(mediaContainerQueryStr + ' video');

        // 检查是否已经有视频元素（说明已经在播放页面）
        const hasVideoElement = document.querySelector('video');

        console.log(`[dd-danmaku] 当前路径: ${currentPath}, 是否播放页: ${isVideoOsdPage}, 是否有视频元素: ${!!hasVideoElement}`);

        if (isVideoOsdPage || hasVideoElement) {
            console.log('[dd-danmaku] 检测到已在播放页面，手动触发初始化...');

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

})();
