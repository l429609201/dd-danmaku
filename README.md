# emby-danmaku

<a id="emby-弹幕插件"></a>

为 Emby 播放器提供弹幕匹配、加载和显示。本项目支持前端脚本模式，也提供带管理页面和服务端功能的 DLL 插件。

[下载发行版](https://github.com/l429609201/dd-danmaku/releases) · [安装 DLL](#dll-版emby-服务端插件) · [手动注入](#食用方法-手动注入) · [常见问题](#常见问题) · [API 说明](#api-说明)

<img width="1847" height="996" alt="Emby 播放器弹幕效果" src="https://github.com/user-attachments/assets/376b7ef5-3776-4aae-8232-4bc20885a606" />

## 选择安装方式

| 方式 | 适用场景 | 包含内容 |
| --- | --- | --- |
| DLL 插件 | 可管理 Emby 服务器，需要本地弹幕、保存授权和后台管理 | 服务端功能、管理页面、内嵌前端脚本 |
| 前端脚本 | 只需要播放器中的匹配与弹幕显示 | 前端功能，不安装 DLL 服务端接口 |

## DLL 版（Emby 服务端插件）

1. 在 [Releases](https://github.com/l429609201/dd-danmaku/releases) 下载 `DD.Danmaku.dll`。稳定使用选择正式发行版，体验新构建选择标题为 `test` 的预发行版。
2. 将 DLL 放入 Emby 插件目录，重启 Emby。
3. 在插件管理页面确认插件已加载，再配置弹幕来源、存储策略和用户授权。

> Web 端自动注入是否生效取决于服务器环境。需要手动加载 `ede.js` 时，请避免同时使用其他注入方式。

**更新方式：**替换旧 DLL 后重启 Emby。单独更新 `ede.js` 不会更新 DLL 内嵌的脚本和管理页面。

## 食用方法 (手动注入)

不使用 `CustomCssJS` 插件时，可以修改客户端入口页面加载脚本。以下方式参考 Catcat's Blog，只提供前端功能。

### 脚本地址

选择 CDN 或本地脚本之一，不要重复加载：

```html
<!-- CDN -->
<script src="https://cdn.jsdelivr.net/gh/l429609201/dd-danmaku/ede.js" charset="utf-8"></script>

<!-- 本地：需提前放置脚本文件 -->
<script src="ede.js" charset="utf-8"></script>
```

<a id="一服务器-web-端"></a>

### 服务器 Web 端

仅对浏览器访问 Emby Web 生效。

| 环境 | 入口文件常见位置 |
| --- | --- |
| Docker | `/system/dashboard-ui/index.html` |
| Windows | `C:\Users\{用户名}\AppData\Roaming\Emby-Server\system\dashboard-ui\index.html` |

1. 打开对应的 `index.html`。
2. 在 `</body>` 之前插入选定的 `<script>` 标签。
3. 保存文件并重启 Emby Server。

**`amilys/embyserver` 镜像：**将脚本命名为 `ede.user.js`，挂载到 `/system/dashboard-ui/ede.user.js`，再开启镜像启动配置中的弹幕功能。挂载示例：

```yaml
volumes:
  - /mnt/data/data/emby/ede.user.js:/system/dashboard-ui/ede.user.js
```

<a id="二官方小秘-pc-客户端-emby-theater"></a>

### PC 客户端

适用于 Windows 和 macOS 的 Emby Theater。

| 客户端 | 入口目录常见位置 |
| --- | --- |
| 官方 Windows 客户端 | `C:\Users\{用户名}\AppData\Roaming\Emby-Theater\system\electronapp\www` |
| 小秘客户端 | 安装目录下的 `Emby Theater\electronapp\www` |

1. 找到客户端的 `index.html`。
2. 在 `</body>` 之前插入选定的 `<script>` 标签。
3. 保存文件并重启客户端。

<a id="食用部署教程参考"></a>

部署参考：[猫猫 Emby 服食用指南](https://catcat.blog/catcat-emby.html)。

<a id="主要变更-features--optimizations"></a>
<a id="-功能增强与优化"></a>
<a id="-界面与体验优化"></a>
<a id="-bug-修复"></a>

## 功能概览

| 功能 | 说明 |
| --- | --- |
| 多来源匹配 | 支持官方和自定义弹幕 API，按启用来源及匹配策略加载弹幕 |
| 标题匹配 | 剧集标题支持 `系列名称 SXXEYY`，例如 `Lycoris Recoil S01E01` |
| 自定义接口 | 支持 `/match`；配合兼容弹幕库（如 v2.0.12+）可查找或下载弹幕 |
| 匹配缓存 | 手动匹配页面可清除本地匹配缓存，重新在线匹配 |
| 信息与海报 | 在线信息与实际 API 来源对应；DLL 本地弹幕使用当前 Emby 媒体信息与海报 |
| 设置界面 | API 选择与自定义地址统一整理，控件布局与 Emby 风格保持一致 |
| 服务端管理 | DLL 提供本地弹幕、保存授权、参数管理和前端日志功能 |

历史修复包括自定义 `/match` 响应解析、分集名称显示为 `NaN` 或函数代码等问题。具体版本改动以 [发行说明](https://github.com/l429609201/dd-danmaku/releases) 为准。

## 常见问题

### 弹幕加载失败或匹配错误

1. 检查网络连接、启用的 API 和自定义地址。
2. 使用手动匹配，输入正确的番剧名称搜索。
3. 清除本地匹配缓存，再刷新页面或重新播放。

仍有问题时，请提交 [Issue](https://github.com/l429609201/dd-danmaku/issues)，提供版本、复现步骤及脱敏日志，不要附带令牌或密钥。

### 更新 DLL 后仍显示旧脚本

确认已替换目标发行版的 DLL 并重启 Emby，再重新打开播放页。DLL 内嵌资源不会随外部脚本更新；同时检查是否存在另一套手动注入。

## API 说明

以下内容面向外部客户端与服务端集成。只使用前端匹配的客户端，不必调用 DLL 本地弹幕接口。

<a id="原版插件与本项目-dll-的-api-说明"></a>

### 接口来源

上游 `pipi20xx/dd-danmaku` 的核心是 Emby 前端脚本，匹配信息主要存放在浏览器或客户端。下面的 `/plugin/danmu`、`/api/danmu` 路径是**本项目提供的旧客户端兼容层**，不是上游公开发布的原生 DLL API。

### 认证与权限

实际请求 URL 应包含 Emby 服务器地址及部署前缀。常见前缀为 `/emby`，但反向代理环境不能写死。

| 调用类型 | 认证与权限 |
| --- | --- |
| 普通业务 API | 有效 Emby 用户令牌；涉及媒体时，该用户必须可访问对应媒体 |
| 管理 API | 用户令牌及 Emby 管理员策略，适用于配置、状态、记录和存储策略等入口 |
| 静态资源 | 管理页面和内嵌脚本可公开 GET；这不代表业务 API 允许匿名访问 |

用户令牌通过 `X-Emby-Token` 请求头发送：

- Emby Web 使用宿主 `ApiClient.accessToken()`。
- 独立客户端使用 Emby 登录响应中的 `AccessToken`。
- DLL 不签发用户令牌，不接受 `UserId` 冒充身份；无用户身份的服务器 API Key 不能替代用户令牌。
- 不承诺 `Authorization: Bearer` 可作为 DLL 的认证头。

```bash
# TOKEN 为占位符；不要将真实凭据写入文档或 shell 历史。
curl -H 'X-Emby-Token: TOKEN' \
  'https://emby.example/emby/dd-danmaku/api/capabilities'
```

### 兼容弹幕读取

<details>
<summary>路径、参数、响应与调用示例</summary>

| 方法 | 路径 |
| --- | --- |
| `GET` | `/plugin/danmu/{Id}` |
| `GET` | `/api/danmu/{Id}` |
| `GET` | `/plugin/danmu/raw/{Id}` |
| `GET` | `/api/danmu/{Id}/raw` |

`{Id}` 为 Emby 媒体项 ID。`/raw` 不绕过认证、媒体权限或 XML 读取开关。

#### 兼容接口参数

四个路径使用相同参数，绑定大小写以 Emby/ServiceStack 规则为准。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `Option` | `DownloadXml` | `DownloadXml` 返回 XML；`GetJsonById` 返回 JSON；`select` 枚举来源 |
| `Mode` | `single` | `single` 读取第一个可用来源；`aggregate` 合并指定范围的多个来源 |
| `Source` | 未指定 | 指定一个来源，不能与 `NeedSites` 同时使用 |
| `NeedSites` | 未指定 | 指定多个来源，最多 32 个；可按列表绑定方式重复传递 |

```text
/emby/plugin/danmu/12345?Option=DownloadXml
/emby/api/danmu/12345?Option=select
/emby/api/danmu/12345?Option=GetJsonById&Mode=aggregate&NeedSites=弹弹play&NeedSites=B站
```

```bash
curl -H 'X-Emby-Token: TOKEN' \
  'https://emby.example/emby/api/danmu/12345?Option=GetJsonById&Mode=single'
```

#### 返回内容与边界

| 选项 | 返回内容 |
| --- | --- |
| `DownloadXml` | `application/xml` 弹幕正文 |
| `GetJsonById` | `{hasNext, data, extra}`，其中 `data` 直接为来源分组数组 |
| `select` | `{ "sources": [...] }` |

来源组保留 `source`、`sourceName`、`opened`、`danmuEvents`，并提供 `itemId`、`storageLocation`、`contentVersion` 供信息查询使用，不再包裹额外的 `group` 对象。

读取既有共享或本人临时正文时，过期的已绑定正文可能按相应授权尝试刷新；失败则保留可用旧正文或回退共享正文。兼容读取不是任意搜索、下载或上传入口；与下方完全只读的 `info` 接口不同。

| 状态码 | 含义 |
| --- | --- |
| `400` | 参数无效 |
| `401` | 无有效用户认证 |
| `403` | 管理接口缺少管理员权限 |
| `404` | 弹幕未找到，或媒体不存在／对用户不可见 |

</details>

### 本地媒体信息与海报接口

```text
GET /dd-danmaku/api/playback/{ItemId}/info
```

接口将已读取的正文与 Emby 媒体展示信息绑定，**不刷新上游、不修改个人选择、不写文件**。要求用户令牌、媒体可见性、XML 总开关及读取开关，不要求管理员或写入权限。

| 参数 | 要求 |
| --- | --- |
| `Source` | 必须显式提供；空字符串表示无来源共享文件 |
| `StorageLocation` | `sidecar` 或 `temporary` |
| `ContentVersion` | 同次正文响应中的 64 位十六进制 SHA-256，大小写不敏感 |

响应包含媒体名、章节与季集、来源、可信上游作品／集数标识和 `Poster`。海报仅提供 Emby 图片项 ID、`Primary` 类型和 `series`／`season`／`item` 层级，不返回带令牌 URL，不猜外部图片。

- 正文来源、存储位置、版本或个人选择变化：`409 PLAYBACK_INFO_CHANGED`。
- 媒体不存在或不可见：`404`。
- `{ItemId}` 使用 Emby 媒体 ID，不能替换成第三方作品／集数 ID。

<details>
<summary>调用示例：先读取正文，再查询同版本信息</summary>

下面先读取绑定字段，再原样调用 `info`。需要已有 `curl` 和 `jq`。

```bash
body="$(curl -fsS -H 'X-Emby-Token: TOKEN' \
  'https://emby.example/emby/api/danmu/12345?Option=GetJsonById&Mode=single')"
item_id="$(printf '%s' "$body" | jq -r '.data[0].itemId')"
source="$(printf '%s' "$body" | jq -r '.data[0].source // ""')"
storage_location="$(printf '%s' "$body" | jq -r '.data[0].storageLocation')"
content_version="$(printf '%s' "$body" | jq -r '.data[0].contentVersion')"

curl -fsS -H 'X-Emby-Token: TOKEN' \
  --get "https://emby.example/emby/dd-danmaku/api/playback/${item_id}/info" \
  --data-urlencode "Source=$source" \
  --data-urlencode "StorageLocation=$storage_location" \
  --data-urlencode "ContentVersion=$content_version"
```

空来源仍须发送 `Source=`。不要自行生成 hash；任意演示 hash 不能通过版本校验。

单独展示请求结构时，可写为以下占位示例，不能直接执行：

```bash
curl -H 'X-Emby-Token: TOKEN' \
  --get 'https://emby.example/emby/dd-danmaku/api/playback/{ItemId}/info' \
  --data-urlencode 'Source=' \
  --data-urlencode 'StorageLocation=sidecar' \
  --data-urlencode 'ContentVersion=CONTENT_VERSION_FROM_BODY'
```

</details>

播放器先显示基础信息，后台补充同版本详情；图片请求使用当前用户令牌请求头：

```text
/Items/{poster.itemId}/Images/Primary?maxWidth=480&quality=90&format=jpg
```

图片响应转为当前加载持有的 Blob URL，切集或退出时取消请求并释放。上游作品 ID 不用于伪造在线匹配对象，外部 API 不接触 Emby token。

完整字段和安全边界见 [DLL 播放链路契约](dll/架构.md#163-播放链路-dto)。

### XML 格式与规范化

<details>
<summary>九段字段与兼容处理</summary>

DLL 采用 Bilibili 兼容的 `<i><d p="...">文本</d></i>` 结构，输出时统一为九段：

| 序号 | 字段 | 含义 |
| --- | --- | --- |
| 1 | 时间 | 视频中出现的秒数 |
| 2 | 模式 | 滚动、顶部、底部等原始模式编号 |
| 3 | 字号 | 弹幕文字大小 |
| 4 | 颜色 | 十进制 RGB 值 |
| 5 | 发送时间戳 | Unix 秒数 |
| 6 | 弹幕池 | 弹幕池类型 |
| 7 | 用户标识 | B 站原始格式为发送者哈希；聚合源可能使用 `[平台]用户ID` 扩展 |
| 8 | 弹幕 ID | 单条弹幕标识，不是视频 CID |
| 9 | 权重 | 权重／屏蔽等级 |

`chatid`、`chatserver`、`sourceprovider` 等根节点元数据可以存在，但不是插件内部弹幕记录的必需字段。

读取兼容缺失或追加字段，并在扫描结果中标记“需规范化”。记录管理页面的规范化任务会保留可解析字段，并以九段格式原子替换原文件。

无法有效解析的单条弹幕会跳过；无法读取或结构损坏的文件保持异常状态，不由规范化任务覆盖。普通读取不会改写 XML。

</details>

<a id="fork--魔改说明"></a>
<a id="参考项目"></a>

## 项目来源

本项目基于 [chen3861229/dd-danmaku](https://github.com/chen3861229/dd-danmaku) 二次开发，并整合了 [pipi20xx/dd-danmaku](https://github.com/pipi20xx/dd-danmaku) 的功能与修复。自定义弹幕 API 支持参考了 pipi 的实现。
