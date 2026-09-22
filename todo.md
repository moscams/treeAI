# TreeAI Roadmap and Known Issues

- [x] Edges are missing or truncated until the node is clicked or dragged.
      → **已修复**：根因是 React Flow 的 `getNodeData().isValid` 要求 `node.width && node.height`，
      而我们的渲染 effect 用干净对象重建节点数组时把这两个字段抹掉了。
      `applyChanges` 里是 `const updateItem = { ...item }`（**拷贝**），测量值只在 `nodes`
      state 里，不在我们传出去的对象上。
      **修复**：`ChatFlow.tsx` 新增 `flowNodesRef`，每次渲染从 `nodes` state 同步；
      `buildFlowNode(..., previous)` 的 `previous` 改从它取。
      **回归脚本**：`scripts/edge-contract-check.mjs`（`node scripts/edge-contract-check.mjs`），
      复刻了 `createNodeInternals` / `applyNodeChanges` / `getNodeData` 的拷贝语义，
      断言旧的「从 handed-out 缓存取 previous」会掉边、新的取法不会。
- [ ] Reduce React Flow canvas flicker while a response is streaming so text fields remain comfortable to edit.
      → **根因已定位**：`ChatFlow.tsx` 的 `onChunk` / `onReasoning` 每个 SSE 分片都 `setState`，
      50–100 次/秒 → `md-editor-rt` 把整篇 Markdown 重新解析 + 换掉整块 DOM。
      **方案**：80ms 节流合批（注意收尾必须补一次 flush），必要时流式期间加 `noHighlight`。
      详见 `HANDOFF.md` 第 2 节。用户说先不修，自己再观察。
- [ ] Add an explicit compatibility layer for reasoning models and provider-specific thinking streams.
- [ ] Add automated tests for branch context assembly, persistence, streaming parsing, import, and export.
      → 尤其需要：`src/utils/sessionTransfer.ts` 的导入校验、`sessionStore.importSessions` 的去重、
      `computeChildPosition` 的落点不重叠。`.mjs` 脚本形式的先行版本见 `scripts/`。
- [ ] Split the production bundle to reduce the initial download size.
      → 当前首屏 JS 392 KB gzip（其中 highlight.js ~56 KB、katex ~78 KB）。
      katex 可以改成动态 import，只在回答里真的出现公式时才加载。

## 更早一轮（已完成）

- **设置中心**（`src/components/SettingsModal.tsx`）：左侧导航分「模型 / 数据 / 外观 / 关于」四页。
  模型管理从原来的 `ModelManager` 弹窗拆成 `settings/ModelsPanel.tsx`；
  「关于」页放了项目介绍、数据隐私说明和 upstream / 本分支的 GitHub 链接。
  「全部导入/导出」收进「数据」页。
- **单会话导出移到画布右上角**（`ChatFlow.tsx`），和「上传文件」「导出思维导图」放在一起。
  侧边栏会话行里的导出按钮已移除。
- **收藏会话**：`Session.starred`，侧边栏行内星标 + 搜索框旁的「只看收藏」。
  收藏**不置顶、不刷新 `updatedAt`** —— 收藏只是标记，不算「更新过」。
- **「重新生成」= 新分支**：已有回答时点重试会创建一个同父节点、同 `userMessage` 的
  兄弟节点去生成，旧回答保留，方便对比。节点还没有回答（首次生成 / 报错重试）才写回原节点。
  配套改动：`updateNodeInSession` 改为 upsert；自动命名改用 `autoTitleSession`，
  避免用闭包里的旧 session 覆盖掉刚建的分支。
- **最大令牌上限放宽到 65535**：三处滑条（对话节点 / 系统节点 / 模型默认值）。
- **新节点自动聚焦输入框修复**：原来用 `autoFocusHandled` ref 做「只补一次」的 latch，
  而 React 18 StrictMode 的 setup→cleanup→setup 会把第一次 setup 里挂的补聚焦定时器清掉，
  第二次又被 latch 挡住，补聚焦永远不执行。现在改成无 latch、多次重试（50/150/300ms），
  并且已经在输入框里或用户正在别处打字时不抢焦点。
- **侧边栏底部图标化**：设置去掉文字只留图标，和夜间模式两个图标居中对齐。

## 本轮新增（已完成）

### 1. 连线「终点不连」bug（与上面 §1 是**两个不同的 bug**）

- 现象：连线起点贴着源节点，**终点却悬在目标节点上方一小段**，点击/拖动也未必恢复。
- 根因：节点入场动画用 `gsap.fromTo(el, { y: -20 }, { y: 0 })`。React Flow 会把 handle 相对节点的
  偏移量缓存下来，只在该节点**尺寸变化**时重算。如果测量恰好发生在动画进行中，缓存里存的是
  「元素上移 20px 时」的 handle 位置；动画只改 `transform`、不改尺寸，ResizeObserver 不再触发，
  于是这条偏差永久留着（zoom 0.9 时表现为 ~17px）。
- 修复：`ChatNode.tsx` / `SystemNode.tsx` 的**入场动画不再做位移**，只做 `opacity` 淡入。
  任何 transform（translate/scale）都会污染 handle 测量，只要动画期间动了位置，
  连线在动画期间就一定会偏 —— 之前只在 `onComplete` 补重测，只能做到「动画结束才接上」，
  用户看到的正是这个。现在动画全程不动几何，`onComplete` 仍保留一次重测作为字体/图片
  迟到导致尺寸变化的兜底。
- 验证：`scripts/cdp-edge-repro.mjs` —— headless Edge + CDP 驱动**真实应用**，
  用 IndexedDB 直接种数据，测量每条边终点到目标 handle 中心的像素距离。
  修复前 **17.1px**（且不恢复）→ 修复后**动画中 60ms 就是 3.0px**，全程不再跳。

### 2. 文件夹（单层）

- `Folder { id, name, createdAt }`；`Session.folderId`；DB 升到 version 2 新增 `folders` 表。
- 侧边栏搜索框下方是筛选 chip 条：**全部**（默认，仍是原来的一条条扁平列表）/ 各文件夹 / 未分类 / `+`。
  chip 条用 `flex-wrap`，文件夹多了往下换行，**不做横向滚动**（横滑对鼠标用户很反直觉）。
- 归类：**拖动会话到文件夹 chip**，或用行内「移动到文件夹」按钮弹菜单；在某个文件夹视图里
  「新建会话」会自动归入该文件夹。
- 删除文件夹**不会删会话**，里面的会话回到「未分类」；删除时会明确提示这一点。
- 移动归类**不刷新 `updatedAt`**（归类不是「又聊过」，不该让它跳位）。
- 导出/导入同步支持 `folders`（可选字段，旧文件照常导入；会话 id 冲突仍一律跳过）。

### 3. 中文搜索

- 原来只搜 `title`。现在 `sessionStore.computeVisible()` 同时搜标题 + 所有节点正文
  （`userMessage` / `assistantMessage`），中文直接 `includes`。
- 搜索、文件夹过滤、会话更新统一走同一个 `computeVisible()`，避免三者不同步。

### 4. 搜索框图标对齐

- 放大镜原先用写死的 `top-2.5`，星标用 `top-1.5`，两者基线不一致。
- 改成 `inset-y-0 my-auto` / `items-center`，与输入框真实高度垂直居中。
  smoke 实测两者与输入框中心偏差均 **0.00px**。

### 5. 模型默认与拖拽

- **默认模型 = 列表第一项**（`Model.sortOrder` 持久化，`defaultModelId` 永远等于排序后的首位）。
  不再维护「自由指定的默认」——那玩意以前没落库，刷新就丢。
- 模型列表支持**拖拽排序**，第一项带「默认」徽标。（曾试过“点星标设默认”，用户反馈拖拽更直接，已改回拖拽。）
- **修复「设置界面整个重绘」**：`SettingsModal` 的入场 gsap 动画 effect 原来依赖 `[onClose]`，
  而 App 每次重渲染都会传新的内联 `onClose` → 模型 store 一变就重跑动画，弹窗闪一下像重绘。
  现在动画 effect 依赖 `[]`，`onClose` 用 ref 取最新值，只在挂载时播放一次。
- 新建会话的系统节点用 `defaultModelId ?? models[0]` 的模型 + 它的 `defaultSystemPrompt`
  （ChatFlow 里原本就写好了，这次把 store 侧的顺序语义补齐）。

### 5.5 侧边栏细节

- 会话星标从标题前面挪到右侧操作区（和「移动 / 编辑 / 删除」放一起）：
  已收藏时常驻显示星标，未收藏时 hover 才出现 —— 不挡标题，也能一眼看出哪些收藏了。
- 侧边栏标题「Tree AI Plus」和「关于」页都换成和 `public/favicon.svg` **同一张图**的
  `<Logo />` 组件 —— 浏览器标签页、侧边栏、关于页三处标识统一。

### 5.6 发送 / 编辑 / 自动聚焦（用户报告的三个体验 bug）

- **改完消息再点发送没反应**：原判断是「这个节点还没有回答才生成」，而输入框每次击键
  都会把草稿写回节点（`isDraft`），所以到点击时“内容变没变”永远相等 —— 条件永远不成立。
  现在改为：**显式点发送 / Ctrl+Enter = 用当前文字把本节点重新回答一遍**（`onResubmit`，
  原地重出，不另起分支）。想保留旧答案对照的话，用户自己从父节点拉个新节点就行。
  「重新生成」按钮仍走 `onRetry`，**那条**才起兄弟分支 —— 两个动作职责分开。
- **发送后不退出编辑态**：同一个节点切走再切回来会因重挂载重新计算 `isEditingUser`，
  样式从“可编辑”变成“只读”，前后不一致。现在发送成功就 `setIsEditingUser(false)`。
- **新建节点后光标没进输入框**：真正原因是 React Flow 在量到尺寸前会给节点
  `visibility: hidden`（`initialized: !!node.width && !!node.height`），对隐藏元素调
  `focus()` 是**静默无效**的；而之前的补聚焦定时器又挂在 `autoFocus` 的 effect cleanup 上，
  `autoFocus` 一翻回 false 就被清掉，正好卡在“节点还没变可见”那一刻。
  现在改成一个**自驱动的聚焦循环**：60ms 一轮，直到元素可见且真的聚焦成功、
  或 4s 超时、或用户已在别的输入框里；循环的生死不再依赖 `autoFocus`，卸载时统一清理。
- **新建节点入场“动画很奇怪”（偶发、难复现）**：入场淡入原来在挂载瞬间就开跑，
  而节点在 React Flow 量到尺寸前是 `visibility: hidden` —— 动画在隐藏期间已经跑掉一半，
  等节点变可见时已经接近不透明，看起来像闪一下/没过渡；而且“何时变可见”取决于测量时机，
  所以时好时坏。更坑的是，从 hidden 变 visible 那一帧会先以满不透明度画一下，下一帧才被改回 0，
  多出一下明显闪烁。
  现在：挂载时立刻 `gsap.set(el, { opacity: 0 })`，然后用 rAF 轮询，**等节点真正可见**
  才开始 `gsap.to(opacity 1)`（2s 超时兜底）。实测淡入曲线从 `vis=visible, op=0.00` 开始。

### 6. 导入模型逻辑（确认）

- 现有 `importModels` / `importSessions` 就是**永远追加、按 id 去重跳过、绝不覆盖**，符合预期。
  备份文件里的 `apiKey` 是空的，绝不能覆盖本机已填好的密钥。

## 本轮修复（XSS + 重新排布丢更新）

### 1. XSS（真实漏洞，实测可执行）

- **根因**：`md-editor-rt` 的 `MdPreview` 有个 `sanitize` prop，**默认是恒等函数**
  `(text) => text`（见它的类型声明里的 `@default`），等于不洗；而 markdown-it
  默认 `html: true`。所以模型回答（或导入的备份正文）里写 `<img src=x onerror=...>`、
  `<script>`、`<svg onload>` 会被**原样插进 DOM 并执行**，`javascript:` 链接也不拦。
- **危害**：API Key 就在同一个 origin 的 IndexedDB 里，一旦执行就能被读走。
- **修复**：新增 `src/utils/sanitize.ts`，用 `xss`（`md-editor-rt` 自己的依赖）的
  `filterXSS`，并给它一个在默认白名单基础上补了 `class`/`style` 的自定义白名单——
  不补的话 KaTeX 的排版和 highlight.js 的着色会被一起洗掉。
  ChatNode 的两处 `<MdPreview>` 都传 `sanitize={sanitizeHtml}`。
- **实测**：灌 `<img onerror>`/`<script>`/`<iframe javascript:>`/`<svg onload>`/
  `[x](javascript:)`，修复前 `window.__x1 === true`（真执行），修复后 6 个 flag 全 false、
  DOM 里无注入元素；同时 KaTeX `.katex`、`.hljs-keyword`、表格仍正常渲染。
- `xss` 已加进 `package.json` 的 dependencies（之前只是 `md-editor-rt` 的传递依赖）。

### 2. 重新排布只生效一个节点（丢失更新）

- **现象**：点右下「重新排布节点」后，大部分节点纹丝不动，个别节点却换到新坐标
  压在兄弟节点身上（用户反馈「往左偏一点点、第二三张卡片贴上」）。
- **根因**：`calculateNodeLayout(true)` 在 `.map()` 里**循环**调用 `updateNodeInSession`；
  而 `updateSession` 是 `async` 且**先 `await db.saveSession()` 再 `set()`**。循环是同步的，
  每次调用都还在 await 期间，于是都从 `get()` 读到同一份旧 session，各自造一个
  「只改了一个节点」的快照去覆盖 —— 最后落库的那个（节点数组里最后一个）赢，
  其余全部回退。
- **修复**（两层）：
  1. `sessionStore.updateSession` 改成**先同步 `set` 再异步落库**，根除同一轮连续更新的
     互相覆盖（影响面不止重排）。
  2. 新增 `replaceSessionNodes(sessionId, nodes)`，`calculateNodeLayout` 把新坐标收集成一个
     Map，最后**一次性**写回，而不是循环 N 次。
- **实测**：修复前 reorg 后 5 个节点只有新节点动（跑到 `(500,716)` 压住 B/C）；
  修复后 n1/A/B/C/新节点全部归位，B/C/新节点同 y、相邻间距正好 220px。

### 自动化检查

- `node scripts/smoke-check.mjs`：headless Edge + CDP 跑真实应用，断言「全部/文件夹筛选/
  中文内容搜索/图标居中/模型默认徽标/新建节点自动聚焦/Ctrl+Enter 发送退出编辑/
  编辑已有回答原地重出/无运行时报错」，共 13 项。

### 开发环境注意：Vite 缓存中毒

本轮排查时遇到一次「白屏 + 控制台报 `does not provide an export named 'default'`」，
根因不是代码，而是 **Vite 把 `ChatNode.tsx` 当成了 0 字节模块**
（`curl http://127.0.0.1:5175/src/components/nodes/ChatNode.tsx` → `Content-Length: 0`）。
处理：杀掉 5175 的进程 → `rm -rf node_modules/.vite` → 重启 `npm run dev`；
浏览器侧再硬刷新（Ctrl+Shift+R）。
**排查心法**：控制台报某个模块缺 default export 时，先 `curl` 一下那个模块的字节数，
不要往代码语法上查。

## 本轮功能（第 8 轮）

1. **代码复制按钮 + 折行**
   - 复制按钮此前看起来是坏的，实因 XSS 清洗误伤：`sanitize` prop 把 md-editor
     自己生成的折叠箭头 `<svg>` 转义成了文本。改用 `markdownItConfig` 的 `html:false`
     从 markdown 源文本层堵 XSS，chrome 不再被误伤（参见上一节）。
     `copy2clipboard` 在 localhost 是真能用的，报「复制失败」只在 headless 无
     剪贴板权限时出现。
   - 代码折行：`.md-preview pre, .md-preview pre code { white-space: pre-wrap !important;
     overflow-wrap: anywhere }`，长行不再产生横向滚动条。
2. **切会话保留视口**：模块级 `savedZoom` + `useStore(s => s.transform[2])` 持续同步，
   `defaultViewport` 还原。注意两个坑：`onMoveEnd` 对 Controls 的 ± 按钮不触发
   （`sourceEvent.internal` 直接 return）；「卸载时读一次」顺序也不对（React 先 render
   新实例再跑旧 cleanup）。
   > 第 9 轮已升级为「每个会话各记一份视口（平移+缩放）」——见下节。
3. **节点宽 644px（+15%）、正文与输入同字号 19px**。
4. **设置右栏加宽**：弹窗 `max-w-5xl`，模型列表固定 `w-60`，表单 `flex-1` ——
   导航（176）和列表（240）宽度不变，多出的宽度全给表单。
5. **回答结束不再闪**：流式/非流式共用一个 `MdPreview`，结束时只改 `modelValue`，
   不再切换分支（原来会在中间出现一帧空渲染）。
6. **删除「导入 md」**：移除 `FileUploadButton` / `handleUploadComplete` / `fileUtils`，
   卸载 `react-dropzone` 依赖与 `FileExtractResult` 类型。
7. **会话统计**：右上角 `BarChart3` 按钮 → `SessionStats` 浮层，显示节点/提问/回答/
   分支/分支点/输入输出思考 token/缓存命中率/计费次数/回答字数/创建更新时间。
8. **空节点不允许再建子节点**：`ChatNode` 的「+」在节点没有回答（`assistantMessage`
   或思维链）时禁用。避免在空节点下面接一串对话、回到空节点却发现上下文里空了一级。

## 本轮修复与功能（第 9 轮）

> 来源：用户提的 9 条反馈。

### 修复

1. **切会话要点好几次才生效**（`Sidebar.tsx`）
   - 点击处理器原来只挂在内层标题 `div` 上，行的 `px-3 / py-2` 内边距、图标之间的
     缝隙都是死区。现在挂到**整行**；右侧操作区整体 `stopPropagation`，
     点星标/编辑/删除不会误切会话。
2. **进会话偶尔一片白**（`ChatFlow.tsx`）
   - 根因是上一轮「只记缩放、不记平移」：切回来平移归零，节点若长在离原点很远处，
     屏幕正好落在空白区。现已改为按会话记完整视口，见功能 1。

### 功能

1. **每幅图记自己的视口**（`ChatFlow.tsx`）
   - `savedZoom: number` → `savedViewports: Map<sessionId, {x,y,zoom}>`；
     用 `useStoreApi().subscribe` 持续写入（不走 `useStore(selector)`，避免平移每一帧
     都重渲染整个 wrapper）；`defaultViewport` 按 `sessionId` 读取。
2. **代码块亮色模式不再黑底**（`index.css`）
   - 黑底其实来自 Tailwind prose 的 `--tw-prose-pre-bg = #1f2937`，不是 md-editor。
     在 `.md-preview` 里置为 `transparent`，交回 md-editor 的 vuepress 变量
     （亮 #f8f8f8 / 暗 #1a1a1a）。
3. **i18n（中/英）**（新增 `src/i18n/index.ts`）
   - **直接用中文原文当 key**，词典只维护 zh → en 一张表；漏翻自动回退中文，
     不会露出 `model.settings.title` 这种 key，可以逐条补。变量用 `{name}`。
   - 组件里 `useT()`（语言一变就重渲染）；store / notification 里用 `t()`。
   - 入口：设置 → 外观 → 语言；持久化在 `localStorage['treeai-lang']`，
     首次按 `navigator.language` 猜测，并同步 `document.documentElement.lang`。
   - 有个小脚本心法：写探针时注意工具调用会先做一次 JSON 反转义，`\\s` 会变成 `\s`，
     在模板字符串里再被吃成 `s` —— 用 `textContent` 复核，别疑神疑鬼觉得字体丢了字母。
4. **回答字号与提问一致**（`index.css`）
   - 只改 `.md-preview` 没用：md-editor 内层 `.md-editor-preview{font-size:16px}` 和
     `div.vuepress-theme{font-size:16px}` 把正文压回 16px。补一条
     `.md-preview .md-editor-preview { font-size: 19px }` 才真正生效（标题用 em 会跟着缩放）。
5. **底部工具栏不再占地方**（`ChatNode.tsx` / `SystemNode.tsx`）
   - 整条底栏删掉：「+」**绝对定位悬浮在节点底边中央**（外层 wrapper 不能
     `overflow:hidden`，否则被裁），正好压在连线上，像「从这条线继续长出去」；
   - 复制/重试改成**右下角悬浮**：绝对定位（不占高度），悬停整个节点才淡入，
     平时不挡正文。没回答时不显示复制（复制不出东西），但重试保留。
   - 报错态在占位文案旁另有一个「重试」，保证入口明显。
6. **统计加年份**（`SessionStats.tsx`）：日期格式加 `year: 'numeric'`，并跟随语言切 `zh-CN`/`en-US`。
7. **入/出改成上下箭头**：统计浮层用 `↓ 输入 token` / `↑ 输出 token`；
   节点底部的 `入 X · 出 Y` → `↓ X · ↑ Y`。
8. **侧边栏底部 / 顶栏重排**（`Sidebar.tsx`）
   - 用户反馈的「占地方」指的是「新建会话」下面那排设置/主题按钮。先后试过两种：
     ① 两行两条分隔线 → ② 并成一行（大黑块 + 两个小图标，重量不对等、重心歪），
     最后定为：设置/主题缩到 15px 挪到**标题行右侧**（头部 `px-4` + 右侧 `pr-4`，
     与浮在边框上的折叠圆钮留约 16px 空隙），**底部只留「新建会话」独占一整条**。
9. **应用标识改版**（`Logo.tsx` + `public/favicon.svg`）
   - 三个**空心**节点（上一、下二）+ 上面那个分叉出两条 smoothstep 连线
     （先竖 → 横 → 竖）+ 同色系（#9fe0bf）细网格背景，沿用 #13231d 底色。
     网格线只铺 8..56、不碰 16px 圆角，所以不需要 clipPath（Logo 与 favicon 两处同图）。

## 待讨论

- **标签（tags）**：多对多、可跨维度筛选，但要配标签管理 UI。会话量上百之后再考虑；
  单层文件夹 + 星标已经够用，两者不冲突。
- **文件夹拖拽在触屏上不可用**（HTML5 DnD 的限制）。桌面为主的场景可接受，
  移动端将来需要补一个「移动到…」菜单作为兜底（目前其实已有行内菜单，触屏也能点）。

