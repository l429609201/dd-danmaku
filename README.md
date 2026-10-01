# emby-danmaku

## Emby 弹幕插件

这是一个为 Emby 设计的弹幕插件，它能够从弹弹play获取弹幕并显示在播放器中。

<img width="1847" height="996" alt="image" src="https://github.com/user-attachments/assets/376b7ef5-3776-4aae-8232-4bc20885a606" />

## DLL 版（Emby 服务端插件）

`DD.Danmaku.dll` 是安装在 Emby 服务器上的插件，提供弹幕管理页面和服务端功能，并内置构建时的 `ede.js`。如果只想使用前端脚本，可跳到下方的[手动注入方法](#食用方法-手动注入)；手动注入不会安装 DLL 的服务端功能。

1. 前往 [Releases](https://github.com/l429609201/dd-danmaku/releases) 下载 `DD.Danmaku.dll`：稳定使用选正式发行版，体验新构建选标题为 `test` 的预发行版。
2. 将 DLL 放入 Emby 的插件目录，重启 Emby，并在插件管理页面确认插件已加载。
3. 按需在插件管理页面配置功能。Web 端自动注入是否生效取决于服务器环境；如需手动加载 `ede.js`，请避免重复注入。

更新时下载目标发行版的 DLL，替换旧文件并重启 Emby。仅更新单独下载的 `ede.js` 不会更新 DLL 中内置的脚本和管理页面。

### 原版插件与本项目 DLL 的 API 说明

经对照上游 `pipi20xx/dd-danmaku` 的公开说明，原版插件的核心是 **Emby 前端脚本**：在播放器页面中匹配并加载弹幕，匹配信息主要保存在浏览器或客户端本地存储。上游公开说明并没有把 `/plugin/danmu/{Id}`、`/api/danmu/{Id}` 这一组路径作为原版插件的官方 DLL API 发布。

本项目 DLL 额外提供了下面四个 **兼容旧弹幕插件调用方式的只读接口**。它们是本项目的兼容层，不应表述为原版插件原生接口：

| 方法 | 路径 |
| --- | --- |
| `GET` | `/plugin/danmu/{Id}` |
| `GET` | `/api/danmu/{Id}` |
| `GET` | `/plugin/danmu/raw/{Id}` |
| `GET` | `/api/danmu/{Id}/raw` |

其中 `{Id}` 是 Emby 媒体项 ID。实际 URL 需要加上 Emby 服务器地址及部署时的 API 前缀；常见形式是 `/emby`，但反向代理或服务器配置不同可能有所变化，不能固定假定为 `/emby`。请求必须携带有效的 Emby 用户认证（推荐使用 `X-Emby-Token`，也可由 Emby 支持的认证方式提供），并且该用户必须有权访问对应媒体。

#### 兼容接口参数

四个路径使用相同的查询参数。参数名按原兼容请求模型绑定，大小写以实际客户端和 Emby/ServiceStack 的参数绑定规则为准：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `Option` | `DownloadXml` | `DownloadXml` 返回 XML；`GetJsonById` 返回 JSON；`select` 只返回可用来源列表。 |
| `Mode` | `single` | `single` 读取第一个可用来源；`aggregate` 合并指定范围内的多个来源。 |
| `Source` | 未指定 | 指定一个来源名称；不能和 `NeedSites` 同时使用。 |
| `NeedSites` | 未指定 | 指定多个来源名称，最多 32 个；可按客户端的列表参数方式重复传递。 |

示例：

```text
/emby/plugin/danmu/12345?Option=DownloadXml
/emby/api/danmu/12345?Option=select
/emby/api/danmu/12345?Option=GetJsonById&Mode=aggregate&NeedSites=弹弹play&NeedSites=B站
```

#### 返回内容与边界

- `Option=DownloadXml`：返回 `application/xml` 弹幕文件内容。
- `Option=GetJsonById`：返回 JSON 对象，包含 `hasNext`、`data`、`extra`；`data` 按来源分组，每组包含 `source`、`sourceName`、`opened` 和 `danmuEvents`。
- `Option=select`：返回 `{ "sources": [...] }`，用于枚举服务器上可读取的来源。
- 接口只读取服务器上已经存在的本地弹幕文件，不负责搜索、匹配、刷新、下载或写入弹幕。
- 未找到弹幕返回 `404`；参数无效返回 `400`；没有有效认证返回 `401`；没有媒体访问权限返回 `403`。具体错误响应由 DLL 的 API 错误格式返回。
- `/raw` 只是兼容路径的一部分，不会绕过认证、媒体权限、读取开关或其他安全限制。

### XML 格式与规范化

DLL 读取和写入的规范 XML 采用 Bilibili 常见的 `<i><d p="...">文本</d></i>` 结构。`p` 属性规范为九段：
`时间,模式,字号,颜色,发送时间戳,弹幕池,用户标识,弹幕 ID,权重`。根节点可以包含 `chatid`、`chatserver`、`sourceprovider` 等来源元数据，但这些元数据不是本项目内部弹幕记录的必要字段。

读取时会兼容字段数量不足或追加字段的来源 XML，并在扫描结果中标记为“需规范化”；记录管理页面的“规范化 XML”任务会在保留可解析字段的前提下，以 Bilibili 九段 `p` 格式原子替换原文件。无法解析时间、模式或正文的单条弹幕会被跳过；无法读取或 XML 结构损坏的文件仍标记为异常，不会被规范化任务覆盖。

如果使用的是原版 `ede.js` 或其他仅依赖前端匹配逻辑的客户端，并不要求调用上述 DLL 接口；只有需要从本项目服务器读取本地弹幕文件的旧客户端，才需要使用这组兼容接口。
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
