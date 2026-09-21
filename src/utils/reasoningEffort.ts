import { Model, ReasoningEffort } from '../types';

/**
 * 思考强度可选项。
 * 'default' 不会发送 reasoning_effort 参数 —— 部分服务商（如 OpenAI 的非推理模型）
 * 不认识这个参数会直接返回 400，所以默认保持"不发送"最安全。
 */
export const REASONING_EFFORT_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: 'default', label: '默认（不发送该参数）' },
  { value: 'none', label: '关闭思考 (none)' },
  { value: 'low', label: '低 (low)' },
  { value: 'high', label: '高 (high)' },
  { value: 'max', label: '最高 (max)' },
];

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'default';

/**
 * 计算本次请求实际要发送的 reasoning_effort。
 *
 * 优先级：模型设置 > 按服务商推断
 *
 * 关于推断：DeepSeek V4 起 thinking 默认开启且 effort=high，
 * 而聊天场景普遍用不到那么高的思考量（既慢又贵），因此对 deepseek 端点
 * 回退到 'low'。想改的话在「模型管理」里选即可，显式设置永远优先。
 */
export function resolveReasoningEffort(model: Model): ReasoningEffort {
  if (model.reasoningEffort !== undefined) return model.reasoningEffort;
  if (/deepseek/i.test(model.baseUrl)) return 'low';
  return DEFAULT_REASONING_EFFORT;
}
