/**
 * @fileoverview Graph visualization functions for BGP network display.
 * Includes layout algorithms and graph initialization.
 */

import { log, CONFIG, rgbToHex, isLocalStorageAvailable, getHostNumber } from './utils.js';
import { validateGraphData, loadData, generateInterfaceNodes, transformEdges, addHierarchicalEdges } from './data.js';
import { getCytoscape } from './lib-imports.js';

/**
 * Custom hierarchical layout algorithm for BGP networks.
 * Positions ASes at the top, routers in the middle, and interfaces around routers.
 * 
 * @param {Object} cy - Cytoscape instance
 * @param {Array} nodes - Array of node objects
 * @param {Array} edges - Array of edge objects
 * @param {boolean} [isRealTime=false] - Whether layout is being updated in real-time
 */
export const bgpHierarchicalLayout = async (cy, nodes, edges, isRealTime = false) => {
    log("Ejecutando bgpHierarchicalLayout...", { isRealTime });
    log("Número de nodos:", nodes.length);
    log("Número de aristas:", edges.length);

    // Eliminamos la opción de usar cose-bilkent debido a problemas de compatibilidad

    // Layout parameters
    const asY = cy.height() * 0.15;
    const routerYRange = [cy.height() * 0.25, cy.height() * 0.45];
    const routerRadius = 120;
    const interfaceRadius = 100;
    const repulsionForce = 2000;
    const attractionForce = 0.3;
    const interfaceAttractionForce = 1.5;
    const interfaceRepulsionForce = 4000;
    const maxInterfaceDistance = 120;
    const maxIterations = isRealTime 
        ? (nodes.length < 30 ? CONFIG.MAX_ITERATIONS.REAL_TIME / 2 : CONFIG.MAX_ITERATIONS.REAL_TIME) 
        : CONFIG.MAX_ITERATIONS.DEFAULT;

    // Create node map for tracking positions and velocities
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
        log(`Nodo ${node.data.id}: Posición inicial: (${pos.x}, ${pos.y})`);
    });

    // Position AS nodes at the top
    const asNodes = nodes.filter(n => !n.data.parent && !n.data.type);
    const numAS = asNodes.length;
    const asSpacing = Math.min(400, cy.width() / (numAS + 1));
    asNodes.forEach((node, index) => {
        if (nodeMap[node.data.id].locked) return;
        const x = (cy.width() / 2 - (numAS - 1) * asSpacing / 2 + index * asSpacing);
        nodeMap[node.data.id].pos = { x, y: asY };
        log(`AS ${node.data.id}: Posición: (${x}, ${asY})`);
    });

    // Position router nodes below their parent AS
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
            log(`Router ${router.data.id}: Posición: (${x}, ${y})`);
        });
    });

    // Position interface nodes around their parent router
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
            log(`Interfaz ${intf.data.id}: Posición: (${x}, ${y})`);
        });
    });

    // Filter edges to ensure source and target nodes exist
    edges = edges.filter(edge => nodeMap[edge.data.source] && nodeMap[edge.data.target]);
    log("Aristas después de filtrar:", edges);

    // Run force-directed layout iterations
    for (let i = 0; i < maxIterations; i++) {
        // Apply repulsion forces between nodes
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

        // Apply attraction forces between connected nodes
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

        // Apply special forces for interface nodes
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

            // Limit maximum distance between interface and router
            if (distance > maxInterfaceDistance) {
                const scale = maxInterfaceDistance / distance;
                intfNode.pos.x = router.pos.x + dx * scale;
                intfNode.pos.y = router.pos.y + dy * scale;
            }
        });

        // Update positions and apply dampening
        Object.keys(nodeMap).forEach(id => {
            const node = nodeMap[id];
            if (node.locked) return;
            node.pos.x += node.vel.x * 0.9;
            node.pos.y += node.vel.y * 0.9;
            node.vel.x *= 0.9;
            node.vel.y *= 0.9;

            // Ensure nodes stay within canvas bounds
            node.pos.x = Math.max(0, Math.min(cy.width(), node.pos.x));
            node.pos.y = Math.max(0, Math.min(cy.height(), node.pos.y));
        });
    }

    /**
     * Helper function to reorder nodes to minimize edge crossings
     */
    const reorderToMinimizeCrossings = () => {
        // Reorder routers by connectivity
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
                log(`Router ${r.node.data.id} (reordenado): Posición: (${x}, ${y})`);
            });
        });

        // Reorder interfaces around routers
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
                log(`Interfaz ${intf.data.id} (reordenado): Posición: (${x}, ${y})`);
            });
        });
    };
    
    reorderToMinimizeCrossings();

    // Update node positions in Cytoscape
    cy.startBatch();
    cy.nodes().forEach(node => {
        const nm = nodeMap[node.id()];
        if (nm) {
            node.position({ x: nm.pos.x, y: nm.pos.y });
            log(`Nodo ${node.id()} (final): Posición: (${nm.pos.x}, ${nm.pos.y})`);
        }
    });
    cy.endBatch();
};

/**
 * Initialize the network graph and render it.
 * 
 * @returns {Promise<Object>} Promise resolving to the Cytoscape instance
 */
export const initializeGraph = async () => {
    try {
        // Obtener la instancia de Cytoscape
        const cytoscape = await getCytoscape();
        if (!cytoscape) {
            throw new Error("Cytoscape no está cargado correctamente.");
        }
        
        const loadingElement = document.getElementById("loading");
        loadingElement.style.display = "block";
        
        // Load graph data
        const response = await fetch("bgp_graph.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        log("Datos cargados de bgp_graph.json:", data);

        // Validate and prepare data
        validateGraphData(data);
        const interfaceNodes = generateInterfaceNodes(data.nodes);
        log("Nodos de interfaz generados:", interfaceNodes);

        const cyContainer = document.getElementById("cy");
        if (!cyContainer) {
            throw new Error("Contenedor #cy no encontrado en el DOM.");
        }
        log("Dimensiones del contenedor #cy:", { width: cyContainer.offsetWidth, height: cyContainer.offsetHeight });

        const allNodes = loadData(data.nodes.concat(interfaceNodes), data.edges, cyContainer);
        log("Todos los nodos después de loadData:", allNodes);

        const transformedEdges = transformEdges(data.edges, interfaceNodes);
        log("Aristas transformadas:", transformedEdges);

        const allEdges = addHierarchicalEdges(allNodes, transformedEdges);
        log("Todas las aristas después de addHierarchicalEdges:", allEdges);

        // Create Cytoscape instance
        const cy = cytoscape({
            container: cyContainer,
            elements: { nodes: allNodes, edges: allEdges },
            style: [
                {
                    selector: "node[!parent]",
                    style: { 
                        "background-color": CONFIG.DEFAULT_COLORS.AS || "#ddd",
                        shape: "rectangle", 
                        label: "data(label)", 
                        "font-size": 16, 
                        padding: 75, 
                        "border-width": 2, 
                        "border-style": "dashed", 
                        width: CONFIG.AS_SIZE.width || 150, 
                        height: CONFIG.AS_SIZE.height || 100,
                        opacity: 1
                    }
                },
                {
                    selector: "node[parent][!type]",
                    style: { 
                        "background-color": CONFIG.DEFAULT_COLORS.ROUTER || "#ffaa00",
                        shape: "ellipse", 
                        label: "data(label)", 
                        width: 60, 
                        height: 60, 
                        "font-size": 14, 
                        "border-width": 2, 
                        "border-color": "#000",
                        opacity: 1
                    }
                },
                {
                    selector: "node[type='interface']",
                    style: { 
                        "background-color": CONFIG.DEFAULT_COLORS.INTERFACE || "#00ff00",
                        shape: "ellipse", 
                        label: ele => `${ele.data("router")}-${ele.data("label")}`, 
                        width: 5,
                        height: 5, 
                        "font-size": 4,
                        "border-width": 0.5, 
                        "border-color": "#000",
                        "text-valign": "center",
                        "text-halign": "center",
                        opacity: 1,
                        "min-zoomed-font-size": 2
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
                        "line-color": ele => ele.data("color") || CONFIG.DEFAULT_COLORS.EDGE || "#000",
                        width: ele => Math.min(10, Math.max(1, (parseFloat(ele.data("weight")?.split("/")[1]) || 3) / 8)),
                        label: "data(weight)",
                        "font-size": 10,
                        "text-background-color": "#FFFFFF",
                        "text-background-opacity": 0.9,
                        "text-background-padding": 2,
                        "curve-style": "bezier",
                        opacity: 1
                    }
                }
            ],
            layout: { name: "preset", fit: false, padding: 50 }
        });

        // Apply saved positions or use layout algorithm
        const savedData = isLocalStorageAvailable() ? JSON.parse(localStorage.getItem("bgpNodeData") || "{}") : {};
        if (!Object.keys(savedData).length) {
            // Usamos el layout personalizado sin cose-bilkent
            await bgpHierarchicalLayout(cy, allNodes, allEdges, false);
        } else {
            cy.nodes().forEach(node => {
                const pos = savedData.positions?.[node.id()];
                if (pos) node.position(pos);
                node.data('locked', savedData.lockedNodes?.[node.id()] || false);
            });
        }

        // Finalize layout
        cy.layout({ name: 'preset' }).run();
        cy.fit();
        cy.zoom(0.8);
        cy.center();

        cy.nodes().forEach(node => {
            log(`Nodo ${node.id()} después del layout: Posición: (${node.position().x}, ${node.position().y}), Visible: ${node.visible()}`);
        });

        return cy;
    } catch (error) {
        log("Error al inicializar el grafo:", error);
        const loadingElement = document.getElementById("loading");
        if (loadingElement) {
            loadingElement.textContent = `Error: ${error.message}.`;
        }
        throw error;
    } finally {
        const loadingElement = document.getElementById("loading");
        if (loadingElement) {
            setTimeout(() => (loadingElement.style.display = "none"), 3000);
        }
    }
};

/**
 * Updates edge labels with IP address information.
 * 
 * @param {Object} cy - Cytoscape instance
 */
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

/**
 * Updates the legend colors based on current configuration.
 * 
 * @param {Object} cy - Cytoscape instance (unused but kept for API consistency)
 */
export const updateLegend = (cy) => {
    const legendItems = document.querySelectorAll(".legend-item");
    legendItems[0].querySelector(".legend-color").style.backgroundColor = CONFIG.DEFAULT_COLORS.AS || "#ddd";
    legendItems[1].querySelector(".legend-color").style.backgroundColor = CONFIG.DEFAULT_COLORS.ROUTER || "#ffaa00";
    legendItems[2].querySelector(".legend-color").style.backgroundColor = CONFIG.DEFAULT_COLORS.INTERFACE || "#00ff00";
    legendItems[3].querySelector(".legend-color").style.backgroundColor = CONFIG.DEFAULT_COLORS.EDGE || "#000";
};