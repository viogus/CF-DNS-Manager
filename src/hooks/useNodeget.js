import useAgentServers from './useAgentServers.js';

const useNodeget = (auth) => {
    const result = useAgentServers(auth, '/api/nodeget/servers', 'nodeget');
    return {
        servers: result.servers,
        nodegetEnabled: result.nodegetEnabled,
        loading: result.loading,
        ipToNameMap: result.ipToNameMap,
        getOptions: result.getOptions,
        refresh: result.refresh
    };
};

export default useNodeget;
