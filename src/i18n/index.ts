import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';

export type AppLang = 'zh' | 'en';

const STORAGE_KEY = 'tw-lang';

function detectLanguage(): AppLang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* localStorage 不可用时退回浏览器语言 */
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || '';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: detectLanguage(),
    fallbackLng: 'zh',
    interpolation: { escapeValue: false },
    returnNull: false,
  });

export function changeAppLanguage(lng: AppLang) {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* 持久化失败不影响本次切换 */
  }
  void i18n.changeLanguage(lng);
}

export default i18n;
