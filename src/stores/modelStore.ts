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
  /**
   * 默认模型 = **列表里排第一的那个**。
   *
   * 之所以不再单独维护一个「自由指定」的 defaultModelId：那玩意没落库，
   * 刷新就丢，而且和列表顺序可能不一致，用户搞不懂「默认」到底按哪个算。
   * 现在顺序就是唯一事实来源 —— 拖到最上面就是默认。
   */
  defaultModelId: string | null;

  setModels: (models: Model[]) => void;
  /** 把某个模型设为默认（= 移到列表第一位） */
  setDefaultModelId: (id: string | null) => void;
  createModel: (model: Model) => void;
  updateModel: (model: Model) => void;
  deleteModel: (id: string) => void;
  /** 拖拽排序后调用，orderedIds 是完整的、新的先后顺序 */
  reorderModels: (orderedIds: string[]) => Promise<void>;
  importModels: (models: Model[]) => Promise<ModelImportResult>;
}

const getErrorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Unknown error'
);

/** 按 sortOrder 升序；缺失 sortOrder 的旧数据排在最后，靠稳定排序保持原相对位置。 */
function sortByOrder(models: Model[]): Model[] {
  return [...models].sort(
    (a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
  );
}

/** 老数据可能完全没有 sortOrder，补上时按现有顺序编号，避免它们全挤到末尾乱序。 */
function normalizeOrder(models: Model[]): Model[] {
  if (!models.some(m => m.sortOrder === undefined)) return models;
  return models.map((m, i) => (m.sortOrder === undefined ? { ...m, sortOrder: i } : m));
}

function nextSortOrder(models: Model[]): number {
  const max = models.reduce(
    (acc, m) => (m.sortOrder === undefined ? acc : Math.max(acc, m.sortOrder)),
    -1
  );
  return max + 1;
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  defaultModelId: null,

  setModels: (models) => {
    const sorted = sortByOrder(normalizeOrder(models));
    set({
      models: sorted,
      defaultModelId: sorted.length > 0 ? sorted[0].id : null
    });
  },

  setDefaultModelId: (id) => {
    if (!id) {
      set({ defaultModelId: null });
      return;
    }
    // 设为默认 = 把它挪到第一位，顺序与 defaultModelId 永远保持一致
    get().reorderModels([id, ...get().models.filter(m => m.id !== id).map(m => m.id)]);
  },

  createModel: async (model) => {
    try {
      const withOrder: Model = { ...model, sortOrder: nextSortOrder(get().models) };
      await db.saveModel(withOrder);
      set((state) => {
        const models = [...state.models, withOrder];
        return {
          models,
          defaultModelId: state.defaultModelId ?? withOrder.id
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
      const existing = get().models.find(m => m.id === model.id);
      // 编辑表单不会带 sortOrder，这里补回去，否则一编辑就掉到列表最后
      const withOrder: Model = { ...model, sortOrder: model.sortOrder ?? existing?.sortOrder };
      await db.saveModel(withOrder);
      set((state) => {
        const models = sortByOrder(state.models.map(m => (m.id === model.id ? withOrder : m)));
        return {
          models,
          defaultModelId: models.length > 0 ? models[0].id : null
        };
      });
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
        const models = state.models.filter(m => m.id !== id);
        return {
          models,
          defaultModelId: models.length > 0 ? models[0].id : null
        };
      });
      showInfo('模型已删除');
    } catch (error: unknown) {
      showError('模型删除失败:' + getErrorMessage(error));
      console.error('Failed to delete model:', error);
    }
  },

  reorderModels: async (orderedIds) => {
    const byId = new Map(get().models.map(m => [m.id, m]));
    const ordered: Model[] = [];
    orderedIds.forEach((id, index) => {
      const model = byId.get(id);
      if (model) ordered.push({ ...model, sortOrder: index });
    });
    if (ordered.length === 0) return;

    // 乐观更新：先把新顺序落到 UI，再后台写完 IndexedDB。
    // 否则拖完会先卡一下、等 Promise.all 完才“啪”地跳成新顺序，看起来像重绘。
    set({
      models: ordered,
      defaultModelId: ordered[0].id
    });

    try {
      await Promise.all(ordered.map(m => db.saveModel(m)));
    } catch (error: unknown) {
      showError('调整顺序失败:' + getErrorMessage(error));
      console.error('Failed to reorder models:', error);
    }
  },

  /**
   * 导入模型配置。**永远只追加**：已存在的 id 一律跳过，不覆盖。
   *
   * 这里绝不能「用文件里的覆盖现有的」：备份文件里的 apiKey 是空的，
   * 覆盖会把用户已经填好的密钥抹掉。重复的过滤掉，新的加进去 ——
   * 多设备来回导入就不会越导越乱，也不用每次想「我是不是导过这份」。
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

    let order = nextSortOrder(get().models);
    const withOrder = toAdd.map(m => ({ ...m, sortOrder: order++ }));

    for (const model of withOrder) {
      await db.saveModel(model);
    }

    if (withOrder.length > 0) {
      set((state) => {
        const models = [...state.models, ...withOrder];
        return {
          models,
          defaultModelId: state.defaultModelId ?? models[0].id
        };
      });
    }

    return { added: toAdd.length, skipped: incoming.length - toAdd.length };
  }
}));
