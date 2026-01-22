# emby-danmaku

## Emby 弹幕插件

这是一个为 Emby 设计的弹幕插件，它能够从弹弹play获取弹幕并显示在播放器中。

<img width="1847" height="996" alt="QQ20260121-003523" src="https://github.com/user-attachments/assets/e9a295b2-eac8-41af-a355-bcc4900f2332" />


## 食用方法 (手动注入)

如果你不想使用 `CustomCssJS` 插件，也可以通过手动修改前端文件的方式来加载此脚本。以下方法参考自 Catcat's Blog。

**脚本地址 (二选一):**
```html
<!-- 完整版 -->
<script src="https://cdn.jsdelivr.net/gh/l429609201/dd-danmaku/ede.js" charset="utf-8"></script>

<!-- 本地版 (需自行下载脚本文件) -->
<script src="ede.js" charset="utf-8"></script>
```

### 一、服务器 Web 端

此方法仅对通过浏览器访问 Emby Web 生效。

1.  进入 Emby 服务器的系统目录，找到 `index.html` 文件。
    *   **Docker:** 通常位于 `/system/dashboard-ui/index.html`。
    *   **Windows:** 通常位于 `C:\Users\{你的用户名}\AppData\Roaming\Emby-Server\system\dashboard-ui\index.html`。
2.  用文本编辑器打开 `index.html`。
3.  在 `</body>` 标签**之前**，粘贴上面提供的 `<script>` 标签。
4.  保存文件并重启 Emby Server。
5.  特别说明，如果你的emby服务端使用的是`amilys/embyserver`镜像只需把`ede.js`文件名修改成`ede.user.js`
    放在宿主机某路径，通过映射的方式，映射到容器`/system/dashboard-ui/ede.user.js`处即可，然后该镜像的启动配置文件把弹幕功能打开即可完成web内嵌弹幕插件

    参考的映射路径   `- /mnt/data/data/emby/ede.user.js:/system/dashboard-ui/ede.user.js`

### 二、官方/小秘 PC 客户端 (Emby Theater)

此方法适用于 Windows 和 macOS 的 Emby Theater 客户端。

1.  找到 Emby Theater 的安装目录。
    *   **官方PC客户端** 通常位于 `C:\Users\{你的用户名}\AppData\Roaming\Emby-Theater\system\electronapp\www`。
    *   **小秘PC客户端** 在你的安装路径下  ` ..\Emby Theater\electronapp\www `
2.  用文本编辑器打开该目录下的 `index.html` 文件。
3.  在 `</body>` 标签**之前**，粘贴上面提供的 `<script>` 标签。
4.  保存文件并重启 Emby Theater 客户端。

#### 食用部署教程参考

  - [猫猫Emby服食用指南](https://catcat.blog/catcat-emby.html)

## Fork & 魔改说明

本项目主要基于 chen3861229/dd-danmaku 项目进行二次开发，并整合了来自 pipi20xx/dd-danmaku 的部分优秀功能和修复。

## 主要变更 (Features & Optimizations)

在上述项目的基础上，进行了以下核心功能的增强与优化：

### ✨ 功能增强与优化

1.  **智能 API 切换与海报同步**
    *   **自动匹配**：现在会自动根据用户启用的 API（官方/自定义）进行匹配。当两者都启用时，会优先使用官方 API。
    *   **海报同步**：弹幕信息页面和手动匹配页面的海报图，现在会与实际使用的 API 来源保持严格一致。如果使用了自定义 API 并成功获取了海报，则会显示自定义海报，否则回退到官方海报。

2.  **更精准的标题匹配格式**
    *   插件现在会自动将剧集标题格式化为 `系列名称 SXXEYY` 的格式（例如 `Lycoris Recoil S01E01`）进行匹配，大大提高了多季度番剧的自动匹配准确率。

3.  **缓存管理**
    *   在“手动匹配”页面新增了“**清除本地匹配缓存**”按钮。当后端数据更新或自动匹配错误时，用户可以一键清除本地的匹配记录，强制插件重新进行在线匹配。

4.  **魔改支持**    
    *   支持自定义弹幕API （抄[pipi](https://github.com/pipi20xx)佬PUA的）
    *   追加/match 接口支持，在首次点开媒体的时候尝试对自定义API使用该接口，配合最新版本弹幕库（v2.0.12+），可以自动查找or下载弹幕
    *   魔改插件提取标题的逻辑，针对播放‘电视节目’的时候追加SxxExx的标准化格式，更加容易识别对应的季和集

### 🎨 界面与体验优化

1.  **设置界面重构**
    *   将“API 选择”和“自定义 API 地址”设置项整合到了一个可折叠的区域中，使“手动匹配”页面更加整洁。
    *   调整了按钮布局和样式，使其更符合 Emby 的原生设计风格，提升了视觉一致性。

2.  **分集名显示修复**
    *   彻底解决了在手动匹配的集数选择下拉框中，分集名称显示为 `NaN` 或函数代码的 Bug。

### 🐛 Bug 修复

*   修复了在特定情况下，自定义 API 的 `/match` 接口返回结果无法被正确解析的问题。
*   修复了多处因代码逻辑不严谨可能导致的用户体验问题。

## 参考项目

 - [pipi20xx/dd-danmaku](https://github.com/pipi20xx/dd-danmaku)
 - [chen3861229/dd-danmaku](https://github.com/chen3861229/dd-danmaku)


## 常见问题

如果遇到弹幕加载失败或匹配错误，请优先尝试以下操作：
1.  检查网络连接和 API 设置。
2.  使用“手动匹配”功能，输入正确的番剧名称进行搜索。
3.  点击“**清除本地匹配缓存**”按钮，然后刷新页面或重新进入播放，让插件重新匹配。

如果问题依旧，欢迎提交 Issue。
