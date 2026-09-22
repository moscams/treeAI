import { create } from 'zustand';
import { Session, ChatNode, Folder } from '../types';
import db from '../db/db';
import { DEFAULT_SESSION_TITLE } from '../utils/sessionTitle';

export interface ImportResult {
  added: number;
  skipped: number;
}

/** 侧边栏当前的文件夹视图：全部 / 未分类 / 某个文件夹 id */
export type FolderView = 'all' | 'uncategorized' | string;

interface SessionState {
  sessions: Session[];
  folders: Folder[];
  currentSessionId: string | null;
  searchQuery: string;
  currentFolderView: FolderView;
  filteredSessions: Session[];

  setSessions: (sessions: Session[]) => void;
  setFolders: (folders: Folder[]) => void;
  setCurrentSessionId: (id: string | null) => void;
  setFolderView: (view: FolderView) => void;
  createSession: (session: Session) => void;
  updateSession: (session: Session) => void;
  deleteSession: (id: string) => void;
  addNodeToSession: (sessionId: string, node: ChatNode) => void;
  updateNodeInSession: (sessionId: string, node: ChatNode) => void;
  deleteNodeFromSession: (sessionId: string, nodeId: string) => void;
  setSearchQuery: (query: string) => void;
  importSessions: (sessions: Session[]) => Promise<ImportResult>;
  toggleStarred: (id: string) => Promise<void>;
  /** 自动命名：仅当标题还是默认值时生效，绝不覆盖用户改过的标题 */
  autoTitleSession: (id: string, title: string) => Promise<void>;

  createFolder: (name: string) => Promise<Folder | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  /** 删除文件夹：里面的会话回到「未分类」，绝不跟着删 */
  deleteFolder: (id: string) => Promise<void>;
  moveSessionToFolder: (sessionId: string, folderId: string | null) => Promise<void>;
  importFolders: (folders: Folder[]) => Promise<ImportResult>;
}

/**
 * 最近更新的排最前。
 *
 * 这样「新建会话」自然出现在顶部（它的 updatedAt 最新），
 * 刚聊过的会话也会浮上来 —— 不需要在创建时特殊处理插入位置。
 *
 * 收藏**不参与排序**：点星标只是一种标记，不算「更新过」，不该让会话跳位。
 */
function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/** 会话是否命中搜索词。标题和所有消息正文都搜，中文直接 includes（没有大小写概念）。 */
function sessionMatches(session: Session, needle: string): boolean {
  if (session.title.toLowerCase().includes(needle)) return true;
  return session.nodes.some(node =>
    (node.userMessage && node.userMessage.toLowerCase().includes(needle)) ||
    (node.assistantMessage && node.assistantMessage.toLowerCase().includes(needle))
  );
}

/**
 * 搜索 + 文件夹过滤。
 *
 * 永远基于「最新的 sessions + 最新的 query + 最新的 folderView」计算，
 * 避免三者不同步（任何一次 session 更新都要用同一套规则重算）。
 */
function computeVisible(
  sessions: Session[],
  query: string,
  folderView: FolderView
): Session[] {
  let result = sessions;

  if (folderView === 'uncategorized') {
    result = result.filter(s => !s.folderId);
  } else if (folderView !== 'all') {
    result = result.filter(s => s.folderId === folderView);
  }

  const needle = query.trim().toLowerCase();
  if (!needle) return result;
  return result.filter(s => sessionMatches(s, needle));
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  folders: [],
  currentSessionId: null,
  searchQuery: '',
  currentFolderView: 'all',
  filteredSessions: [],

  setSessions: (sessions) => {
    const sorted = sortSessions(sessions);
    set((state) => ({
      sessions: sorted,
      filteredSessions: computeVisible(sorted, state.searchQuery, state.currentFolderView)
    }));
  },

  setFolders: (folders) => {
    set((state) => {
      // 当前选中的文件夹被删掉时，退回「全部」，否则列表会空得莫名其妙
      const stillExists =
        state.currentFolderView === 'all' ||
        state.currentFolderView === 'uncategorized' ||
        folders.some(f => f.id === state.currentFolderView);
      const currentFolderView = stillExists ? state.currentFolderView : 'all';
      return {
        folders,
        currentFolderView,
        filteredSessions: computeVisible(state.sessions, state.searchQuery, currentFolderView)
      };
    });
  },

  setCurrentSessionId: (id) => {
    set({ currentSessionId: id });
  },

  setFolderView: (view) => {
    set((state) => ({
      currentFolderView: view,
      filteredSessions: computeVisible(state.sessions, state.searchQuery, view)
    }));
  },

  createSession: async (session) => {
    try {
      await db.saveSession(session);
      set((state) => {
        const sessions = sortSessions([...state.sessions, session]);
        return {
          sessions,
          filteredSessions: computeVisible(sessions, state.searchQuery, state.currentFolderView),
          currentSessionId: session.id
        };
      });
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  },

  updateSession: async (session) => {
    try {
      const updatedSession = {
        ...session,
        updatedAt: new Date().toISOString()
      };
      await db.saveSession(updatedSession);
      set((state) => {
        const sessions = sortSessions(
          state.sessions.map(s => (s.id === session.id ? updatedSession : s))
        );
        return {
          sessions,
          filteredSessions: computeVisible(sessions, state.searchQuery, state.currentFolderView)
        };
      });
    } catch (error) {
      console.error('Failed to update session:', error);
    }
  },

  deleteSession: async (id) => {
    try {
      await db.deleteSession(id);
      set((state) => {
        const sessions = state.sessions.filter(s => s.id !== id);
        const newCurrentId = state.currentSessionId === id
          ? (sessions.length > 0 ? sessions[0].id : null)
          : state.currentSessionId;

        return {
          sessions,
          filteredSessions: computeVisible(sessions, state.searchQuery, state.currentFolderView),
          currentSessionId: newCurrentId
        };
      });
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  },

  addNodeToSession: (sessionId, node) => {
    const session = get().sessions.find(s => s.id === sessionId);
    if (!session) return;

    const updatedSession = {
      ...session,
      nodes: [...session.nodes, node],
      updatedAt: new Date().toISOString()
    };

    get().updateSession(updatedSession);
  },

  updateNodeInSession: (sessionId, node) => {
    const session = get().sessions.find(s => s.id === sessionId);
    if (!session) return;

    // upsert：分支场景下「重新生成」会先调用本方法把新节点标成流式中，
    // 此时 addNodeToSession 的异步落库可能还没把节点写进 store。
    // 只 map 不追加的话，那次更新会被丢掉。
    const exists = session.nodes.some(n => n.id === node.id);
    const updatedSession = {
      ...session,
      nodes: exists
        ? session.nodes.map(n => n.id === node.id ? node : n)
        : [...session.nodes, node],
      updatedAt: new Date().toISOString()
    };

    get().updateSession(updatedSession);
  },

  deleteNodeFromSession: (sessionId, nodeId) => {
    const session = get().sessions.find(s => s.id === sessionId);
    if (!session) return;

    // Remove this node and its children recursively
    const nodesToRemove = new Set<string>();

    const collectNodesToRemove = (id: string) => {
      nodesToRemove.add(id);
      session.nodes
        .filter(n => n.parentId === id)
        .forEach(child => collectNodesToRemove(child.id));
    };

    collectNodesToRemove(nodeId);

    const updatedSession = {
      ...session,
      nodes: session.nodes.filter(n => !nodesToRemove.has(n.id)),
      updatedAt: new Date().toISOString()
    };

    get().updateSession(updatedSession);
  },

  setSearchQuery: (query) => {
    set((state) => ({
      searchQuery: query,
      filteredSessions: computeVisible(state.sessions, query, state.currentFolderView)
    }));
  },

  /**
   * 导入会话。冲突（id 已存在）一律跳过，绝不覆盖现有数据 ——
   * 这是备份工具最重要的性质。跳过数量会回传给调用方用于提示。
   *
   * 顺带挡住同一个文件内部的重复 id。
   */
  importSessions: async (incoming) => {
    const existingIds = new Set(get().sessions.map(s => s.id));
    const seen = new Set<string>();
    const toAdd: Session[] = [];

    for (const session of incoming) {
      if (existingIds.has(session.id) || seen.has(session.id)) continue;
      seen.add(session.id);
      toAdd.push(session);
    }

    for (const session of toAdd) {
      await db.saveSession(session);
    }

    if (toAdd.length > 0) {
      set((state) => {
        const sessions = sortSessions([...state.sessions, ...toAdd]);
        return {
          sessions,
          filteredSessions: computeVisible(sessions, state.searchQuery, state.currentFolderView),
          // 本来没选中任何会话时，自动跳到刚导入的第一条，让用户马上看到结果
          currentSessionId: state.currentSessionId ?? toAdd[0].id
        };
      });
    }

    return { added: toAdd.length, skipped: incoming.length - toAdd.length };
  },

  /**
   * 切换收藏。
   *
   * 不走 updateSession —— 那个会刷新 updatedAt，导致「收藏一下会话就跳到
   * 最近列表最前」这种副作用。收藏是标记，不是「又聊过」。
   */
  toggleStarred: async (id) => {
    const session = get().sessions.find(s => s.id === id);
    if (!session) return;

    const updated = { ...session, starred: !session.starred };

    try {
      await db.saveSession(updated);
      set((state) => {
        const sessions = sortSessions(
          state.sessions.map(s => (s.id === id ? updated : s))
        );
        return {
          sessions,
          filteredSessions: computeVisible(sessions, state.searchQuery, state.currentFolderView)
        };
      });
    } catch (error) {
      console.error('Failed to toggle starred:', error);
    }
  },

  /**
   * 自动命名。
   *
   * 单独一条 action，而不是调用 updateSession({ ...session, title }) ——
   * 后者会把调用方闭包里那份「旧 session」整体写回，连带把刚创建、还没落库的
   * 分支节点一起抹掉。这里始终基于 store 里的最新对象，只改 title。
   */
  autoTitleSession: async (id, title) => {
    const session = get().sessions.find(s => s.id === id);
    if (!session) return;
    // 用户自己改过标题就不再介入
    if (session.title !== DEFAULT_SESSION_TITLE || !title || session.title === title) return;

    const updated = { ...session, title };

    try {
      await db.saveSession(updated);
      set((state) => {
        const sessions = sortSessions(
          state.sessions.map(s => (s.id === id ? updated : s))
        );
        return {
          sessions,
          filteredSessions: computeVisible(sessions, state.searchQuery, state.currentFolderView)
        };
      });
    } catch (error) {
      console.error('Failed to auto-title session:', error);
    }
  },

  // ---- 文件夹 ----

  createFolder: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const folder: Folder = {
      id: crypto.randomUUID(),
      name: trimmed,
      createdAt: new Date().toISOString()
    };

    try {
      await db.saveFolder(folder);
      set((state) => {
        const folders = [...state.folders, folder];
        return {
          folders,
          // 新建后直接切到新文件夹，用户马上能看到它
          currentFolderView: folder.id,
          filteredSessions: computeVisible(state.sessions, state.searchQuery, folder.id)
        };
      });
      return folder;
    } catch (error) {
      console.error('Failed to create folder:', error);
      return null;
    }
  },

  renameFolder: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const folder = get().folders.find(f => f.id === id);
    if (!folder) return;

    const updated = { ...folder, name: trimmed };

    try {
      await db.saveFolder(updated);
      set((state) => ({
        folders: state.folders.map(f => (f.id === id ? updated : f))
      }));
    } catch (error) {
      console.error('Failed to rename folder:', error);
    }
  },

  deleteFolder: async (id) => {
    const affected = get().sessions.filter(s => s.folderId === id);

    try {
      await db.deleteFolder(id);

      // 文件夹里的会话回到「未分类」，并把这次变更落库
      const updatedSessions = affected.map(s => ({ ...s, folderId: null }));
      for (const session of updatedSessions) {
        await db.saveSession(session);
      }

      set((state) => {
        const sessions = state.sessions.map(s =>
          s.folderId === id ? { ...s, folderId: null } : s
        );
        const folders = state.folders.filter(f => f.id !== id);
        const currentFolderView = state.currentFolderView === id ? 'all' : state.currentFolderView;
        return {
          folders,
          sessions,
          currentFolderView,
          filteredSessions: computeVisible(sessions, state.searchQuery, currentFolderView)
        };
      });
    } catch (error) {
      console.error('Failed to delete folder:', error);
    }
  },

  moveSessionToFolder: async (sessionId, folderId) => {
    const session = get().sessions.find(s => s.id === sessionId);
    if (!session) return;
    if ((session.folderId ?? null) === (folderId ?? null)) return;

    // 不刷新 updatedAt：拖动归类不是「又聊过」，不该让它跳位
    const updated = { ...session, folderId: folderId ?? null };

    try {
      await db.saveSession(updated);
      set((state) => {
        const sessions = sortSessions(
          state.sessions.map(s => (s.id === sessionId ? updated : s))
        );
        return {
          sessions,
          filteredSessions: computeVisible(sessions, state.searchQuery, state.currentFolderView)
        };
      });
    } catch (error) {
      console.error('Failed to move session:', error);
    }
  },

  importFolders: async (incoming) => {
    const existingIds = new Set(get().folders.map(f => f.id));
    const seen = new Set<string>();
    const toAdd: Folder[] = [];

    for (const folder of incoming) {
      if (existingIds.has(folder.id) || seen.has(folder.id)) continue;
      seen.add(folder.id);
      toAdd.push(folder);
    }

    for (const folder of toAdd) {
      await db.saveFolder(folder);
    }

    if (toAdd.length > 0) {
      set((state) => ({ folders: [...state.folders, ...toAdd] }));
    }

    return { added: toAdd.length, skipped: incoming.length - toAdd.length };
  }
}));
