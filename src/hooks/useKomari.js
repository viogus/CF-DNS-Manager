import useAgentServers from './useAgentServers.js';

const useKomari = (auth) => {
    const result = useAgentServers(auth, '/api/komari/servers', 'komari');
    return {
        servers: result.servers,
        komariEnabled: result.komariEnabled,
        loading: result.loading,
        ipToNameMap: result.ipToNameMap,
        getOptions: result.getOptions,
        refresh: result.refresh
    };
};

export default useKomari;
