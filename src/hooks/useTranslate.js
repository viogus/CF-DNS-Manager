import { useState } from 'react';
import translations from '../i18n.js';

export default function useTranslate() {
    const [lang, setLang] = useState(localStorage.getItem('lang') || 'zh');

    const t = (key) => translations[lang][key] || key;

    const changeLang = (l) => {
        setLang(l);
        localStorage.setItem('lang', l);
    };

    const toggleLang = () => {
        const nextLang = lang === 'zh' ? 'en' : 'zh';
        changeLang(nextLang);
    };

    return { t, lang, changeLang, toggleLang };
}
