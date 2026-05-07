import { useState, useEffect, useRef, useMemo } from 'react';

const NODEGET_CACHE_TTL = 10 * 60 * 1000;

const useNodeget = (auth) => {
    const [servers, setServers] = useState([]);
    const [nodegetEnabled, setNodegetEnabled] = useState(false);
    const [loading, setLoading] = useState(false);
    const cacheRef = useRef({ ts: 0, servers: [], enabled: false });

    const fetchServers = async () => {
        if (auth?.mode !== 'server') {
            setNodegetEnabled(false);
            return;
        }
        if (Date.now() - cacheRef.current.ts < NODEGET_CACHE_TTL && cacheRef.current.ts > 0) {
            setServers(cacheRef.current.servers);
            setNodegetEnabled(cacheRef.current.enabled);
            return;
        }
        setLoading(true);
        try {
            const headers = {};
            if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
            if (auth.currentAccountIndex !== undefined) {
                headers['X-Managed-Account-Index'] = String(auth.currentAccountIndex);
            }
            const res = await fetch('/api/nodeget/servers', { headers });
            const data = await res.json();
            if (data.enabled) {
                setServers(data.servers || []);
                setNodegetEnabled(true);
                cacheRef.current = { ts: Date.now(), servers: data.servers || [], enabled: true };
            } else {
                setNodegetEnabled(false);
                cacheRef.current = { ts: Date.now(), servers: [], enabled: false };
            }
        } catch {
            setNodegetEnabled(false);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchServers();
    }, [auth?.mode, auth?.token, auth?.currentAccountIndex]);

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

    const getOptions = (type) => {
        return servers.flatMap(s => {
            const list = type === 'AAAA' ? s.ipv6 : s.ipv4;
            return list.map(ip => ({ value: ip, label: `${s.name} — ${ip}` }));
        });
    };

    return { servers, nodegetEnabled, loading, ipToNameMap, getOptions, refresh: fetchServers };
};

export default useNodeget;
