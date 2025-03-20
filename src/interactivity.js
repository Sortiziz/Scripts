import { log, rgbToHex, showNotification, isLocalStorageAvailable, CONFIG, debounce } from './utils.js';
import { loadData } from './data.js';
import { bgpHierarchicalLayout, initializeGraph, updateEdgeLabels } from './visualization.js';

export const setupInteractivity = (cy) => {
    const edgeLabelStates = new Map();
    let eventIndex = 0;
    const events = [
        { type: "addNode", node: { data: { id: "R16", label: "R16", parent: "AS5", interfaces: {} }, position: null }, edge: { data: { source: "R14", target: "R16", weight: "192.168.23.0/30", status: "added" } } },
        { type: "removeEdge", edgeId: "R14-to-R13" }
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
            "text-background-padding": 3
        });
    };

    cy.edges("[!invisible][type!='hierarchical']").on("click", evt => toggleEdgeLabel(evt.target));

    const modal = document.getElementById("color-modal");
    const applyColorBtn = document.getElementById("apply-color-btn");
    const cancelColorBtn = document.getElementById("cancel-color-btn");
    let selectedElementId = null;

    cy.on("dblclick", "node, edge[!invisible][type!='hierarchical']", evt => {
        const element = evt.target;
        const pos = element.isNode() ? element.renderedPosition() : element.renderedMidpoint();
        modal.style.left = `${Math.max(0, Math.min(pos.x, cy.width() - 250))}px`;
        modal.style.top = `${Math.max(0, Math.min(pos.y, cy.height() - 180))}px`;
        modal.style.display = "block";
        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
        modal.focus();

        selectedElementId = element.id();
        document.getElementById("type-label").innerHTML = element.isNode()
            ? `Color para nodo: ${element.data("label")}`
            : `Color para enlace entre ${cy.getElementById(element.data("source")).data("label")} y ${cy.getElementById(element.data("target")).data("label")}`;
        document.getElementById("color-input").value = rgbToHex(element.isNode() ? element.style("background-color") : element.style("line-color"));
    });

    applyColorBtn.addEventListener("click", () => {
        if (!selectedElementId) return;
        const element = cy.getElementById(selectedElementId);
        const newColor = document.getElementById("color-input").value;
        if (element.isNode()) element.style("background-color", newColor);
        else element.style("line-color", newColor);
        element.data("color", newColor);
        hideModal();
    });

    cancelColorBtn.addEventListener("click", hideModal);

    function hideModal() {
        modal.classList.remove("show");
        setTimeout(() => {
            modal.style.display = "none";
            modal.setAttribute("aria-hidden", "true");
        }, 300);
        selectedElementId = null;
    }

    const popperContainer = document.getElementById("popper-container");
    const tooltips = new Map();
    const setupTooltips = () => {
        cy.nodes().forEach(node => {
            if (tooltips.has(node.id())) return;
            const connections = cy.edges().filter(e => e.data("source") === node.id() || e.data("target") === node.id()).length;
            const div = document.createElement("div");
            div.style.position = "absolute";
            popperContainer.appendChild(div);
            const tip = tippy(div, {
                content: node.data("type") === "interface"
                    ? `Interfaz: ${node.data("label")}<br>Router: ${node.data("router")}<br>IP: ${node.data("ip")}<br>Conexiones: ${connections}`
                    : `ID: ${node.id()}<br>AS: ${node.data("parent") || "N/A"}<br>Conexiones: ${connections}`,
                theme: "light",
                placement: "top",
                trigger: "manual"
            });
            tooltips.set(node.id(), { div, tip });
            node.on("mouseover", () => tip.show());
            node.on("mouseout", () => tip.hide());
        });
    };
    setupTooltips();

    cy.nodes().on('dragfree', evt => {
        const node = evt.target;
        node.data('locked', true);
    });

    const saveData = () => {
        if (!isLocalStorageAvailable()) return showNotification("No se puede guardar: localStorage no disponible", "error");
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
        localStorage.removeItem("bgpNodeData");
        const nodes = cy.nodes().map(node => ({ data: node.data(), position: null }));
        const edges = cy.edges().map(edge => ({ data: edge.data() }));
        const newNodes = loadData(nodes, edges, cy.container());
        cy.reset();
        cy.batch(() => {
            newNodes.forEach(newNode => {
                const node = cy.getElementById(newNode.data.id);
                node.position(newNode.position);
                node.data('locked', false);
            });
        });
        bgpHierarchicalLayout(cy, newNodes, edges, false);
        cy.fit();
        cy.zoom(1.0);
        cy.center();
        showNotification("Posiciones reseteadas.");
    };

    const timeSlider = document.getElementById("time-slider") || (() => {
        const container = document.createElement("div");
        container.style.marginTop = "10px";
        container.innerHTML = `<label for="time-slider">Evento: </label><input type="range" id="time-slider" min="0" max="${events.length}" value="0" step="1" style="width: 200px">`;
        document.getElementById("controls").appendChild(container);
        return container.querySelector("#time-slider");
    })();

    timeSlider.addEventListener("input", (event) => {
        const newIndex = parseInt(event.target.value);
        if (newIndex === eventIndex) return;

        if (newIndex > eventIndex) {
            for (let i = eventIndex; i < newIndex; i++) {
                const evt = events[i];
                if (evt.type === "addNode") {
                    cy.add([evt.node, evt.edge]);
                    bgpHierarchicalLayout(cy, cy.nodes().map(n => ({ data: n.data(), position: n.position() })), cy.edges().map(e => ({ data: e.data() })), true);
                    showNotification(`Añadido nodo ${evt.node.data.id}.`);
                } else if (evt.type === "removeEdge") {
                    const edge = cy.getElementById(evt.edgeId);
                    if (edge) cy.remove(edge);
                    bgpHierarchicalLayout(cy, cy.nodes().map(n => ({ data: n.data(), position: n.position() })), cy.edges().map(e => ({ data: e.data() })), true);
                    showNotification(`Eliminada conexión ${evt.edgeId}.`);
                }
            }
        } else {
            initializeGraph().then(newCy => {
                cy.elements().remove();
                cy.add(newCy.elements());
                for (let i = 0; i < newIndex; i++) {
                    const evt = events[i];
                    if (evt.type === "addNode") cy.add([evt.node, evt.edge]);
                }
                bgpHierarchicalLayout(cy, cy.nodes().map(n => ({ data: n.data(), position: n.position() })), cy.edges().map(e => ({ data: e.data() })), true);
                cy.fit();
                cy.zoom(1.0);
                cy.center();
                showNotification("Grafo restaurado.");
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

    const unlockBtn = document.createElement("button");
    unlockBtn.textContent = "Desbloquear Nodos";
    unlockBtn.setAttribute("aria-label", "Desbloquear todos los nodos");
    unlockBtn.style.backgroundColor = "#17a2b8";
    unlockBtn.style.color = "white";
    unlockBtn.addEventListener("click", () => {
        cy.nodes().forEach(node => {
            node.data('locked', false);
        });
        showNotification("Todos los nodos han sido desbloqueados.");
    });
    document.getElementById("controls").appendChild(unlockBtn);

    document.getElementById("save-btn").addEventListener("click", saveData);
    document.getElementById("reset-positions-btn").addEventListener("click", resetPositions);
    document.getElementById("reset-colors-btn").addEventListener("click", resetColors);
    document.getElementById("zoom-slider").addEventListener("input", event => cy.zoom(parseFloat(event.target.value)));
    document.getElementById("export-btn").addEventListener("click", () => {
        if (!isLocalStorageAvailable()) return showNotification("No se puede exportar: localStorage no disponible", "error");
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
    document.getElementById("import-btn").addEventListener("click", () => document.getElementById("import-input").click());
    document.getElementById("import-input").addEventListener("change", event => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = JSON.parse(e.target.result);
                if (isLocalStorageAvailable()) {
                    localStorage.setItem("bgpNodeData", JSON.stringify(data));
                    showNotification("Configuración importada. Recarga para aplicar.");
                }
            } catch (error) {
                showNotification(`Error al importar: ${error.message}`, "error");
            }
        };
        reader.readAsText(file);
    });
};

export const setupSearchAndFilter = (cy) => {
    const searchInput = document.getElementById("search-input");
    const filterType = document.getElementById("filter-type");

    searchInput.addEventListener("input", debounce(() => {
        const query = searchInput.value.toLowerCase();
        cy.nodes().forEach(node => {
            node.style("opacity", node.data("label").toLowerCase().includes(query) ? 1 : 0.2);
        });
    }, 300));

    filterType.addEventListener("change", () => {
        const type = filterType.value;
        cy.nodes().forEach(node => {
            node.style("opacity", type === "all" || 
                (type === "AS" && !node.data("parent")) || 
                (type === "router" && node.data("parent") && !node.data("type")) || 
                (type === "interface" && node.data("type") === "interface") ? 1 : 0.2);
        });
    });
};

const getHostNumber = (ip) => {
    if (!ip || typeof ip !== "string") return "N/A";
    const parts = ip.split(".");
    return parts.length >= 4 ? parts[3].split("/")[0] : "N/A";
};