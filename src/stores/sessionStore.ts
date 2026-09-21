import { create } from 'zustand';
import { Session, ChatNode } from '../types';
import db from '../db/db';

export interface SessionImportResult {
  added: number;
  skipped: number;
}

interface SessionState {
  sessions: Session[];
  currentSessionId: string | null;
  searchQuery: string;
  filteredSessions: Session[];
  
  setSessions: (sessions: Session[]) => void;
  setCurrentSessionId: (id: string | null) => void;
  createSession: (session: Session) => void;
  updateSession: (session: Session) => void;
  deleteSession: (id: string) => void;
  addNodeToSession: (sessionId: string, node: ChatNode) => void;
  updateNodeInSession: (sessionId: string, node: ChatNode) => void;
  deleteNodeFromSession: (sessionId: string, nodeId: string) => void;
  setSearchQuery: (query: string) => void;
  importSessions: (sessions: Session[]) => Promise<SessionImportResult>;
}

/**
 * 最近更新的排最前。
 *
 * 这样「新建会话」自然出现在顶部（它的 updatedAt 最新），
 * 刚聊过的会话也会浮上来 —— 不需要在创建时特殊处理插入位置。
 * 列表渲染直接用这个顺序，别处不用再排。
 */
function sortByRecent(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/** 搜索过滤。永远基于「最新的 sessions + 最新的 query」计算，避免两者不同步。 */
function applySearch(sessions: Session[], query: string): Session[] {
  if (!query) return sessions;
  const needle = query.toLowerCase();
  return sessions.filter(s => s.title.toLowerCase().includes(needle));
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  searchQuery: '',
  filteredSessions: [],
  
  setSessions: (sessions) => {
    const sorted = sortByRecent(sessions);
    set({ 
      sessions: sorted,
      filteredSessions: sorted
    });
  },
  
  setCurrentSessionId: (id) => {
    set({ currentSessionId: id });
  },
  
  createSession: async (session) => {
    try {
      await db.saveSession(session);
      set((state) => {
        const sessions = sortByRecent([...state.sessions, session]);
        return {
          sessions,
          filteredSessions: applySearch(sessions, state.searchQuery),
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
        const sessions = sortByRecent(
          state.sessions.map(s => (s.id === session.id ? updatedSession : s))
        );
        return {
          sessions,
          // 注意：这里必须基于「过滤后」的结果重建。
          // 之前写的是 state.sessions.map(...)（未过滤），
          // 结果是任何一次更新都会把搜索结果冲掉，整个列表重新出现。
          filteredSessions: applySearch(sessions, state.searchQuery)
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
          filteredSessions: applySearch(sessions, state.searchQuery),
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
    
    const updatedSession = { 
      ...session, 
      nodes: session.nodes.map(n => n.id === node.id ? node : n),
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
      filteredSessions: applySearch(state.sessions, query)
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
        const sessions = sortByRecent([...state.sessions, ...toAdd]);
        return {
          sessions,
          filteredSessions: applySearch(sessions, state.searchQuery),
          // 本来没选中任何会话时，自动跳到刚导入的第一条，让用户马上看到结果
          currentSessionId: state.currentSessionId ?? toAdd[0].id
        };
      });
    }
    
    return { added: toAdd.length, skipped: incoming.length - toAdd.length };
  }
}));
