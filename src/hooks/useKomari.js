import { useState, useEffect, useRef, useMemo } from 'react';

const KOMARI_CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存
const useKomari = (auth) => {
    const [servers, setServers] = useState([]);
    const [komariEnabled, setKomariEnabled] = useState(false);
    const [loading, setLoading] = useState(false);
    const cacheRef = useRef({ ts: 0, servers: [], enabled: false });

    const fetchServers = async () => {
        // 仅托管模式下可用（需要后端环境变量）
        if (auth?.mode !== 'server') {
            setKomariEnabled(false);
            return;
        }
        // 缓存未过期则使用缓存
        if (Date.now() - cacheRef.current.ts < KOMARI_CACHE_TTL && cacheRef.current.ts > 0) {
            setServers(cacheRef.current.servers);
            setKomariEnabled(cacheRef.current.enabled);
            return;
        }
        setLoading(true);
        try {
            const headers = {};
            if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
            if (auth.currentAccountIndex !== undefined) {
                headers['X-Managed-Account-Index'] = String(auth.currentAccountIndex);
            }
            const res = await fetch('/api/komari/servers', { headers });
            const data = await res.json();
            if (data.enabled) {
                setServers(data.servers || []);
                setKomariEnabled(true);
                cacheRef.current = { ts: Date.now(), servers: data.servers || [], enabled: true };
            } else {
                setKomariEnabled(false);
                cacheRef.current = { ts: Date.now(), servers: [], enabled: false };
            }
        } catch {
            setKomariEnabled(false);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchServers();
    }, [auth?.mode, auth?.token, auth?.currentAccountIndex]);

    // 构建 IP -> 服务器名 映射
    const ipToNameMap = useMemo(() => {
        const map = new Map();
        for (const s of servers) {
            for (const ip of s.ipv4) {
                const arr = map.get(ip) || [];
                if (!arr.includes(s.name)) arr.push(s.name);
                map.set(ip, arr);
            }
            for (const ip of s.ipv6) {
                const arr = map.get(ip) || [];
                if (!arr.includes(s.name)) arr.push(s.name);
                map.set(ip, arr);
            }
        }
        return map;
    }, [servers]);

    // 获取下拉选项
    const getOptions = (type) => {
        return servers.flatMap(s => {
            const list = type === 'AAAA' ? s.ipv6 : s.ipv4;
            return list.map(ip => ({ value: ip, label: `${s.name} — ${ip}` }));
        });
    };

    return { servers, komariEnabled, loading, ipToNameMap, getOptions, refresh: fetchServers };
};

export default useKomari;
