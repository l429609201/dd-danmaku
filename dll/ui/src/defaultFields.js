// 参数定义与 ede.js 的 lsKeys 对齐，仅列出后端支持的非敏感字段。
// 展示标签独立于存储标识，保持播放器数字枚举和字符串数组协议。
export const choices = {
  engine: [['canvas', 'Canvas 画布'], ['dom', 'DOM 元素']],
  fontStyle: [[0, '正常'], [1, '原生斜体'], [2, '形变斜体']],
  chConvert: [[0, '未启用'], [1, '转换为简体'], [2, '转换为繁体']],
  typeFilter: [['bottom', '底部弹幕'], ['top', '顶部弹幕'], ['ltr', '从左至右'], ['rtl', '从右至左'], ['rolling', '滚动弹幕'], ['onlyWhite', '彩色弹幕'], ['emoji', '表情弹幕']],
  sourceFilter: [['AcFun', 'A站'], ['BiliBili', 'B站'], ['DanDanPlay', '弹弹play'], ['D', 'D'], ['Gamer', '巴哈姆特'], ['iqiyi', '爱奇艺'], ['QQ', '腾讯视频'], ['Youku', '优酷'], ['5dm', 'D站'], ['异世界动漫', '异世界动漫']],
  showSource: [['source', '来源平台'], ['originalUserId', '用户 ID'], ['cid', '弹幕 CID']],
  convertTopTo: [['default', '默认'], ['bottom', '底部弹幕'], ['rolling', '滚动弹幕']],
  convertBottomTo: [['default', '默认'], ['top', '顶部弹幕'], ['rolling', '滚动弹幕']],
}
export const labels = { fontStyle: '弹幕斜体', chConvert: '简繁转换', typeFilter: '屏蔽类型', sourceFilter: '屏蔽来源平台', showSource: '显示来源信息' }
// 按播放器面板的顺序分组；只调整展示，不扩展后端持久化字段。
export const groups = [
  { title: '基础设置', basic: true, fields: [
    ['switch', '弹幕开关', true], ['antiOverlap', '防重叠', false],
    ['filterLevel', '过滤等级', 0, 0, 3, 1], ['heightPercent', '显示区域（%）', 70, 3, 100, 1],
    ['fontSizeRate', '弹幕字号（%）', 140, 50, 300, 10], ['fontOpacity', '不透明度（%）', 60, 20, 100, 10],
    ['speed', '弹幕速度（%）', 200, 10, 300, 10],
  ] },
  { title: '弹幕字体样式', fields: [
    ['fontWeight', '弹幕粗细', 400, 100, 1000, 100], ['fontStyle', '弹幕斜体', 0, 0, 2, 1],
    ['fontFamily', '弹幕字体', 'sans-serif'],
  ] },
  { title: '弹幕屏蔽', fields: [
    ['typeFilter', '屏蔽类型', []], ['sourceFilter', '屏蔽来源平台', []], ['showSource', '显示来源信息', []],
  ] },
  { title: '弹幕高级屏蔽', fields: [
    ['autoFilterCount', '自动过滤条数阈值', 0, 0, 10000, 500],
    ['mergeSimilarEnable', '合并相似弹幕', false], ['mergeSimilarPercent', '相似度（%）', 80, 20, 100, 1],
    ['mergeSimilarTime', '时间窗口（秒）', 10, 1, 60, 1],
    ['filterKeywordsEnable', '启用屏蔽关键词', true], ['filterKeywords', '屏蔽关键词', ''],
  ] },
  { title: '弹幕位置转换', fields: [
    ['convertTopTo', '顶部弹幕转换', 'default'], ['convertBottomTo', '底部弹幕转换', 'default'],
  ] },
  { title: '额外设置', fields: [
    ['chConvert', '简繁转换', 1, 0, 2], ['engine', '渲染引擎', 'canvas'],
  ] },
  { title: '自动匹配', fields: [['autoLoadSwitch', '自动加载弹幕', true]] },
  { title: '播放界面设置', fields: [
    ['osdTitleEnable', '显示弹幕信息', false], ['osdHeaderClockEnable', '显示播放时钟', false],
    ['osdLineChartEnable', '高能进度条', false], ['osdLineChartSkipFilter', '高能进度条免过滤', false],
    ['osdLineChartTime', '颗粒度（秒）', 10, 1, 60, 1],
  ] },
]
export const fields = groups.flatMap(group => group.fields)
