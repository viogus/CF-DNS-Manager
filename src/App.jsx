import React, { useState, useEffect, useRef } from 'react';
import { Zap, Server, User, LogOut, Languages, CheckCircle, AlertCircle, X, RefreshCw } from 'lucide-react';
import useTranslate from './hooks/useTranslate.js';
import { getAuthHeaders } from './utils.js';
import Login from './components/Login.jsx';
import ZoneDetail from './components/ZoneDetail.jsx';
import DnspodManager from './components/DnspodManager.jsx';

const App = () => {
    const { t, lang, changeLang, toggleLang } = useTranslate();
    const [auth, setAuth] = useState(null);
    const [showAccountSelector, setShowAccountSelector] = useState(false);
    const accountSelectorRef = useRef(null);
    const [zones, setZones] = useState([]);
    const [selectedZone, setSelectedZone] = useState(null);
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState(null);
    const toastTimer = useRef(null);
    const [currentPage, setCurrentPage] = useState('cloudflare'); // 'cloudflare' | 'dnspod'
    const [zoneTab, setZoneTab] = useState('dns'); // 'dns' | 'saas'

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (accountSelectorRef.current && !accountSelectorRef.current.contains(event.target)) {
                setShowAccountSelector(false);
            }
        };

        const handleScroll = () => {
            if (showAccountSelector) setShowAccountSelector(false);
        };

        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', handleScroll, { capture: true });

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScroll, { capture: true });
        };
    }, [showAccountSelector]);

    const showToast = (message, type = 'success') => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ message, type, id: Date.now() });
        toastTimer.current = setTimeout(() => setToast(null), 3000);
    };

    const handleLogout = () => {
        setAuth(null);
        setZones([]);
        setSelectedZone(null);
        localStorage.removeItem('auth_session');
        sessionStorage.removeItem('auth_session');
    };

    const fetchZones = async (credentials) => {
        setLoading(true);
        const headers = getAuthHeaders(credentials);

        try {
            const res = await fetch('/api/zones', { headers });
            if (res.status === 401 || res.status === 403) {
                handleLogout();
                return;
            }
            const data = await res.json();
            if (res.ok && data.success) {
                const sortedZones = (data.result || []).sort((a, b) =>
                    new Date(b.modified_on) - new Date(a.modified_on)
                );
                setZones(sortedZones);

                if (sortedZones.length > 0) {
                    if (selectedZone) {
                        const stillExists = sortedZones.find(z => z.id === selectedZone.id);
                        if (stillExists) {
                            setSelectedZone(stillExists);
                        } else {
                            setSelectedZone(sortedZones[0]);
                        }
                    } else {
                        setSelectedZone(sortedZones[0]);
                    }
                } else {
                    setSelectedZone(null);
                }
            } else if (data.errors && data.errors.length > 0) {
                const msg = data.errors[0].message || t('fetchZonesFailed');
                showToast(msg, 'error');
            } else if (!res.ok) {
                showToast(`${t('fetchZonesFailed')} (${res.status})`, 'error');
            }
        } catch (err) { }
        setLoading(false);
    };



    useEffect(() => {
        const saved = localStorage.getItem('auth_session') || sessionStorage.getItem('auth_session');
        if (saved) {
            try {
                const credentials = JSON.parse(saved);
                setAuth(credentials);
                fetchZones(credentials);
            } catch (e) {
                localStorage.removeItem('auth_session');
                sessionStorage.removeItem('auth_session');
            }
        }
    }, []);

    const handleLogin = (credentials) => {
        setAuth(credentials);
        if (credentials.remember) {
            localStorage.setItem('auth_session', JSON.stringify(credentials));
        } else {
            // Always use sessionStorage to at least survive refresh within the session
            sessionStorage.setItem('auth_session', JSON.stringify(credentials));
        }
        fetchZones(credentials);
    };

    if (!auth) {
        return <Login onLogin={handleLogin} t={t} lang={lang} onLangChange={changeLang} />;
    }

    return (
        <div className="fade-in">
            {toast && (
                <div key={toast.id} style={{
                    position: 'fixed',
                    top: '24px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 9999,
                    background: toast.type === 'success' ? '#fff' : '#fff5f5',
                    color: toast.type === 'success' ? '#1a202c' : '#c53030',
                    padding: '10px 16px',
                    borderRadius: '12px',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    border: toast.type === 'success' ? '1px solid #e2e8f0' : '1px solid #feb2b2',
                    animation: 'fadeDown 0.3s ease-out'
                }}>
                    <style>{`
                        @keyframes fadeDown {
                            from { opacity: 0; transform: translate(-50%, -20px); }
                            to { opacity: 1; transform: translate(-50%, 0); }
                        }
                    `}</style>
                    {toast.type === 'success' ? <CheckCircle size={18} color="var(--success)" /> : <AlertCircle size={18} color="var(--error)" />}
                    <span style={{ fontSize: '0.875rem', fontWeight: '600', whiteSpace: 'nowrap' }}>{toast.message}</span>
                    <button onClick={() => setToast(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px', display: 'flex', marginLeft: '4px' }}>
                        <X size={14} color="var(--text-muted)" />
                    </button>
                </div>
            )}
            <header>
                <div className="logo" onClick={() => window.location.reload()} style={{ cursor: 'pointer' }}>
                    <Zap size={22} color="var(--primary)" />
                    DNS <span>Manager</span>
                </div>

                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button
                        onClick={toggleLang}
                        style={{ border: 'none', background: 'transparent', padding: '8px', cursor: 'pointer', display: 'flex', color: 'var(--text-muted)', borderRadius: '8px', transition: 'all 0.2s' }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(0,0,0,0.05)';
                            e.currentTarget.style.color = 'var(--primary)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--text-muted)';
                        }}
                        title={lang === 'zh' ? 'English' : '中文'}
                    >
                        <Languages size={18} />
                    </button>

                    <div style={{ height: '16px', width: '1px', background: 'var(--border)' }}></div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: '500' }}>
                        <Server size={14} />
                        {auth.mode === 'server' ? t('managed') : t('clientOnly')}
                    </div>

                    {auth.mode === 'server' && (
                        <>
                            <div style={{ height: '16px', width: '1px', background: 'var(--border)' }}></div>
                            <button
                                className={`btn ${currentPage === 'dnspod' ? 'btn-primary' : 'btn-outline'}`}
                                style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                                onClick={() => setCurrentPage(currentPage === 'dnspod' ? 'cloudflare' : 'dnspod')}
                            >
                                {currentPage === 'dnspod' ? 'Cloudflare' : 'DNSPod'}
                            </button>
                        </>
                    )}

                    <div style={{ height: '16px', width: '1px', background: 'var(--border)' }}></div>


                    <div style={{ position: 'relative' }} ref={accountSelectorRef}>
                        <button
                            onClick={() => setShowAccountSelector(!showAccountSelector)}
                            style={{ border: 'none', background: 'transparent', padding: '8px', cursor: 'pointer', display: 'flex', color: 'var(--text-muted)', borderRadius: '8px', transition: 'background 0.2s' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            title={t('switchAccount')}
                        >
                            <User size={20} />
                        </button>
                        {showAccountSelector && (
                            <div className="glass-card fade-in" style={{
                                position: 'absolute',
                                top: '120%',
                                right: 0,
                                width: '200px',
                                padding: '0.25rem',
                                zIndex: 100,
                                maxHeight: '300px',
                                overflowY: 'auto'
                            }}>
                                {auth.mode === 'server' && auth.accounts && auth.accounts.length > 1 && (
                                    <>
                                        {auth.accounts.map(acc => (
                                            <div
                                                key={acc.id}
                                                onClick={() => {
                                                    const newAuth = { ...auth, currentAccountIndex: acc.id };
                                                    setAuth(newAuth);
                                                    setSelectedZone(null);
                                                    setZones([]);
                                                    if (newAuth.remember) {
                                                        localStorage.setItem('auth_session', JSON.stringify(newAuth));
                                                    } else {
                                                        sessionStorage.setItem('auth_session', JSON.stringify(newAuth));
                                                    }
                                                    setShowAccountSelector(false);
                                                    fetchZones(newAuth);
                                                }}
                                                style={{
                                                    padding: '0.5rem 0.75rem',
                                                    cursor: 'pointer',
                                                    borderRadius: '6px',
                                                    fontSize: '0.875rem',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    color: (auth.currentAccountIndex || 0) === acc.id ? 'var(--primary)' : 'var(--text-main)',
                                                    background: (auth.currentAccountIndex || 0) === acc.id ? '#fff7ed' : 'transparent',
                                                    fontWeight: (auth.currentAccountIndex || 0) === acc.id ? 600 : 400
                                                }}
                                                onMouseEnter={e => { if ((auth.currentAccountIndex || 0) !== acc.id) e.currentTarget.style.background = '#f9fafb'; }}
                                                onMouseLeave={e => { if ((auth.currentAccountIndex || 0) !== acc.id) e.currentTarget.style.background = 'transparent'; }}
                                            >
                                                <User size={14} />
                                                {acc.name === 'Default Account' ? (lang === 'zh' ? '默认账户' : 'Default Account') : ((lang === 'zh' ? '账户 ' : 'Account ') + acc.id)}
                                                {(auth.currentAccountIndex || 0) === acc.id && <CheckCircle size={14} style={{ marginLeft: 'auto' }} />}
                                            </div>
                                        ))}
                                        <div style={{ height: '1px', background: 'var(--border)', margin: '0.25rem 0' }}></div>
                                    </>
                                )}

                                <div
                                    onClick={handleLogout}
                                    style={{
                                        padding: '0.5rem 0.75rem',
                                        cursor: 'pointer',
                                        borderRadius: '6px',
                                        fontSize: '0.875rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        color: 'var(--error)',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    <LogOut size={14} />
                                    {t('logout')}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </header>

            <main style={{ paddingBottom: '3rem' }}>
                {currentPage === 'dnspod' ? (
                    <DnspodManager
                        auth={auth}
                        onBack={() => setCurrentPage('cloudflare')}
                        t={t}
                        showToast={showToast}
                    />
                ) : selectedZone ? (
                    <ZoneDetail
                        zone={selectedZone}
                        zones={zones}
                        onSwitchZone={setSelectedZone}
                        onRefreshZones={() => fetchZones(auth)}
                        zonesLoading={loading}
                        auth={auth}
                        onBack={() => { }}
                        t={t}
                        showToast={showToast}
                        tab={zoneTab}
                        setTab={setZoneTab}
                    />
                ) : (
                    <div className="container" style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--text-muted)' }}>
                        {loading ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                <RefreshCw className="spin" size={32} style={{ color: 'var(--primary)' }} />
                                <p>{t('statusInitializing')}</p>
                            </div>
                        ) : (
                            <p>{t('noZonesFound') || 'No domains found.'}</p>
                        )}
                    </div>
                )}
            </main>
        </div >
    );
};

export default App;
