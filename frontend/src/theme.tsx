import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeName = 'clarity' | 'large' | 'night' | 'console';
export type Language = 'en' | 'te' | 'hi';

const ThemeContext = createContext<{
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  language: Language;
  setLanguage: (language: Language) => void;
} | null>(null);

function isTheme(value: string | null): value is ThemeName {
  return value === 'clarity' || value === 'large' || value === 'night' || value === 'console';
}

function isLanguage(value: string | null): value is Language {
  return value === 'en' || value === 'te' || value === 'hi';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('lab-theme');
    return isTheme(saved) ? saved : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'clarity';
  });
  const [language, updateLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('lab-language');
    return isLanguage(saved) ? saved : 'en';
  });

  const setTheme = useCallback((next: ThemeName) => {
    updateTheme(next);
    localStorage.setItem('lab-theme', next);
  }, []);
  const setLanguage = useCallback((next: Language) => {
    updateLanguage(next);
    localStorage.setItem('lab-language', next);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language === 'te' ? 'te-IN' : language === 'hi' ? 'hi-IN' : 'en-IN';
    const font = language === 'te' ? 'noto-sans-telugu' : language === 'hi' ? 'noto-sans-devanagari' : 'noto-sans-latin';
    let preload = document.querySelector<HTMLLinkElement>('link[data-language-font]');
    if (!preload) {
      preload = document.createElement('link');
      preload.rel = 'preload';
      preload.as = 'font';
      preload.type = 'font/woff2';
      preload.crossOrigin = 'anonymous';
      preload.dataset.languageFont = 'true';
      document.head.appendChild(preload);
    }
    preload.href = `/fonts/${font}.woff2`;
  }, [theme, language]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      document.documentElement.dataset.motion = preference.matches ? 'reduce' : 'full';
    };
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  const value = useMemo(() => ({ theme, setTheme, language, setLanguage }), [theme, setTheme, language, setLanguage]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}
