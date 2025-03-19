import { log, getRandomPosition, isLocalStorageAvailable, is_valid_ip, is_valid_subnet, ipToInt, getNetworkAddress } from './utils.js';

let interfaceNodeToRouter = {};

export const validateGraphData = (data) => {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
        throw new Error("Formato de bgp_graph.json inválido");
    }
    const nodeIds = new Set();
    const allIps = new Set();
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
                if (allIps.has(ip)) {
                    throw new Error(`Dirección IP duplicada: ${ip} en nodo ${node.data.id}`);
                }
                allIps.add(ip);
            });
        }
    });
    const edgeSignatures = new Set();
    data.edges.forEach(edge => {
        const { source, target, sourceInterface, targetInterface, weight } = edge.data;
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
        const sourceIpStr = sourceNode.data.interfaces[sourceInterface];
        const targetIpStr = targetNode.data.interfaces[targetInterface];
        const [sourceIp, sourceMask] = sourceIpStr.split('/');
        const [targetIp, targetMask] = targetIpStr.split('/');
        const [edgeNetwork, edgeMask] = weight.split('/');

        if (sourceMask !== edgeMask || targetMask !== edgeMask) {
            console.warn(`Máscaras inconsistentes en enlace ${source} -> ${target}: ${sourceMask} vs ${edgeMask} vs ${targetMask}`);
        }

        const sourceNetwork = getNetworkAddress(sourceIp, parseInt(edgeMask));
        const targetNetwork = getNetworkAddress(targetIp, parseInt(edgeMask));
        const edgeNetworkInt = ipToInt(edgeNetwork);

        if (sourceNetwork !== edgeNetworkInt || targetNetwork !== edgeNetworkInt) {
            console.warn(`IPs no están en la subred especificada para el enlace ${source} -> ${target}`);
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
            Object.entries(node.data.interfaces).forEach(([intfName, ip]) => {
                const intfId = `${routerId}_${intfName}`;
                if (interfaceNodeIds.has(intfId)) {
                    throw new Error(`ID duplicado para nodo de interfaz: ${intfId}`);
                }
                interfaceNodeIds.add(intfId);
                interfaceNodes.push({
                    data: { id: intfId, label: intfName, type: "interface", router: routerId, ip, parent: routerId, color: "#FFA500" },
                    position: getRandomPosition(),
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
        // Solo generar aristas jerárquicas para routers bajo AS
        if (node.data.parent && !node.data.type) {
            hierarchicalEdges.push({
                data: { source: node.data.parent, target: node.data.id, type: "hierarchical", invisible: true },
            });
        }
        // No se generan aristas "router-interface" ya que la relación está implícita en la jerarquía
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

export const loadData = (nodes, edges = [], cyContainer = null) => {
    console.log("Ejecutando loadData...");
    const viewportWidth = cyContainer ? cyContainer.offsetWidth : 1200;
    const viewportHeight = cyContainer ? cyContainer.offsetHeight : 800;

    nodes.forEach(node => {
        if (!node.position) {
            node.position = getRandomPosition();
        }
        node.data.defaultPosition = node.position;
        node.locked = false;
    });

    console.log("loadData completado. Posiciones iniciales:", nodes.map(n => ({ id: n.data.id, position: n.position })));
    return nodes;
};