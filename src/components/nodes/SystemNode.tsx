import React, { useState, useEffect, useRef } from 'react';
import { Handle, Position, NodeProps, useUpdateNodeInternals } from 'reactflow';
import { Plus, Settings } from 'lucide-react';
import { useModelStore } from '../../stores/modelStore';
import { gsap } from 'gsap';
import { NodeData } from '../../types';
import { useT } from '../../i18n';

const SystemNode: React.FC<NodeProps<NodeData>> = ({ id, data }) => {
  const { node, onEdit, onAddChild, onModelChange, onTemperatureChange, onMaxTokensChange } = data;
  const [isEditing, setIsEditing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(node.userMessage || '');
  
  const { models } = useModelStore();
  
  const nodeRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const t = useT();

  // 同 ChatNode：入场不用位移动画（transform 会污染 React Flow 对 handle 的测量，
  // 导致动画期间连线终点不贴节点），只做淡入；并且等节点真正可见后再开始淡入
  // （测量之前 React Flow 会先把它设成 visibility: hidden，提前淡入会“闪一下”）。
  useEffect(() => {
    const el = nodeRef.current;
    if (!el) return;

    let raf = 0;
    let tween: gsap.core.Tween | null = null;
    let cancelled = false;
    const deadline = performance.now() + 2000;

    // 先置 0，避免元素刚变可见那一帧先闪一下满不透明再淡入
    gsap.set(el, { opacity: 0 });

    const start = () => {
      if (cancelled) return;
      const hidden =
        el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden';
      if (hidden) {
        if (performance.now() < deadline) raf = requestAnimationFrame(start);
        else gsap.set(el, { opacity: 1 });
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
      gsap.set(el, { opacity: 1 });
    };
  }, [id, updateNodeInternals]);

  // Debug log for width changes
  useEffect(() => {
    if (nodeRef.current && node.userMessage) {
      console.debug(`System Node ${id} width: ${nodeRef.current.offsetWidth}px`);
    }
  }, [node.userMessage, id]);

  useEffect(() => {
    setSystemPrompt(node.userMessage || '');
  }, [node.userMessage]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [isEditing]);

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = () => {
    onEdit(node.id, systemPrompt, 'system');
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setSystemPrompt(node.userMessage || '');
    }
  };

  const nodeHeight = isEditing || showSettings ? 'auto' : 'min-h-[100px]';

  return (
    <div ref={nodeRef} className="relative">
      <div
        className={`node-content bg-white rounded-lg overflow-hidden border border-neutral-200 shadow-minimal ${nodeHeight}`}
      >
      <div className="flex justify-between items-center p-2 text-neutral-700 border-b border-neutral-100 shrink-0">
        <div className="flex items-center">
          <Settings size={14} className="mr-1.5 text-neutral-500" />
          <span className="text-xs font-medium">{t('系统提示词')}</span>
        </div>
        
        <div className="flex space-x-1 node-toolbar">
          <button 
            className="p-1 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-50 rounded transition-colors"
            onClick={() => setShowSettings(!showSettings)}
            title={t('模型设置')}
          >
            <Settings size={12} />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="p-3 bg-neutral-50 border-b border-neutral-100">
          <div className="mb-3">
            <label className="block text-xs font-medium text-neutral-700 mb-1">
              {t('模型')}
            </label>
            <select
              value={node.modelId || ''}
              onChange={(e) => onModelChange(node.id, e.target.value)}
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
                {t('温度')}
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
                {t('最大令牌数')}
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

      <div className="p-3 flex-1 min-h-0 overflow-y-auto">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full h-32 p-2.5 border border-neutral-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            placeholder={t('在此输入系统提示词...')}
          />
        ) : (
          <div 
            className="min-h-[60px] cursor-pointer text-sm" 
            onClick={handleEdit}
            style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}
          >
            {node.userMessage || (
              <span className="text-neutral-400 italic">
                {t('点击添加系统提示词...')}
              </span>
            )}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-neutral-400 !border-white"
      />
      </div>

      {/* 同 ChatNode：底栏整条删掉，「+」悬浮在节点右下角，不占布局高度 */}
      <button
        type="button"
        className="absolute -bottom-3 -right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-neutral-900 bg-neutral-900 text-white shadow-sm transition-colors hover:bg-neutral-700"
        onClick={() => onAddChild(node.id)}
        title={t('添加子节点')}
      >
        <Plus size={14} />
      </button>
    </div>
  );
};

export default SystemNode;
