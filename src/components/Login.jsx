import { useState } from 'react';
import { Key, Shield, Zap, Languages, RefreshCw } from 'lucide-react';

const Login = ({ onLogin, t, lang, onLangChange }) => {
    const [password, setPassword] = useState('');
    const [token, setToken] = useState('');
    const [isServerMode, setIsServerMode] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [remember, setRemember] = useState(false);

    // 辅助函数：生成 SHA-256 哈希
    const hashPassword = async (pwd) => {
        const msgUint8 = new TextEncoder().encode(pwd);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const handleLogin = async (e) => {
        e.preventDefault();

        // Security Check: Block HTTP except for localhost
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (window.location.protocol === 'http:' && !isLocalhost) {
            setError(t('httpWarning'));
            setLoading(false);
            return;
        }

        setLoading(true);
        setError('');

        try {
            if (isServerMode) {
                const hashedPassword = await hashPassword(password);
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: hashedPassword })
                });
                const data = await res.json();
                if (res.ok) {
                    onLogin({
                        mode: 'server',
                        token: data.token,
                        remember,
                        accounts: data.accounts || [],
                        currentAccountIndex: 0
                    });
                } else {
                    let errMsg = data.error || t('loginFailed');
                    if (errMsg.includes('Invalid password')) errMsg = t('invalidPassword');
                    if (errMsg.includes('Server is not configured')) errMsg = t('serverNotConfigured');
                    setError(errMsg);
                }
            } else {
                const res = await fetch('/api/verify-token', {
                    headers: { 'X-Cloudflare-Token': token }
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    onLogin({ mode: 'client', token: token, remember });
                } else {
                    let errMsg = data.message || t('loginFailed');
                    if (errMsg === 'Invalid token') errMsg = t('invalidToken');
                    if (errMsg === 'No token provided') errMsg = t('tokenRequired');
                    if (errMsg === 'Failed to verify token') errMsg = t('verifyFailed');
                    setError(errMsg);
                }
            }
        } catch (err) {
            setError(t('errorOccurred'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '1rem' }}>
            <div className="glass-card login-card fade-in">
                <div style={{ position: 'absolute', top: '1rem', right: '1rem', zIndex: 10 }}>
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            onLangChange(lang === 'zh' ? 'en' : 'zh');
                        }}
                        style={{ border: 'none', background: 'transparent', padding: '8px', cursor: 'pointer', display: 'flex', color: 'var(--text-muted)', borderRadius: '8px', transition: 'background 0.2s' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        title={lang === 'zh' ? 'English' : '中文'}
                    >
                        <Languages size={20} />
                    </button>
                </div>

                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <div style={{ display: 'inline-flex', padding: '0.75rem', background: 'rgba(243, 128, 32, 0.1)', borderRadius: '12px', marginBottom: '1rem' }}>
                        <Zap size={32} color="var(--primary)" />
                    </div>
                    <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>{t('title')}</h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{t('subtitle')}</p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', padding: '4px', background: '#f3f4f6', borderRadius: '8px' }}>
                    <button
                        className={`btn ${isServerMode ? 'btn-primary' : 'btn-outline'}`}
                        style={{ flex: 1, padding: '0.4rem', border: 'none' }}
                        onClick={() => setIsServerMode(true)}
                    >
                        {t('serverMode')}
                    </button>
                    <button
                        className={`btn ${!isServerMode ? 'btn-primary' : 'btn-outline'}`}
                        style={{ flex: 1, padding: '0.4rem', border: 'none' }}
                        onClick={() => setIsServerMode(false)}
                    >
                        {t('clientMode')}
                    </button>
                </div>

                <form onSubmit={handleLogin}>
                    {isServerMode ? (
                        <div className="input-group">
                            <label>{t('passwordLabel')}</label>
                            <div style={{ position: 'relative' }}>
                                <Key size={16} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
                                <input
                                    type="password"
                                    placeholder={t('passwordPlaceholder')}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    style={{ paddingLeft: '38px' }}
                                    required
                                />
                            </div>
                            <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                                {t('serverHint')}
                            </p>
                        </div>
                    ) : (
                        <div className="input-group">
                            <label>{t('tokenLabel')}</label>
                            <div style={{ position: 'relative' }}>
                                <Shield size={16} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
                                <input
                                    type="password"
                                    placeholder={t('tokenPlaceholder')}
                                    value={token}
                                    onChange={(e) => setToken(e.target.value)}
                                    style={{ paddingLeft: '38px' }}
                                    required
                                />
                            </div>
                            <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                                {t('tokenHint')}
                            </p>
                        </div>
                    )}

                    {error && <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginBottom: '1rem', textAlign: 'center' }}>{error}</p>}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem' }}>
                        <input
                            type="checkbox"
                            id="remember"
                            checked={remember}
                            onChange={(e) => setRemember(e.target.checked)}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                        <label htmlFor="remember" style={{ fontSize: '0.875rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                            {isServerMode ? t('rememberMe') : t('rememberToken')}
                        </label>
                    </div>

                    <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                        {loading ? <RefreshCw className="spin" size={18} /> : t('loginBtn')}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;
