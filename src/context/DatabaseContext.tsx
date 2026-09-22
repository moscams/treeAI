import React, { createContext, useContext, ReactNode, useCallback } from 'react';
import db from '../db/db';
import { useSessionStore } from '../stores/sessionStore';
import { useModelStore } from '../stores/modelStore';

interface DatabaseContextType {
  loadSessions: () => Promise<void>;
  loadModels: () => Promise<void>;
  loadFolders: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextType | undefined>(undefined);

export const DatabaseProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { setSessions, setFolders } = useSessionStore();
  const { setModels } = useModelStore();

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await db.getAllSessions();
      setSessions(sessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }, [setSessions]);

  // 文件夹独立加载。即使这里失败，会话照样能显示（都落在「全部」里），
  // 所以不让它拖垮启动流程。
  const loadFolders = useCallback(async () => {
    try {
      const folders = await db.getAllFolders();
      setFolders(folders);
    } catch (error) {
      console.error('Failed to load folders:', error);
    }
  }, [setFolders]);

  const loadModels = useCallback(async () => {
    try {
      const models = await db.getAllModels();
      setModels(models);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  }, [setModels]);

  return (
    <DatabaseContext.Provider value={{ loadSessions, loadModels, loadFolders }}>
      {children}
    </DatabaseContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useDatabaseContext = () => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabaseContext must be used within a DatabaseProvider');
  }
  return context;
};
