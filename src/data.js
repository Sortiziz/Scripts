import { log, getRandomPosition, isLocalStorageAvailable, is_valid_ip, is_valid_subnet } from './utils.js';

// Mapeo global para rastrear la relación entre nodos de interfaz y sus routers
let interfaceNodeToRouter = {};

/**
 * Valida la estructura de datos de bgp_graph.json.
 * @param {Object} data - Datos del grafo.
 * @throws {Error} Si los datos son inválidos.
 */
export const validateGraphData = (data) => {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
        throw new Error("Formato de bgp_graph.json inválido");
    }
    const nodeIds = new Set();
    data.nodes.forEach(node => {
        if (!node.data.id) throw new Error("Nodo sin ID");
        if (nodeIds.has(node.data.id)) throw new Error(`ID duplicado: ${node.data.id}`);
        nodeIds.add(node.data.id);
        if (node.data.interfaces) {
            Object.values(node.data.interfaces).forEach(ip_str => {
                if (ip_str.split('/').length !== 2) {
                    throw new Error(`IP/Máscara mal formada: ${ip_str}`);
                }
                const [ip, subnet] = ip_str.split('/');
                if (!is_valid_ip(ip)) {
                    throw new Error(`Dirección IP inválida en nodo ${node.data.id}: ${ip}`);
                }
                if (!is_valid_subnet(subnet)) {
                    throw new Error(`Máscara de subred inválida en nodo ${node.data.id}: ${subnet}`);
                }
            });
        }
    });
    const edgeSignatures = new Set();
    data.edges.forEach(edge => {
        const { source, target, sourceInterface, targetInterface } = edge.data;
        if (!nodeIds.has(source) || !nodeIds.has(target)) {
            throw new Error(`Enlace inválido: ${source} o ${target} no existen`);
        }
        const sourceNode = data.nodes.find(n => n.data.id === source);
        const targetNode = data.nodes.find(n => n.data.id === target);
        if (sourceNode.data.interfaces && !sourceNode.data.interfaces[sourceInterface]) {
            throw new Error(`Interfaz ${sourceInterface} no encontrada en ${source}`);
        }
        if (targetNode.data.interfaces && !targetNode.data.interfaces[targetInterface]) {
            throw new Error(`Interfaz ${targetInterface} no encontrada en ${target}`);
        }
        const sig = `${Math.min(source, target)}-${Math.max(source, target)}`;
        if (edgeSignatures.has(sig)) {
            console.warn(`Adv: Enlace duplicado entre ${source} y ${target}`);
        }
        edgeSignatures.add(sig);
    });
    log("Data validated:", { nodes: data.nodes.length, edges: data.edges.length });
    return true;
};

/**
 * Genera nodos de interfaz para cada router y crea un mapeo global.
 * @param {Array} nodes - Lista de nodos del grafo.
 * @returns {Array} Lista de nodos de interfaz generados.
 */
export const generateInterfaceNodes = (nodes) => {
    const interfaceNodes = [];
    const interfaceNodeIds = new Set();
    interfaceNodeToRouter = {}; // Reiniciar el mapeo global
    nodes.forEach(node => {
        if (node.data.interfaces) {
            const routerId = node.data.id;
            const parent = node.data.parent;
            Object.entries(node.data.interfaces).forEach(([intfName, ip]) => {
                const intfId = `${routerId}_${intfName}`; // Unique identifier
                if (interfaceNodeIds.has(intfId)) {
                    throw new Error(`ID duplicado para nodo de interfaz: ${intfId}`);
                }
                interfaceNodeIds.add(intfId);
                interfaceNodes.push({
                    data: { id: intfId, label: intfName, type: "interface", router: routerId, ip, parent, color: "#FFA500" },
                    position: null,
                });
                interfaceNodeToRouter[intfId] = routerId; // Mapear interfaz a su router
            });
        }
    });
    return interfaceNodes;
};

/**
 * Transforma los enlaces para usar nodos de interfaz.
 * @param {Array} edges - Lista de enlaces del grafo.
 * @param {Array} interfaceNodes - Lista de nodos de interfaz.
 * @returns {Array} Lista de enlaces transformados.
 */
export const transformEdges = (edges, interfaceNodes) => {
    const interfaceNodeIds = new Set(interfaceNodes.map(n => n.data.id)); // Optimización para búsquedas rápidas
    return edges.map(edge => {
        const { source, target, sourceInterface, targetInterface, weight } = edge.data;
        if (!source || !target || !sourceInterface || !targetInterface || !weight) {
            log(`Adv: Datos de enlace incompletos: ${JSON.stringify(edge.data)}`);
            return null;
        }
        const sourceIntfId = `${source}_${sourceInterface}`;
        const targetIntfId = `${target}_${targetInterface}`;
        if (!interfaceNodeIds.has(sourceIntfId) || !interfaceNodeIds.has(targetIntfId)) {
            log(`Adv: Interfaces ${sourceIntfId} o ${targetIntfId} no generadas`);
            return null;
        }
        return { data: { source: sourceIntfId, target: targetIntfId, weight, color: "#000" } };
    }).filter(Boolean);
};

/**
 * Añade enlaces jerárquicos para relaciones AS-router, interfaz-router y conexiones entre routers.
 * @param {Array} nodes - Lista de nodos del grafo.
 * @param {Array} edges - Lista de enlaces transformados del grafo.
 * @returns {Array} Lista de enlaces con jerarquías y conexiones añadidas.
 */
export const addHierarchicalEdges = (nodes, edges) => {
    const hierarchicalEdges = [];
    // Añadir relaciones AS > router y router > interfaz
    nodes.forEach(node => {
        if (node.data.parent && !node.data.type) {
            hierarchicalEdges.push({
                data: { source: node.data.parent, target: node.data.id, type: "hierarchical", invisible: true },
            });
        }
        if (node.data.type === "interface" && node.data.router) {
            hierarchicalEdges.push({
                data: { source: node.data.router, target: node.data.id, type: "router-interface", invisible: false },
            });
        }
    });

    // Añadir bordes invisibles entre routers conectados
    const routerConnections = new Set();
    edges.forEach(edge => {
        const sourceRouter = interfaceNodeToRouter[edge.data.source];
        const targetRouter = interfaceNodeToRouter[edge.data.target];
        if (sourceRouter && targetRouter && sourceRouter !== targetRouter) {
            const connectionSig = `${Math.min(sourceRouter, targetRouter)}-${Math.max(sourceRouter, targetRouter)}`;
            if (!routerConnections.has(connectionSig)) {
                routerConnections.add(connectionSig);
                hierarchicalEdges.push({
                    data: { source: sourceRouter, target: targetRouter, type: "router-connection", invisible: true },
                });
            }
        }
    });

    return edges.concat(hierarchicalEdges);
};

/**
 * Carga y posiciona los nodos del grafo, usando datos guardados si están disponibles.
 * @param {Array} nodes - Lista de nodos del grafo.
 * @param {Array} edges - Lista de enlaces del grafo (opcional).
 * @returns {Array} Lista de nodos con posiciones asignadas.
 */
export const loadData = (nodes, edges = []) => {
    const savedData = isLocalStorageAvailable() ? JSON.parse(localStorage.getItem("bgpNodeData") || "{}") : {};
    const nonInterfaceNodes = nodes.filter(node => node.data.type !== "interface");
    const interfaceNodes = nodes.filter(node => node.data.type === "interface");

    // Index for quick access
    const nodeIndex = nodes.reduce((acc, node) => {
        acc[node.data.id] = node;
        return acc;
    }, {});

    // Map AS to its routers
    const asToRouters = {};
    nonInterfaceNodes.forEach(node => {
        if (node.data.parent) {
            if (!asToRouters[node.data.parent]) {
                asToRouters[node.data.parent] = [];
            }
            asToRouters[node.data.parent].push(node);
        }
    });

    // Position non-interface nodes (ASes and routers) with random offsets initially
    nonInterfaceNodes.forEach(node => {
        const nodeId = node.data.id;
        if (savedData.positions?.[nodeId]?.x && savedData.positions?.[nodeId]?.y) {
            node.position = { x: savedData.positions[nodeId].x, y: savedData.positions[nodeId].y };
        } else if (!node.data.parent) {
            // AS nodes en cuadrícula fija
            const asIndex = nonInterfaceNodes.filter(n => !n.data.parent).findIndex(n => n.data.id === nodeId);
            const asGrid = Math.ceil(Math.sqrt(nonInterfaceNodes.filter(n => !n.data.parent).length));
            const asRow = Math.floor(asIndex / asGrid);
            const asCol = asIndex % asGrid;
            const gridSize = 900;
            node.position = {
                x: 200 + (asCol * gridSize),
                y: 350 + (asRow * gridSize),
            };
        } else {
            // Routers inicialmente en círculo alrededor de su AS (serán ajustados por layout)
            const parentId = node.data.parent;
            const asNode = nodeIndex[parentId];
            const asPos = asNode.position;
            const routersInAs = asToRouters[parentId];
            const numRouters = routersInAs.length;
            const index = routersInAs.indexOf(node);
            const angle = (2 * Math.PI * index) / numRouters;
            const radius = 150;
            node.position = {
                x: asPos.x + radius * Math.cos(angle),
                y: asPos.y + radius * Math.sin(angle),
            };
        }
        node.data.color = savedData.colors?.nodes?.[nodeId] || node.data.color || (node.data.parent ? "#00FF00" : "#ddd");
        node.locked = !node.data.parent; // Fijar ASes, desbloquear routers para ajuste de layout
    });

    // Create dictionary of interface connections
    const interfaceConnections = {};
    edges.forEach(edge => {
        const sourceIntfId = `${edge.data.source}_${edge.data.sourceInterface}`;
        const targetIntfId = `${edge.data.target}_${edge.data.targetInterface}`;
        interfaceConnections[sourceIntfId] = targetIntfId;
        interfaceConnections[targetIntfId] = sourceIntfId;
    });

    // Position interface nodes with dynamic radius and angular offset
    const interfacesByRouter = {};
    interfaceNodes.forEach(node => {
        const routerId = node.data.router;
        if (!interfacesByRouter[routerId]) interfacesByRouter[routerId] = [];
        interfacesByRouter[routerId].push(node);
    });

    Object.entries(interfacesByRouter).forEach(([routerId, interfaces]) => {
        const router = nodeIndex[routerId];
        const routerPos = router.position;
        const numInterfaces = interfaces.length;
        const baseRadius = 40 + 10 * (numInterfaces - 1); // Dynamic radius based on number of interfaces

        interfaces.forEach((intfNode) => {
            const intfId = intfNode.data.id;
            const connectedIntfId = interfaceConnections[intfId];
            let initialAngle;
            if (connectedIntfId && nodeIndex[connectedIntfId]) {
                const connectedIntf = nodeIndex[connectedIntfId];
                const connectedRouter = nodeIndex[connectedIntf.data['router']];
                const dx = connectedRouter.position.x - routerPos.x;
                const dy = connectedRouter.position.y - routerPos.y;
                initialAngle = Math.atan2(dy, dx);
            } else {
                const index = interfaces.indexOf(intfNode);
                initialAngle = (2 * Math.PI * index) / numInterfaces;
            }
            const randomAngleOffset = (Math.random() - 0.5) * Math.PI / 9; // ±20 degrees
            const angle = initialAngle + randomAngleOffset;
            const radius = baseRadius;
            intfNode.position = {
                x: routerPos.x + radius * Math.cos(angle),
                y: routerPos.y + radius * Math.sin(angle),
            };
            intfNode.locked = false; // Desbloquear interfaces para layout
        });
    });

    return nonInterfaceNodes.concat(interfaceNodes);
};