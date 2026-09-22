import React, { useEffect, useRef, useState } from 'react';
import { X, Cpu, Database, Palette, Info } from 'lucide-react';
import { gsap } from 'gsap';
import ModelsPanel from './settings/ModelsPanel';
import DataPanel from './settings/DataPanel';
import AppearancePanel from './settings/AppearancePanel';
import AboutPanel from './settings/AboutPanel';
import { useT } from '../i18n';

export type SettingsTab = 'models' | 'data' | 'appearance' | 'about';

interface SettingsModalProps {
  initialTab?: SettingsTab;
  onClose: () => void;
}

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'models', label: '模型', icon: <Cpu size={16} /> },
  { id: 'data', label: '数据', icon: <Database size={16} /> },
  { id: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { id: 'about', label: '关于', icon: <Info size={16} /> },
];

const SettingsModal: React.FC<SettingsModalProps> = ({ initialTab = 'models', onClose }) => {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const modalRef = useRef<HTMLDivElement>(null);
  const t = useT();

  // onClose 每次父组件重渲染都是新函数。如果直接把它写进 effect 依赖，
  // 模型列表拖拽排序 → store 变化 → App 重渲染 → onClose 变新 → effect 重跑
  // → gsap 再次从 y:16/opacity:0 播放入场动画，整个弹窗就会“闪一下重绘”。
  // 用 ref 存最新值，动画只在挂载时跑一次。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = modalRef.current;
    if (el) {
      gsap.fromTo(
        el,
        { y: 16, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.25, ease: 'power2.out' }
      );
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="bg-white rounded-lg shadow-subtle max-w-5xl w-full h-[80vh] max-h-[720px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-5 py-4 border-b border-neutral-100 shrink-0">
          <h2 className="text-lg font-medium text-neutral-800">{t('设置')}</h2>
          <button
            className="text-neutral-500 hover:text-neutral-700 p-1 rounded-md hover:bg-neutral-50"
            onClick={onClose}
            title={t('关闭')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <nav className="w-44 shrink-0 border-r border-neutral-100 p-3 space-y-1">
            {TABS.map(item => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`w-full flex items-center space-x-2 px-3 py-2 rounded-md text-sm transition-colors ${
                    active
                      ? 'bg-neutral-100 text-neutral-900 font-medium'
                      : 'text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {item.icon}
                  <span>{t(item.label)}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 min-w-0">
            {tab === 'models' && <ModelsPanel />}
            {tab === 'data' && <DataPanel />}
            {tab === 'appearance' && <AppearancePanel />}
            {tab === 'about' && <AboutPanel />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
