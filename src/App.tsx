import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatFlow from './components/ChatFlow';
import SettingsModal from './components/SettingsModal';
import type { SettingsTab } from './components/SettingsModal';
import NotificationContainer from './components/Notification';
import { useSessionStore } from './stores/sessionStore';
import { useModelStore } from './stores/modelStore';
import { useDatabaseContext } from './context/DatabaseContext';
import { Session } from './types';
import { DEFAULT_SESSION_TITLE } from './utils/sessionTitle';
import { ChevronRight, Loader2, PlusCircle } from 'lucide-react';
import { useT } from './i18n';

const App: React.FC = () => {
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { currentSessionId, setCurrentSessionId } = useSessionStore();
  const { loadSessions, loadModels, loadFolders } = useDatabaseContext();
  const { sessions } = useSessionStore();
  const { models } = useModelStore();
  const [isLoading, setIsLoading] = useState(true);
  const t = useT();

  useEffect(() => {
    const initializeData = async () => {
      try {
        await loadSessions();
        await loadModels();
        await loadFolders();
      } catch (error) {
        console.error('Failed to initialize data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLoading && sessions.length > 0 && !currentSessionId) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [sessions, currentSessionId, setCurrentSessionId, isLoading]);

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-50">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-neutral-500 mx-auto" />
          <p className="mt-4 text-base text-neutral-600">{t('加载中...')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50">
      {sidebarCollapsed && (
        <button 
          className="absolute top-4 left-4 z-20 bg-white p-1.5 rounded-full shadow-minimal border border-neutral-200"
          onClick={toggleSidebar}
        >
          <ChevronRight size={14} className="text-neutral-600" />
        </button>
      )}
      
      <Sidebar 
        onOpenSettings={(tab) => setSettingsTab(tab ?? 'models')} 
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />
      <main className="flex-1 overflow-hidden relative">
        {currentSessionId ? (
          <ChatFlow
            sessionId={currentSessionId}
            onOpenSettings={() => setSettingsTab('models')}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-md p-8 bg-white rounded-lg shadow-subtle border border-neutral-100">
              <h2 className="text-xl font-medium text-neutral-800 mb-4">{t('欢迎使用 Tree AI Plus')}</h2>
              <p className="text-neutral-600 mb-6 text-sm leading-relaxed">
                {t('创建一个新会话，开始与 AI 进行树状结构的对话。')}
              </p>
              <button 
                className="inline-flex items-center justify-center space-x-2 px-5 py-2 bg-neutral-900 text-white rounded-md hover:bg-neutral-800 transition-colors"
                onClick={() => {
                  if (models.length === 0) {
                    setSettingsTab('models');
                  } else {
                    const newSession: Session = {
                      id: crypto.randomUUID(),
                      title: DEFAULT_SESSION_TITLE,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      nodes: []
                    };
                    useSessionStore.getState().createSession(newSession);
                    setCurrentSessionId(newSession.id);
                  }
                }}
              >
                <PlusCircle size={16} className="mr-2" />
                <span>{models.length === 0 ? t('设置模型') : t('创建新会话')}</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {settingsTab && (
        <SettingsModal
          initialTab={settingsTab}
          onClose={() => setSettingsTab(null)}
        />
      )}
      
      <NotificationContainer />
    </div>
  );
};

export default App;
