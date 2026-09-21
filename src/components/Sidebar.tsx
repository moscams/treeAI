import React, { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { 
  Search, Plus, Settings, Trash2, Edit, X, ChevronLeft,
  MessageSquare, Library, Sun, Moon
} from 'lucide-react';
import { gsap } from 'gsap';
import { showSuccess, showWarning, showInfo } from '../utils/notification';
import { useThemeStore } from '../stores/themeStore';
import { DEFAULT_SESSION_TITLE } from '../utils/sessionTitle';

interface SidebarProps {
  onModelManagerClick: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onModelManagerClick, collapsed, onToggleCollapse }) => {
  const { 
    sessions, 
    currentSessionId, 
    setCurrentSessionId, 
    createSession,
    deleteSession,
    updateSession,
    searchQuery,
    setSearchQuery,
    filteredSessions
  } = useSessionStore();

  const { theme, toggleTheme } = useThemeStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;

    // 用 gsap.from 时必须显式清理：它会“从当前值推到自然值”，
    // 而 React 18 StrictMode 会双次调用 effect，第二个补间会把第一个补间的
    // 中间态当成终点，于是侧边栏永久带着一个 -10px 左右的残留偏移
    // （表现为“边距不对”）。clearProps 负责保证 tween 结束后不留下内联 transform。
    const tween = gsap.from(el, {
      x: -20,
      opacity: 0,
      duration: 0.5,
      ease: 'power2.out',
      clearProps: 'transform,opacity'
    });

    return () => {
      tween.kill();
      gsap.set(el, { clearProps: 'transform,opacity' });
    };
  }, [collapsed]);

  const handleCreateSession = () => {
    const newSession = {
      id: crypto.randomUUID(),
      title: DEFAULT_SESSION_TITLE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: []
    };
    createSession(newSession);
  };

  const handleStartEdit = (id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  };

  const handleSaveEdit = (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session && editTitle.trim()) {
      updateSession({
        ...session,
        title: editTitle.trim()
      });
      showSuccess('会话名称已更新');
    } else if (!editTitle.trim()) {
      showWarning('会话名称不能为空');
    }
    setEditingId(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      handleSaveEdit(id);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  const handleDeleteSession = (id: string) => {
    deleteSession(id);
    showInfo('会话已删除');
  };

  if (collapsed) return null;

  return (
    <div 
      ref={sidebarRef}
      className="sidebar w-64 h-full bg-white border-r border-neutral-200 flex flex-col z-10 relative"
    >
      <button 
        className="absolute -right-3 top-4 bg-white p-1.5 rounded-full border border-neutral-200 shadow-minimal z-20"
        onClick={onToggleCollapse}
      >
        <ChevronLeft size={14} className="text-neutral-600" />
      </button>

      <div className="px-5 py-4 border-b border-neutral-100">
        <h1 className="text-lg font-medium gradient-text">TreeAI</h1>
      </div>

      <div className="px-4 py-3">
        <div className="relative">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="搜索会话..."
            className="w-full pl-9 pr-3 py-2 rounded-md border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-1 focus:ring-neutral-300 focus:border-neutral-300 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Search className="absolute left-3 top-2.5 text-neutral-400" size={16} />
          {searchQuery && (
            <button 
              className="absolute right-3 top-2.5 text-neutral-400 hover:text-neutral-600"
              onClick={() => setSearchQuery('')}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-hide">
        {filteredSessions.length === 0 ? (
          <div className="text-center text-neutral-400 py-8 text-sm">
            {searchQuery ? '没有匹配的会话' : '暂无会话'}
          </div>
        ) : (
          filteredSessions.map(session => (
            <div 
              key={session.id}
              className={`sidebar-session py-2 px-3 flex justify-between items-center rounded-md group ${
                currentSessionId === session.id 
                  ? 'bg-neutral-100 text-neutral-900' 
                  : 'text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {editingId === session.id ? (
                <input
                  type="text"
                  className="flex-1 px-2 py-1 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => handleSaveEdit(session.id)}
                  onKeyDown={(e) => handleKeyPress(e, session.id)}
                  autoFocus
                />
              ) : (
                <div 
                  className="flex items-center flex-1 truncate cursor-pointer" 
                  onClick={() => setCurrentSessionId(session.id)}
                >
                  <MessageSquare size={16} className="mr-2 flex-shrink-0" />
                  <span className="text-sm">{session.title}</span>
                </div>
              )}
              
              <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  className="text-neutral-500 hover:text-neutral-700 p-1 rounded-md hover:bg-neutral-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartEdit(session.id, session.title);
                  }}
                >
                  <Edit size={14} />
                </button>
                <button 
                  className="text-neutral-500 hover:text-neutral-700 p-1 rounded-md hover:bg-neutral-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSession(session.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="px-3 py-3 border-t border-neutral-100">
        <button
          className="w-full flex items-center justify-center space-x-2 py-2 px-4 bg-neutral-900 text-white rounded-md hover:bg-neutral-800 transition-colors"
          onClick={handleCreateSession}
        >
          <Plus size={16} />
          <span className="text-sm">新建会话</span>
        </button>
      </div>
      
      <div className="px-3 py-3 border-t border-neutral-100 flex justify-between">
        <button 
          className="flex-1 flex items-center justify-center py-2 text-neutral-600 hover:bg-neutral-50 rounded-md transition-colors"
          onClick={onModelManagerClick}
        >
          <Settings size={18} />
        </button>
        <button 
          className="flex-1 flex items-center justify-center py-2 text-neutral-600 hover:bg-neutral-50 rounded-md transition-colors"
        >
          <Library size={18} />
        </button>
        <button 
          className="flex-1 flex items-center justify-center py-2 text-neutral-600 hover:bg-neutral-50 rounded-md transition-colors"
          onClick={toggleTheme}
          title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
