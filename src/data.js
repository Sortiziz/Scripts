// src/data.js
import { log, getRandomPosition, isLocalStorageAvailable } from './utils.js';

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
            Object.values(node.data.interfaces).forEach(ip => {
                if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(ip)) {
                    throw new Error(`IP inválida en nodo ${node.data.id}: ${ip}`);
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
            console.warn(`Advertencia: Enlace duplicado detectado entre ${source} y ${target}`);
        }
        edgeSignatures.add(sig);
    });
    log("Datos validados:", { nodes: data.nodes.length, edges: data.edges.length });
    return true;
};

/**
 * Genera nodos de interfaz para cada router.
 * @param {Array} nodes - Lista de nodos del grafo.
 * @returns {Array} Lista de nodos de interfaz generados.
 */
export const generateInterfaceNodes = (nodes) => {
    const interfaceNodes = [];
    nodes.forEach(node => {
        if (node.data.interfaces) {
            const routerId = node.data.id;
            const parent = node.data.parent;
            Object.entries(node.data.interfaces).forEach(([intfName, ip]) => {
                const intfId = `${routerId}_${intfName}`; // Identificador único
                interfaceNodes.push({
                    data: { id: intfId, label: intfName, type: "interface", router: routerId, ip, parent, color: "#FFA500" },
                    position: null,
                });
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
    return edges.map(edge => {
        const { source, target, sourceInterface, targetInterface, weight } = edge.data;
        const sourceIntfId = `${source}_${sourceInterface}`;
        const targetIntfId = `${target}_${targetInterface}`;
        if (!interfaceNodes.some(n => n.data.id === sourceIntfId) || !interfaceNodes.some(n => n.data.id === targetIntfId)) {
            log(`Advertencia: Interfaces ${sourceIntfId} o ${targetIntfId} no generadas`);
            return null;
        }
        return { data: { source: sourceIntfId, target: targetIntfId, weight, color: "#000" } };
    }).filter(Boolean);
};

/**
 * Añade enlaces jerárquicos para relaciones AS-router e interfaz-router.
 * @param {Array} nodes - Lista de nodos del grafo.
 * @param {Array} edges - Lista de enlaces del grafo.
 * @returns {Array} Lista de enlaces con jerarquías añadidas.
 */
export const addHierarchicalEdges = (nodes, edges) => {
    const hierarchicalEdges = [];
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

    // Índice de nodos para acceso rápido
    const nodeIndex = nodes.reduce((acc, node) => {
        acc[node.data.id] = node;
        return acc;
    }, {});

    // Crear un mapeo de AS a sus routers
    const asToRouters = {};
    nonInterfaceNodes.forEach(node => {
        if (node.data.parent) {
            if (!asToRouters[node.data.parent]) {
                asToRouters[node.data.parent] = [];
            }
            asToRouters[node.data.parent].push(node);
        }
    });

    // Posicionar nodos no interfaces (ASes y routers) con desplazamiento aleatorio
    nonInterfaceNodes.forEach(node => {
        const nodeId = node.data.id;
        if (savedData.positions?.[nodeId]?.x && savedData.positions?.[nodeId]?.y) {
            node.position = { x: savedData.positions[nodeId].x, y: savedData.positions[nodeId].y };
        } else if (!node.data.parent) {
            // AS nodes
            const asIndex = nonInterfaceNodes.filter(n => !n.data.parent).findIndex(n => n.data.id === nodeId);
            const asGrid = Math.ceil(Math.sqrt(nonInterfaceNodes.length));
            const asRow = Math.floor(asIndex / asGrid);
            const asCol = asIndex % asGrid;
            const gridSize = 800; // Aumentado de 700 a 800
            const randomOffsetX = (Math.random() - 0.5) * 100; // Mantenido en ±50
            const randomOffsetY = (Math.random() - 0.5) * 100;
            node.position = {
                x: 200 + (asCol * gridSize) + randomOffsetX,
                y: 350 + (asRow * gridSize) + randomOffsetY,
            };
        } else {
            // Router nodes
            const parentId = node.data.parent;
            const asNode = nodeIndex[parentId];
            const asPos = asNode.position;
            const routersInAs = asToRouters[parentId];
            const numRouters = routersInAs.length;
            const index = routersInAs.indexOf(node);
            const angle = (2 * Math.PI * index) / numRouters;
            const radius = 150; // Radio para posicionar routers alrededor del AS
            node.position = {
                x: asPos.x + radius * Math.cos(angle),
                y: asPos.y + radius * Math.sin(angle),
            };
        }
        node.data.color = savedData.colors?.nodes?.[nodeId] || node.data.color || (node.data.parent ? "#00FF00" : "#ddd");
    });

    // Crear diccionario de conexiones de interfaces
    const interfaceConnections = {};
    edges.forEach(edge => {
        const sourceIntfId = `${edge.data.source}_${edge.data.sourceInterface}`;
        const targetIntfId = `${edge.data.target}_${edge.data.targetInterface}`;
        interfaceConnections[sourceIntfId] = targetIntfId;
        interfaceConnections[targetIntfId] = sourceIntfId;
    });

    // Posicionar nodos de interfaz con ajuste dinámico y desplazamiento angular
    const interfacesByRouter = {};
    interfaceNodes.forEach(node => {
        const routerId = node.data.router;
        if (!interfacesByRouter[routerId]) interfacesByRouter[routerId] = [];
        interfacesByRouter[routerId].push(node);
    });

    Object.entries(interfacesByRouter).forEach(([routerId, interfaces]) => {
        const router = nodeIndex[routerId];
        const routerPos = router.position;
        interfaces.forEach((intfNode) => {
            const intfId = intfNode.data.id;
            if (savedData.positions?.[intfId]?.x && savedData.positions?.[intfId]?.y) {
                intfNode.position = { x: savedData.positions[intfId].x, y: savedData.positions[intfId].y };
            } else {
                const connectedIntfId = interfaceConnections[intfId];
                if (connectedIntfId && nodeIndex[connectedIntfId]) {
                    const connectedIntf = nodeIndex[connectedIntfId];
                    const connectedRouter = nodeIndex[connectedIntf.data.router];
                    const dx = connectedRouter.position.x - routerPos.x;
                    const dy = connectedRouter.position.y - routerPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const baseRadius = 100; // Aumentado de 80 a 100
                    const radius = Math.max(baseRadius, distance / 1.2); // Ajustado de /1.5 a /1.2
                    let angle = Math.atan2(dy, dx);
                    // Introducir desplazamiento angular para evitar superposición
                    const offsetAngle = (Math.PI / 12); // 15 grados
                    const isSource = intfId === `${connectedIntf.data.router}_${connectedIntf.data.label}` ? 1 : -1;
                    angle += isSource * offsetAngle;
                    intfNode.position = {
                        x: routerPos.x + radius * Math.cos(angle),
                        y: routerPos.y + radius * Math.sin(angle),
                    };
                } else {
                    const numInterfaces = interfaces.length;
                    const index = interfaces.indexOf(intfNode);
                    const angle = (2 * Math.PI * index) / numInterfaces;
                    const radius = 40;
                    intfNode.position = {
                        x: routerPos.x + radius * Math.cos(angle),
                        y: routerPos.y + radius * Math.sin(angle),
                    };
                }
            }
            intfNode.data.color = savedData.colors?.nodes?.[intfId] || intfNode.data.color || "#FFA500";
        });
    });

    return nonInterfaceNodes.concat(interfaceNodes);
};