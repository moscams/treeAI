import React, { useState, useRef } from 'react';
import { GripVertical, Plus, Save, Trash2, Star } from 'lucide-react';
import { useModelStore } from '../../stores/modelStore';
import { Model, ReasoningEffort } from '../../types';
import { REASONING_EFFORT_OPTIONS, resolveReasoningEffort } from '../../utils/reasoningEffort';

/**
 * 模型配置面板。
 *
 * 从原来的 ModelManager 弹窗里拆出来 —— 现在它是「设置」里的一个标签页，
 * 自身不再管遮罩层、标题栏和关闭按钮，那些由 SettingsModal 负责。
 */
const ModelsPanel: React.FC = () => {
  const { models, createModel, updateModel, deleteModel, reorderModels } = useModelStore();
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const handleDropOnModel = async (targetId: string) => {
    const sourceId = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    const ids = models.map(m => m.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;

    // 把拖动的模型插到目标模型之前
    ids.splice(from, 1);
    ids.splice(ids.indexOf(targetId), 0, sourceId);
    await reorderModels(ids);
  };

  const handleAddModel = () => {
    const newModel: Model = {
      id: crypto.randomUUID(),
      // 预填 DeepSeek：用户只需要粘贴 API Key 就能用。
      // reasoningEffort 故意不设 —— 留空时 resolveReasoningEffort() 会按 baseUrl
      // 自动判定为 low；如果写死成 low，以后把 baseUrl 换成 OpenAI 就会多发一个
      // 它不认识的 reasoning_effort 参数。
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      modelName: 'deepseek-v4-pro',
      defaultSystemPrompt: 'You are a helpful assistant.',
      maxTokens: 32768,
      temperature: 0.7
    };

    setEditingModel(newModel);
  };

  const handleEditModel = (model: Model) => {
    setEditingModel({ ...model });
  };

  const handleSaveModel = (e: React.FormEvent) => {
    e.preventDefault();

    if (!editingModel) return;

    if (models.some(m => m.id === editingModel.id)) {
      updateModel(editingModel);
    } else {
      createModel(editingModel);
    }

    setEditingModel(null);
  };

  const handleDeleteModel = (id: string) => {
    if (confirm('确定要删除这个模型吗？')) {
      deleteModel(id);
      if (editingModel?.id === id) {
        setEditingModel(null);
      }
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-1/3 border-r border-neutral-100 p-4 overflow-y-auto">
        <div className="mb-3 flex justify-between items-center">
          <h3 className="text-sm font-medium text-neutral-700">模型列表</h3>
          <button
            className="flex items-center space-x-1 text-neutral-600 hover:text-neutral-800 p-1 rounded hover:bg-neutral-50"
            onClick={handleAddModel}
          >
            <Plus size={14} />
            <span className="text-xs">添加</span>
          </button>
        </div>

        {models.length > 1 && (
          <p className="mb-2 text-xs text-neutral-400 leading-relaxed">
            拖动调整顺序，<span className="text-neutral-600">第一项就是默认模型</span>，新建对话会自动使用它。
          </p>
        )}

        <div className="space-y-1">
          {models.length === 0 ? (
            <div className="text-center text-neutral-400 p-4 text-sm">
              暂无配置模型
            </div>
          ) : (
            models.map((model, index) => (
              <div
                key={model.id}
                draggable
                onDragStart={(e) => {
                  setDragId(model.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                onDragOver={(e) => { e.preventDefault(); setDragOverId(model.id); }}
                onDragLeave={() => setDragOverId(prev => (prev === model.id ? null : prev))}
                onDrop={(e) => { e.preventDefault(); handleDropOnModel(model.id); }}
                className={`py-2 px-2 rounded-md cursor-pointer flex justify-between items-center border ${
                  dragOverId === model.id && dragId && dragId !== model.id
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-transparent'
                } ${
                  editingModel?.id === model.id ? 'bg-neutral-100 text-neutral-900' : 'hover:bg-neutral-50 text-neutral-600'
                } ${dragId === model.id ? 'opacity-50' : ''}`}
                onClick={() => handleEditModel(model)}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <GripVertical size={13} className="flex-shrink-0 text-neutral-300 cursor-grab active:cursor-grabbing" />
                  <span className="truncate text-sm">{model.name}</span>
                  {index === 0 && (
                    <span className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">
                      <Star size={9} fill="currentColor" />
                      默认
                    </span>
                  )}
                </span>
                <button
                  className="text-neutral-400 hover:text-neutral-700 p-1 rounded hover:bg-neutral-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteModel(model.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="w-2/3 p-4 overflow-y-auto">
        {editingModel ? (
          <form ref={formRef} onSubmit={handleSaveModel} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                模型名称
              </label>
              <input
                type="text"
                value={editingModel.name}
                onChange={(e) => setEditingModel({ ...editingModel, name: e.target.value })}
                className="w-full p-2 border border-neutral-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                API 地址
              </label>
              {/* 用 type="text" 而不是 type="url"：url 会让浏览器在提交时做格式校验，
                  不合格就静默拦住 form submit（只弹一个不起眼的提示），
                  表现为「点了保存没反应」。宁可让它存进去、请求时再报错。 */}
              <input
                type="text"
                inputMode="url"
                value={editingModel.baseUrl}
                onChange={(e) => setEditingModel({ ...editingModel, baseUrl: e.target.value })}
                className="w-full p-2 border border-neutral-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                placeholder="https://api.deepseek.com"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                API 密钥
              </label>
              <input
                type="password"
                value={editingModel.apiKey}
                onChange={(e) => setEditingModel({ ...editingModel, apiKey: e.target.value })}
                className="w-full p-2 border border-neutral-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                模型标识 (例如: gpt-4)
              </label>
              <input
                type="text"
                value={editingModel.modelName}
                onChange={(e) => setEditingModel({ ...editingModel, modelName: e.target.value })}
                className="w-full p-2 border border-neutral-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                思考强度 (reasoning_effort)
              </label>
              <select
                value={editingModel.reasoningEffort ?? resolveReasoningEffort(editingModel)}
                onChange={(e) => setEditingModel({ ...editingModel, reasoningEffort: e.target.value as ReasoningEffort })}
                className="w-full p-2 border border-neutral-200 rounded-md text-sm bg-white focus:outline-none focus:ring-1 focus:ring-neutral-400"
              >
                {REASONING_EFFORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-neutral-400">
                DeepSeek V4 起 thinking 默认开启且 effort=high。聊天场景建议 low：思考量小、响应快、输出 token 便宜。
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                默认系统提示词 <span className="text-neutral-400 font-normal">（可留空）</span>
              </label>
              <textarea
                value={editingModel.defaultSystemPrompt}
                onChange={(e) => setEditingModel({ ...editingModel, defaultSystemPrompt: e.target.value })}
                className="w-full p-2 border border-neutral-200 rounded-md h-32 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                placeholder="留空则不发送 system 消息 —— 这是合法请求，大多数模型不带系统提示词也能正常对话"
              />
            </div>

            <div className="flex space-x-4">
              <div className="flex-1">
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-medium text-neutral-700">
                    默认温度
                  </label>
                  <span className="text-xs text-neutral-500">{editingModel.temperature.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={editingModel.temperature}
                  onChange={(e) => setEditingModel({ ...editingModel, temperature: parseFloat(e.target.value) })}
                  className="w-full accent-neutral-700"
                />
              </div>

              <div className="flex-1">
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-medium text-neutral-700">
                    默认最大令牌数
                  </label>
                  <span className="text-xs text-neutral-500">{editingModel.maxTokens}</span>
                </div>
                <input
                  type="range"
                  min="256"
                  max="65535"
                  step="1"
                  value={editingModel.maxTokens}
                  onChange={(e) => setEditingModel({ ...editingModel, maxTokens: parseInt(e.target.value) })}
                  className="w-full accent-neutral-700"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-neutral-100">
              <button
                type="button"
                className="px-4 py-2 border border-neutral-200 rounded-md text-neutral-600 hover:bg-neutral-50 text-sm transition-colors"
                onClick={() => setEditingModel(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className="flex items-center space-x-2 px-4 py-2 bg-neutral-900 text-white rounded-md hover:bg-neutral-800 text-sm transition-colors"
              >
                <Save size={14} />
                <span>保存模型</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500">
            <div className="text-center p-6 bg-neutral-50 rounded-lg border border-neutral-100 max-w-md">
              <h3 className="text-base font-medium text-neutral-700 mb-2">模型配置</h3>
              <p className="mb-4 text-sm text-neutral-500">
                从左侧列表选择一个模型进行编辑，或创建一个新模型。
              </p>
              <button
                className="inline-flex items-center space-x-2 px-4 py-2 bg-neutral-900 text-white rounded-md hover:bg-neutral-800 text-sm transition-colors"
                onClick={handleAddModel}
              >
                <Plus size={14} />
                <span>添加新模型</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ModelsPanel;
