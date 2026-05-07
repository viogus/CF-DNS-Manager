import { useState, useEffect, useRef, useMemo } from 'react';

const CACHE_TTL = 10 * 60 * 1000;

function useAgentServers(auth, endpoint, name) {
    const [servers, setServers] = useState([]);
    const [enabled, setEnabled] = useState(false);
    const [loading, setLoading] = useState(false);
    const cacheRef = useRef({ ts: 0, servers: [], enabled: false, account: undefined });

    const fetchServers = async () => {
        if (auth?.mode !== 'server') {
            setEnabled(false);
            return;
        }
        var account = auth?.currentAccountIndex;
        if (Date.now() - cacheRef.current.ts < CACHE_TTL && cacheRef.current.ts > 0
            && cacheRef.current.account === account) {
            setServers(cacheRef.current.servers);
            setEnabled(cacheRef.current.enabled);
            return;
        }
        setLoading(true);
        try {
            const headers = {};
            if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
            if (auth.currentAccountIndex !== undefined) {
                headers['X-Managed-Account-Index'] = String(auth.currentAccountIndex);
            }
            const res = await fetch(endpoint, { headers });
            const data = await res.json();
            if (data.enabled) {
                setServers(data.servers || []);
                setEnabled(true);
                cacheRef.current = { ts: Date.now(), servers: data.servers || [], enabled: true, account: account };
            } else {
                setEnabled(false);
                cacheRef.current = { ts: Date.now(), servers: [], enabled: false, account: account };
            }
        } catch {
            setEnabled(false);
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

    return { servers, [`${name}Enabled`]: enabled, loading, ipToNameMap, getOptions, refresh: fetchServers };
}

export default useAgentServers;
