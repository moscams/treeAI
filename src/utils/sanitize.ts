import { filterXSS, getDefaultWhiteList } from 'xss';

/*
 * 把模型返回的 markdown 编成 HTML 之后的清洗函数，交给 MdPreview 的
 * sanitize prop 使用（见 ChatNode.tsx 的两处 <MdPreview>）。
 *
 * 背景（这是个真实的 XSS 漏洞，不是假想）：
 *   md-editor-rt 的 sanitize 默认是恒等函数 (text) => text，等于不洗。
 *   而 markdown-it 默认 html: true，所以回答里写 <img onerror> / <script>
 *   会被原样插进 DOM 并执行。本应用把 API Key 存在同一个 origin 的
 *   IndexedDB 里，一旦执行就能被读走 —— 所以必须洗。
 *
 * 为什么不用 filterXSS 的默认白名单：
 *   默认白名单只留标签本身，会把 class / style 一起洗掉。KaTeX 靠 class
 *   和 inline style 排版、highlight.js 靠 class 着色，全洗了公式和代码
 *   就废了。所以在默认白名单基础上给每个标签补上 class 和 style。
 *
 * 清洗能力（已实测）：
 *   - script / iframe / svg 等不在白名单里的标签 → 转义成纯文本
 *   - on* 事件属性 → 剥离
 *   - javascript: 协议的 href/src → 剥离
 *   - style 值走 xss 的 CSS 过滤器（url(javascript:)、expression() 会被清空）
 */
const whiteList = { ...getDefaultWhiteList() };
Object.keys(whiteList).forEach((tag) => {
  whiteList[tag] = [...new Set([...(whiteList[tag] || []), 'class', 'style'])];
});

export function sanitizeHtml(html: string): string {
  return filterXSS(html, { whiteList });
}
