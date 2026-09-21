/**
 * 会话标题工具。
 *
 * 默认标题放在这里而不是写死在组件里，是为了让「新建会话」和
 * 「自动命名」两处引用同一个值 —— 否则改了一边，自动命名会认为
 * 标题已被用户手动改过，从此再也不生效。
 */

export const DEFAULT_SESSION_TITLE = 'New Conversation';

/** 自动标题的最大长度（按字符数，中文也算 1 个） */
export const AUTO_TITLE_MAX_LENGTH = 24;

/**
 * 从第一个问题推导会话标题。纯本地字符串处理，不调用 API。
 * 返回 null 表示没有可用内容（例如空白输入），调用方应保持原标题。
 */
export function deriveSessionTitle(text: string | undefined | null): string | null {
  if (!text) return null;

  // 换行/多余空格压成单个空格，避免标题里带换行把侧边栏撑开
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;

  return clean.length > AUTO_TITLE_MAX_LENGTH
    ? `${clean.slice(0, AUTO_TITLE_MAX_LENGTH)}…`
    : clean;
}
