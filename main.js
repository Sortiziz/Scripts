// Constantes y configuraciones
const DEBUG = true;
const log = (...args) => DEBUG && console.log(...args);
let cy;

// Utilidades
const getRandomPosition = () => ({
    x: Math.floor(Math.random() * 800) + 100,
    y: Math.floor(Math.random() * 600) + 100,
});

const rgbToHex = (rgb) => {
    if (!rgb || typeof rgb !== "string") return "#ddd";
    const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!match) return "#ddd";
    const [_, r, g, b] = match;
    return `#${[r, g, b].map(x => parseInt(x).toString(16).padStart(2, "0")).join("")}`;
};

const getHostNumber = (ip) => {
    if (!ip || typeof ip !== "string") return "N/A";
    const parts = ip.split(".");
    return parts.length >= 4 ? parts[3].split("/")[0] : "N/A";
};

// Validación de datos
const validateGraphData = (data) => {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
        throw new Error("Formato de bgp_graph.json inválido");
    }
    const nodeIds = new Set(data.nodes.map(n => n.data.id));
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
    });
    log("Datos validados:", { nodes: data.nodes.length, edges: data.edges.length });
    return true;
};

// Procesamiento de datos
const generateInterfaceNodes = (nodes) => {
    const interfaceNodes = [];
    nodes.forEach(node => {
        if (node.data.interfaces) {
            const routerId = node.data.id;
            const parent = node.data.parent;
            Object.entries(node.data.interfaces).forEach(([intfName, ip]) => {
                const intfId = `${routerId}_${intfName}`;
                interfaceNodes.push({
                    data: { id: intfId, label: intfName, type: "interface", router: routerId, ip, parent, color: "#FFA500" },
                    position: null, // Posición asignada después en loadData
                });
            });
        }
    });
    return interfaceNodes;
};

const transformEdges = (edges, interfaceNodes) => {
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

const addHierarchicalEdges = (nodes, edges) => {
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

const loadData = (nodes) => {
    const savedData = JSON.parse(localStorage.getItem("bgpNodeData") || "{}");
    const nonInterfaceNodes = nodes.filter(node => node.data.type !== "interface");
    const interfaceNodes = nodes.filter(node => node.data.type === "interface");

    // Asignar posiciones iniciales explícitas para ASes y routers
    nonInterfaceNodes.forEach(node => {
        const nodeId = node.data.id;
        if (savedData.positions?.[nodeId]?.x && savedData.positions?.[nodeId]?.y) {
            node.position = { x: savedData.positions[nodeId].x, y: savedData.positions[nodeId].y };
        } else if (!node.data.parent) {
            // Posicionar ASes en coordenadas base
            const asIndex = nonInterfaceNodes.filter(n => !n.data.parent).findIndex(n => n.data.id === nodeId);
            node.position = { x: 200 + (asIndex * 300), y: 300 };
        } else {
            // Posicionar routers en el centro de sus ASes
            const parentNode = nonInterfaceNodes.find(n => !n.data.parent && n.data.id === node.data.parent);
            if (parentNode && parentNode.position) {
                node.position = { 
                    x: parentNode.position.x,
                    y: parentNode.position.y
                };
            } else {
                node.position = getRandomPosition();
            }
        }
        node.data.color = savedData.colors?.nodes?.[nodeId] || node.data.color || (node.data.parent ? "#00FF00" : "#ddd");
    });

    // Posicionar interfaces en un círculo pequeño alrededor de sus routers
    const interfacesByRouter = {};
    interfaceNodes.forEach(node => {
        const routerId = node.data.router;
        if (!interfacesByRouter[routerId]) interfacesByRouter[routerId] = [];
        interfacesByRouter[routerId].push(node);
    });

    Object.entries(interfacesByRouter).forEach(([routerId, interfaces]) => {
        const router = nonInterfaceNodes.find(n => n.data.id === routerId);
        const routerPos = router.position;
        const numInterfaces = interfaces.length;

        const radius = 10; // Radio fijo reducido a 10 píxeles
        interfaces.forEach((intfNode, index) => {
            const intfId = intfNode.data.id;
            if (savedData.positions?.[intfId]?.x && savedData.positions?.[intfId]?.y) {
                intfNode.position = { x: savedData.positions[intfId].x, y: savedData.positions[intfId].y };
            } else {
                const angle = (2 * Math.PI * index) / numInterfaces;
                intfNode.position = {
                    x: routerPos.x + radius * Math.cos(angle),
                    y: routerPos.y + radius * Math.sin(angle),
                };
            }
            intfNode.data.color = savedData.colors?.nodes?.[intfId] || intfNode.data.color || "#FFA500";
        });
    });

    return nonInterfaceNodes.concat(interfaceNodes);
};

// Visualización
const initializeGraph = async () => {
    const loadingElement = document.getElementById("loading");
    loadingElement.style.display = "block";
    try {
        const response = await fetch("bgp_graph.json");
        if (!response.ok) throw new Error(`Error al cargar bgp_graph.json: ${response.status}`);
        const data = await response.json();

        validateGraphData(data);
        const interfaceNodes = generateInterfaceNodes(data.nodes);
        const allNodes = loadData(data.nodes.concat(interfaceNodes));
        const transformedEdges = transformEdges(data.edges, interfaceNodes);
        const allEdges = addHierarchicalEdges(allNodes, transformedEdges);

        cy = cytoscape({
            container: document.getElementById("cy"),
            elements: { nodes: allNodes, edges: allEdges },
            style: [
                {
                    selector: "node[!parent]",
                    style: {
                        "background-color": ele => ele.data("color") || "#ddd",
                        shape: "rectangle",
                        label: "data(label)",
                        "text-valign": "top",
                        "text-halign": "center",
                        "font-size": 16,
                        padding: 50,
                        "border-width": 2,
                        "border-style": "dashed",
                        width: 200,
                        height: 200,
                    },
                },
                {
                    selector: "node[parent][!type]",
                    style: {
                        "background-color": ele => ele.data("color") || "#00FF00",
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
                        "background-color": ele => ele.data("color") || "#FFA500",
                        shape: "ellipse",
                        label: "data(label)",
                        width: 30,
                        height: 30,
                        "text-valign": "center",
                        "text-halign": "center",
                        "font-size": 10,
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
                        "line-color": ele => ele.data("color") || "#000",
                        width: 3,
                        label: "data(weight)",
                        "font-size": 14,
                        "text-background-color": "#FFFFFF",
                        "text-background-opacity": 0.9,
                        "text-background-padding": 3,
                        "source-label": "",
                        "target-label": "",
                        "source-text-offset": 30,
                        "target-text-offset": 30,
                        "source-text-margin-y": -10,
                        "target-text-margin-y": -10,
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
                padding: 30,
            },
        });

        // Solo aplicar cose si el usuario reinicia posiciones manualmente
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
                    if (edge.data("weight")) return 200;
                    return 100;
                },
                nodeRepulsion: 100000,
                edgeElasticity: edge => edge.data("type") === "router-interface" ? 200 : 50,
            }).run();
        }

        updateEdgeLabels(cy);
        setupInteractivity(cy);
        return cy;
    } catch (error) {
        console.error("Error al inicializar el grafo:", error);
        loadingElement.textContent = `Error: ${error.message}. Intenta recargar.`;
        throw error;
    } finally {
        setTimeout(() => (loadingElement.style.display = "none"), 3000);
    }
};

// Actualizar etiquetas de enlaces
const updateEdgeLabels = (cy) => {
    cy.edges("[!invisible][type!='hierarchical'][type!='router-interface']").forEach(edge => {
        const sourceIp = cy.getElementById(edge.data("source")).data("ip") || "N/A";
        const targetIp = cy.getElementById(edge.data("target")).data("ip") || "N/A";
        edge.style({
            "source-label": `.${getHostNumber(sourceIp)}`,
            "target-label": `.${getHostNumber(targetIp)}`,
            "font-size": 12,
            "color": "#00008B",
            "text-background-color": "#FFFFFF",
            "text-background-opacity": 0.9,
            "text-background-padding": 3,
        });
    });
};

// Interactividad
const setupInteractivity = (cy) => {
    const edgeLabelStates = new Map();
    const toggleEdgeLabel = (edge) => {
        const edgeId = edge.id();
        const state = edgeLabelStates.get(edgeId) === "full" ? "host" : "full";
        edgeLabelStates.set(edgeId, state);
        const sourceIp = cy.getElementById(edge.data("source")).data("ip") || "N/A";
        const targetIp = cy.getElementById(edge.data("target")).data("ip") || "N/A";
        edge.style({
            "source-label": state === "host" ? `.${getHostNumber(sourceIp)}` : sourceIp,
            "target-label": state === "host" ? `.${getHostNumber(targetIp)}` : targetIp,
        });
    };

    cy.edges("[!invisible][type!='hierarchical'][type!='router-interface']").on("click", evt => toggleEdgeLabel(evt.target));

    const modal = document.getElementById("color-modal");
    const applyColorBtn = document.getElementById("apply-color-btn");
    const cancelColorBtn = document.getElementById("cancel-color-btn");
    let selectedElementId = null;

    cy.on("dblclick", "node, edge[!invisible][type!='hierarchical']", evt => {
        const element = evt.target;
        const pos = element.isNode() ? element.renderedPosition() : element.renderedMidpoint();
        const modalWidth = 250, modalHeight = 180;
        const left = Math.max(0, Math.min(pos.x, cy.width() - modalWidth));
        const top = Math.max(0, Math.min(pos.y, cy.height() - modalHeight));

        modal.style.left = `${left}px`;
        modal.style.top = `${top}px`;
        modal.style.display = "block";
        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");

        selectedElementId = element.id();
        const typeLabel = document.getElementById("type-label");
        if (element.isNode()) {
            typeLabel.innerHTML = `Color para nodo: ${element.data("label")}`;
        } else {
            typeLabel.innerHTML = `Color para enlace entre ${cy.getElementById(element.data("source")).data("label")} y ${cy.getElementById(element.data("target")).data("label")}`;
        }
        const currentColor = element.isNode() ? element.style("background-color") : element.style("line-color");
        document.getElementById("color-input").value = rgbToHex(currentColor);
    });

    applyColorBtn.addEventListener("click", () => {
        if (selectedElementId) {
            const element = cy.getElementById(selectedElementId);
            const newColor = document.getElementById("color-input").value;
            if (element.isNode()) element.style("background-color", newColor);
            else element.style("line-color", newColor);
            element.data("color", newColor);
            modal.classList.remove("show");
            setTimeout(() => {
                modal.style.display = "none";
                modal.setAttribute("aria-hidden", "true");
            }, 300);
            selectedElementId = null;
        }
    });

    cancelColorBtn.addEventListener("click", () => {
        modal.classList.remove("show");
        setTimeout(() => {
            modal.style.display = "none";
            modal.setAttribute("aria-hidden", "true");
        }, 300);
        selectedElementId = null;
    });

    const popperContainer = document.getElementById("popper-container");
    const setupTooltips = () => {
        popperContainer.innerHTML = "";
        cy.nodes().forEach(node => {
            const div = document.createElement("div");
            div.style.position = "absolute";
            popperContainer.appendChild(div);
            const tip = tippy(div, {
                content: node.data("type") === "interface"
                    ? `Interfaz: ${node.data("label")}<br>Router: ${node.data("router")}<br>IP: ${node.data("ip")}`
                    : `ID: ${node.id()}<br>AS: ${node.data("parent") || "N/A"}`,
                theme: "light",
                placement: "top",
                trigger: "manual",
            });
            // Usar eventos nativos de Cytoscape en lugar de asumir jQuery
            node.on("mouseover", () => tip.show());
            node.on("mouseout", () => tip.hide());
        });
    };
    setupTooltips();

    const saveData = () => {
        const positions = {};
        const colors = { nodes: {}, edges: {} };
        cy.nodes().forEach(node => {
            positions[node.id()] = node.position();
            colors.nodes[node.id()] = rgbToHex(node.style("background-color"));
        });
        cy.edges("[!invisible][type!='hierarchical']").forEach(edge => {
            colors.edges[edge.id()] = rgbToHex(edge.style("line-color"));
        });
        localStorage.setItem("bgpNodeData", JSON.stringify({ positions, colors }));
        alert("Datos guardados correctamente.");
    };

    const resetPositions = () => {
        cy.layout({
            name: "cose",
            fit: true,
            padding: 30,
            animate: true,
            idealEdgeLength: edge => {
                if (edge.data("type") === "router-interface") return 10;
                if (edge.data("weight")) return 200;
                return 100;
            },
            nodeRepulsion: 100000,
            edgeElasticity: edge => edge.data("type") === "router-interface" ? 200 : 50,
        }).run();
    };

    const resetColors = () => {
        cy.batch(() => {
            cy.nodes("[!parent]").style("background-color", "#ddd");
            cy.nodes("[parent][!type]").style("background-color", "#00FF00");
            cy.nodes("[type='interface']").style("background-color", "#FFA500");
            cy.edges("[!invisible][type!='hierarchical']").style("line-color", "#000");
        });
        updateEdgeLabels(cy);
    };

    document.getElementById("save-btn").addEventListener("click", saveData);
    document.getElementById("reset-positions-btn").addEventListener("click", resetPositions);
    document.getElementById("reset-colors-btn").addEventListener("click", resetColors);
    document.getElementById("zoom-slider").addEventListener("input", () => cy.zoom(parseFloat(event.target.value)));
};

// Iniciar aplicación
initializeGraph().then(() => log("Grafo listo")).catch(() => log("Inicialización fallida"));