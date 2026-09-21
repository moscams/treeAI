# HANDOFF

写给明天的自己。写于 `e063480`（`master` 已同步到这个提交）。

> **先读第 1 节和第 2 节。** 那是两个**还没解决**的问题，而且第 1 节里我上一轮的
> 修复是**错的**，下面写清楚了为什么错 —— 别再犯一次。

---

## 0. 现状一句话

18 个提交，`master` 和 `feat/deepseek-v4-reasoning` 都指向 `e063480`，已推送。
功能基本齐了（DeepSeek V4 / 思考链 / 暗色 / 统计 / JSON 备份 / 全离线），
**剩两个可见缺陷**：连线要点击后才完整、流式输出时闪屏。

两个都有**高置信度根因**，都在下面附了现成补丁。

---

## 1. 🔴 未解决：连线要点击或拖动后才出现

### 现象

新建节点后（或流式输出期间），父→子的连线不显示或不完整，
**点一下 / 拖动一下节点就恢复正常**。

### 根因：React Flow 的 `isValid` 需要 `width` + `height`

`EdgeRenderer` 里，只要端点缺尺寸，边**整个 return null**：

```js
// node_modules/@reactflow/core/dist/esm/index.js
const [.., sourceIsValid] = getNodeData(nodeInternals.get(edge.source));
const [.., targetIsValid] = getNodeData(nodeInternals.get(edge.target));
if (!sourceIsValid || !targetIsValid) return null;
```

```js
function getNodeData(node) {
  const handleBounds = node?.[internalsSymbol]?.handleBounds || null;
  const isValid = handleBounds && node?.width && node?.height
    && typeof node?.positionAbsolute?.x !== 'undefined'
    && typeof node?.positionAbsolute?.y !== 'undefined';
  ...
}
```

而 `width` / `height` 的**唯一来源是我们自己传进去的节点对象**：

```js
// createNodeInternals
const internals = { ...node, positionAbsolute: {...} };   // ← 摊的是我们的对象
```

React Flow 量到尺寸后会写回我们，路径是 `updateNodeDimensions → onNodesChange`：

```js
// updateNodeDimensions（源码，已确认会推送给我们）
set({ nodeInternals: new Map(nodeInternals), ... });
if (changes?.length > 0) { onNodesChange?.(changes); }
```

我们接住了（`ChatFlow.tsx` 的 `onNodesChange`）：

```js
onNodesChange={(changes) => {
  setNodes(nds => applyNodeChanges(changes, nds));
  collectNodeDimensions(changes);
}}
```

**但我们的渲染 effect 每次都用干净对象重建整个节点数组**，
`width`/`height` 就被抹掉了 → `isValid` 变 false → 边不渲染。

### ⚠️ 我上一轮的修复为什么是错的（必读）

上一轮我加了 `buildFlowNode(node, position, data, previous)`，
把 `previous` 摊在前面，`previous` 取自 `nodeCacheRef`。**看起来对，实际没用**，因为：

```js
// applyChanges 源码 —— 注意这一行
const updateItem = { ...item };        // ← 拷贝！
...
case 'dimensions': {
  updateItem.width  = currentChange.dimensions.width;
  updateItem.height = currentChange.dimensions.height;
  break;
}
```

**`applyNodeChanges` 返回的是新对象。** 所以：

| 位置 | 有没有测量值 |
|---|---|
| `nodes` state（`applyNodeChanges` 的产物） | ✅ 有 |
| `nodeCacheRef`（我们当初传给 React Flow 的那批对象） | ❌ **永远没有** |

于是我 `{ ...previous }` 摊的是一个**从来不含尺寸的对象**，等于没改。
**这就是修复无效的原因。**

### 补丁（2 行，改数据来源）

把 cache 的维护方式换掉 —— **每次渲染都从 `nodes` state 同步**：

```js
// ChatFlow.tsx，替换原来的 nodeCacheRef
-  const nodeCacheRef = useRef<Map<string, Node>>(new Map());
+  /*
+   * React Flow 会把量到的尺寸写回节点对象，但 applyChanges 里是
+   * `const updateItem = { ...item }` —— 是拷贝。所以真正带 width/height 的那份
+   * 在 nodes state 里，不在我们传出去的对象上。每次渲染同步一遍。
+   */
+  const flowNodesRef = useRef<Map<string, Node>>(new Map());
+  flowNodesRef.current = new Map(nodes.map(n => [n.id, n]));
```

```js
// 渲染 effect 里
-  const previousNodes = nodeCacheRef.current;
-  const nextCache = new Map<string, Node>();
+  const previousNodes = flowNodesRef.current;
```

```js
     if (previous && previous.data.node === node && ...) {
-      nextCache.set(node.id, previous);
       return previous;
     }
     const next = buildFlowNode(node, position, { ... }, previous);
-    nextCache.set(node.id, next);
     return next;
   });
-
-  nodeCacheRef.current = nextCache;
```

`calculateNodeLayout` 里那句 `nodeCacheRef.current.get(node.id)` 也换成 `flowNodesRef.current.get(node.id)`。

**验证思路（写测试脚本，不靠肉眼）**：

我上一轮写过 `/tmp/edge2.mjs`，它复刻了 `createNodeInternals` / `getNodeData` / `applyChanges`。
**但它当时模拟错了** —— 我让 `applyChanges` 直接改我们对象的字段，而真实实现是拷贝。
明天先把脚本改成拷贝语义，再断言「流式重建一次后 `isValid` 仍为 true」。
脚本跑通再去浏览器点。

> 教训：**别再用「读了源码觉得对」就宣布修好。** 这类问题必须先用脚本复刻契约跑一遍。

### 浏览器侧怎么确认（30 秒）

1. 硬刷新
2. 新建一个节点 → 立刻看连线
3. 发消息，**生成过程中和生成结束后**都看连线
4. 如果还断：DevTools → console 看有没有
   `Couldn't create edge for ... handle id`（React Flow 的 `error008`）——
   有它就说明 `handleBounds` 才是缺的那个，不是 `width`/`height`
5. 想直接看数据：`useReactFlow().getNodes()` 里每个节点的 `width`/`height` 是不是 `undefined`

---

## 2. 🟡 未解决：流式输出时闪屏

### 现象

模型生成文本时整屏/节点内容在闪。

### 根因：**每个 SSE 分片都触发一次状态更新**

```js
// ChatFlow.tsx 约 480 行
onChunk: (chunk) => {
  accumulatedResponse += chunk;
  setStreamingResponses(prev => ({ ...prev, [nodeId]: accumulatedResponse }));
},
// 约 489 行
onReasoning: (chunk) => {
  accumulatedReasoning += chunk;
  setStreamingReasoning(prev => ({ ...prev, [nodeId]: accumulatedReasoning }));
},
```

DeepSeek 大约 50–100 tok/s，也就是**每秒 50–100 次**：

```
setState → 整棵组件树重渲染 → md-editor-rt 重新解析整篇 Markdown
        → dangerouslySetInnerHTML 换掉整块 DOM → 重新高亮 → 重新排版
```

**upstream 自己的 `todo.md` 第一条就是这个**：

> `- [ ] Reduce React Flow canvas flicker while a response is streaming so text fields remain comfortable to edit.`

所以是长期存在的上游缺陷，不是我们引入的。（我们这轮的节点复用优化只让**其它**
节点不再重渲染，正在输出的那个节点**必须**跟着新文本重渲染，所以治不到它。）

### 方案 A（推荐，先做这个）：节流合批

把状态更新从「跟着 token 频率」降到「肉眼够用的频率」：

```js
// 一个 80ms 的窗口内的所有分片合成一次 setState。
// Markdown 重新解析一次不便宜，没必要跟着 token 频率走；
// 80ms（约 12 次/秒）看起来仍然是"实时在打字"。
const FLUSH_INTERVAL = 80;

const pendingResponseRef = useRef<Record<string, string>>({});
const pendingReasoningRef = useRef<Record<string, string>>({});
const flushTimerRef = useRef<number | null>(null);

const flushStreamingState = () => {
  flushTimerRef.current = null;
  if (Object.keys(pendingResponseRef.current).length) {
    setStreamingResponses(prev => ({ ...prev, ...pendingResponseRef.current }));
    pendingResponseRef.current = {};
  }
  if (Object.keys(pendingReasoningRef.current).length) {
    setStreamingReasoning(prev => ({ ...prev, ...pendingReasoningRef.current }));
    pendingReasoningRef.current = {};
  }
};

const scheduleFlush = () => {
  if (flushTimerRef.current !== null) return;
  flushTimerRef.current = window.setTimeout(flushStreamingState, FLUSH_INTERVAL);
};

// onChunk / onReasoning 里改成：
//   pendingResponseRef.current[nodeId] = accumulatedResponse;
//   scheduleFlush();
```

**两个必须注意的点：**

1. **流结束时一定要补一次 `flushStreamingState()`**，否则最后一段文字会丢
   （或停留在 80ms 前的状态）。`finally` / 收尾那段都要加。
2. 卸载时要 `clearTimeout`，避免对已卸载组件 setState。

### 方案 B（如果 A 还不够）：流式期间降级渲染

- 生成期间给 `MdPreview` 加 **`noHighlight`** —— 去掉每帧的 highlight.js 重跑，
  这是单次重渲染里最贵的一步。Markdown 结构还在，只是代码块暂时不上色。
- 更激进：**生成期间用纯文本渲染**（`whitespace-pre-wrap`），流结束再换成 `MdPreview`。
  闪屏会彻底消失，代价是生成过程中看不到 Markdown 排版。很多同类产品就是这么做的。

建议顺序：**A → A + `noHighlight` → B**。

### 浏览器侧怎么确认（定位到具体是哪一层在闪）

DevTools → Rendering → 勾 **Paint flashing**：

| 闪的是哪块 | 说明 |
|---|---|
| 只是节点内的 Markdown 区域 | 就是上面的重解析，方案 A/B 对症 |
| 整块画布 / 背景 | 还有别的整图重绘，要去查 `nodes`/`edges` 之外的更新源 |
| 节点高度在跳 | `.node-content` 的 `max-height: 760px` + 内容增长的滚动条抖动 |

顺便留意 `Performance` 面板里 `Recalculate Style` / `Layout` 的调用频率 ——
50–100 次/秒就是实锤。

---

## 3. 环境速查

```bash
bun install
bun run dev        # http://127.0.0.1:5175/  (host 固定 127.0.0.1)
bun run build      # dist/ 纯静态
bun run lint
bunx tsc --noEmit -p tsconfig.app.json
```

### 基线：3 个既有 TS 错误（**故意的，不是我们弄坏的**）

```
src/components/ChatFlow.tsx(...)    TS6133  'event' 声明未使用
src/components/nodes/ChatNode.tsx(..)  TS2554  onEdit 传了 4 个参数，类型是 3 个
src/components/nodes/ChatNode.tsx(..)  TS2554  同上
```

行号会随编辑漂移，**只要还是这 3 条就没事**。

### 🕳️ 踩坑清单

| 坑 | 处理 |
|---|---|
| **模块返回 200 但 0 字节** | Vite 转换缓存中毒。杀进程 + `rm -rf node_modules/.vite` + 重启 |
| `src/types.ts` 是 0 字节 | **这个正常**（纯类型，被完全擦除），别当成中毒 |
| 改了 `tailwind.config.js` | HMR 不生效，**必须手动刷新浏览器** |
| `localhost:5175` 和 `127.0.0.1:5175` | **两个不同的 origin → 两个独立的 IndexedDB**。调试时用一个 |
| 系统代理 `HTTP_PROXY=127.0.0.1:7890` | 测本地端口要 `curl --noproxy '*'` |
| 端口漂移 | `vite.config.ts` 是 `strictPort: false`，5175 被占会自动换端口，看终端输出 |

### 一条命令体检（改完代码先跑这个）

```bash
curl -s --noproxy '*' -o /dev/null http://127.0.0.1:5175/ && \
for f in $(find src -name '*.tsx' -o -name '*.ts' | grep -v vite-env | grep -v 'src/types.ts'); do
  n=$(curl -s --noproxy '*' "http://127.0.0.1:5175/$f" | wc -c)
  [ "$n" -lt 100 ] && echo "❌ $f ${n}字节"
done; echo "体检完成"
```

---

## 4. Cloudflare 部署（已就位）

- **用 Pages，不用 Workers** ✅（纯静态 SPA + 零后端）
- **`master` 现在就是可部署分支**（已快进到 `e063480`），所以接 Git 时用默认配置即可
- 没域名不影响：`<项目名>.pages.dev` + 自动 HTTPS，免费
- 不需要 `_redirects`（没有 react-router，纯单入口 SPA）
- 接 Git 的话：Framework preset = **None**，Build command = `bun run build`，
  Output = `dist`，环境变量 `BUN_VERSION = 1.4.2`
- 更简单的方式：`bun run build` 后把 `dist` 直接拖进 Pages

### 🔴 部署后用户一定会问的两件事

1. **本地数据不会自动过去。** IndexedDB 按 origin 隔离 ——
   `127.0.0.1:5175` 和 `xxx.pages.dev` 是两个库。
   流程：本地侧边栏底部 ⬇️ 导出全部 → Pages 站点 ⬆️ 导入（密钥要重填）。
2. **从 Pages 调局域网模型会被拦。** Pages 是 HTTPS，混合内容规则：
   `http://127.0.0.1:11434`（Ollama）在 Chrome/Firefox 有 localhost 豁免 ✅，
   但 `http://192.168.x.x` ❌ 被拦。

---

## 5. 回退点

```
backup/before-ff-2d04c4e  → 2d04c4e（快进 master 之前的原始状态）
```

要回退 `master`：`git reset --hard upstream/master && git push --force-with-lease origin master`

---

## 6. 其它待办（都还没做，按建议优先级）

### 已完成但值得知道的设计决策

- `reasoning_effort` 对 `baseUrl` 匹配 `/deepseek/i` 的模型自动回落 `low`；显式设置优先
- `'default'` = **不下发该参数**（保护其他服务商不被塞不认识的字段）
- `stream_options.include_usage` 默认带，遇到 4xx 提到该参数**自动去掉重发并向记住**
- mermaid **故意关闭**（743KB gz）；想恢复要照 katex 那套 shim 做一遍
- 导出**故意不含 API Key**，也**故意没有勾选框**
- 导入冲突**一律跳过 + 提示**，绝不覆盖

### 没做的可选项（等用户拍板）

| 项 | 说明 |
|---|---|
| tok/s 口径 | 现在是端到端（含网络 + 首字延迟），本地模型偏低。可改成「首字到末字」得到纯解码速度，或两个都显示。用户说「不动」 |
| 接服务端自报速度 | llama.cpp 的 `timings.predicted_per_second`。我无法验证流式响应里的位置，猜错会显示错数字，所以没做 |
| XSS | `MdPreview` 没有 sanitize。**用户明确说不修。** 缓解：外链清零后上一份严格 CSP 能大幅削弱影响 |
| `strictPort: true` | 免掉端口漂移的困惑 |
| 暗色代码块配色 | 现在是 atom-one 的 CSS 变量映射，用户没抱怨过 |
| 移动端 / 触屏 | 完全没测过 |

### 一开始提到的、后来搁置的

- 给 upstream 提 PR（用户说「先不合并了」）

---

## 7. 复现这两个 bug 的最短路径

给明天的自己省时间：

```
1. bun run dev，打开 127.0.0.1:5175
2. 建一个新会话 → 根节点出现
3. 点根节点的「+」→ 新节点出现、视野移过去、输入框有焦点
   → 【看连线】应该有，没有就是第 1 节
4. 输入一句话回车 → 生成期间
   → 【看闪屏】+【看光标是否稳定】
   → 【看所有连线】生成中/结束后都应在
5. 生成结束后点「+」再加一个分支
   → 【看新节点的连线】这是第 1 节最容易复现的路径
```

第 5 步是最稳定的复现路径：**流式结束后的那次状态更新会把测量值抹掉**，
所以「刚聊完再加节点」几乎必然丢连线。
