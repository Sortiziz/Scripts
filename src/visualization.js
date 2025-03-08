import { log, CONFIG, rgbToHex } from './utils.js';
import { validateGraphData, loadData, generateInterfaceNodes, transformEdges, addHierarchicalEdges } from './data.js';

/**
 * Inicializa el grafo de visualización usando Cytoscape.
 * @returns {Promise<cytoscape.Core>} Una instancia de Cytoscape inicializada.
 * @throws {Error} Si falla la carga de datos o la inicialización.
 */
export const initializeGraph = async () => {
    if (typeof cytoscape === "undefined") {
        throw new Error("Cytoscape no está cargado. Verifica la inclusión del script.");
    }
    const loadingElement = document.getElementById("loading");
    loadingElement.style.display = "block";
    try {
        const response = await fetch("bgp_graph.json", { cache: "no-store" })
            .catch(error => {
                throw new Error(`Error de red al cargar bgp_graph.json: ${error.message}`);
            });
        if (!response.ok) {
            throw new Error(`Error al cargar bgp_graph.json: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();

        validateGraphData(data);
        const interfaceNodes = generateInterfaceNodes(data.nodes);
        const allNodes = loadData(data.nodes.concat(interfaceNodes), data.edges);
        const transformedEdges = transformEdges(data.edges, interfaceNodes);
        const allEdges = addHierarchicalEdges(allNodes, transformedEdges);

        const cy = cytoscape({
            container: document.getElementById("cy"),
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

        // Solo aplicar cose si no hay posiciones guardadas
        const allNodesHaveSavedPositions = allNodes.every(node => {
            const savedData = JSON.parse(localStorage.getItem("bgpNodeData") || "{}");
            return savedData.positions?.[node.data.id]?.x && savedData.positions?.[node.data.id]?.y;
        });
        if (!allNodesHaveSavedPositions) {
            cy.layout({
                name: "cose",
                fit: true,
                padding: 30,
                animate: true,
                idealEdgeLength: edge => {
                    if (edge.data("type") === "router-interface") return 10;
                    if (edge.data("weight")) return 350; // Mantenido en 350
                    return 100;
                },
                nodeRepulsion: 300000, // Mantenido en 300000
                edgeElasticity: edge => edge.data("type") === "router-interface" ? 200 : 50,
            }).run();
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
 * Actualiza las etiquetas de los enlaces para mostrar las IPs de las interfaces desde el inicio.
 * @param {cytoscape.Core} cy - Instancia de Cytoscape.
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
 * @param {cytoscape.Core} cy - Instancia de Cytoscape.
 */
export const updateLegend = (cy) => {
    const legendItems = document.querySelectorAll(".legend-item");
    legendItems[0].querySelector(".legend-color").style.backgroundColor = cy.nodes("[!parent]").style("background-color") || CONFIG.DEFAULT_COLORS.AS;
    legendItems[1].querySelector(".legend-color").style.backgroundColor = cy.nodes("[parent][!type]").style("background-color") || CONFIG.DEFAULT_COLORS.ROUTER;
    legendItems[2].querySelector(".legend-color").style.backgroundColor = cy.nodes("[type='interface']").style("background-color") || CONFIG.DEFAULT_COLORS.INTERFACE;
    legendItems[3].querySelector(".legend-color").style.backgroundColor = cy.edges("[!invisible]").style("line-color") || CONFIG.DEFAULT_COLORS.EDGE;
};

// Función auxiliar para obtener la parte del host de una IP
const getHostNumber = (ip) => {
    if (!ip || typeof ip !== "string") return "N/A";
    const parts = ip.split(".");
    return parts.length >= 4 ? parts[3].split("/")[0] : "N/A";
};