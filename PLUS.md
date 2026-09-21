# Tree AI Plus

[Anionex/treeAI](https://github.com/Anionex/treeAI) 的增强分支。

上游把「线性对话变成画布」这件事做得很干净：本地优先、数据全在浏览器 IndexedDB、
任何 OpenAI 兼容的模型都能接。这个分支不动那套骨架，补的是三件事：

1. **让 DeepSeek V4 这类推理模型真正好用** —— 思考链、推理强度、按量计费看得见
2. **让它能完全离线自持** —— 零外部请求，可以在没有外网的内网 / 局域网上跑
3. **把一批「点了没反应」的地方修掉** —— 每一条都附根因，不是猜的

> 上游仓库：https://github.com/Anionex/treeAI
> 本分支：`moscams/treeAI` · 分支 `feat/deepseek-v4-reasoning`

---

## 目录

- [一、新增功能](#一新增功能)
  - [1. DeepSeek V4 与思考链](#1-deepseek-v4-与思考链)
  - [2. 每条回答的用量统计](#2-每条回答的用量统计)
  - [3. 暗色模式](#3-暗色模式)
  - [4. JSON 备份与恢复](#4-json-备份与恢复)
  - [5. 会话自动命名](#5-会话自动命名)
  - [6. 视口跟随新节点](#6-视口跟随新节点)
- [二、修复（附根因）](#二修复附根因)
- [三、完全离线](#三完全离线)
- [四、与上游的兼容性](#四与上游的兼容性)
- [五、已知未修](#五已知未修)
- [六、开发与部署](#六开发与部署)
- [七、提交索引](#七提交索引)

---

## 一、新增功能

### 1. DeepSeek V4 与思考链

**推理强度按模型配置。** 每个模型多了一个「思考强度」下拉：`默认（不发送该参数）` /
`none` / `low` / `high` / `max`。

- `默认` 意味着**请求里完全不带 `reasoning_effort` 字段** —— 这样其他服务商不会被
  塞一个它不认识的参数。
- 没显式设置时，`baseUrl` 匹配 `/deepseek/i` 的模型**自动回落到 `low`**。
  聊天用不上高强度的思考配额，默认省下来。
- 顺带修了一个既有 bug：模型级的 `temperature` / `maxTokens` 以前**根本没被用上**，
  创建根节点时走的是硬编码值。

**思考链实时显示。** 推理模型会把思维链放在 `delta.reasoning_content` 这条**独立通道**
里，正文之前全部到达。现在它会：

- 流式实时显示（`思考过程 · N 字 · 思考中…`），流完自动折叠
- 流结束后**持久化到节点上**，随时能展开回看
- **绝不混进 `messages`** —— 只有 `content` 会进对话历史。这点是刻意保证的：
  把思维链塞回上下文既浪费 token，也会让模型行为变得奇怪

### 2. 每条回答的用量统计

每条回答底部一行小字：`1234 字 · ~45 tok/s · 缓存 87% · 入 3200 · 出 850 · 思考 420`。

| 指标 | 说明 |
|---|---|
| 字数 | 回答长度 |
| tok/s | 输出速度 |
| 缓存 | 前缀缓存命中率，≥50% 显示为绿色 |
| 入 / 出 | 输入 / 输出 token |
| 思考 | 推理 token 数 |

**跨服务商可用。** 这是这一项的关键：流式模式下，**OpenAI 及大多数兼容服务端默认
不返回 `usage`**，必须显式下发 `stream_options.include_usage`。DeepSeek 是例外
（它总是带）。所以：

- 默认带上这个参数
- 但有些严格校验的兼容层会因此 **400**，那样就从「没有统计」变成「**没有回复**」——
  严重得多。所以加了自动回退：4xx 且报错提到该参数 → **去掉参数原样重发一次**，
  并把结论按 `baseUrl|modelName` 记下来，同一模型不再白跑失败请求
- 缓存命中字段按各家写法都认：`prompt_cache_hit_tokens`（DeepSeek）、
  `prompt_tokens_details.cached_tokens`（OpenAI / vLLM / llama.cpp）、
  `cache_read_input_tokens`（Anthropic 兼容层）
- 服务商报 `cached_tokens: 0` 会显示成 **`缓存 0%`**（缓存在用，这次没命中），
  而不是被当成「这家没有缓存」把整项藏掉

> **tok/s 的口径**：客户端墙钟计时，`输出 token ÷ 总耗时`。所以它**包含网络延迟和
> 首字延迟**，本地模型会显得比实际解码速度慢。故意没接服务端自报的 `timings` ——
> 那些字段在流式响应里的位置无法可靠验证，猜错会显示错数字。

### 3. 暗色模式

侧边栏底部的 ☀️/🌙 切换。没有闪白（首屏之前就应用），跟随系统偏好，
`<meta name="theme-color">` 一起同步。

实现方式是**把 Tailwind 的中性色阶重映射到 CSS 变量**：

```css
:root      { --c-neutral-50: 250 250 250; ... }
html.dark  { --c-neutral-50: 23 23 23;    ... }   /* 反向 */
```

```js
// tailwind.config.js
neutral: { 50: 'rgb(var(--c-neutral-50) / <alpha-value>)', ... }
```

好处是**所有 `bg-` / `text-` / `border-neutral-*` 以及 hover / focus 变体自动适配，
一个组件都不用改**。写成 `rgb(... / <alpha-value>)` 是为了让 `bg-white/50`
这类透明度修饰符继续工作。

暗色不是简单取反 —— `bg-neutral-900 text-white` 的主按钮在暗色下需要「浅底深字」，
所以单独覆盖了 `html.dark .text-white`。

代码高亮配色、Markdown 正文配色也都走同一套 CSS 变量。

### 4. JSON 备份与恢复

在此之前**没有任何导入功能**。数据只活在这台浏览器的 IndexedDB 里，
清一次站点数据、换个浏览器、换台机器就全没了。思维导图导出是给人看的，
它丢掉 modelId、温度、节点坐标、用量统计 —— 当不了备份。

```jsonc
{
  "format": "treeai-sessions",
  "version": 1,
  "exportedAt": "2026-09-21T...",
  "sessions": [ /* 1 条或 N 条，同一套 schema */ ],
  "models":   [ /* 可选，apiKey 已置空 */ ]
}
```

| 粒度 | 入口 |
|---|---|
| 导出全部 / 导入 | 侧边栏**底部**（设置 · 下载 · 上传 · 主题） |
| 导出单个会话 | 会话项 hover → **文件图标** |

设计取舍：

- **一个 schema 管两种粒度**。导出全部和导出单个会话只差数组长度，
  所以导入只有一条代码路径，单会话文件导到哪都能用
- **`apiKey` 永远置空**。这几乎不要成本：`Session` 里存的是 `modelId` 而不是模型本身，
  密钥本来就不在会话数据里 —— 只影响可选的 `models` 列表
- **模型配置一起导出**，否则导入后每个节点都指向一个不存在的模型，
  重新生成时会静默失败
- **冲突一律跳过，绝不覆盖**。备份工具不能破坏它本该保护的数据；
  而真正的恢复场景（导进一个空浏览器）根本没有冲突。数量会写进提示，
  不会静默处理
- 同一个文件内部的重复 id 也会去重
- 模型那边规则更严：文件里的密钥是空的，**用它覆盖会把你已经填好的密钥抹掉**

### 5. 会话自动命名

第一句话自动变成标题（折叠空白，超 24 字截断加省略号）。纯本地行为，不发任何请求。
只在标题还是默认值时才改，所以你手动改过的标题不会被冲掉。

### 6. 视口跟随新节点

新建节点后视野会**平滑平移**过去。分支一多就会往右排，否则新节点经常落在屏幕外面。

只平移**不改缩放** —— 你缩到 0.3 在看全貌，加个节点就被拉回 1.0 太粗暴。

> 实现上有个坑：React Flow 的 `setCenter` **不传 `zoom` 时会回落到 `maxZoom`**
> （默认 2 倍），也就是会突然放大。所以必须显式传当前缩放。

---

## 二、修复（附根因）

每一条都是读源码定位的，不是猜的。

### 空白页 —— 3034 个图标请求

`vite.config.ts` 里有 `optimizeDeps: { exclude: ['lucide-react'] }`，
导致每个图标变成一次独立请求。广告拦截器拦掉其中
`node_modules/lucide-react/dist/esm/icons/fingerprint.js` 之后，
整个应用在 import 阶段就崩了。删掉这个配置即可。

> 另外一个容易误判的现象：如果**单个**模块返回 HTTP 200 但**长度为 0**，
> 那是 Vite 的转换缓存被污染了 —— 杀掉进程 + `rm -rf node_modules/.vite` 重启。

### 新节点压在父节点身上

```js
// 旧代码
position = {
  x: parentFlowNode.position.x + siblingCount * 100,
  y: parentFlowNode.position.y + 250
};
```

这组数字是「节点宽 350px」时代写的。现在节点宽 **560px**、最高 **760px**，
两个方向都清不开：第二个分支会整个压在第一个身上，**连第一个子节点都会压在父节点身上**
（长回答的节点通常就超过 250px 高）。

现在偏移量来自 **React Flow 实测的节点尺寸**，量不到才退回常量。

### 加了再删再加，位置越来越往右跑

上一版改成「排在最右边那个兄弟的右侧」，解决了重叠，但**忽略了行中间的空位**：

| 操作 | 旧行为 | 现在 |
|---|---|---|
| 加 A / B / C | `A@0  B@780  C@1560` | 同左 |
| **删 A，再加 D** | `B@780  C@1560  D@2340` ← 0 空着 | `B@780  C@1560  **D@0**` |
| **删 B，再加 E** | `C@1560  D@2340  E@3120` | `C@1560  D@0  **E@780**` |

每删一次加一次就整体往右挪一格，左边留个空洞。现在改成**从左往右找第一个放得下的空位**，
「删掉再加 = 放回原位」。

### 连线不完整，点一下或挪一下才出现 ⭐

**这条是 React Flow 的源码级陷阱，也是最隐蔽的一个。**

React Flow 判断「这条边能不能画」的依据是（`getNodeData`）：

```js
const isValid = handleBounds && node?.width && node?.height && ...;
```

```js
// EdgeRenderer
if (!sourceIsValid || !targetIsValid) return null;   // ← 整条边不渲染
```

而 `width` / `height` 的来源是（`createNodeInternals`）：

```js
const internals = { ...node };   // ← 来自我们传进去的节点对象
```

我们每来一个 token 就重建整个节点数组，**而重建时没有带上 `width`/`height`**：

```js
// 旧代码
return { id: node.id, type: node.type, position, data: {...} };   // ← 尺寸丢了
```

于是 `isValid === false` → **边直接不渲染**。只有等下一次重新测量
（拖动节点、点击、`updateNodeInternals`）把尺寸写回来，连线才突然出现。

现在重建时会把上一个节点对象摊在最前面，保留 React Flow 自己写回来的字段：

```js
return { ...previous, id: node.id, type: node.type, position, data };
```

> 这个 bug **上游本来就有**，只是以前新节点都压在父节点身上、连线短到看不出来，
> 节点位置修好之后才暴露。

### 流式输出时闪屏

同一个根因的另一面：每个 token 都会触发 effect 重建**全部**节点对象 + 重建全部
`edges`，整张图跟着重画。

- **没变化的节点直接复用同一个对象引用**，React Flow 会跳过它的渲染 ——
  流式期间只有正在输出的那个节点会更新
- **结构没变就不动 `edges`**（比较 id 指纹）
- 节点 `data` 里的 7 个回调改成**稳定引用**（用 ref 转发到最新实现）。
  否则回调引用每次都变，所有节点都得重渲染 —— 但回调又必须读到最新的
  `session`，所以不能简单 `useCallback` 缓存

### 上传文件后节点掉在原点

`handleUploadComplete` 建的节点**没有 position**，而渲染路径把缺失的 position
当成 `{x: 0, y: 0}` —— 于是直接压在系统节点上。现在走同一套落点计算。

### 五个「静默失败」

| # | 现象 | 根因 |
|---|---|---|
| 1 | 新会话永远用第一个模型 | 创建根节点用 `models[0]`，没用 `defaultModelId`（别处都在用） |
| 2 | 点重新生成没反应 | `handleRetryNode` 在模型不存在时**静默 return** |
| 3 | 切模型时系统提示词状态不明 | 提示只在 `ChatNode` 里发，那里不知道提示词有没有被替换 |
| 4 | 不填系统提示词就存不了模型 | 表单上 `defaultSystemPrompt` 有 `required` |
| 5 | **点保存模型没反应** | API 地址是 `type="url"` —— 少写 `http://` 会被浏览器静默拦住提交 |

> 第 5 条很可能是「模型配置莫名消失」的真正原因。现在改成 `type="text"` +
> `inputMode="url"`：宁可存进去、请求时报错，也不要一个点了没反应的按钮。

### 切换模型时的系统提示词策略

系统节点的内容创建时取自模型的 `defaultSystemPrompt`。

- 提示词**还是**原模型的默认值（你没改过）→ 跟着换成新模型的
- 你**改过** → 一个字都不动

既不丢你手写的内容，也不会出现「换了模型还在用上一个模型的提示词」。

### 会话列表

- 按 `updatedAt` **降序**（刚聊过的浮上来，新建的出现在顶部）
- 修了一个隐藏 bug：`updateSession` 用**未过滤**的列表重建 `filteredSessions` ——
  搜索状态下流式回答结束会触发一次更新，**搜索结果被冲掉，整个列表全回来**

### 暗色模式下的正文不可读

`.md-preview` 带 `prose`，它把 `--tw-prose-body` 钉成 `#374151`；
`@apply prose-invert` **没有真正生效**。现在在 `html.dark` 下显式覆盖 16 个
`--tw-prose-*` 变量。同时给 `MdPreview` 传 `theme={theme}`，
让它自己的代码块 / 表格配色也跟上。

### Ctrl + 滚轮缩放

处理函数无条件 `stopPropagation`，把 React Flow 的捏合缩放手势吃掉了。
现在 `ctrlKey || metaKey` 时放行（`{ capture: true, passive: false }`）。

### 思维导图导出的换行丢失

`escapeXml` 没有转义换行，节点内的多行文本会挤成一行。
补 `.replace(/\r\n|\r|\n/g, '&#10;')` —— **必须放在 `&` 转义之后**，
否则 `&#10;` 会被二次转义成 `&amp;#10;`。

---

## 三、完全离线

上游的 Markdown 渲染器 `md-editor-rt` 会在预览挂载时往页面里插
`<script>` / `<link>`，从 **unpkg.com** 拉 highlight.js、katex、mermaid。
关键是**这些加载是无条件的** —— 不管回答里有没有代码、公式、图表都会拉，
而且**没有 SRI 校验**，等于每次渲染都在执行第三方 CDN 的代码。

实测每次约 **820 KB（gzip）**，其中 mermaid 一家 **743 KB**。

| 资源 | 处理方式 |
|---|---|
| highlight.js | Vite 打包 `highlight.js/lib/common`（35 种语言，比 CDN 那份 190 种语言的版本**还小**）；配色改用 CSS 变量，**夜间模式白送** |
| katex | Vite 打包。`import 'katex/dist/katex.min.css'` 让 Vite 自动改写字体 URL 并产出字体文件，**不用手工拷字体**；字体按需加载 |
| **mermaid** | **关闭**。743 KB 换一个 LLM 聊天很少产出的功能不划算。mermaid 代码块**降级为普通代码块** |
| Google Fonts (Inter) | **删除**。Inter 没有中文字形，中文本来就在走系统回退 —— 拉它只为了英文和数字，代价是约 100 KB + 一次外部请求 |

### 结果

| | 之前 | 之后 |
|---|---|---|
| 主包 JS | 257 KB | **392 KB** |
| 主包 CSS | 19 KB | **27 KB** |
| 首屏合计 | 276 KB | 419 KB |
| **运行时外部请求** | unpkg **约 820 KB**（按需触发） | **0** |
| `index.html` 外部引用 | Google Fonts | **0** |

净效果：**首屏多 143 KB（同源、可缓存），干掉 820 KB 的第三方请求**，并彻底离线可用。

### 附带红利：可以上严格 CSP 了

外链清零之后，一份严格的 CSP 能**大幅削弱**下面那个 XSS 的爆炸半径
（无法加载外部脚本、无法回传数据）：

```http
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' https:
```

`connect-src` 只能写 `https:`，因为 API 地址是用户自己配的。

---

## 四、与上游的兼容性

**数据格式标识一律没改**，改动只限显示文字：

| 标识 | 值 | 为什么不改 |
|---|---|---|
| 导出格式 | `treeai-sessions` | 改了旧备份就导不进来 |
| 主题偏好 | `treeai-theme`（localStorage） | 改了用户的夜间模式设置会丢 |
| IndexedDB | `TreeChatDatabase` | 改了数据全没 |
| 备份文件名 | `treeai-backup-<日期>.json` | 无语义影响，保持稳定 |

`src/db/db.ts`、`src/stores/modelStore.ts`、`src/context/DatabaseContext.tsx`
的存储逻辑**没有改动**，只加了导入方法。

## 五、已知未修

| 项目 | 说明 |
|---|---|
| **XSS** | `ChatNode` 的 `<MdPreview>` 没有 `sanitize`，`md-editor-rt` 内部用 `dangerouslySetInnerHTML` 渲染。**这是上游问题，本分支按明确决定未修改。** 缓解手段见上面的 CSP：外链清零后恶意内容无法加载外部脚本、也无法把数据传出去。真正修法是在渲染前接一个 sanitizer |
| **3 个既有 TS 错误** | `ChatFlow.tsx` 一个未使用的 `event` 参数；`ChatNode.tsx` 两处 `onEdit` 传了 4 个参数而类型声明是 3 个。与本次改动无关，未修 |
| **mermaid 不可用** | 见上文，故意关闭。想要的话：本地打包 mermaid、去掉 `noMermaid`、仿照 katex 加一套 shim |
| **tok/s 不含首字延迟** | 见上文口径说明 |

---

## 六、开发与部署

```bash
bun install
bun run dev      # http://127.0.0.1:5175/
bun run build    # 产出 dist/，纯静态
bun run lint
```

**本项目用 Bun**（`bun.lock` 已提交）。`package-lock.json` 也保持最新，所以 npm 同样可用。

### 部署

纯静态 SPA，**没有后端**，数据全在访问者的 IndexedDB 里 —— 服务器拿不到任何对话内容。

- **Cloudflare Pages**：直接拖 `dist/` 最简单（绕过 CI）。用 Git 集成的话记得指定
  `BUN_VERSION`，CF 默认走 npm/Node
- 没有 react-router，是纯 SPA，**不需要 `_redirects`**
- `vite.config.ts` 没有设 `base`，部署在根路径下开箱可用

### 自持要点

⚠️ **必须用 HTTPS（或 `http://localhost`）。**
代码里有 9 处 `crypto.randomUUID()`，它**要求安全上下文**：

| 访问方式 | `crypto.randomUUID()` |
|---|---|
| `http://localhost:5175` | ✅ |
| `https://...` | ✅ |
| `http://192.168.x.x` | ❌ **新建会话 / 节点 / 模型全部失败** |

自持时用自签证书 / Caddy / Cloudflare Tunnel 都可以。IndexedDB 本身不要求安全上下文。

> `vite.config.ts` 里 `strictPort: false`，5175 被占用时端口会自动漂移，
> 请以终端实际输出为准（或改成 `true`）。

---

## 七、提交索引

```
2bd25d3  fix(vite): 删掉 optimizeDeps.exclude lucide-react（修空白页）
2f0503e  feat: 支持 DeepSeek V4 推理模型 + 思考链
87bd0b6  feat: 暗色模式、每条回答的统计、UI 修复
3f9d2a5  fix: 暗色可读性、Ctrl+滚轮缩放、节点加宽、DeepSeek 默认值
c752bbc  feat: 思考链实时流、会话自动命名、输入文字可读性
bcc03ef  feat: JSON 备份与恢复（会话 + 模型）
c942155  fix: 静默失败、默认模型、切模型时的系统提示词
773ad36  chore: 清零全部第三方 CDN 请求，改用系统字体
88ba7a0  feat: 从任意 OpenAI 兼容服务商收集 token 用量
f1598a9  chore: 提交 bun.lock
4a229ee  fix: 新节点落在看得见的地方
c777394  fix: 新节点放进空位，并让视口跟随
```

---

## License

与上游一致（MIT）。原始项目版权归 [Anionex](https://github.com/Anionex) 所有。
