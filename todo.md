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

## 待讨论

- **标签（tags）**：多对多、可跨维度筛选，但要配标签管理 UI。会话量上百之后再考虑；
  单层文件夹 + 星标已经够用，两者不冲突。
- **文件夹拖拽在触屏上不可用**（HTML5 DnD 的限制）。桌面为主的场景可接受，
  移动端将来需要补一个「移动到…」菜单作为兜底（目前其实已有行内菜单，触屏也能点）。

