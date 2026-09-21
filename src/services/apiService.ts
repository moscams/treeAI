import { Model, UsageStats } from '../types';
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
  /** token 用量回调。多数服务端需要 stream_options.include_usage 才会在流里返回 */
  onUsage?: (usage: UsageStats) => void;
}

/*
 * usage 的获取。
 *
 * 关键点：流式模式下，OpenAI 这类服务端「默认不返回 usage」—— 必须显式下发
 * stream_options.include_usage。DeepSeek 是个例外，它总是把 usage 挂在最后一个
 * 分片上。之前为了少一个兼容性风险没发这个参数，代价是：换个模型就什么统计都没有。
 *
 * 但确实有些兼容层收到不认识的字段直接 400。所以策略是：默认带，失败再退回不带，
 * 并把结论记在下面这个 Set 里 —— 同一个模型不会再白跑一次失败请求。
 */
const streamOptionsUnsupported = new Set<string>();

// 只在这些字样出现时才认为是「参数不被接受」，避免把「模型不存在」之类误判成重试
const PARAM_REJECTED = /stream_options|include_usage|unexpected keyword|extra inputs|unknown parameter|unexpected parameter|unsupported parameter|extra fields/i;

export async function sendChatRequest(options: ChatRequestOptions): Promise<void> {
  const { messages, model, temperature, maxTokens, signal, onChunk, onReasoning, onUsage } = options;
  
  try {
    // 去掉结尾多余的斜杠，避免拼出 //chat/completions
    const baseUrl = model.baseUrl.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/chat/completions`;

    const buildRequestBody = (withUsage: boolean): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        model: model.modelName,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true
      };

      if (withUsage) {
        body.stream_options = { include_usage: true };
      }

      // 思考强度：'default' 时不下发该参数，保持服务商原有默认行为
      const reasoningEffort = resolveReasoningEffort(model);
      if (reasoningEffort !== 'default') {
        body.reasoning_effort = reasoningEffort;
      }

      return body;
    };

    const send = (withUsage: boolean) =>
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`
        },
        body: JSON.stringify(buildRequestBody(withUsage)),
        signal
      });

    const modelKey = `${baseUrl}|${model.modelName}`;
    const wantsUsage = onUsage ? !streamOptionsUnsupported.has(modelKey) : false;
    let response = await send(wantsUsage);

    if (!response.ok && wantsUsage && response.status >= 400 && response.status < 500) {
      const errorText = await response.text();
      if (!PARAM_REJECTED.test(errorText)) {
        throw new Error(`API request failed: ${response.status} ${errorText}`);
      }
      // 服务端不认 stream_options：记下来，这个模型以后都不再带，然后原样重发一次
      streamOptionsUnsupported.add(modelKey);
      response = await send(false);
    }

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
            
            // token 用量。字段名各家不一样，能认的都认一下。
            if (json.usage && onUsage) {
              const u = json.usage;
              const promptTokens = u.prompt_tokens ?? 0;

              // 缓存命中：
              //   DeepSeek  prompt_cache_hit_tokens
              //   OpenAI    prompt_tokens_details.cached_tokens
              //   Anthropic cache_read_input_tokens（部分兼容层会透传）
              const cacheHitTokens = u.prompt_cache_hit_tokens
                ?? u.prompt_tokens_details?.cached_tokens
                ?? u.cache_read_input_tokens
                ?? 0;

              // 未命中：DeepSeek 直接给；其他家只能自己减。
              // 注意判空方式 —— OpenAI 报 cached_tokens: 0 是有意义的（表示缓存在用但这次没命中），
              // 这时候要算成 100% 未命中并把「缓存 0%」显示出来，而不是当作「这家不支持缓存」。
              const reportsCache = cacheHitTokens > 0 || u.prompt_tokens_details != null
                || u.prompt_cache_miss_tokens != null || u.cache_read_input_tokens != null;
              const cacheMissTokens = u.prompt_cache_miss_tokens
                ?? (reportsCache ? Math.max(promptTokens - cacheHitTokens, 0) : 0);

              onUsage({
                promptTokens,
                completionTokens: u.completion_tokens ?? 0,
                totalTokens: u.total_tokens ?? 0,
                cacheHitTokens,
                cacheMissTokens,
                reasoningTokens: u.completion_tokens_details?.reasoning_tokens
              });
            }
            
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
