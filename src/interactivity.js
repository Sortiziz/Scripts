import { log, rgbToHex, showNotification, isLocalStorageAvailable, CONFIG, debounce } from './utils.js';
import { loadData } from './data.js';
import { bgpHierarchicalLayout, initializeGraph, updateEdgeLabels } from './visualization.js';

export const setupInteractivity = (cy) => {
    const edgeLabelStates = new Map();
    let eventIndex = 0;
    const events = [
        { type: "addNode", node: { data: { id: "R16", label: "R16", parent: "AS5", interfaces: {} }, position: null }, edge: { data: { source: "R14", target: "R16", weight: "192.168.23.0/30", status: "added" } } },
        { type: "removeEdge", edgeId: "R14_R13_192.168.18.0/30" }
    ];

    const toggleEdgeLabel = (edge) => {
        const edgeId = edge.id();
        const currentState = edgeLabelStates.get(edgeId) || "host";
        const newState = currentState === "full" ? "host" : "full";
        edgeLabelStates.set(edgeId, newState);
        const sourceIp = cy.getElementById(edge.data("source")).data("ip") || "N/A";
        const targetIp = cy.getElementById(edge.data("target")).data("ip") || "N/A";
        edge.style({
            "source-label": newState === "host" ? `.${getHostNumber(sourceIp)}` : sourceIp,
            "target-label": newState === "host" ? `.${getHostNumber(targetIp)}` : targetIp,
            "font-size": 10,
            "color": "#00008B",
            "text-background-color": "#FFFFFF",
            "text-background-opacity": 0.9,
            "text-background-padding": 3,
        });
    };

    cy.edges("[!invisible][type!='hierarchical']").on("click", evt => {
        toggleEdgeLabel(evt.target);
    });

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
        modal.focus();

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
            if (element.isNode()) {
                element.style("background-color", newColor);
            } else {
                element.style("line-color", newColor);
            }
            element.data("color", newColor);
            modal.classList.remove("show");
            setTimeout(() => {
                modal.style.display = "none";
                modal.setAttribute("aria-hidden", "true");
            }, 300);
            selectedElementId = null;
            showNotification("Color aplicado correctamente.");
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
        cy.nodes().forEach(node => {
            let tip;
            const connections = cy.edges().filter(e => e.data("source") === node.id() || e.data("target") === node.id()).length;
            node.on("mouseover", () => {
                if (!tip) {
                    const div = document.createElement("div");
                    div.style.position = "absolute";
                    popperContainer.appendChild(div);
                    tip = tippy(div, {
                        content: node.data("type") === "interface"
                            ? `Interfaz: ${node.data("label")}<br>Router: ${node.data("router")}<br>IP: ${node.data("ip")}<br>Conexiones: ${connections}`
                            : `ID: ${node.id()}<br>AS: ${node.data("parent") || "N/A"}<br>Conexiones: ${connections}`,
                        theme: "light",
                        placement: "top",
                        trigger: "manual",
                    });
                }
                tip.show();
            });
            node.on("mouseout", () => tip?.hide());
        });
    };
    setupTooltips();

    cy.nodes().on('drag', evt => {
        const node = evt.target;
        node.data('locked', true);
    });

    const saveData = () => {
        if (!isLocalStorageAvailable()) {
            showNotification("No se puede guardar: localStorage no disponible", "error");
            return;
        }
        const positions = {};
        const colors = { nodes: {}, edges: {} };
        const lockedNodes = {};
        cy.nodes().forEach(node => {
            positions[node.id()] = node.position();
            colors.nodes[node.id()] = rgbToHex(node.style("background-color"));
            lockedNodes[node.id()] = node.data('locked') || false;
        });
        cy.edges("[!invisible][type!='hierarchical']").forEach(edge => {
            colors.edges[edge.id()] = rgbToHex(edge.style("line-color"));
        });
        localStorage.setItem("bgpNodeData", JSON.stringify({ positions, colors, lockedNodes }));
        showNotification("Datos guardados correctamente.");
    };

    const resetPositions = () => {
        console.log("Iniciando resetPositions...");
        localStorage.removeItem("bgpNodeData");
        const nodes = cy.nodes().map(node => ({
            data: node.data(),
            position: null
        }));
        const edges = cy.edges().map(edge => ({ data: edge.data() }));
        console.log("Nodos antes de loadData:", nodes.map(n => ({ id: n.data.id, position: n.position })));
        const newNodes = loadData(nodes, edges, cy.container());
        console.log("Nodos después de loadData:", newNodes.map(n => ({ id: n.data.id, position: n.position })));
        cy.reset();
        cy.batch(() => {
            newNodes.forEach(newNode => {
                const node = cy.getElementById(newNode.data.id);
                node.position(newNode.position);
                node.data('defaultPosition', newNode.position);
                node.data('locked', false);
            });
        });
        console.log("Nodos después de aplicar posiciones:", cy.nodes().map(n => ({ id: n.id(), position: n.position() })));
        bgpHierarchicalLayout(cy, newNodes, edges, false);
        console.log("Nodos después de bgpHierarchicalLayout:", cy.nodes().map(n => ({ id: n.id(), position: n.position() })));
        cy.layout({ name: 'preset' }).run();
        cy.resize();
        cy.fit();
        cy.zoom(0.8);
        cy.center();
        showNotification("Posiciones recalculadas y optimizadas.");
        console.log("resetPositions completado.");
    };

    const timeSliderContainer = document.createElement("div");
    timeSliderContainer.style.marginTop = "10px";
    const timeSliderLabel = document.createElement("label");
    timeSliderLabel.setAttribute("for", "time-slider");
    timeSliderLabel.textContent = "Evento: ";
    const timeSlider = document.createElement("input");
    timeSlider.type = "range";
    timeSlider.id = "time-slider";
    timeSlider.min = "0";
    timeSlider.max = events.length.toString();
    timeSlider.value = "0";
    timeSlider.step = "1";
    timeSlider.style.width = "200px";
    timeSliderContainer.appendChild(timeSliderLabel);
    timeSliderContainer.appendChild(timeSlider);
    document.getElementById("controls").appendChild(timeSliderContainer);

    timeSlider.addEventListener("input", (event) => {
        const newIndex = parseInt(event.target.value);
        if (newIndex === eventIndex) return;

        if (newIndex > eventIndex) {
            for (let i = eventIndex; i < newIndex; i++) {
                const evt = events[i];
                if (evt.type === "addNode") {
                    const newNode = { data: evt.node.data, position: evt.node.position };
                    const newEdge = { data: evt.edge.data };
                    cy.add([newNode, newEdge]);
                    const updatedNodes = cy.nodes().map(n => ({ data: n.data(), position: n.position() }));
                    const updatedEdges = cy.edges().map(e => ({ data: e.data() }));
                    bgpHierarchicalLayout(cy, updatedNodes, updatedEdges, true);
                    showNotification(`Añadido nodo ${evt.node.data.id} y conexión.`);
                } else if (evt.type === "removeEdge") {
                    const edge = cy.edges().filter(e => e.id() === evt.edgeId)[0];
                    if (edge) {
                        edge.data('status', 'removed');
                        setTimeout(() => cy.remove(edge), 1000);
                    }
                    const updatedNodes = cy.nodes().map(n => ({ data: n.data(), position: n.position() }));
                    const updatedEdges = cy.edges().map(e => ({ data: e.data() }));
                    bgpHierarchicalLayout(cy, updatedNodes, updatedEdges, true);
                    showNotification(`Eliminada conexión ${evt.edgeId}.`);
                }
            }
        } else {
            cy.elements().remove();
            initializeGraph().then(newCy => {
                cy.add(newCy.elements());
                for (let i = 0; i < newIndex; i++) {
                    const evt = events[i];
                    if (evt.type === "addNode") {
                        const newNode = { data: evt.node.data, position: evt.node.position };
                        const newEdge = { data: evt.edge.data };
                        cy.add([newNode, newEdge]);
                    }
                }
                const updatedNodes = cy.nodes().map(n => ({ data: n.data(), position: n.position() }));
                const updatedEdges = cy.edges().map(e => ({ data: e.data() }));
                bgpHierarchicalLayout(cy, updatedNodes, updatedEdges, true);
                cy.fit();
                cy.zoom(0.8);
                cy.center();
                showNotification("Grafo restaurado al evento seleccionado.");
            });
        }
        eventIndex = newIndex;
        updateEdgeLabels(cy);
    });

    const resetColors = () => {
        cy.batch(() => {
            cy.nodes("[!parent]").style("background-color", CONFIG.DEFAULT_COLORS.AS);
            cy.nodes("[parent][!type]").style("background-color", CONFIG.DEFAULT_COLORS.ROUTER);
            cy.nodes("[type='interface']").style("background-color", CONFIG.DEFAULT_COLORS.INTERFACE);
            cy.edges("[!invisible][type!='hierarchical']").style("line-color", CONFIG.DEFAULT_COLORS.EDGE);
        });
        showNotification("Colores reseteados.");
    };

    document.getElementById("save-btn").addEventListener("click", saveData);
    document.getElementById("reset-positions-btn").addEventListener("click", resetPositions);
    document.getElementById("reset-colors-btn").addEventListener("click", resetColors);
    document.getElementById("zoom-slider").addEventListener("input", (event) => {
        const zoomValue = parseFloat(event.target.value);
        requestAnimationFrame(() => {
            cy.zoom(zoomValue);
        });
    });

    document.getElementById("export-btn").addEventListener("click", () => {
        if (!isLocalStorageAvailable()) {
            showNotification("No se puede exportar: localStorage no disponible", "error");
            return;
        }
        const data = JSON.parse(localStorage.getItem("bgpNodeData") || "{}");
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "bgp_config.json";
        a.click();
        URL.revokeObjectURL(url);
        showNotification("Configuración exportada.");
    });

    document.getElementById("import-btn").addEventListener("click", () => {
        document.getElementById("import-input").click();
    });

    document.getElementById("import-input").addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (isLocalStorageAvailable()) {
                        localStorage.setItem("bgpNodeData", JSON.stringify(data));
                        showNotification("Configuración importada. Recarga la página para aplicar los cambios.");
                    } else {
                        showNotification("No se puede importar: localStorage no disponible", "error");
                    }
                } catch (error) {
                    showNotification(`Error al importar: ${error.message}`, "error");
                }
            };
            reader.readAsText(file);
        }
    });

    document.getElementById("cy").addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const pan = cy.pan();
            const step = 50;
            if (event.key === "ArrowRight") cy.pan({ x: pan.x - step, y: pan.y });
            if (event.key === "ArrowLeft") cy.pan({ x: pan.x + step, y: pan.y });
            if (event.key === "ArrowUp") cy.pan({ x: pan.x, y: pan.y + step });
            if (event.key === "ArrowDown") cy.pan({ x: pan.x, y: pan.y - step });
        }
    });
};

export const setupSearchAndFilter = (cy) => {
    const searchInput = document.getElementById("search-input");
    const filterType = document.getElementById("filter-type");

    searchInput.addEventListener("input", debounce(() => {
        const query = searchInput.value.toLowerCase();
        cy.nodes().forEach(node => {
            const label = node.data("label").toLowerCase();
            node.style("opacity", label.includes(query) ? 1 : 0.2);
        });
    }, 300));

    filterType.addEventListener("change", () => {
        const type = filterType.value;
        cy.nodes().forEach(node => {
            if (type === "all") {
                node.style("opacity", 1);
            } else if (type === "AS" && !node.data("parent")) {
                node.style("opacity", 1);
            } else if (type === "router" && node.data("parent") && !node.data("type")) {
                node.style("opacity", 1);
            } else if (type === "interface" && node.data("type") === "interface") {
                node.style("opacity", 1);
            } else {
                node.style("opacity", 0.2);
            }
        });
    });
};

const getHostNumber = (ip) => {
    if (!ip || typeof ip !== "string") return "N/A";
    const parts = ip.split(".");
    return parts.length >= 4 ? parts[3].split("/")[0] : "N/A";
};