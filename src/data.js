/**
 * @fileoverview Data validation and transformation for the BGP graph visualization.
 * Handles data preparation before rendering in Cytoscape.
 */

import { log, getNetworkAddress, ipToInt, showNotification } from './utils.js';

// Definimos getNetmask localmente para evitar problemas con las importaciones
const getNetmask = (prefix) => {
    return prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
};

/**
 * Validates the graph data for consistency and correctness.
 * Checks for duplicate IPs and subnet consistency.
 * 
 * @param {Object} data - The graph data containing nodes and edges
 * @param {Array} data.nodes - Array of node objects
 * @param {Array} data.edges - Array of edge objects
 */
export function validateGraphData(data) {
    const nodeMap = new Map();
    const ipMap = new Map();
    
    // Process nodes and build maps in a single pass
    data.nodes.forEach(node => {
        nodeMap.set(node.data.id, node.data);
        
        if (node.data.interfaces) {
            Object.entries(node.data.interfaces).forEach(([intfName, ip]) => {
                const ipAddress = ip.split('/')[0];
                if (ipMap.has(ipAddress)) {
                    const errorMsg = `Dirección IP duplicada: ${ipAddress} en nodo ${node.data.id} (ya usada por ${ipMap.get(ipAddress)})`;
                    log(errorMsg);
                    showNotification(errorMsg, "error");
                } else {
                    ipMap.set(ipAddress, node.data.id);
                }
            });
        }
    });

    // Validate edge subnets
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
            const errorMsg = `Interfaz ${sourceInterface} no encontrada en ${source} o ${targetInterface} no encontrada en ${target}`;
            log(errorMsg);
            showNotification(errorMsg, "error");
            return;
        }

        const calculatedSrcNetwork = getNetworkAddress(sourceIP, prefix);
        const calculatedDstNetwork = getNetworkAddress(targetIP, prefix);

        if (calculatedSrcNetwork !== expectedNetwork || calculatedDstNetwork !== expectedNetwork) {
            const errorMsg = `IPs no están en la subred especificada para el enlace ${source} -> ${target}. ` +
                `Subred esperada: ${expectedNetwork}/${prefix}, IP fuente: ${sourceIP} (red: ${calculatedSrcNetwork}), ` +
                `IP destino: ${targetIP} (red: ${calculatedDstNetwork})`;
            log(errorMsg);
            showNotification(errorMsg, "error");
        }
    });
}

/**
 * Generates interface nodes from router nodes with interfaces.
 * 
 * @param {Array} nodes - Array of node objects
 * @returns {Array} Array of generated interface node objects
 */
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

/**
 * Transforms edges to connect interface nodes instead of router nodes.
 * 
 * @param {Array} edges - Array of edge objects
 * @param {Array} interfaceNodes - Array of interface node objects
 * @returns {Array} Transformed edges connecting interfaces
 */
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
            const errorMsg = `No se encontró interfaz para el enlace ${source} (${sourceInterface}) -> ${target} (${targetInterface})`;
            log(errorMsg);
            showNotification(errorMsg, "error");
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

/**
 * Adds hierarchical edges to connect parent-child nodes.
 * 
 * @param {Array} nodes - Array of node objects
 * @param {Array} edges - Array of edge objects
 * @returns {Array} All edges including hierarchical connections
 */
export function addHierarchicalEdges(nodes, edges) {
    const hierarchicalEdges = [];
    
    nodes.forEach(node => {
        // Generate router-to-interface connections
        if (node.data.type === 'interface') {
            hierarchicalEdges.push({
                data: { 
                    source: node.data.router, 
                    target: node.data.id, 
                    type: 'router-connection' 
                }
            });
        }
    });
    
    return [...edges, ...hierarchicalEdges];
}

/**
 * Prepares nodes with positions for visualization.
 * 
 * @param {Array} nodes - Array of node objects
 * @param {Array} edges - Array of edge objects (unused but kept for API consistency)
 * @param {HTMLElement} container - The container element for the graph
 * @returns {Array} Nodes with positions
 */
export function loadData(nodes, edges, container) {
    return nodes.map(node => ({
        ...node,
        position: node.position || { 
            x: Math.random() * (container.offsetWidth || 800), 
            y: Math.random() * (container.offsetHeight || 600) 
        }
    }));
}