// Main data types for the application

export type ReasoningEffort = 'default' | 'none' | 'low' | 'high' | 'max';

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
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: ChatNode[];
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
  position?: NodePosition;
}

export interface Position {
  x: number;
  y: number;
}

export interface NodeData {
  node: ChatNode;
  streamingResponse?: string | null;
  onAddChild: (parentId: string) => void;
  onEdit: (nodeId: string, content: string, type: 'user' | 'assistant' | 'system') => void;
  onDelete: (nodeId: string) => void;
  onRetry: (nodeId: string) => void;
  onModelChange: (nodeId: string, modelId: string) => void;
  onTemperatureChange: (nodeId: string, temperature: number) => void;
  onMaxTokensChange: (nodeId: string, maxTokens: number) => void;
  isRoot?: boolean;
}

export interface ModelResponse {
  text: string;
  isComplete: boolean;
  error?: string;
}

export interface FileExtractResult {
  text: string;
  filename: string;
  mimeType: string;
}

export interface NodePosition {
  x: number;
  y: number;
}
