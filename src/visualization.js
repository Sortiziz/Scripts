import { log, CONFIG, rgbToHex, isLocalStorageAvailable } from './utils.js';
import { validateGraphData, loadData, generateInterfaceNodes, transformEdges, addHierarchicalEdges } from './data.js';

export const bgpHierarchicalLayout = (cy, nodes, edges, isRealTime = false) => {
  console.log("Ejecutando bgpHierarchicalLayout...", { isRealTime });

  const asY = cy.height() * 0.15;
  const routerYRange = [cy.height() * 0.25, cy.height() * 0.45];
  const routerRadius = 120;
  const interfaceRadius = 40; // Interfaces más próximas al router
  const repulsionForce = 1000;
  const attractionForce = 0.3;
  const interfaceAttractionForce = 1.5;
  const interfaceRepulsionForce = 2500;
  const maxInterfaceDistance = 60;
  const maxIterations = isRealTime ? 100 : 200;

  // Aseguramos que cada nodo de tipo "interface" tenga un id único combinando el id del router y su label.
  nodes
    .filter(n => n.data.type === "interface")
    .forEach(node => {
      const routerId = node.data.router;
      const interfaceLabel = node.data.label;
      if (!node.data.id || !node.data.id.startsWith(routerId + "-")) {
        node.data.id = `${routerId}-${interfaceLabel}`;
      }
    });

  // Crear un mapa de nodos basado en los IDs. Si un nodo no tiene id, se ignora.
  const nodeMap = {};
  nodes.forEach(node => {
    if (!node.data.id) {
      console.warn("Nodo sin id:", node);
      return;
    }
    const pos = (typeof node.position === "function") ? node.position() : node.position;
    nodeMap[node.data.id] = {
      pos: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
      vel: { x: 0, y: 0 },
      type: node.data.type || (node.data.parent && !node.data.router ? 'router' : 'as'),
      router: node.data.router || null,
      parent: node.data.parent || null,
      locked: node.data.locked || false,
      subnetConflicts: []
    };
  });

  // Verificar que cada nodo tenga una posición válida; si no, asignar {x: 0, y: 0}.
  nodes.forEach(node => {
    const pos = typeof node.position === "function" ? node.position() : node.position;
    if (pos == null || pos.x == null || pos.y == null) {
      if (typeof node.position === "function") {
        node.position({ x: 0, y: 0 });
      } else {
        node.position = { x: 0, y: 0 };
      }
      if (node.data.id && nodeMap[node.data.id]) {
        nodeMap[node.data.id].pos = { x: 0, y: 0 };
      }
    }
  });

  // Posicionar nodos AS (sin parent y sin type)
  const asNodes = nodes.filter(n => !n.data.parent && !n.data.type);
  const numAS = asNodes.length;
  const asSpacing = Math.min(400, cy.width() / (numAS + 1));
  asNodes.forEach((node, index) => {
    if (nodeMap[node.data.id].locked) return;
    const x = (cy.width() / 2 - (numAS - 1) * asSpacing / 2 + index * asSpacing);
    nodeMap[node.data.id].pos = { x, y: asY };
  });

  // Posicionar routers dentro de cada AS
  const routerNodes = nodes.filter(n => n.data.parent && !n.data.type);
  const asToRouters = {};
  routerNodes.forEach(node => {
    if (!asToRouters[node.data.parent]) asToRouters[node.data.parent] = [];
    asToRouters[node.data.parent].push(node);
  });
  Object.entries(asToRouters).forEach(([asId, routers]) => {
    if (!nodeMap[asId]) return; // Asegurarse de que el nodo AS existe
    const asPos = nodeMap[asId].pos;
    const numRouters = routers.length;
    const baseAngle = Math.random() * 2 * Math.PI;
    const routerY = (routerYRange[0] + routerYRange[1]) / 2;
    routers.forEach((router, index) => {
      if (!nodeMap[router.data.id] || nodeMap[router.data.id].locked) return;
      const angle = baseAngle + (2 * Math.PI / numRouters) * index;
      nodeMap[router.data.id].pos = {
        x: asPos.x + routerRadius * Math.cos(angle),
        y: routerY + (routerRadius * 0.5) * Math.sin(angle)
      };
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
    // Ordenar interfaces por label para mantener consistencia (ej. eth0, eth1)
    interfaces.sort((a, b) => a.data.label.localeCompare(b.data.label));
    const routerEntry = nodeMap[routerId];
    if (!routerEntry) {
      console.warn(`No se encontró el router con id ${routerId} para posicionar interfaces.`);
      return;
    }
    const routerPos = routerEntry.pos;
    const numInterfaces = interfaces.length;
    interfaces.forEach((intf, index) => {
      if (!nodeMap[intf.data.id] || nodeMap[intf.data.id].locked) return;
      const angle = (2 * Math.PI / numInterfaces) * index;
      nodeMap[intf.data.id].pos = {
        x: routerPos.x + interfaceRadius * Math.cos(angle),
        y: routerPos.y + interfaceRadius * Math.sin(angle)
      };
    });
  });

  // Validar aristas para que referencien nodos existentes y advertir sobre conflictos en subredes
  const subnetMap = new Map();
  edges = edges.filter(edge => {
    const validSource = nodeMap[edge.data.source] !== undefined;
    const validTarget = nodeMap[edge.data.target] !== undefined;
    if (!validSource || !validTarget) {
      console.warn(`Arista descartada: source=${edge.data.source}, target=${edge.data.target}`);
      return false;
    }
    const isOriginalEdge = edge.data.hasOwnProperty('sourceInterface') &&
                           edge.data.hasOwnProperty('targetInterface');
    const sourceIsRouter = nodes.find(n => n.data.id === edge.data.source && n.data.parent && !n.data.type);
    const targetIsRouter = nodes.find(n => n.data.id === edge.data.target && n.data.parent && !n.data.type);
    if (isOriginalEdge && sourceIsRouter && targetIsRouter && edge.data.weight) {
      const subnet = edge.data.weight.split('/')[0];
      if (!subnet) {
        console.warn(`Subred inválida en arista ${edge.data.source} -> ${edge.data.target}: ${edge.data.weight}`);
        return false;
      }
      if (subnetMap.has(subnet)) {
        const prevTarget = subnetMap.get(subnet);
        console.warn(`Conflicto en subred: ${subnet} ya se usó en ${prevTarget} y ahora en ${edge.data.target}`);
      } else {
        subnetMap.set(subnet, edge.data.target);
      }
    }
    return true;
  });

  // Iteraciones de fuerza para ajustar posiciones
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
    });

    Object.keys(nodeMap).forEach(id => {
      const node = nodeMap[id];
      if (node.locked) return;
      node.pos.x += node.vel.x * 0.9;
      node.pos.y += node.vel.y * 0.9;
      node.vel.x *= 0.9;
      node.vel.y *= 0.9;

      // Si es una interfaz, limitar su distancia al router
      if (node.type === "interface" && node.router) {
        const routerPos = nodeMap[node.router] ? nodeMap[node.router].pos : { x: 0, y: 0 };
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

  // Reordenamiento opcional para minimizar cruces de aristas.
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
        if (!r.node.data || !nodeMap[r.node.data.id]) return;
        const router = nodeMap[r.node.data.id];
        if (router.locked) return;
        const angle = baseAngle + (2 * Math.PI / numRouters) * index;
        router.pos.x = asPos.x + routerRadius * Math.cos(angle);
        router.pos.y = routerYRange[0] + (routerYRange[1] - routerYRange[0]) * Math.sin(angle);
      });
    });

    // Reorder interfaces basándose en su label
    Object.entries(routerToInterfaces).forEach(([routerId, interfaces]) => {
      if (!nodeMap[routerId]) return;
      const routerPos = nodeMap[routerId].pos;
      const numInterfaces = interfaces.length;
      interfaces.sort((a, b) => a.data.label.localeCompare(b.data.label));
      interfaces.forEach((intf, index) => {
        if (!nodeMap[intf.data.id]) return;
        const interfaceNode = nodeMap[intf.data.id];
        if (interfaceNode.locked) return;
        const angle = (2 * Math.PI / numInterfaces) * index;
        interfaceNode.pos.x = routerPos.x + interfaceRadius * Math.cos(angle);
        interfaceNode.pos.y = routerPos.y + interfaceRadius * Math.sin(angle);
      });
    });
  };
  reorderToMinimizeCrossings();

  // Asegurar que cada nodo tenga una posición válida antes de llamar a cy.fit()
  cy.nodes().forEach(node => {
    const pos = typeof node.position === "function" ? node.position() : node.position;
    if (pos == null || pos.x == null || pos.y == null) {
      if (typeof node.position === "function") {
        node.position({ x: 0, y: 0 });
      } else {
        node.position = { x: 0, y: 0 };
      }
    }
  });

  // Actualizamos la posición de los nodos usando una actualización en bloque y evitando llamar a node.position() si no es una función
  cy.startBatch();
  cy.nodes().animate({
    position: (node) => {
      const nm = nodeMap[node.id()];
      return nm ? { x: nm.pos.x, y: nm.pos.y } : (typeof node.position === "function" ? node.position() : node.position);
    },
    duration: 500,
    easing: 'ease-in-out'
  });
  cy.endBatch();

  console.log("bgpHierarchicalLayout completado. Nuevas posiciones:",
    cy.nodes().map(n => ({ id: n.id(), position: typeof n.position === "function" ? n.position() : n.position })));
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
    let allEdges = addHierarchicalEdges(allNodes, transformedEdges);

    // Filtramos las aristas que referencian nodos inexistentes.
    allEdges = allEdges.filter(edge =>
      allNodes.some(node => node.data.id === edge.data.source) &&
      allNodes.some(node => node.data.id === edge.data.target)
    );

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
          selector: "edge[weight]",
          style: {
            "line-color": ele => {
              return ele.data('status') === 'added' ? 'blue' :
                     ele.data('status') === 'removed' ? 'red' :
                     ele.data("color") || CONFIG.DEFAULT_COLORS.EDGE;
            },
            "line-style": ele => ele.data('status') === 'removed' ? 'dashed' : 'solid',
            width: ele => {
              const weightParts = (ele.data("weight") || "").split("/");
              let parsed = parseFloat(weightParts[1]);
              if (isNaN(parsed)) parsed = 3;
              return Math.min(10, Math.max(1, parsed / 8));
            },
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
          const pos = typeof node.position === "function" ? node.position() : node.position;
          acc[node.data.id] = pos;
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

    const savedData = isLocalStorageAvailable()
      ? JSON.parse(localStorage.getItem("bgpNodeData") || "{}")
      : {};
    const allNodesHaveSavedPositions = allNodes.every(node => {
      const pos = typeof node.position === "function" ? node.position() : node.position;
      return pos != null && pos.x != null && pos.y != null;
    });

    if (!allNodesHaveSavedPositions) {
      bgpHierarchicalLayout(cy, allNodes, allEdges, false);
      cy.fit();
      cy.zoom(0.8);
      cy.center();
    } else {
      cy.nodes().forEach(node => {
        const pos =
          savedData.positions[node.id()] ||
          (typeof node.position === "function" ? node.position() : node.position);
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
    const sourceElem = cy.getElementById(edge.data("source"));
    const targetElem = cy.getElementById(edge.data("target"));
    if (!sourceElem.length || !targetElem.length) {
      console.warn(`Advertencia: El borde ${edge.id()} hace referencia a nodos inexistentes`);
      return;
    }
    const sourceIp = sourceElem.data("ip") || "N/A";
    const targetIp = targetElem.data("ip") || "N/A";
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
  legendItems[0].querySelector(".legend-color").style.backgroundColor =
    cy.nodes("[!parent]").style("background-color") || CONFIG.DEFAULT_COLORS.AS;
  legendItems[1].querySelector(".legend-color").style.backgroundColor =
    cy.nodes("[parent][!type]").style("background-color") || CONFIG.DEFAULT_COLORS.ROUTER;
  legendItems[2].querySelector(".legend-color").style.backgroundColor =
    cy.nodes("[type='interface']").style("background-color") || CONFIG.DEFAULT_COLORS.INTERFACE;
  legendItems[3].querySelector(".legend-color").style.backgroundColor =
    cy.edges("[!invisible]").style("line-color") || CONFIG.DEFAULT_COLORS.EDGE;
};

const getHostNumber = (ip) => {
  if (!ip || typeof ip !== "string") return "N/A";
  const parts = ip.split(".");
  return parts.length >= 4 ? parts[3].split("/")[0] : "N/A";
};