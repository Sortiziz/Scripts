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
    const interfaceNodeIds = new Set(interfaceNodes.map(n => n.data.id));
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
 * Carga y posiciona los nodos del grafo en una estructura jerárquica.
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

    // Map routers to their interfaces
    const routerToInterfaces = {};
    interfaceNodes.forEach(node => {
        const routerId = node.data.router;
        if (!routerToInterfaces[routerId]) routerToInterfaces[routerId] = [];
        routerToInterfaces[routerId].push(node);
    });

    // Posicionar AS en una línea horizontal en la parte superior
    const asNodes = nonInterfaceNodes.filter(n => !n.data.parent);
    const asSpacing = 200; // Espaciado entre AS
    const asY = 100; // Altura de los AS
    asNodes.forEach((node, index) => {
        const x = (index - (asNodes.length - 1) / 2) * asSpacing; // Centrar los AS
        node.position = { x, y: asY };
        node.data.defaultPosition = { x, y: asY }; // Guardar posición predeterminada
        node.data.color = savedData.colors?.nodes?.[node.data.id] || node.data.color || "#ddd";
        node.locked = true; // Fijar ASes
    });

    // Posicionar routers debajo de sus AS, centrados
    const routerSpacing = 50; // Espaciado entre routers
    const routerY = 250; // Altura de los routers
    Object.entries(asToRouters).forEach(([asId, routers]) => {
        const asNode = nodeIndex[asId];
        const asX = asNode.position.x;
        routers.forEach((router, index) => {
            const routerX = asX + (index - (routers.length - 1) / 2) * routerSpacing; // Centrar routers bajo el AS
            router.position = { x: routerX, y: routerY };
            router.data.defaultPosition = { x: routerX, y: routerY }; // Guardar posición predeterminada
            router.data.color = savedData.colors?.nodes?.[router.data.id] || router.data.color || "#00FF00";
            router.locked = false; // Desbloquear routers
        });
    });

    // Posicionar interfaces debajo de sus routers, centradas
    const interfaceSpacing = 30; // Espaciado entre interfaces
    const interfaceY = 350; // Altura de las interfaces
    Object.entries(routerToInterfaces).forEach(([routerId, interfaces]) => {
        const router = nodeIndex[routerId];
        const routerX = router.position.x;
        interfaces.forEach((intfNode, index) => {
            const intfX = routerX + (index - (interfaces.length - 1) / 2) * interfaceSpacing; // Centrar interfaces bajo el router
            intfNode.position = { x: intfX, y: interfaceY };
            intfNode.data.defaultPosition = { x: intfX, y: interfaceY }; // Guardar posición predeterminada
            intfNode.locked = false; // Desbloquear interfaces
        });
    });

    return nonInterfaceNodes.concat(interfaceNodes);
};