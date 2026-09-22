import React from 'react';
import { Sun, Moon, Check } from 'lucide-react';
import { useThemeStore, Theme } from '../../stores/themeStore';
import { useLangStore, useT, Lang } from '../../i18n';

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

// 语言名用各自的母语写（中文 / English），不参与翻译 —— 否则英文界面里
// 出现 "Chinese" 反而不好找。
const LANG_OPTIONS: { value: Lang; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
];

const AppearancePanel: React.FC = () => {
  const { theme, setTheme } = useThemeStore();
  const { lang, setLang } = useLangStore();
  const t = useT();

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <section>
        <h3 className="text-sm font-medium text-neutral-800 mb-1">{t('主题')}</h3>
        <p className="text-xs text-neutral-500 mb-4">
          {t('选择界面配色。这个偏好保存在本地，下次打开仍然生效。')}
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
                <span className="text-sm font-medium text-neutral-800">{t(option.label)}</span>
                <span className="mt-0.5 text-xs text-neutral-500">{t(option.description)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-neutral-800 mb-1">{t('语言')}</h3>
        <p className="text-xs text-neutral-500 mb-4">
          {t('选择界面语言。这个偏好保存在本地，下次打开仍然生效。')}
        </p>
        <div className="grid grid-cols-2 gap-4">
          {LANG_OPTIONS.map(option => {
            const active = lang === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setLang(option.value)}
                className={`relative flex items-center justify-between p-4 rounded-lg border text-left transition-colors ${
                  active
                    ? 'border-neutral-800 bg-neutral-50'
                    : 'border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                <span className="text-sm font-medium text-neutral-800">{option.label}</span>
                {active && (
                  <span className="text-neutral-800">
                    <Check size={16} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default AppearancePanel;
