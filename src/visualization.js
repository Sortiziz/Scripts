import { log, CONFIG, rgbToHex, isLocalStorageAvailable } from './utils.js';
import { validateGraphData, loadData, generateInterfaceNodes, transformEdges, addHierarchicalEdges } from './data.js';

export const bgpHierarchicalLayout = (cy, nodes, edges, isRealTime = false) => {
    console.log("Ejecutando bgpHierarchicalLayout...", { isRealTime });

    const asY = cy.height() * 0.15;
    const routerYRange = [cy.height() * 0.25, cy.height() * 0.45];
    const routerRadius = 120;
    const interfaceRadius = 60;
    const repulsionForce = 1000;
    const attractionForce = 0.3;
    const interfaceAttractionForce = 1.5; // Mantenida para posicionamiento relativo
    const interfaceRepulsionForce = 2500;
    const maxInterfaceDistance = 70;
    const maxIterations = isRealTime ? 100 : 200;

    const nodeMap = {};
    nodes.forEach(node => {
        nodeMap[node.data.id] = {
            pos: { x: node.position.x || 0, y: node.position.y || 0 },
            vel: { x: 0, y: 0 },
            type: node.data.type || (node.data.parent && !node.data.router ? 'router' : 'as'),
            router: node.data.router || null,
            parent: node.data.parent || null,
            locked: node.data.locked || false,
            subnetConflicts: []
        };
    });

    const asNodes = nodes.filter(n => !n.data.parent && !n.data.type);
    const numAS = asNodes.length;
    const asSpacing = Math.min(400, cy.width() / (numAS + 1));
    asNodes.forEach((node, index) => {
        if (nodeMap[node.data.id].locked) return;
        const x = (cy.width() / 2 - (numAS - 1) * asSpacing / 2 + index * asSpacing);
        nodeMap[node.data.id].pos = { x, y: asY };
    });

    const routerNodes = nodes.filter(n => n.data.parent && !n.data.type);
    const asToRouters = {};
    routerNodes.forEach(node => {
        if (!asToRouters[node.data.parent]) asToRouters[node.data.parent] = [];
        asToRouters[node.data.parent].push(node);
    });
    Object.entries(asToRouters).forEach(([asId, routers]) => {
        const asPos = nodeMap[asId].pos;
        const numRouters = routers.length;
        const baseAngle = Math.random() * 2 * Math.PI;
        const routerY = (routerYRange[0] + routerYRange[1]) / 2;
        routers.forEach((router, index) => {
            if (nodeMap[router.data.id].locked) return;
            const angle = baseAngle + (2 * Math.PI / numRouters) * index;
            nodeMap[router.data.id].pos = {
                x: asPos.x + routerRadius * Math.cos(angle),
                y: routerY + (routerRadius * 0.5) * Math.sin(angle)
            };
        });
    });

    const interfaceNodes = nodes.filter(n => n.data.type === "interface");
    const routerToInterfaces = {};
    interfaceNodes.forEach(node => {
        const routerId = node.data.router;
        if (!routerToInterfaces[routerId]) routerToInterfaces[routerId] = [];
        routerToInterfaces[routerId].push(node);
    });
    Object.entries(routerToInterfaces).forEach(([routerId, interfaces]) => {
        const routerPos = nodeMap[routerId].pos;
        const numInterfaces = interfaces.length;
        const baseAngle = Math.random() * 2 * Math.PI;
        interfaces.forEach((intf, index) => {
            if (nodeMap[intf.data.id].locked) return;
            const angle = baseAngle + (2 * Math.PI / numInterfaces) * index;
            nodeMap[intf.data.id].pos = {
                x: routerPos.x + interfaceRadius * Math.cos(angle),
                y: routerPos.y + interfaceRadius * Math.sin(angle)
            };
        });
    });

    const subnetMap = new Map();
    edges.forEach(edge => {
        const isOriginalEdge = edge.data.hasOwnProperty('sourceInterface') && edge.data.hasOwnProperty('targetInterface');
        const sourceIsRouter = nodes.find(n => n.data.id === edge.data.source && n.data.parent && !n.data.type);
        const targetIsRouter = nodes.find(n => n.data.id === edge.data.target && n.data.parent && !n.data.type);
        if (isOriginalEdge && sourceIsRouter && targetIsRouter && edge.data.weight) {
            const subnet = edge.data.weight.split('/')[0];
            if (!subnet) {
                console.warn(`Subred inválida en arista ${edge.data.source} -> ${edge.data.target}: ${edge.data.weight}`);
                return;
            }
            const sourceNodeId = edge.data.source;
            const targetNodeId = edge.data.target;
            if (subnetMap.has(subnet)) {
                const prevTarget = subnetMap.get(subnet);
                console.warn(`Posible bucle o conflicto de subred: ${subnet} usado en ${sourceNodeId} y ${prevTarget}, ahora en ${targetNodeId}`);
            } else {
                subnetMap.set(subnet, targetNodeId);
            }
        }
    });

    for (let i = 0; i < maxIterations; i++) {
        Object.keys(nodeMap).forEach(id1 => {
            Object.keys(nodeMap).forEach(id2 => {
                if (id1 === id2 || nodeMap[id1].locked || nodeMap[id2].locked) return;
                const n1 = nodeMap[id1];
                const n2 = nodeMap[id2];
                const dx = n1.pos.x - n2.pos.x;
                const dy = n1.pos.y - n2.pos.y;
                const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
                const force = (n1.type === "interface" && n2.type === "interface") ? interfaceRepulsionForce : repulsionForce;
                const fx = (dx / distance) * (force / (distance * distance));
                const fy = (dy / distance) * (force / (distance * distance));
                n1.vel.x += fx;
                n1.vel.y += fy;
                n2.vel.x -= fx;
                n2.vel.y -= fy;
            });
        });

        edges.forEach(edge => {
            const source = nodeMap[edge.data.source];
            const target = nodeMap[edge.data.target];
            if (!source || !target || source.locked || target.locked) return;
            const dx = target.pos.x - source.pos.x;
            const dy = target.pos.y - source.pos.y;
            const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const force = attractionForce * distance;
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;
            source.vel.x += fx;
            source.vel.y += fy;
            target.vel.x -= fx;
            target.vel.y -= fy;
        });

        interfaceNodes.forEach(intf => {
            const intfNode = nodeMap[intf.data.id];
            const routerNode = nodeMap[intf.data.router];
            if (!routerNode || intfNode.locked) return;
            const dx = routerNode.pos.x - intfNode.pos.x;
            const dy = routerNode.pos.y - intfNode.pos.y;
            const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const force = interfaceAttractionForce * distance;
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;
            intfNode.vel.x += fx;
            intfNode.vel.y += fy;
        });

        Object.keys(nodeMap).forEach(id => {
            const node = nodeMap[id];
            if (node.locked) return;
            node.pos.x += node.vel.x * 0.9;
            node.pos.y += node.vel.y * 0.9;
            node.vel.x *= 0.9;
            node.vel.y *= 0.9;

            if (node.type === "interface" && node.router) {
                const routerPos = nodeMap[node.router].pos;
                const dx = node.pos.x - routerPos.x;
                const dy = node.pos.y - routerPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > maxInterfaceDistance) {
                    const scale = maxInterfaceDistance / distance;
                    node.pos.x = routerPos.x + dx * scale;
                    node.pos.y = routerPos.y + dy * scale;
                }
            }
        });
    }

    const reorderToMinimizeCrossings = () => {
        Object.entries(asToRouters).forEach(([asId, routers]) => {
            const routerConnectivity = routers.map(r => ({
                node: r,
                connections: edges.filter(e => e.data.source.includes(r.data.id) || e.data.target.includes(r.data.id)).length
            }));
            routerConnectivity.sort((a, b) => b.connections - a.connections);
            const asPos = nodeMap[asId].pos;
            const numRouters = routers.length;
            const baseAngle = Math.random() * 2 * Math.PI;
            routerConnectivity.forEach((r, index) => {
                const router = nodeMap[r.node.data.id];
                if (router.locked) return;
                const angle = baseAngle + (2 * Math.PI / numRouters) * index;
                router.pos.x = asPos.x + routerRadius * Math.cos(angle);
                router.pos.y = routerYRange[0] + (routerYRange[1] - routerYRange[0]) * Math.sin(angle);
            });
        });

        Object.entries(routerToInterfaces).forEach(([routerId, interfaces]) => {
            const interfaceConnectivity = interfaces.map(intf => ({
                node: intf,
                connections: edges.filter(e => e.data.source === intf.data.id || e.data.target === intf.data.id).length
            }));
            interfaceConnectivity.sort((a, b) => b.connections - a.connections);
            const routerPos = nodeMap[routerId].pos;
            const numInterfaces = interfaces.length;
            const baseAngle = Math.random() * 2 * Math.PI;
            interfaceConnectivity.forEach((intf, index) => {
                const interfaceNode = nodeMap[intf.node.data.id];
                if (interfaceNode.locked) return;
                const angle = baseAngle + (2 * Math.PI / numInterfaces) * index;
                interfaceNode.pos.x = routerPos.x + interfaceRadius * Math.cos(angle);
                interfaceNode.pos.y = routerPos.y + interfaceRadius * Math.sin(angle);
            });
        });
    };
    reorderToMinimizeCrossings();

    cy.nodes().animate({
        position: (node) => ({
            x: nodeMap[node.id()].pos.x,
            y: nodeMap[node.id()].pos.y
        }),
        duration: 500,
        easing: 'ease-in-out'
    });

    console.log("bgpHierarchicalLayout completado. Nuevas posiciones:", cy.nodes().map(n => ({ id: n.id(), position: n.position() })));
};

export const initializeGraph = async () => {
    if (typeof cytoscape === "undefined") {
        throw new Error("Cytoscape no está cargado. Verifica la inclusión del script.");
    }
    const loadingElement = document.getElementById("loading");
    loadingElement.style.display = "block";
    try {
        const response = await fetch("bgp_graph.json", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Error al cargar bgp_graph.json: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();

        validateGraphData(data);
        const interfaceNodes = generateInterfaceNodes(data.nodes);
        const cyContainer = document.getElementById("cy");
        const allNodes = loadData(data.nodes.concat(interfaceNodes), data.edges, cyContainer);
        const transformedEdges = transformEdges(data.edges, interfaceNodes);
        const allEdges = addHierarchicalEdges(allNodes, transformedEdges);

        const subnetMap = new Map();
        allEdges.forEach(edge => {
            const isOriginalEdge = edge.data.hasOwnProperty('sourceInterface') && edge.data.hasOwnProperty('targetInterface');
            const sourceIsRouter = allNodes.find(n => n.data.id === edge.data.source && n.data.parent && !n.data.type);
            const targetIsRouter = allNodes.find(n => n.data.id === edge.data.target && n.data.parent && !n.data.type);
            if (isOriginalEdge && sourceIsRouter && targetIsRouter && edge.data.weight) {
                const subnet = edge.data.weight.split('/')[0];
                if (!subnet) {
                    console.warn(`Subred inválida en arista ${edge.data.source} -> ${edge.data.target}: ${edge.data.weight}`);
                    return;
                }
                const sourceNodeId = edge.data.source;
                const targetNodeId = edge.data.target;
                if (subnetMap.has(subnet)) {
                    const prevTarget = subnetMap.get(subnet);
                    console.warn(`Posible bucle o conflicto de subred: ${subnet} usado en ${sourceNodeId} y ${prevTarget}, ahora en ${targetNodeId}`);
                } else {
                    subnetMap.set(subnet, targetNodeId);
                }
            }
        });

        const cy = cytoscape({
            container: cyContainer,
            elements: { nodes: allNodes, edges: allEdges },
            style: [
                {
                    selector: "node[!parent]",
                    style: {
                        "background-color": ele => ele.data("color") || CONFIG.DEFAULT_COLORS.AS,
                        shape: "rectangle",
                        label: "data(label)",
                        "text-valign": "top",
                        "text-halign": "center",
                        "font-size": 16,
                        padding: 75,
                        "border-width": 2,
                        "border-style": "dashed",
                        width: CONFIG.AS_SIZE.width,
                        height: CONFIG.AS_SIZE.height,
                    },
                },
                {
                    selector: "node[parent][!type]",
                    style: {
                        "background-color": ele => ele.data("color") || CONFIG.DEFAULT_COLORS.ROUTER,
                        shape: "ellipse",
                        label: "data(label)",
                        width: 60,
                        height: 60,
                        "text-valign": "center",
                        "text-halign": "center",
                        "font-size": 14,
                        "border-width": 2,
                        "border-color": "#000",
                    },
                },
                {
                    selector: "node[type='interface']",
                    style: {
                        "background-color": ele => ele.data("color") || CONFIG.DEFAULT_COLORS.INTERFACE,
                        shape: "ellipse",
                        label: "data(label)",
                        width: 20,
                        height: 20,
                        "text-valign": "center",
                        "text-halign": "center",
                        "font-size": 8,
                        "border-width": 1,
                        "border-color": "#000",
                    },
                },
                {
                    selector: "edge[type='hierarchical']",
                    style: { "line-color": "#000", opacity: 0 },
                },
                {
                    selector: "edge[type='router-connection']",
                    style: { 
                        "line-color": "transparent", 
                        opacity: 0,
                        "curve-style": "straight",
                    },
                },
                {
                    selector: "edge[!invisible][type!='hierarchical']",
                    style: {
                        "line-color": ele => {
                            return ele.data('status') === 'added' ? 'blue' :
                                   ele.data('status') === 'removed' ? 'red' :
                                   ele.data("color") || CONFIG.DEFAULT_COLORS.EDGE;
                        },
                        "line-style": ele => ele.data('status') === 'removed' ? 'dashed' : 'solid',
                        width: ele => Math.min(10, Math.max(1, parseFloat(ele.data("weight")?.split("/")[1]) / 8 || 3)),
                        label: "data(weight)",
                        "font-size": 10,
                        "text-background-color": "#FFFFFF",
                        "text-background-opacity": 0.9,
                        "text-background-padding": 2,
                        "source-label": "",
                        "target-label": "",
                        "source-text-offset": 20,
                        "target-text-offset": 20,
                        "source-text-margin-y": -8,
                        "target-text-margin-y": -8,
                        "text-rotation": "autorotate",
                        "curve-style": "bezier",
                    },
                },
            ],
            layout: {
                name: "preset",
                positions: allNodes.reduce((acc, node) => {
                    acc[node.data.id] = node.position;
                    return acc;
                }, {}),
                fit: true,
                padding: 50,
            },
        });

        cy.nodes().on('drag', evt => {
            const node = evt.target;
            node.data('locked', true);
        });

        const savedData = isLocalStorageAvailable() ? JSON.parse(localStorage.getItem("bgpNodeData") || "{}") : {};
        const allNodesHaveSavedPositions = allNodes.every(node => savedData.positions?.[node.data.id]?.x && savedData.positions?.[node.data.id]?.y);

        if (!allNodesHaveSavedPositions) {
            bgpHierarchicalLayout(cy, allNodes, allEdges, false);
            cy.fit();
            cy.zoom(0.8);
            cy.center();
        } else {
            cy.nodes().forEach(node => {
                const pos = savedData.positions[node.id()];
                if (pos) node.position(pos);
                node.data('locked', savedData.lockedNodes?.[node.id()] || false);
            });
            cy.fit();
            cy.zoom(0.8);
            cy.center();
        }

        return cy;
    } catch (error) {
        console.error("Error al inicializar el grafo:", error);
        loadingElement.textContent = `Error: ${error.message}. Intenta recargar.`;
        throw error;
    } finally {
        setTimeout(() => (loadingElement.style.display = "none"), 3000);
    }
};

export const updateEdgeLabels = (cy) => {
    cy.edges("[!invisible][type!='hierarchical']").forEach(edge => {
        const sourceIp = cy.getElementById(edge.data("source")).data("ip") || "N/A";
        const targetIp = cy.getElementById(edge.data("target")).data("ip") || "N/A";
        if (sourceIp === "N/A" || targetIp === "N/A") {
            console.warn(`Advertencia: Falta IP en enlace ${edge.id()}`);
        }
        edge.style({
            "source-label": `.${getHostNumber(sourceIp)}`,
            "target-label": `.${getHostNumber(targetIp)}`,
            "font-size": 10,
            "color": "#00008B",
            "text-background-color": "#FFFFFF",
            "text-background-opacity": 0.9,
            "text-background-padding": 2,
        });
    });
};

export const updateLegend = (cy) => {
    const legendItems = document.querySelectorAll(".legend-item");
    legendItems[0].querySelector(".legend-color").style.backgroundColor = cy.nodes("[!parent]").style("background-color") || CONFIG.DEFAULT_COLORS.AS;
    legendItems[1].querySelector(".legend-color").style.backgroundColor = cy.nodes("[parent][!type]").style("background-color") || CONFIG.DEFAULT_COLORS.ROUTER;
    legendItems[2].querySelector(".legend-color").style.backgroundColor = cy.nodes("[type='interface']").style("background-color") || CONFIG.DEFAULT_COLORS.INTERFACE;
    legendItems[3].querySelector(".legend-color").style.backgroundColor = cy.edges("[!invisible]").style("line-color") || CONFIG.DEFAULT_COLORS.EDGE;
};

const getHostNumber = (ip) => {
    if (!ip || typeof ip !== "string") return "N/A";
    const parts = ip.split(".");
    return parts.length >= 4 ? parts[3].split("/")[0] : "N/A";
};