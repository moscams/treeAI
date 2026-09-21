import { Model } from '../types';
import { resolveReasoningEffort } from '../utils/reasoningEffort';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatRequestOptions {
  messages: ChatMessage[];
  model: Model;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
  onChunk: (chunk: string) => void;
  /** 思维链分片回调。与正文分开，不会混进 messages */
  onReasoning?: (chunk: string) => void;
}

export async function sendChatRequest(options: ChatRequestOptions): Promise<void> {
  const { messages, model, temperature, maxTokens, signal, onChunk, onReasoning } = options;
  
  try {
    // 去掉结尾多余的斜杠，避免拼出 //chat/completions
    const baseUrl = model.baseUrl.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/chat/completions`;

    const requestBody: Record<string, unknown> = {
      model: model.modelName,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true
    };

    // 思考强度：'default' 时不下发该参数，保持服务商原有默认行为
    const reasoningEffort = resolveReasoningEffort(model);
    if (reasoningEffort !== 'default') {
      requestBody.reasoning_effort = reasoningEffort;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Process complete server-sent events
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          if (data === '[DONE]') {
            break;
          }

          try {
            const json = JSON.parse(data);
            const choice = json.choices?.[0];
            
            // 思考型模型的思维链，单独走一条通道，绝不混进正文
            const reasoning = choice?.delta?.reasoning_content;
            if (reasoning && onReasoning) {
              onReasoning(reasoning);
            }
            
            // 兼容 OpenAI / DeepSeek 等流式返回格式
            const content = choice?.delta?.content || 
                            choice?.text || 
                            json.output || 
                            '';
            
            if (content) {
              onChunk(content);
            }
          } catch {
            console.warn('Failed to parse SSE data:', data);
          }
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request was cancelled');
    }
    throw error;
  }
}
