import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { MdPreview } from 'md-editor-rt';
import 'md-editor-rt/lib/preview.css';
import { Plus, Send, RefreshCcw, Copy, Settings, Trash2, MessageSquare, Brain, ChevronDown } from 'lucide-react';
import { useModelStore } from '../../stores/modelStore';
import { useThemeStore } from '../../stores/themeStore';
import { gsap } from 'gsap';
import { showSuccess, showInfo, showWarning } from '../../utils/notification';
import { NodeData } from '../../types';

const ChatNode: React.FC<NodeProps<NodeData>> = ({ id, data }) => {
  const { node, streamingResponse, streamingReasoning, onEdit, onAddChild, onDelete, onRetry, onModelChange, onTemperatureChange, onMaxTokensChange } = data;
  const [userMessage, setUserMessage] = useState(node.userMessage || '');
  const [isEditingUser, setIsEditingUser] = useState(!node.userMessage);
  const [showSettings, setShowSettings] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  
  const { models } = useModelStore();
  const { theme } = useThemeStore();
  
  // ---- 统计信息 ----
  const usage = node.usage;
  const answerChars = node.assistantMessage?.length ?? 0;
  const cacheTotal = usage ? usage.cacheHitTokens + usage.cacheMissTokens : 0;
  const cacheRate = usage && cacheTotal > 0
    ? Math.round((usage.cacheHitTokens / cacheTotal) * 100)
    : null;
  const tokensPerSecond = usage?.durationMs && usage.completionTokens > 0
    ? Math.round(usage.completionTokens / (usage.durationMs / 1000))
    : null;

  // 流式期间优先显示实时思维链；流完之后节点上持久化的值接管。
  const reasoningText = streamingReasoning || node.reasoning || '';
  const isLiveReasoning = !!streamingReasoning && !!node.isStreaming;

  // 思维链一产生就自动展开，否则「流式显示」等于没显示。
  // 用 ref 保证每个节点只自动展开一次，之后尊重用户的折叠操作。
  const autoExpandedReasoning = useRef(false);
  useEffect(() => {
    if (isLiveReasoning && !autoExpandedReasoning.current) {
      autoExpandedReasoning.current = true;
      setShowReasoning(true);
    }
  }, [isLiveReasoning]);
  
  const userInputRef = useRef<HTMLTextAreaElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (nodeRef.current) {
      gsap.fromTo(nodeRef.current, 
        { y: -20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, ease: "power2.out" }
      );
    }
  }, []);

  
  // Debug log for width changes
  useEffect(() => {
    if (nodeRef.current && node.assistantMessage) {
      console.debug(`Node ${id} width: ${nodeRef.current.offsetWidth}px`);
    }
  }, [node.assistantMessage, id]);


  useEffect(() => {
    if (isEditingUser && userInputRef.current) {
      userInputRef.current.focus();
      userInputRef.current.setSelectionRange(
        userInputRef.current.value.length,
        userInputRef.current.value.length
      );
    }
  }, [isEditingUser]);

  const handleSubmitUserMessage = () => {
    if (!userMessage.trim()) return;
    
    onEdit(node.id, userMessage, 'user');
    // setIsEditingUser(false); // 发送后不切换编辑态，输入框内容不变
    
    // If there's no AI response yet, trigger one
    if (!node.assistantMessage && !node.isStreaming) {
      setTimeout(() => {
        onRetry(node.id);
      }, 100);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSubmitUserMessage();
    }
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    
    // Show a brief animation
    const button = document.activeElement;
    if (button) {
      gsap.fromTo(
        button,
        { backgroundColor: 'rgba(79, 70, 229, 0.2)' },
        { backgroundColor: 'transparent', duration: 1 }
      );
    }
    
    // 显示通知
    showSuccess('内容已复制到剪贴板');
  };

  // 滚轮处理：
  //  - 普通滚轮：留在节点内部滚动，不带动画布（stopPropagation）
  //  - Ctrl/⌘ + 滚轮：交给 React Flow 缩放画布。
  //    React Flow 把 ctrlKey+wheel 当作触控板捏合手势（zoomOnPinch，默认开），
  //    但它的监听挂在画布元素的冒泡阶段，我们必须放行才能让它收到；
  //    同时 preventDefault 阻止浏览器把 Ctrl+滚轮当成「整页缩放」。
  const handleWheel = useCallback((e: WheelEvent) => {
    if (!nodeRef.current || !nodeRef.current.contains(e.target as Node)) return;

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      return;
    }

    e.stopPropagation();
  }, []);

  useEffect(() => {
    // capture 阶段：保证在节点内任何子元素之前处理。
    // passive: false 是必须的，否则浏览器会忽略 preventDefault。
    const node = nodeRef.current;
    const opts = { capture: true, passive: false } as const;
    if (node) {
      node.addEventListener('wheel', handleWheel, opts);
    }

    return () => {
      if (node) {
        node.removeEventListener('wheel', handleWheel, opts);
      }
    };
  }, [handleWheel]);

  return (
    <div 
      ref={nodeRef}
      className="node-content bg-white rounded-lg overflow-hidden border border-neutral-200 shadow-minimal"
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-neutral-400 !border-white"
      />

      <div className="flex justify-between items-center p-2 text-neutral-700 border-b border-neutral-100 shrink-0">
        <div className="flex items-center">
          <MessageSquare size={14} className="mr-1.5 text-neutral-500" />
          <span className="text-xs font-medium">对话节点</span>
        </div>
        
        <div className="flex space-x-1 node-toolbar">
          <button 
            className="p-1 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50 rounded transition-colors"
            onClick={() => setShowSettings(!showSettings)}
            title="模型设置"
          >
            <Settings size={12} />
          </button>
          <button 
            className="p-1 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50 rounded transition-colors"
            onClick={() => {
              onDelete(node.id);
              showWarning('节点已删除');
            }}
            title="删除节点"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="p-3 bg-neutral-50 border-b border-neutral-100 shrink-0">
          <div className="mb-3">
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              模型
            </label>
            <select
              value={node.modelId || ''}
              onChange={(e) => {
                // 提示由 ChatFlow 统一发出 —— 只有它知道系统提示词有没有被一并替换
                onModelChange(node.id, e.target.value);
              }}
              className="w-full p-1.5 text-xs border border-neutral-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-neutral-400"
            >
              {models.map(model => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </div>
          
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-medium text-neutral-700">
                温度
              </label>
              <span className="text-xs text-neutral-500">{node.temperature.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={node.temperature}
              onChange={(e) => onTemperatureChange(node.id, parseFloat(e.target.value))}
              className="w-full accent-neutral-700"
            />
          </div>
          
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-medium text-neutral-700">
                最大令牌数
              </label>
              <span className="text-xs text-neutral-500">{node.maxTokens}</span>
            </div>
            <input
              type="range"
              min="256"
              max="32768"
              step="256"
              value={node.maxTokens}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                onMaxTokensChange(node.id, value);
                if (value % 1024 === 0) { // 只在1024的整数倍时显示通知
                  showInfo(`最大令牌数设置为: ${value}`);
                }
              }}
              className="w-full accent-neutral-700"
            />
          </div>
        </div>
      )}

      <div 
        className="p-3 border-b border-neutral-100 shrink-0"
        onWheel={(e) => {
          e.stopPropagation();
        }}
      >
        {isEditingUser ? (
          <div className="relative">
            <textarea
              ref={userInputRef}
              value={userMessage}
              onChange={(e) => {
                setUserMessage(e.target.value);
                onEdit(node.id, e.target.value, 'user', true);
              }}
              onBlur={() => {
                onEdit(node.id, userMessage, 'user', false);
                if (userMessage.trim() && userMessage !== node.userMessage) {
                  showInfo('消息已保存');
                }
              }}
              className="w-full p-2.5 border border-neutral-200 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-400 text-[17px] leading-relaxed"
              placeholder="在此输入您的消息..."
              onKeyDown={handleKeyDown}
              rows={3}
            />
            <div className="flex justify-end mt-2 pr-2" style={{ marginTop: "-30px" }}>
              <button
                onClick={handleSubmitUserMessage}
                disabled={!userMessage.trim()}
                className={`flex items-center space-x-1 px-2 py-1 rounded-full ${
                  userMessage.trim() 
                    ? 'send-button'
                    : 'send-button disabled'
                } transition-colors`}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        ) : (
          <div className="relative group">
            <div 
              className="pr-8 max-h-[200px] min-h-[80px] overflow-auto text-[19px] leading-relaxed whitespace-pre-wrap"
              onClick={() => setIsEditingUser(true)}
            >
              {node.userMessage || <span className="text-gray-400 italic">Click to add message...</span>}
            </div>
            <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="p-1 text-gray-500 hover:text-blue-600 transition-colors"
                onClick={() => handleCopyToClipboard(node.userMessage)}
                title="Copy"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div 
        className="assistant-message p-3 relative"
        onWheel={(e) => {
          e.stopPropagation();
        }}
      >
        {node.isStreaming ? (
          <div className="flex items-center space-x-2 text-gray-500 mb-2">
            <div className="animate-pulse">AI is thinking...</div>
            <div className="animate-bounce delay-100">.</div>
            <div className="animate-bounce delay-200">.</div>
            <div className="animate-bounce delay-300">.</div>
          </div>
        ) : node.error ? (
          <div className="text-red-500 mb-2">
            Error: {node.error}
          </div>
        ) : null}

        {reasoningText ? (
          <div className="mb-2 border border-neutral-100 rounded-md overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setShowReasoning(v => !v)}
              className="w-full flex items-center justify-between px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              <span className="flex items-center">
                <Brain size={12} className="mr-1.5" />
                思考过程 · {reasoningText.length} 字
                {isLiveReasoning && (
                  <span className="ml-1.5 animate-pulse text-neutral-400">思考中…</span>
                )}
              </span>
              <ChevronDown
                size={12}
                className={`transition-transform ${showReasoning ? 'rotate-180' : ''}`}
              />
            </button>
            {showReasoning && (
              <pre
                className="m-0 px-2.5 py-2 text-xs leading-relaxed text-neutral-500 whitespace-pre-wrap break-words max-h-[240px] overflow-auto border-t border-neutral-100 bg-neutral-50/50 font-sans"
                onWheel={(e) => e.stopPropagation()}
              >
                {reasoningText}
              </pre>
            )}
          </div>
        ) : null}

        {(streamingResponse !== null && node.isStreaming) ? (
          <div className="relative group">
            <div 
              className="preview-container"
              onWheel={(e: React.WheelEvent) => {
                e.stopPropagation();
              }}
            >
              <MdPreview 
                editorId={`preview-${node.id}`}
                modelValue={streamingResponse}
                theme={theme}
                // mermaid 从 CDN 加载的体积高达 743KB（gzip），而且是不管内容里
                // 有没有图都会加载。关掉后 mermaid 代码块会降级成普通代码块。
                // 想要的话：本地打包 mermaid，删掉这行，再仿照 katex 加一套 shim。
                noMermaid
                className="md-preview overflow-auto break-words"
                style={{ backgroundColor: 'transparent', maxWidth: '100%' }}
                previewTheme="vuepress"
              />
            </div>
          </div>
        ) : node.assistantMessage ? (
          <div className="relative group">
            <div 
              className="preview-container"
              onWheel={(e: React.WheelEvent) => {
                e.stopPropagation();
              }}
            >
              <MdPreview 
                editorId={`preview-${node.id}`}
                modelValue={node.assistantMessage}
                theme={theme}
                // 同上面那处：mermaid 太重，关掉（降级为普通代码块）
                noMermaid
                className="md-preview overflow-auto break-words"
                style={{ backgroundColor: 'transparent', maxWidth: '100%' }}
                previewTheme="vuepress"
              />
            </div>
            <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="p-1 text-gray-500 hover:text-blue-600 transition-colors"
                onClick={() => handleCopyToClipboard(node.assistantMessage)}
                title="Copy"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        ) : !node.isStreaming ? (
          <div className="text-neutral-400 italic min-h-[160px] text-sm">
            {node.error ? '请点击重试获取AI回复' : 'AI回复将显示在这里'}
          </div>
        ) : null}

        {!node.isStreaming && answerChars > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 pt-2 border-t border-neutral-100 text-[11px] text-neutral-400">
            <span>{answerChars} 字</span>
            {tokensPerSecond !== null && (
              <span title="输出速度（含首字延迟）">~{tokensPerSecond} tok/s</span>
            )}
            {cacheRate !== null && (
              <span
                className={cacheRate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : undefined}
                title={`命中缓存 ${usage?.cacheHitTokens} tok，未命中 ${usage?.cacheMissTokens} tok`}
              >
                缓存 {cacheRate}%
              </span>
            )}
            {usage && (
              <span title="输入 token · 输出 token">
                入 {usage.promptTokens} · 出 {usage.completionTokens}
              </span>
            )}
            {usage?.reasoningTokens ? (
              <span title="思考消耗的 token">思考 {usage.reasoningTokens}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex justify-between items-center border-t border-neutral-100 p-2 shrink-0">
        <div className="flex space-x-2">
          <button 
            onClick={() => handleCopyToClipboard(node.assistantMessage)}
            className="p-1 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50 rounded transition-colors"
            title="复制到剪贴板"
          >
            <Copy size={14} />
          </button>
          <button 
            onClick={() => {
              onRetry(node.id);
              showInfo('正在重新生成回复...');
            }} 
            className="p-1 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50 rounded transition-colors"
            title="重新生成回复"
          >
            <RefreshCcw size={14} />
          </button>
        </div>
        
        <button 
          className="flex items-center justify-center p-1.5 bg-neutral-900 text-white rounded-full hover:bg-neutral-800 transition-colors"
          onClick={() => onAddChild(node.id)}
          title="添加子节点"
        >
          <Plus size={14} />
        </button>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-neutral-400 !border-white"
      />
    </div>
  );
};

export default ChatNode;
