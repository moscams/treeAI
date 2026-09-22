import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Handle, Position, NodeProps, useUpdateNodeInternals } from 'reactflow';
import { MdPreview } from 'md-editor-rt';
import 'md-editor-rt/lib/preview.css';
import { Plus, Send, RefreshCcw, Copy, Settings, Trash2, MessageSquare, Brain, ChevronDown } from 'lucide-react';
import { useModelStore } from '../../stores/modelStore';
import { useThemeStore } from '../../stores/themeStore';
import { gsap } from 'gsap';
import { showSuccess, showInfo, showWarning } from '../../utils/notification';
import { sanitizeHtml } from '../../utils/sanitize';
import { NodeData } from '../../types';

const ChatNode: React.FC<NodeProps<NodeData>> = ({ id, data }) => {
  const { node, streamingResponse, streamingReasoning, autoFocus, onEdit, onAddChild, onDelete, onRetry, onResubmit, onModelChange, onTemperatureChange, onMaxTokensChange } = data;
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
  const updateNodeInternals = useUpdateNodeInternals();
  
  /*
   * 入场只做透明度，**不做位移动画**。
   *
   * 之前的 `y: -20 → 0` 会在动画期间把 handle 一起向上带 20px。React Flow 测量
   * handle 偏移时，量的是 handle 相对 `.react-flow__node` 包装层的位置 —— 包装层
   * 不带这个 transform，于是量到的 handle 位置比真实值高；动画结束前连线终点就
   * 停在节点上方，直到动画结束才“啪”地接上。
   * 任何 transform（translate / scale）都会污染这个测量，所以动画期间干脆别动位置。
   *
   * onComplete 里依旧补一次重测，作为字体/图片迟到导致的尺寸变化的兜底。
   */
  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;

    let raf = 0;
    let tween: gsap.core.Tween | null = null;
    let cancelled = false;
    const deadline = performance.now() + 2000;

    // 先置 0。否则元素从 hidden 变 visible 的那一帧会先以满不透明度画一下，
    // 下一帧才被 rAF 里的淡入改成 0 —— 表现为“先闪一下、再淡入”。
    gsap.set(el, { opacity: 0 });

    const start = () => {
      if (cancelled) return;

      // React Flow 在量到尺寸之前会先把节点设成 `visibility: hidden`。
      // 淡入必须等它**真正可见**之后再开始：否则动画在隐藏期间就已经跑掉一半，
      // 等节点“出现”时已经接近不透明 —— 看起来像闪一下 / 没有过渡。
      // 而“什么时候变可见”取决于测量时机，所以这个问题时有时无、很难复现。
      const hidden =
        el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden';
      if (hidden) {
        if (performance.now() < deadline) raf = requestAnimationFrame(start);
        else gsap.set(el, { opacity: 1 }); // 超时兜底，别让它一直隐着
        return;
      }

      tween = gsap.to(el, {
        opacity: 1, duration: 0.3, ease: 'power2.out',
        onComplete: () => updateNodeInternals(id)
      });
    };

    raf = requestAnimationFrame(start);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      tween?.kill();
      // 卸载/重挂时不要留下 opacity: 0（否则 StrictMode 下会真的把节点隐掉）
      gsap.set(el, { opacity: 1 });
    };
  }, [id, updateNodeInternals]);

  
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

  /*
   * 新建节点后直接把光标放进输入框，不需要用户再点一下。
   *
   * 这里有两个坑，必须同时处理：
   *
   * 1) React Flow 在量到节点尺寸之前，会把节点包成 `visibility: hidden`
   *    （`initialized: !!node.width && !!node.height`）。对隐藏元素调 focus()
   *    是**静默无效**的 —— 不会报错，也不会触发 focusin。所以不能一挂载就只试一次。
   *
   * 2) `autoFocus` 是 ChatFlow 里的一次性标记，节点入图后很快就会被置回 false。
   *    如果让循环的生死跟着 autoFocus（放在 effect 的 cleanup 里），它会在
   *    “节点还没变可见”的那一刻被清掉，光标永远等不到。所以循环一旦启动，
   *    只靠**自己成功 / 超时**停止，卸载时再由单独的 effect 兜底清理。
   */
  const focusLoopRef = useRef<number | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    // 只读节点（比如“重新生成”新建的分支：userMessage 已拷贝过来）没有输入框，
    // 不需要聚焦，也就没必要跑这个循环。
    if (!isEditingUser) return;
    if (focusLoopRef.current !== null) return; // 已在跑，别重复启动

    let stopped = false;
    const stop = () => {
      stopped = true;
      if (focusLoopRef.current !== null) {
        clearInterval(focusLoopRef.current);
        focusLoopRef.current = null;
      }
    };

    const tryFocus = () => {
      if (stopped) return;
      const el = userInputRef.current;
      if (!el) return;

      // React Flow 还没量到尺寸：元素隐藏，focus() 是空操作，下一轮再试
      if (el.offsetParent === null || getComputedStyle(el).visibility === 'hidden') return;

      const active = document.activeElement;
      if (active === el) { stop(); return; }
      // 用户已经在别的输入框里打字了，就不要抢
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) { stop(); return; }

      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      if (document.activeElement === el) stop();
    };

    tryFocus();
    focusLoopRef.current = window.setInterval(tryFocus, 60);
    // 超时兜底，避免极端情况下的空转
    window.setTimeout(stop, 4000);
  }, [autoFocus, isEditingUser]);

  // 卸载时清掉可能还在跑的聚焦循环
  useEffect(() => () => {
    if (focusLoopRef.current !== null) {
      clearInterval(focusLoopRef.current);
      focusLoopRef.current = null;
    }
  }, []);

  const handleSubmitUserMessage = () => {
    if (!userMessage.trim()) return;

    onEdit(node.id, userMessage, 'user');

    // 发送后退出编辑态。
    // 不退出的话，节点一直停在「可编辑」样式；切走再切回来时组件重挂载，
    // isEditingUser 会根据「已有 userMessage」重新算成 false —— 于是同一个节点
    // 前后样式不一样（像“进入过编辑又退出”），用户会不知道该处于哪种状态。
    setIsEditingUser(false);

    // 显式点发送 / Ctrl+Enter = 「让这个节点用当前文字重新回答一遍」。
    //
    // 用 onResubmit 而不是 onRetry：改了消息就地重出，结果写回本节点，
    // **不另起分支**。想保留旧答案对照的话，用户自己从父节点拉个新节点就行，
    // 不在这里替他做决定。（「重新生成」按钮仍走 onRetry，那条才起兄弟分支。）
    //
    // 不能再用「内容有没有变」当条件：输入框每次击键都会把草稿写回节点
    // （onEdit 带 isDraft），所以到点击时 node.userMessage 早已经是新内容，
    // 比较永远相等 —— 这正是“改成 456 后再点发送毫无反应”的原因。
    if (!node.isStreaming) {
      setTimeout(() => {
        onResubmit(node.id);
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
              max="65535"
              step="1"
              value={node.maxTokens}
              onChange={(e) => onMaxTokensChange(node.id, parseInt(e.target.value))}
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
                // 必须洗：md-editor-rt 的 sanitize 默认是恒等函数（不洗），
                // 模型回答里塞的 <script>/<img onerror> 会真执行（见 utils/sanitize.ts）。
                sanitize={sanitizeHtml}
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
                // 同上：非流式的历史消息同样要清洗
                sanitize={sanitizeHtml}
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
            onClick={() => onRetry(node.id)} 
            className="p-1 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50 rounded transition-colors"
            title="重新生成回复（另起一个新分支，保留当前回答）"
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
