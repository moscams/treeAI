import React, { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import {
  Search, Plus, Settings, Trash2, Edit, X, ChevronLeft,
  MessageSquare, Sun, Moon, Star, Folder, FolderPlus, FolderInput, Check
} from 'lucide-react';
import Logo from './Logo';
import { gsap } from 'gsap';
import { showSuccess, showWarning, showInfo } from '../utils/notification';
import { useThemeStore } from '../stores/themeStore';
import { DEFAULT_SESSION_TITLE } from '../utils/sessionTitle';
import type { SettingsTab } from './SettingsModal';
import { useT } from '../i18n';

interface SidebarProps {
  onOpenSettings: (tab?: SettingsTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/** 会话需要移动到的目标：某个文件夹，或 null 表示「未分类」 */
type MoveTarget = string | null;

const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings, collapsed, onToggleCollapse }) => {
  const {
    sessions,
    folders,
    currentSessionId,
    currentFolderView,
    setCurrentSessionId,
    setFolderView,
    createSession,
    deleteSession,
    updateSession,
    searchQuery,
    setSearchQuery,
    filteredSessions,
    toggleStarred,
    createFolder,
    renameFolder,
    deleteFolder,
    moveSessionToFolder,
  } = useSessionStore();

  const { theme, toggleTheme } = useThemeStore();
  const t = useT();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  // 新建文件夹的内联输入
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  // 重命名文件夹
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  // 拖拽目标高亮
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  // 「移动到文件夹」菜单：fixed 定位，避免被列表的 overflow 裁掉
  const [moveMenu, setMoveMenu] = useState<{ sessionId: string; top: number; left: number } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // 搜索来自 store，收藏过滤只是本地视图层的事，不需要进 store
  const visibleSessions = starredOnly
    ? filteredSessions.filter(s => s.starred)
    : filteredSessions;

  const hasFolders = folders.length > 0;

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

  // 点击别处关掉移动菜单
  useEffect(() => {
    if (!moveMenu) return;
    const close = () => setMoveMenu(null);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [moveMenu]);

  const handleCreateSession = () => {
    // 当前正停在某个文件夹里新建，就直接归进去，省一次拖动
    const folderId =
      currentFolderView !== 'all' && currentFolderView !== 'uncategorized'
        ? currentFolderView
        : null;

    const newSession = {
      id: crypto.randomUUID(),
      title: DEFAULT_SESSION_TITLE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [],
      folderId,
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
      showSuccess(t('会话名称已更新'));
    } else if (!editTitle.trim()) {
      showWarning(t('会话名称不能为空'));
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
    showInfo(t('会话已删除'));
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setIsCreatingFolder(false);
      return;
    }
    const folder = await createFolder(newFolderName);
    if (folder) {
      showSuccess(t('已创建文件夹「{name}」', { name: folder.name }));
    }
    setNewFolderName('');
    setIsCreatingFolder(false);
  };

  const handleRenameFolder = async (id: string) => {
    if (folderNameDraft.trim()) {
      await renameFolder(id, folderNameDraft);
      showSuccess(t('文件夹已重命名'));
    }
    setEditingFolderId(null);
    setFolderNameDraft('');
  };

  const handleDeleteFolder = async (id: string, name: string) => {
    // 会话不会被删，只是回到「未分类」，所以这里说清楚，避免用户以为连聊天记录一起没了
    if (!window.confirm(t('删除文件夹「{name}」？\n里面的会话会移到「未分类」，不会被删除。', { name }))) return;
    await deleteFolder(id);
    showInfo(t('文件夹已删除，会话已移到「未分类」'));
  };

  const handleDropOnFolder = (e: React.DragEvent, target: MoveTarget) => {
    e.preventDefault();
    setDragOverFolder(null);
    const sessionId = e.dataTransfer.getData('text/session-id');
    if (!sessionId) return;
    moveSessionToFolder(sessionId, target);
  };

  const chipClass = (active: boolean) =>
    `flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
      active
        ? 'bg-neutral-900 text-white border-neutral-900'
        : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
    }`;

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
        <div className="flex items-center gap-2">
          {/* 和浏览器标签页 favicon、「关于」页用同一个标识 */}
          <Logo size={26} />
          <h1 className="text-lg font-medium gradient-text">Tree AI Plus</h1>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="relative">
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('搜索标题或内容...')}
            className="w-full pl-9 pr-16 py-2 rounded-md border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-1 focus:ring-neutral-300 focus:border-neutral-300 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {/* 用 inset-y-0 + items-center 让放大镜和右侧按钮都相对输入框真实高度垂直居中，
              不再靠 top-2.5 这种写死的偏移（字号或 padding 一改就错位）。 */}
          <Search className="pointer-events-none absolute left-3 inset-y-0 my-auto text-neutral-400" size={16} />
          <div className="absolute right-2 inset-y-0 flex items-center gap-0.5">
            {searchQuery && (
              <button
                className="text-neutral-400 hover:text-neutral-600 p-1"
                onClick={() => setSearchQuery('')}
                title={t('清除搜索')}
              >
                <X size={14} />
              </button>
            )}
            <button
              className={`p-1 rounded transition-colors ${
                starredOnly
                  ? 'text-amber-400'
                  : 'text-neutral-300 hover:text-neutral-500'
              }`}
              onClick={() => setStarredOnly(v => !v)}
              title={starredOnly ? t('显示全部会话') : t('只看收藏')}
            >
              <Star size={14} fill={starredOnly ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>
      </div>

      {/* 文件夹 chip：放不下就换行，不做横向滚动条 —— 横滑对鼠标用户很反直觉。 */}
      <div className="px-4 pb-2 flex flex-wrap items-center gap-1.5">
        <button
          className={chipClass(currentFolderView === 'all')}
          onClick={() => setFolderView('all')}
        >
          {t('全部')}
        </button>

        {folders.map(folder => {
          const active = currentFolderView === folder.id;
          if (editingFolderId === folder.id) {
            return (
              <input
                key={folder.id}
                autoFocus
                className="flex-shrink-0 w-24 px-2 py-1 text-xs border border-neutral-300 rounded-full focus:outline-none focus:ring-1 focus:ring-neutral-400"
                value={folderNameDraft}
                onChange={(e) => setFolderNameDraft(e.target.value)}
                onBlur={() => handleRenameFolder(folder.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameFolder(folder.id);
                  if (e.key === 'Escape') { setEditingFolderId(null); setFolderNameDraft(''); }
                }}
              />
            );
          }
          return (
            <div
              key={folder.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverFolder(folder.id); }}
              onDragLeave={() => setDragOverFolder(prev => (prev === folder.id ? null : prev))}
              onDrop={(e) => handleDropOnFolder(e, folder.id)}
              className={`group/chip ${chipClass(active)} ${
                dragOverFolder === folder.id ? 'ring-2 ring-amber-300 border-amber-300' : ''
              }`}
            >
              <button
                className="inline-flex items-center gap-1"
                onClick={() => setFolderView(folder.id)}
              >
                <Folder size={12} />
                {folder.name}
              </button>
              {active && (
                <span className="inline-flex items-center gap-0.5 ml-0.5">
                  <button
                    className="hover:opacity-70"
                    title={t('重命名')}
                    onClick={() => { setEditingFolderId(folder.id); setFolderNameDraft(folder.name); }}
                  >
                    <Edit size={11} />
                  </button>
                  <button
                    className="hover:opacity-70"
                    title={t('删除文件夹')}
                    onClick={() => handleDeleteFolder(folder.id, folder.name)}
                  >
                    <X size={11} />
                  </button>
                </span>
              )}
            </div>
          );
        })}

        {isCreatingFolder ? (
          <input
            autoFocus
            className="flex-shrink-0 w-24 px-2 py-1 text-xs border border-neutral-300 rounded-full focus:outline-none focus:ring-1 focus:ring-neutral-400"
            placeholder={t('文件夹名')}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={handleCreateFolder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') { setIsCreatingFolder(false); setNewFolderName(''); }
            }}
          />
        ) : (
          <button
            className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-neutral-400 border border-dashed border-neutral-300 hover:text-neutral-600 hover:border-neutral-400"
            onClick={() => setIsCreatingFolder(true)}
            title={t('新建文件夹')}
          >
            <FolderPlus size={12} />
          </button>
        )}

        {hasFolders && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOverFolder('__uncategorized__'); }}
            onDragLeave={() => setDragOverFolder(prev => (prev === '__uncategorized__' ? null : prev))}
            onDrop={(e) => handleDropOnFolder(e, null)}
            className={`${chipClass(currentFolderView === 'uncategorized')} ${
              dragOverFolder === '__uncategorized__' ? 'ring-2 ring-amber-300 border-amber-300' : ''
            }`}
          >
            <button onClick={() => setFolderView('uncategorized')}>{t('未分类')}</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-hide">
        {visibleSessions.length === 0 ? (
          <div className="text-center text-neutral-400 py-8 text-sm">
            {searchQuery
              ? t('没有匹配的会话')
              : starredOnly
                ? t('还没有收藏的会话')
                : currentFolderView !== 'all'
                  ? t('这个文件夹还是空的')
                  : t('暂无会话')}
          </div>
        ) : (
          visibleSessions.map(session => (
            <div
              key={session.id}
              draggable={hasFolders}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/session-id', session.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              className={`sidebar-session py-2 px-3 flex justify-between items-center rounded-md group relative ${
                currentSessionId === session.id
                  ? 'bg-neutral-100 text-neutral-900'
                  : 'text-neutral-600 hover:bg-neutral-50'
              }`}
              // 点击切会话：监听器挂在**整行**上。以前只挂在内层标题 div，
              // 行的 px-3 / py-2 内边距和图标右侧的缝隙都是死区，
              // 点到那里没反应 —— 表现就是「要点好几次才切得过去」。
              onClick={() => setCurrentSessionId(session.id)}
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
                >
                  <MessageSquare size={16} className="mr-2 flex-shrink-0" />
                  <span className="text-sm">{session.title}</span>
                </div>
              )}

              <div
                className="flex items-center space-x-0.5"
                // 操作区整体不冒泡：图标之间的缝隙点到也不该切会话
                onClick={(e) => e.stopPropagation()}
              >
                {/* 星标放到右侧操作区（和编辑/删除一起）。已收藏时常驻显示，
                    未收藏时 hover 才出现 —— 既不挡标题，也能一眼看出哪些收藏了。 */}
                <button
                  className={`p-1 rounded-md transition-colors ${
                    session.starred
                      ? 'text-amber-400 hover:text-amber-500'
                      : 'opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-neutral-500'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStarred(session.id);
                  }}
                  title={session.starred ? t('取消收藏') : t('收藏会话')}
                >
                  <Star size={14} fill={session.starred ? 'currentColor' : 'none'} />
                </button>

                <div className="flex space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {hasFolders && (
                    <button
                      className="text-neutral-500 hover:text-neutral-700 p-1 rounded-md hover:bg-neutral-100"
                      title={t('移动到文件夹')}
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMoveMenu({
                          sessionId: session.id,
                          top: Math.min(r.bottom + 4, window.innerHeight - 220),
                          left: Math.max(8, r.left - 150),
                        });
                      }}
                    >
                      <FolderInput size={14} />
                    </button>
                  )}
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
            </div>
          ))
        )}
      </div>

      {hasFolders && (
        <div className="px-4 pb-1 text-[11px] text-neutral-300 text-center">
          {t('拖动会话到文件夹即可归类')}
        </div>
      )}

      <div className="px-3 py-3 border-t border-neutral-100">
        <button
          className="w-full flex items-center justify-center space-x-2 py-2 px-4 bg-neutral-900 text-white rounded-md hover:bg-neutral-800 transition-colors"
          onClick={handleCreateSession}
        >
          <Plus size={16} />
          <span className="text-sm">{t('新建会话')}</span>
        </button>
      </div>

      <div className="px-3 py-3 border-t border-neutral-100 flex items-center justify-center space-x-2">
        <button
          className="flex items-center justify-center p-2 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 rounded-md transition-colors"
          onClick={() => onOpenSettings('models')}
          title={t('设置')}
        >
          <Settings size={18} />
        </button>
        <button
          className="flex items-center justify-center p-2 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-50 rounded-md transition-colors"
          onClick={toggleTheme}
          title={theme === 'dark' ? t('切换到日间模式') : t('切换到夜间模式')}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      {/* 移动到文件夹菜单 */}
      {moveMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMoveMenu(null)} />
          <div
            className="fixed z-50 w-44 bg-white border border-neutral-200 rounded-md shadow-lg py-1 text-sm"
            style={{ top: moveMenu.top, left: moveMenu.left }}
          >
            <div className="px-3 py-1 text-[11px] text-neutral-400">{t('移动到')}</div>
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 flex items-center justify-between"
              onClick={() => { moveSessionToFolder(moveMenu.sessionId, null); setMoveMenu(null); }}
            >
              <span>{t('未分类')}</span>
              {!sessions.find(s => s.id === moveMenu.sessionId)?.folderId && <Check size={13} className="text-neutral-400" />}
            </button>
            {folders.map(folder => {
              const current = sessions.find(s => s.id === moveMenu.sessionId)?.folderId === folder.id;
              return (
                <button
                  key={folder.id}
                  className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 flex items-center justify-between"
                  onClick={() => { moveSessionToFolder(moveMenu.sessionId, folder.id); setMoveMenu(null); }}
                >
                  <span className="truncate flex items-center gap-1.5">
                    <Folder size={12} className="text-neutral-400" />
                    {folder.name}
                  </span>
                  {current && <Check size={13} className="text-neutral-400" />}
                </button>
              );
            })}
            <div className="border-t border-neutral-100 my-1" />
            <button
              className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 flex items-center gap-1.5 text-neutral-500"
              onClick={() => { setMoveMenu(null); setIsCreatingFolder(true); }}
            >
              <FolderPlus size={12} />
              {t('新建文件夹…')}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default Sidebar;
