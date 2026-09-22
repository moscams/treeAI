// Main data types for the application

export type ReasoningEffort = 'default' | 'none' | 'low' | 'high' | 'max';

/** 单次请求的 token 用量统计，来自服务商返回的 usage 字段 */
export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 命中上下文缓存的输入 token 数 */
  cacheHitTokens: number;
  /** 未命中缓存的输入 token 数 */
  cacheMissTokens: number;
  /** 思考消耗的 token（部分服务商不返回） */
  reasoningTokens?: number;
  /** 从发出请求到收到最后一个分片的耗时，用于估算 token/s */
  durationMs?: number;
}

export interface Model {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  defaultSystemPrompt: string;
  maxTokens: number;
  temperature: number;
  /**
   * 思考强度。'default' 表示不发送 reasoning_effort，交由服务商默认行为决定。
   * DeepSeek V4 的取值：none 关闭思考 / low / high / max。
   */
  reasoningEffort?: ReasoningEffort;
  /** 列表顺序。数字最小的排最前，也就是**默认模型**。旧数据没有这个字段。 */
  sortOrder?: number;
}

/** 会话文件夹。单层，不支持嵌套 —— 够用，且不会把侧边栏变成一棵要维护的树。 */
export interface Folder {
  id: string;
  name: string;
  createdAt: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: ChatNode[];
  /** 收藏标记。只用于筛选和视觉标记，不影响排序。旧数据没有这个字段，当作未收藏。 */
  starred?: boolean;
  /** 所属文件夹。undefined / null 表示未分类。旧数据没有这个字段。 */
  folderId?: string | null;
}

export interface ChatNode {
  id: string;
  parentId: string | null;
  type: 'system' | 'chat';
  userMessage: string;
  assistantMessage: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  createdAt: string;
  isStreaming?: boolean;
  error?: string;
  /**
   * 思考型模型的思维链（reasoning_content）。
   * 仅本地留存展示用，绝不会回传给 API —— 带 tools 时回传才需要，不带 tools 传了也会被忽略。
   */
  reasoning?: string;
  /** 最近一次请求的 token 用量统计 */
  usage?: UsageStats;
  position?: NodePosition;
}

export interface Position {
  x: number;
  y: number;
}

export interface NodeData {
  node: ChatNode;
  streamingResponse?: string | null;
  /** 流式期间的思维链（正文之前到达，且有独立的 SSE 通道） */
  streamingReasoning?: string | null;
  onAddChild: (parentId: string) => void;
  onEdit: (nodeId: string, content: string, type: 'user' | 'assistant' | 'system', isDraft?: boolean) => void;
  onDelete: (nodeId: string) => void;
  onRetry: (nodeId: string) => void;
  /**
   * 原地重出：改了这条消息后重新生成，结果写回**本节点**，不另起分支。
   * （「重新生成」按钮走 onRetry，那条才会保留旧答案、起兄弟分支。）
   */
  onResubmit: (nodeId: string) => void;
  onModelChange: (nodeId: string, modelId: string) => void;
  onTemperatureChange: (nodeId: string, temperature: number) => void;
  onMaxTokensChange: (nodeId: string, maxTokens: number) => void;
  isRoot?: boolean;
  /**
   * 这个节点是刚创建的，输入框应该自动取得焦点，用户直接打字就行。
   * 只在新建时置 true，所以不会在重渲染时反复抢焦点。
   */
  autoFocus?: boolean;
}

export interface ModelResponse {
  text: string;
  isComplete: boolean;
  error?: string;
}

export interface NodePosition {
  x: number;
  y: number;
}
