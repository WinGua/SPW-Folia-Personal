/* The zh-CN bundle is Folia's own locale data, so every kit label we reuse reads exactly like the
 * desktop app. Only the settings window is translated here; the bundle is static. */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '../../../work/folia/folia-major-main/src/i18n/locales/zh-CN';

void i18n.use(initReactI18next).init({
    resources: { 'zh-CN': { translation: zhCN } },
    lng: 'zh-CN',
    fallbackLng: 'zh-CN',
    interpolation: { escapeValue: false },
    returnNull: false,
    initImmediate: false,
});

export default i18n;
