import { create } from 'zustand';
import { Model } from '../types';
import db from '../db/db';
import { showError, showInfo, showSuccess } from '../utils/notification';

export interface ModelImportResult {
  added: number;
  skipped: number;
}

interface ModelState {
  models: Model[];
  defaultModelId: string | null;
  
  setModels: (models: Model[]) => void;
  setDefaultModelId: (id: string | null) => void;
  createModel: (model: Model) => void;
  updateModel: (model: Model) => void;
  deleteModel: (id: string) => void;
  importModels: (models: Model[]) => Promise<ModelImportResult>;
}

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Unknown error'
);

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  defaultModelId: null,
  
  setModels: (models) => {
    set({ 
      models,
      defaultModelId: models.length > 0 ? models[0].id : null
    });
  },
  
  setDefaultModelId: (id) => {
    set({ defaultModelId: id });
  },
  
  createModel: async (model) => {
    try {
      await db.saveModel(model);
      set((state) => {
        const newModels = [...state.models, model];
        const newDefaultId = state.defaultModelId || model.id;
        
        return { 
          models: newModels,
          defaultModelId: newDefaultId
        };
      });
      showSuccess('模型创建成功');
    } catch (error: unknown) {
      showError('模型创建失败:' + getErrorMessage(error));
      console.error('Failed to create model:', error);
    }
  },
  
  updateModel: async (model) => {
    try {
      await db.saveModel(model);
      set((state) => ({
        models: state.models.map(m => 
          m.id === model.id ? model : m
        )
      }));
      showSuccess('模型更新成功');
    } catch (error: unknown) {
      showError('模型更新失败：' + getErrorMessage(error));
      console.error('Failed to update model:', error);
    }
  },
  
  deleteModel: async (id) => {
    try {
      await db.deleteModel(id);
      set((state) => {
        const newModels = state.models.filter(m => m.id !== id);
        const newDefaultId = state.defaultModelId === id 
          ? (newModels.length > 0 ? newModels[0].id : null) 
          : state.defaultModelId;
          
        return {
          models: newModels,
          defaultModelId: newDefaultId
        };
      });
      showInfo('模型已删除');
    } catch (error: unknown) {
      showError('模型删除失败:' + getErrorMessage(error));
      console.error('Failed to delete model:', error);
    }
  },

  /**
   * 导入模型配置。已存在的 id 一律跳过。
   *
   * 这里绝不能「用文件里的覆盖现有的」：备份文件里的 apiKey 是空的，
   * 覆盖会把用户已经填好的密钥抹掉。
   *
   * 批量导入不发 toast —— 由调用方汇总成一条消息（逐个 model 弹提示会刷屏）。
   */
  importModels: async (incoming) => {
    const existingIds = new Set(get().models.map(m => m.id));
    const seen = new Set<string>();
    const toAdd: Model[] = [];

    for (const model of incoming) {
      if (existingIds.has(model.id) || seen.has(model.id)) continue;
      seen.add(model.id);
      toAdd.push({ ...model, apiKey: model.apiKey ?? '' });
    }

    for (const model of toAdd) {
      await db.saveModel(model);
    }

    if (toAdd.length > 0) {
      set((state) => {
        const models = [...state.models, ...toAdd];
        return {
          models,
          defaultModelId: state.defaultModelId ?? models[0].id
        };
      });
    }

    return { added: toAdd.length, skipped: incoming.length - toAdd.length };
  }
}));
