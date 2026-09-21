import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'treeai-theme';

function readStoredTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    // 隐私模式下 localStorage 可能不可用
    return null;
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
  );
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  // 让原生控件（滚动条、输入框）也跟着切换
  document.documentElement.style.colorScheme = theme;
}

const initialTheme: Theme = readStoredTheme() ?? (systemPrefersDark() ? 'dark' : 'light');

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,

  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // 写不进去也无所谓，当前会话仍然生效
    }
    applyTheme(theme);
    set({ theme });
  },

  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

// 在 React 首次渲染之前就应用，避免首屏先闪一下白色
applyTheme(initialTheme);
