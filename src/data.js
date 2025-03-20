/**
 * data.js
 *
 * This file validates and transforms the graph data.
 * The validateGraphData function checks that, for each edge,
 * the source and target IP addresses belong to the expected subnet.
 */

export function validateGraphData(data) {
    const nodeMap = new Map(data.nodes.map(node => [node.data.id, node.data]));
    const ipMap = new Map();

    data.nodes.forEach(node => {
        if (node.data.interfaces) {
            Object.entries(node.data.interfaces).forEach(([intfName, ip]) => {
                const ipAddress = ip.split('/')[0];
                if (ipMap.has(ipAddress)) {
                    console.warn(`Dirección IP duplicada: ${ipAddress} en nodo ${node.data.id} (ya usada por ${ipMap.get(ipAddress)})`);
                } else {
                    ipMap.set(ipAddress, node.data.id);
                }
            });
        }
    });

    data.edges.forEach(edge => {
        const { weight, source, target, sourceInterface, targetInterface } = edge.data;
        if (!weight || !sourceInterface || !targetInterface) return;

        const [expectedNetwork, prefixStr] = weight.split('/');
        const prefix = parseInt(prefixStr, 10);
        if (!expectedNetwork || isNaN(prefix)) return;

        const sourceNode = nodeMap.get(source);
        const targetNode = nodeMap.get(target);
        if (!sourceNode?.interfaces || !targetNode?.interfaces) return;

        const sourceIP = sourceNode.interfaces[sourceInterface]?.split('/')[0];
        const targetIP = targetNode.interfaces[targetInterface]?.split('/')[0];
        if (!sourceIP || !targetIP) {
            console.warn(`Interfaz ${sourceInterface} no encontrada en ${source} o ${targetInterface} no encontrada en ${target}`);
            return;
        }

        const calculatedSrcNetwork = getNetworkAddress(sourceIP, prefix);
        const calculatedDstNetwork = getNetworkAddress(targetIP, prefix);

        if (calculatedSrcNetwork !== expectedNetwork || calculatedDstNetwork !== expectedNetwork) {
            console.warn(
                `IPs no están en la subred especificada para el enlace ${source} -> ${target}. ` +
                `Subred esperada: ${expectedNetwork}/${prefix}, IP fuente: ${sourceIP} (red: ${calculatedSrcNetwork}), ` +
                `IP destino: ${targetIP} (red: ${calculatedDstNetwork})`
            );
        }
    });
}

function ipToInt(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
}

function getNetmask(prefix) {
    return prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
}

function getNetworkAddress(ip, prefix) {
    const ipInt = ipToInt(ip);
    const mask = getNetmask(prefix);
    const networkInt = ipInt & mask;
    return [
        (networkInt >>> 24) & 0xFF,
        (networkInt >>> 16) & 0xFF,
        (networkInt >>> 8) & 0xFF,
        networkInt & 0xFF
    ].join('.');
}

export function generateInterfaceNodes(nodes) {
    const interfaceNodes = [];
    nodes.forEach(node => {
        if (node.data.interfaces) {
            Object.entries(node.data.interfaces).forEach(([intfName, ip]) => {
                const interfaceId = `${node.data.id}-${intfName}`;
                interfaceNodes.push({
                    data: {
                        id: interfaceId,
                        label: intfName,
                        router: node.data.id,
                        ip: ip,
                        type: 'interface'
                    }
                });
            });
        }
    });
    return interfaceNodes;
}

export function transformEdges(edges, interfaceNodes) {
    const intfMap = new Map();
    interfaceNodes.forEach(node => {
        const key = `${node.data.router}-${node.data.label}`;
        intfMap.set(key, node.data.id);
    });

    return edges.map(edge => {
        const { source, target, sourceInterface, targetInterface } = edge.data;
        const sourceIntfId = intfMap.get(`${source}-${sourceInterface}`);
        const targetIntfId = intfMap.get(`${target}-${targetInterface}`);
        
        if (!sourceIntfId || !targetIntfId) {
            console.warn(`No se encontró interfaz para el enlace ${source} (${sourceInterface}) -> ${target} (${targetInterface})`);
            return { data: { ...edge.data, source, target } };
        }

        return {
            data: {
                ...edge.data,
                source: sourceIntfId,
                target: targetIntfId
            }
        };
    }).filter(edge => edge.data.source !== edge.data.target);
}

export function addHierarchicalEdges(nodes, edges) {
    const hierarchicalEdges = [];
    nodes.forEach(node => {
        // No generar aristas jerárquicas para evitar superposiciones
        // if (node.data.parent && !node.data.type) {
        //     hierarchicalEdges.push({
        //         data: { source: node.data.parent, target: node.data.id, type: 'hierarchical' }
        //     });
        // }
        // Generar aristas de conexión router-interfaz
        if (node.data.type === 'interface') {
            hierarchicalEdges.push({
                data: { source: node.data.router, target: node.data.id, type: 'router-connection' }
            });
        }
    });
    return [...edges, ...hierarchicalEdges];
}

export function loadData(nodes, edges, container) {
    return nodes.map(node => ({
        ...node,
        position: node.position || { x: Math.random() * 800, y: Math.random() * 600 }
    }));
}