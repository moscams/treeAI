# TreeAI Roadmap and Known Issues

- [ ] Reduce React Flow canvas flicker while a response is streaming so text fields remain comfortable to edit.
      → **根因已定位**：`ChatFlow.tsx` 的 `onChunk` / `onReasoning` 每个 SSE 分片都 `setState`，
      50–100 次/秒 → `md-editor-rt` 把整篇 Markdown 重新解析 + 换掉整块 DOM。
      **方案**：80ms 节流合批（注意收尾必须补一次 flush），必要时流式期间加 `noHighlight`。
      详见 `HANDOFF.md` 第 2 节。
- [ ] Edges are missing or truncated until the node is clicked or dragged.
      → **根因已定位**：React Flow 的 `getNodeData().isValid` 要求 `node.width && node.height`，
      而我们的渲染 effect 用干净对象重建节点数组时把这两个字段抹掉了。
      `applyChanges` 里是 `const updateItem = { ...item }`（**拷贝**），所以测量值只在 `nodes`
      state 里，不在我们传出去的对象上 —— 上一轮从 ref cache 取 `previous` 的修复因此无效。
      **方案**：`previous` 改从 `nodes` state 同步的 map 里取。
      详见 `HANDOFF.md` 第 1 节。
- [ ] Add an explicit compatibility layer for reasoning models and provider-specific thinking streams.
- [ ] Add automated tests for branch context assembly, persistence, streaming parsing, import, and export.
      → 尤其需要：`src/utils/sessionTransfer.ts` 的导入校验、`sessionStore.importSessions` 的去重、
      `computeChildPosition` 的落点不重叠。这几块现在只有手写脚本验证过（脚本在 `/tmp`，会丢）。
- [ ] Split the production bundle to reduce the initial download size.
      → 当前首屏 JS 392 KB gzip（其中 highlight.js ~56 KB、katex ~78 KB）。
      katex 可以改成动态 import，只在回答里真的出现公式时才加载。
