import { log, CONFIG, rgbToHex, isLocalStorageAvailable } from './utils.js';
import { validateGraphData, loadData, generateInterfaceNodes, transformEdges, addHierarchicalEdges } from './data.js';

/**
 * Implementa un layout jerárquico personalizado para BGP.
 */
const bgpHierarchicalLayout = (cy, nodes, edges) => {
    const repulsionForce = 10000;
    const attractionForce = 0.05;
    const damping = 0.9;
    const maxIterations = 100;

    const nodeMap = {};
    nodes.forEach(node => {
        nodeMap[node.data.id] = { 
            pos: { x: node.position.x, y: node.position.y }, 
            vel: { x: 0, y: 0 }, 
            type: node.data.type || (node.data.parent ? 'router' : 'as') 
        };
    });

    for (let i = 0; i < maxIterations; i++) {
        // Repulsión entre nodos
        Object.keys(nodeMap).forEach(id1 => {
            Object.keys(nodeMap).forEach(id2 => {
                if (id1 === id2) return;
                const n1 = nodeMap[id1];
                const n2 = nodeMap[id2];
                const dx = n1.pos.x - n2.pos.x;
                const dy = n1.pos.y - n2.pos.y;
                const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
                const force = repulsionForce / (distance * distance);
                const fx = (dx / distance) * force;
                const fy = (dy / distance) * force;
                n1.vel.x += fx;
                n1.vel.y += n1.type === 'as' ? fy * 0.1 : fy; // Menor movimiento vertical para AS
                n2.vel.x -= fx;
                n2.vel.y -= n2.type === 'as' ? fy * 0.1 : fy;
            });
        });

        // Atracción por enlaces
        edges.forEach(edge => {
            const source = nodeMap[edge.data.source];
            const target = nodeMap[edge.data.target];
            if (!source || !target) return;
            const dx = target.pos.x - source.pos.x;
            const dy = target.pos.y - source.pos.y;
            const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const force = attractionForce * distance;
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;
            source.vel.x += fx;
            source.vel.y += source.type === 'as' ? fy * 0.1 : fy;
            target.vel.x -= fx;
            target.vel.y -= target.type === 'as' ? fy * 0.1 : fy;
        });

        // Actualizar posiciones con amortiguación
        Object.keys(nodeMap).forEach(id => {
            const node = nodeMap[id];
            node.pos.x += node.vel.x * damping;
            node.pos.y += node.vel.y * damping;
            node.vel.x *= damping;
            node.vel.y *= damping;
            // Restricciones jerárquicas
            if (node.type === 'as') node.pos.y = Math.min(node.pos.y, cy.height() * 0.25);
            else if (node.type === 'router') node.pos.y = Math.max(Math.min(node.pos.y, cy.height() * 0.55), cy.height() * 0.25);
            else node.pos.y = Math.max(node.pos.y, cy.height() * 0.55);
        });
    }

    // Aplicar posiciones finales
    cy.nodes().forEach(node => {
        const pos = nodeMap[node.id()];
        node.position({ x: pos.pos.x, y: pos.pos.y });
    });
};

/**
 * Inicializa el grafo de visualización usando Cytoscape.
 */
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
                    selector: "edge[type='router-interface']",
                    style: { 
                        "line-color": "#000", 
                        width: 2,
                        opacity: 1,
                        "curve-style": "straight",
                    },
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
                    selector: "edge[!invisible][type!='hierarchical'][type!='router-interface']",
                    style: {
                        "line-color": ele => ele.data("color") || CONFIG.DEFAULT_COLORS.EDGE,
                        width: ele => Math.min(10, Math.max(1, parseFloat(ele.data("weight")?.split("/")[1]) / 8 || 3)),
                        label: "data(weight)",
                        "font-size": 12,
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

        const savedData = isLocalStorageAvailable() ? JSON.parse(localStorage.getItem("bgpNodeData") || "{}") : {};
        const allNodesHaveSavedPositions = allNodes.every(node => savedData.positions?.[node.data.id]?.x && savedData.positions?.[node.data.id]?.y);

        if (!allNodesHaveSavedPositions) {
            bgpHierarchicalLayout(cy, allNodes, allEdges);
            cy.fit();
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

/**
 * Actualiza las etiquetas de los enlaces para mostrar las IPs de las interfaces.
 */
export const updateEdgeLabels = (cy) => {
    cy.edges("[!invisible][type!='hierarchical'][type!='router-interface']").forEach(edge => {
        const sourceIp = cy.getElementById(edge.data("source")).data("ip") || "N/A";
        const targetIp = cy.getElementById(edge.data("target")).data("ip") || "N/A";
        if (sourceIp === "N/A" || targetIp === "N/A") {
            console.warn(`Advertencia: Falta IP en enlace ${edge.id()}`);
        }
        edge.style({
            "source-label": `.${getHostNumber(sourceIp)}`,
            "target-label": `.${getHostNumber(targetIp)}`,
            "font-size": 12,
            "color": "#00008B",
            "text-background-color": "#FFFFFF",
            "text-background-opacity": 0.9,
            "text-background-padding": 2,
        });
    });
};

/**
 * Actualiza la leyenda para reflejar los colores actuales.
 */
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