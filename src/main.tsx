import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { config } from 'md-editor-rt';
// 只打包常用语言（约 35 种），比 md-editor 从 CDN 拉的那份 190 种语言的完整版还小
import hljs from 'highlight.js/lib/common';
// katex 的样式里用 url(fonts/...) 引用字体，交给 Vite 处理后
// 字体会被正确产出并改写 URL —— 不需要手工拷贝字体文件
import katex from 'katex';
import 'katex/dist/katex.min.css';
import App from './App';
import './index.css';
import { DatabaseProvider } from './context/DatabaseContext';

/*
 * md-editor-rt 会在挂载时往页面里插 <script> / <link>，从 unpkg.com 拉
 * highlight.js、katex、mermaid 和它们的样式 —— 而且没有 SRI 校验，
 * 等于在运行时执行第三方代码。实测这些请求每次渲染回答都会发出，
 * 合计约 820KB（gzip），其中 mermaid 一家就占 743KB。
 *
 * 这里的处理：
 *   highlight.js / katex → 交给 Vite 打包（可 tree-shaking），挂到 window 上供 md-editor 使用，
 *                          再把它的资源地址指向 public/ 下的本地空文件
 *   mermaid              → 在 MdPreview 上用 noMermaid 关掉（见 ChatNode.tsx）
 *
 * 配色由 index.css 里的 --hljs-* 变量提供，这样能跟随夜间模式。
 *
 * 注：window.hljs / window.katex 的类型由 md-editor-rt 自己声明好了（都是 any），
 * 所以这里直接赋值，不需要再 declare global。
 */
window.hljs = hljs;
window.katex = katex;

config({
  // 从源头关掉 markdown 里的原始 HTML。
  //
  // md-editor-rt 的 sanitize prop 默认是恒等函数（不洗），markdown-it 又默认
  // html: true，所以模型回答（或导入的备份正文）里写 <script>/<img onerror> /
  // <svg onload> 会被原样插进 DOM 并执行 —— API Key 就在同源 IndexedDB 里，
  // 等于白送。关掉 html 后，markdown-it 把这类标签转义成纯文本，DOM 里
  // 不再有可执行节点。
  //
  // 为什么不用 MDPreview 的 sanitize prop：它的清洗发生在「整段 HTML 编译完之后」，
  // 会把 md-editor 自己生成的 <svg>（代码块折叠箭头）也一并转义成文本，
  // 代码块头部就显示成一堆 <svg ...> 源码。html: false 只作用于 markdown 源文本，
  // md-editor 自己生成的 HTML（代码块头、KaTeX 等）不受影响。
  markdownItConfig: (md) => {
    md.set({ html: false });
  },
  editorExtensions: {
    highlight: {
      js: '/hljs-shim.js',
      css: {
        atom: { light: '/hljs-shim.css', dark: '/hljs-shim.css' },
      },
    },
    katex: {
      js: '/katex-shim.js',
      css: '/katex-shim.css',
    },
  },
});

// 全局错误处理
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled rejection:', event.reason);
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found! The app cannot be mounted.');
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <DatabaseProvider>
        <App />
      </DatabaseProvider>
    </StrictMode>
  );
}
