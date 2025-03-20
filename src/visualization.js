import { log, CONFIG, rgbToHex, isLocalStorageAvailable } from './utils.js';
import { validateGraphData, loadData, generateInterfaceNodes, transformEdges, addHierarchicalEdges } from './data.js';

export const bgpHierarchicalLayout = (cy, nodes, edges, isRealTime = false) => {
    console.log("Ejecutando bgpHierarchicalLayout...", { isRealTime });
    console.log("Número de nodos:", nodes.length);
    console.log("Número de aristas:", edges.length);

    const asY = cy.height() * 0.15;
    const routerYRange = [cy.height() * 0.25, cy.height() * 0.45];
    const routerRadius = 120;
    const interfaceRadius = 100;
    const repulsionForce = 2000;
    const attractionForce = 0.3;
    const interfaceAttractionForce = 1.5;
    const interfaceRepulsionForce = 4000;
    const maxInterfaceDistance = 120;
    const maxIterations = isRealTime ? 100 : 500;

    const nodeMap = {};
    nodes.forEach(node => {
        const pos = node.position || { x: Math.random() * cy.width(), y: Math.random() * cy.height() };
        nodeMap[node.data.id] = {
            pos: { x: pos.x, y: pos.y },
            vel: { x: 0, y: 0 },
            type: node.data.type || (node.data.parent && !node.data.router ? 'router' : 'as'),
            router: node.data.router || null,
            parent: node.data.parent || null,
            locked: node.data.locked || false
        };
        console.log(`Nodo ${node.data.id}: Posición inicial: (${pos.x}, ${pos.y})`);
    });

    // Posicionar nodos AS
    const asNodes = nodes.filter(n => !n.data.parent && !n.data.type);
    const numAS = asNodes.length;
    const asSpacing = Math.min(400, cy.width() / (numAS + 1));
    asNodes.forEach((node, index) => {
        if (nodeMap[node.data.id].locked) return;
        const x = (cy.width() / 2 - (numAS - 1) * asSpacing / 2 + index * asSpacing);
        nodeMap[node.data.id].pos = { x, y: asY };
        console.log(`AS ${node.data.id}: Posición: (${x}, ${asY})`);
    });

    // Posicionar routers dentro de cada AS
    const routerNodes = nodes.filter(n => n.data.parent && !n.data.type);
    const asToRouters = {};
    routerNodes.forEach(node => {
        if (!asToRouters[node.data.parent]) asToRouters[node.data.parent] = [];
        asToRouters[node.data.parent].push(node);
    });
    Object.entries(asToRouters).forEach(([asId, routers]) => {
        if (!nodeMap[asId]) return;
        const asPos = nodeMap[asId].pos;
        const numRouters = routers.length;
        const baseAngle = Math.random() * 2 * Math.PI;
        const routerY = (routerYRange[0] + routerYRange[1]) / 2;
        routers.forEach((router, index) => {
            if (!nodeMap[router.data.id] || nodeMap[router.data.id].locked) return;
            const angle = baseAngle + (2 * Math.PI / numRouters) * index;
            const x = asPos.x + routerRadius * Math.cos(angle);
            const y = routerY + (routerRadius * 0.5) * Math.sin(angle);
            nodeMap[router.data.id].pos = { x, y };
            console.log(`Router ${router.data.id}: Posición: (${x}, ${y})`);
        });
    });

    // Posicionar interfaces para cada router
    const interfaceNodes = nodes.filter(n => n.data.type === "interface");
    const routerToInterfaces = {};
    interfaceNodes.forEach(node => {
        const routerId = node.data.router;
        if (!routerToInterfaces[routerId]) routerToInterfaces[routerId] = [];
        routerToInterfaces[routerId].push(node);
    });
    Object.entries(routerToInterfaces).forEach(([routerId, interfaces]) => {
        interfaces.sort((a, b) => a.data.label.localeCompare(b.data.label));
        const routerEntry = nodeMap[routerId];
        if (!routerEntry) return;
        const routerPos = routerEntry.pos;
        const numInterfaces = interfaces.length;
        interfaces.forEach((intf, index) => {
            if (!nodeMap[intf.data.id] || nodeMap[intf.data.id].locked) return;
            const angle = numInterfaces > 1 ? (2 * Math.PI / numInterfaces) * index : 0;
            const x = routerPos.x + interfaceRadius * Math.cos(angle) + (Math.random() * 20 - 10);
            const y = routerPos.y + interfaceRadius * Math.sin(angle) + (Math.random() * 20 - 10);
            nodeMap[intf.data.id].pos = { x, y };
            console.log(`Interfaz ${intf.data.id}: Posición: (${x}, ${y})`);
        });
    });

    edges = edges.filter(edge => nodeMap[edge.data.source] && nodeMap[edge.data.target]);
    console.log("Aristas después de filtrar:", edges);

    for (let i = 0; i < maxIterations; i++) {
        Object.keys(nodeMap).forEach(id1 => {
            Object.keys(nodeMap).forEach(id2 => {
                if (id1 === id2 || nodeMap[id1].locked || nodeMap[id2].locked) return;
                const n1 = nodeMap[id1];
                const n2 = nodeMap[id2];
                const dx = n1.pos.x - n2.pos.x;
                const dy = n1.pos.y - n2.pos.y;
                const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
                const force = (n1.type === "interface" && n2.type === "interface")
                    ? interfaceRepulsionForce
                    : repulsionForce;
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
            const router = nodeMap[intf.data.router];
            if (!router || intfNode.locked) return;
            const dx = router.pos.x - intfNode.pos.x;
            const dy = router.pos.y - intfNode.pos.y;
            const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const force = interfaceAttractionForce * distance;
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;
            intfNode.vel.x += fx;
            intfNode.vel.y += fy;

            if (distance > maxInterfaceDistance) {
                const scale = maxInterfaceDistance / distance;
                intfNode.pos.x = router.pos.x + dx * scale;
                intfNode.pos.y = router.pos.y + dy * scale;
            }
        });

        Object.keys(nodeMap).forEach(id => {
            const node = nodeMap[id];
            if (node.locked) return;
            node.pos.x += node.vel.x * 0.9;
            node.pos.y += node.vel.y * 0.9;
            node.vel.x *= 0.9;
            node.vel.y *= 0.9;

            // Asegurarse de que los nodos estén dentro del área visible
            node.pos.x = Math.max(0, Math.min(cy.width(), node.pos.x));
            node.pos.y = Math.max(0, Math.min(cy.height(), node.pos.y));
        });
    }

    const reorderToMinimizeCrossings = () => {
        Object.entries(asToRouters).forEach(([asId, routers]) => {
            if (!nodeMap[asId]) return;
            const routerConnectivity = routers.map(r => ({
                node: r,
                connections: edges.filter(e => e.data.source === r.data.id || e.data.target === r.data.id).length
            }));
            routerConnectivity.sort((a, b) => b.connections - a.connections);
            const asPos = nodeMap[asId].pos;
            const numRouters = routers.length;
            const baseAngle = Math.random() * 2 * Math.PI;
            routerConnectivity.forEach((r, index) => {
                if (!nodeMap[r.node.data.id] || nodeMap[r.node.data.id].locked) return;
                const angle = baseAngle + (2 * Math.PI / numRouters) * index;
                const x = asPos.x + routerRadius * Math.cos(angle);
                const y = routerYRange[0] + (routerYRange[1] - routerYRange[0]) * Math.sin(angle);
                nodeMap[r.node.data.id].pos = { x, y };
                console.log(`Router ${r.node.data.id} (reordenado): Posición: (${x}, ${y})`);
            });
        });

        Object.entries(routerToInterfaces).forEach(([routerId, interfaces]) => {
            if (!nodeMap[routerId]) return;
            const routerPos = nodeMap[routerId].pos;
            const numInterfaces = interfaces.length;
            interfaces.forEach((intf, index) => {
                if (!nodeMap[intf.data.id] || nodeMap[intf.data.id].locked) return;
                const angle = numInterfaces > 1 ? (2 * Math.PI / numInterfaces) * index : 0;
                const x = routerPos.x + interfaceRadius * Math.cos(angle) + (Math.random() * 20 - 10);
                const y = routerPos.y + interfaceRadius * Math.sin(angle) + (Math.random() * 20 - 10);
                nodeMap[intf.data.id].pos = { x, y };
                console.log(`Interfaz ${intf.data.id} (reordenado): Posición: (${x}, ${y})`);
            });
        });
    };
    reorderToMinimizeCrossings();

    cy.startBatch();
    cy.nodes().forEach(node => {
        const nm = nodeMap[node.id()];
        if (nm) {
            node.position({ x: nm.pos.x, y: nm.pos.y });
            console.log(`Nodo ${node.id()} (final): Posición: (${nm.pos.x}, ${nm.pos.y})`);
        }
    });
    cy.endBatch();
};

export const initializeGraph = async () => {
    if (typeof cytoscape === "undefined") {
        throw new Error("Cytoscape no está cargado.");
    }
    const loadingElement = document.getElementById("loading");
    loadingElement.style.display = "block";
    try {
        const response = await fetch("bgp_graph.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        console.log("Datos cargados de bgp_graph.json:", data);

        validateGraphData(data);
        const interfaceNodes = generateInterfaceNodes(data.nodes);
        console.log("Nodos de interfaz generados:", interfaceNodes);

        const cyContainer = document.getElementById("cy");
        if (!cyContainer) {
            throw new Error("Contenedor #cy no encontrado en el DOM.");
        }
        console.log("Dimensiones del contenedor #cy:", { width: cyContainer.offsetWidth, height: cyContainer.offsetHeight });

        const allNodes = loadData(data.nodes.concat(interfaceNodes), data.edges, cyContainer);
        console.log("Todos los nodos después de loadData:", allNodes);

        const transformedEdges = transformEdges(data.edges, interfaceNodes);
        console.log("Aristas transformadas:", transformedEdges);

        const allEdges = addHierarchicalEdges(allNodes, transformedEdges);
        console.log("Todas las aristas después de addHierarchicalEdges:", allEdges);

        const cy = cytoscape({
            container: cyContainer,
            elements: { nodes: allNodes, edges: allEdges },
            style: [
                {
                    selector: "node[!parent]",
                    style: { 
                        "background-color": CONFIG.DEFAULT_COLORS.AS || "#ddd", // Asegurar un color visible
                        shape: "rectangle", 
                        label: "data(label)", 
                        "font-size": 16, 
                        padding: 75, 
                        "border-width": 2, 
                        "border-style": "dashed", 
                        width: CONFIG.AS_SIZE.width || 150, 
                        height: CONFIG.AS_SIZE.height || 100,
                        opacity: 1 // Asegurar visibilidad
                    }
                },
                {
                    selector: "node[parent][!type]",
                    style: { 
                        "background-color": CONFIG.DEFAULT_COLORS.ROUTER || "#ffaa00", // Asegurar un color visible
                        shape: "ellipse", 
                        label: "data(label)", 
                        width: 60, 
                        height: 60, 
                        "font-size": 14, 
                        "border-width": 2, 
                        "border-color": "#000",
                        opacity: 1 // Asegurar visibilidad
                    }
                },
                {
                    selector: "node[type='interface']",
                    style: { 
                        "background-color": CONFIG.DEFAULT_COLORS.INTERFACE || "#00ff00", // Asegurar un color visible
                        shape: "ellipse", 
                        label: ele => `${ele.data("router")}-${ele.data("label")}`, 
                        width: 8, 
                        height: 8, 
                        "font-size": 6, 
                        "border-width": 0.5, 
                        "border-color": "#000",
                        "text-valign": "center",
                        "text-halign": "center",
                        opacity: 1 // Asegurar visibilidad
                    }
                },
                { 
                    selector: "edge[type='hierarchical']", 
                    style: { 
                        "line-color": "#000", 
                        opacity: 0, 
                        "curve-style": "straight" 
                    } 
                },
                { 
                    selector: "edge[type='router-connection']", 
                    style: { 
                        "line-color": "#888", 
                        opacity: 0.5, 
                        "curve-style": "straight",
                        width: 1 
                    } 
                },
                {
                    selector: "edge[weight]",
                    style: {
                        "line-color": ele => ele.data("color") || CONFIG.DEFAULT_COLORS.EDGE || "#000", // Asegurar un color visible
                        width: ele => Math.min(10, Math.max(1, (parseFloat(ele.data("weight")?.split("/")[1]) || 3) / 8)),
                        label: "data(weight)",
                        "font-size": 10,
                        "text-background-color": "#FFFFFF",
                        "text-background-opacity": 0.9,
                        "text-background-padding": 2,
                        "curve-style": "bezier",
                        opacity: 1 // Asegurar visibilidad
                    }
                }
            ],
            layout: { name: "preset", fit: false, padding: 50 }
        });

        const savedData = isLocalStorageAvailable() ? JSON.parse(localStorage.getItem("bgpNodeData") || "{}") : {};
        if (!Object.keys(savedData).length) {
            bgpHierarchicalLayout(cy, allNodes, allEdges, false);
        } else {
            cy.nodes().forEach(node => {
                const pos = savedData.positions?.[node.id()];
                if (pos) node.position(pos);
                node.data('locked', savedData.lockedNodes?.[node.id()] || false);
            });
        }

        cy.layout({ name: 'preset' }).run();
        cy.fit();
        cy.zoom(1.0);
        cy.center();

        // Verificar que los nodos sean visibles después del layout
        cy.nodes().forEach(node => {
            console.log(`Nodo ${node.id()} después del layout: Posición: (${node.position().x}, ${node.position().y}), Visible: ${node.visible()}`);
        });

        return cy;
    } catch (error) {
        console.error("Error al inicializar el grafo:", error);
        loadingElement.textContent = `Error: ${error.message}.`;
        throw error;
    } finally {
        setTimeout(() => (loadingElement.style.display = "none"), 3000);
    }
};

export const updateEdgeLabels = (cy) => {
    cy.edges("[!invisible][type!='hierarchical']").forEach(edge => {
        const source = cy.getElementById(edge.data("source"));
        const target = cy.getElementById(edge.data("target"));
        if (!source.length || !target.length) return;
        const sourceIp = source.data("ip") || "N/A";
        const targetIp = target.data("ip") || "N/A";
        edge.style({
            "source-label": `.${getHostNumber(sourceIp)}`,
            "target-label": `.${getHostNumber(targetIp)}`,
            "font-size": 10,
            "color": "#00008B",
            "text-background-color": "#FFFFFF",
            "text-background-opacity": 0.9,
            "text-background-padding": 2
        });
    });
};

export const updateLegend = (cy) => {
    const legendItems = document.querySelectorAll(".legend-item");
    legendItems[0].querySelector(".legend-color").style.backgroundColor = CONFIG.DEFAULT_COLORS.AS || "#ddd";
    legendItems[1].querySelector(".legend-color").style.backgroundColor = CONFIG.DEFAULT_COLORS.ROUTER || "#ffaa00";
    legendItems[2].querySelector(".legend-color").style.backgroundColor = CONFIG.DEFAULT_COLORS.INTERFACE || "#00ff00";
    legendItems[3].querySelector(".legend-color").style.backgroundColor = CONFIG.DEFAULT_COLORS.EDGE || "#000";
};

const getHostNumber = (ip) => {
    if (!ip || typeof ip !== "string") return "N/A";
    const parts = ip.split(".");
    return parts.length >= 4 ? parts[3].split("/")[0] : "N/A";
};