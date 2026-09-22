import React from 'react';
import { Sun, Moon, Check } from 'lucide-react';
import { useThemeStore, Theme } from '../../stores/themeStore';

const OPTIONS: { value: Theme; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'light',
    label: '浅色',
    description: '明亮的白色界面',
    icon: <Sun size={20} />,
  },
  {
    value: 'dark',
    label: '深色',
    description: '夜间护眼的暗色界面',
    icon: <Moon size={20} />,
  },
];

const AppearancePanel: React.FC = () => {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <section>
        <h3 className="text-sm font-medium text-neutral-800 mb-1">主题</h3>
        <p className="text-xs text-neutral-500 mb-4">
          选择界面配色。这个偏好保存在本地，下次打开仍然生效。
        </p>
        <div className="grid grid-cols-2 gap-4">
          {OPTIONS.map(option => {
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                className={`relative flex flex-col items-start p-4 rounded-lg border text-left transition-colors ${
                  active
                    ? 'border-neutral-800 bg-neutral-50'
                    : 'border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                {active && (
                  <span className="absolute top-3 right-3 text-neutral-800">
                    <Check size={16} />
                  </span>
                )}
                <span className="mb-2 text-neutral-700">{option.icon}</span>
                <span className="text-sm font-medium text-neutral-800">{option.label}</span>
                <span className="mt-0.5 text-xs text-neutral-500">{option.description}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default AppearancePanel;
