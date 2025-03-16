import { log, getRandomPosition, isLocalStorageAvailable, is_valid_ip, is_valid_subnet } from './utils.js';

let interfaceNodeToRouter = {};

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
        const sortedNodes = [source, target].sort();
        const sortedInterfaces = source === sortedNodes[0] ? [sourceInterface, targetInterface] : [targetInterface, sourceInterface];
        const sig = `${sortedNodes[0]}-${sortedNodes[1]}-${sortedInterfaces[0]}-${sortedInterfaces[1]}`;
        if (edgeSignatures.has(sig)) {
            console.warn(`Adv: Enlace duplicado entre ${source} y ${target} usando interfaces ${sourceInterface} y ${targetInterface}`);
        }
        edgeSignatures.add(sig);
    });
    log("Data validated:", { nodes: data.nodes.length, edges: data.edges.length });
    return true;
};

export const generateInterfaceNodes = (nodes) => {
    const interfaceNodes = [];
    const interfaceNodeIds = new Set();
    interfaceNodeToRouter = {};
    nodes.forEach(node => {
        if (node.data.interfaces) {
            const routerId = node.data.id;
            const parent = node.data.parent;
            Object.entries(node.data.interfaces).forEach(([intfName, ip]) => {
                const intfId = `${routerId}_${intfName}`;
                if (interfaceNodeIds.has(intfId)) {
                    throw new Error(`ID duplicado para nodo de interfaz: ${intfId}`);
                }
                interfaceNodeIds.add(intfId);
                interfaceNodes.push({
                    data: { id: intfId, label: intfName, type: "interface", router: routerId, ip, parent, color: "#FFA500" },
                    position: null,
                });
                interfaceNodeToRouter[intfId] = routerId;
            });
        }
    });
    return interfaceNodes;
};

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

const detectOverlap = (node1, node2, buffer = 10) => {
    const size1 = node1.data.type === "interface" ? 20 : node1.data.parent ? 60 : 250;
    const size2 = node2.data.type === "interface" ? 20 : node2.data.parent ? 60 : 250;
    const dx = node1.position.x - node2.position.x;
    const dy = node1.position.y - node2.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < (size1 / 2 + size2 / 2 + buffer);
};

const resolveOverlaps = (nodes, spacing, minSpacing) => {
    let adjusted = false;
    do {
        adjusted = false;
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                if (detectOverlap(nodes[i], nodes[j])) {
                    adjusted = true;
                    const dx = nodes[j].position.x - nodes[i].position.x;
                    const move = Math.max(spacing, minSpacing) / 2;
                    nodes[i].position.x -= move;
                    nodes[j].position.x += move;
                }
            }
        }
    } while (adjusted);
    return nodes;
};

const sortASByConnectivity = (asNodes, edges) => {
    const connectivity = {};
    asNodes.forEach(node => connectivity[node.data.id] = new Set());
    
    edges.forEach(edge => {
        const sourceAS = asNodes.find(n => n.data.id === edge.data.source.split('_')[0])?.data.id;
        const targetAS = asNodes.find(n => n.data.id === edge.data.target.split('_')[0])?.data.id;
        if (sourceAS && targetAS && sourceAS !== targetAS) {
            connectivity[sourceAS].add(targetAS);
            connectivity[targetAS].add(sourceAS);
        }
    });

    return asNodes.sort((a, b) => connectivity[b.data.id].size - connectivity[a.data.id].size);
};

export const loadData = (nodes, edges = [], cyContainer = null) => {
    console.log("Ejecutando loadData...");
    const nonInterfaceNodes = nodes.filter(node => node.data.type !== "interface");
    const interfaceNodes = nodes.filter(node => node.data.type === "interface");

    const nodeIndex = nodes.reduce((acc, node) => {
        acc[node.data.id] = node;
        return acc;
    }, {});

    const asToRouters = {};
    nonInterfaceNodes.forEach(node => {
        if (node.data.parent) {
            if (!asToRouters[node.data.parent]) asToRouters[node.data.parent] = [];
            asToRouters[node.data.parent].push(node);
        }
    });

    const routerToInterfaces = {};
    interfaceNodes.forEach(node => {
        const routerId = node.data.router;
        if (!routerToInterfaces[routerId]) routerToInterfaces[routerId] = [];
        routerToInterfaces[routerId].push(node);
    });

    const viewportWidth = cyContainer ? cyContainer.offsetWidth : 1200;
    const viewportHeight = cyContainer ? cyContainer.offsetHeight : 800;

    let asNodes = nonInterfaceNodes.filter(n => !n.data.parent);
    asNodes = sortASByConnectivity(asNodes, edges);
    const asCount = asNodes.length;
    const maxRoutersPerAS = Math.max(...Object.values(asToRouters).map(routers => routers.length), 1);
    const maxInterfacesPerRouter = Math.max(...Object.values(routerToInterfaces).map(interfaces => interfaces.length), 1);

    const asSpacing = Math.min(300, viewportWidth / (asCount + 1));
    const routerSpacing = Math.min(60, viewportWidth / (maxRoutersPerAS * asCount + 1));
    const interfaceSpacing = Math.min(30, viewportWidth / (maxInterfacesPerRouter * maxRoutersPerAS * asCount + 1));

    const asY = viewportHeight * 0.15;
    const routerY = viewportHeight * 0.45;
    const interfaceY = viewportHeight * 0.75;

    asNodes.forEach((node, index) => {
        const x = (viewportWidth / 2 - (asCount - 1) * asSpacing / 2 + index * asSpacing);
        node.position = { x, y: asY };
        node.data.defaultPosition = { x, y: asY };
        node.locked = false;
    });
    resolveOverlaps(asNodes, asSpacing, 250);

    Object.entries(asToRouters).forEach(([asId, routers]) => {
        const asNode = nodeIndex[asId];
        const asX = asNode.position.x;
        const connectivity = routers.map(r => edges.filter(e => e.data.source.includes(r.data.id) || e.data.target.includes(r.data.id)).length);
        routers.sort((a, b) => connectivity[routers.indexOf(b)] - connectivity[routers.indexOf(a)]);
        routers.forEach((router, index) => {
            const routerX = (asX - (routers.length - 1) * routerSpacing / 2 + index * routerSpacing);
            router.position = { x: routerX, y: routerY };
            router.data.defaultPosition = { x: routerX, y: routerY };
            router.locked = false;
        });
        resolveOverlaps(routers, routerSpacing, 60);
    });

    Object.entries(routerToInterfaces).forEach(([routerId, interfaces]) => {
        const router = nodeIndex[routerId];
        const routerX = router.position.x;
        interfaces.forEach((intfNode, index) => {
            const intfX = (routerX - (interfaces.length - 1) * interfaceSpacing / 2 + index * interfaceSpacing);
            intfNode.position = { x: intfX, y: interfaceY };
            intfNode.data.defaultPosition = { x: intfX, y: interfaceY };
            intfNode.locked = false;
        });
        resolveOverlaps(interfaces, interfaceSpacing, 20);
    });

    const result = nonInterfaceNodes.concat(interfaceNodes);
    console.log("loadData completado. Posiciones calculadas:", result.map(n => ({ id: n.data.id, position: n.position })));
    return result;
};