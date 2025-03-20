// Import necessary libraries (if you're using modules)
import cytoscape from 'cytoscape';
// import $ from 'jquery'; // If you're using jQuery

// Load the bgp_graph.json data (replace with your actual loading method)
async function loadGraphData() {
    try {
        const response = await fetch('bgp_graph.json'); // Or however you load your data
        const bgpGraphData = await response.json();
        return bgpGraphData;
    } catch (error) {
        console.error("Error loading graph data:", error);
        return null;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const bgpGraphData = await loadGraphData();

    if (!bgpGraphData) {
        document.getElementById('loading').textContent = "Failed to load graph data.";
        return;
    }

    const cytoscapeElements = [];

    // 1. Process Nodes
    bgpGraphData.nodes.forEach(node => {
        // A. Create Router/AS Node
        cytoscapeElements.push({
            group: 'nodes',
            data: {
                id: node.data.id,
                label: node.data.label,
                type: node.data.parent ? 'router' : 'AS'
            }
        });

        // B. Create Interface Nodes (if applicable)
        if (node.data.interfaces) {
            for (const interfaceName in node.data.interfaces) {
                const interfaceId = `${node.data.id}-${interfaceName}`;
                cytoscapeElements.push({
                    group: 'nodes',
                    data: {
                        id: interfaceId,
                        label: interfaceName,
                        parent: node.data.id,
                        type: 'interface'
                    }
                });

                // C. Create Edge from Router to Interface
                cytoscapeElements.push({
                    group: 'edges',
                    data: {
                        id: `${node.data.id}-to-${interfaceId}`,
                        source: node.data.id,
                        target: interfaceId,
                        type: 'router-to-interface'
                    }
                });
            }
        }
    });

    // 2. Process Edges (Router-to-Router connections)
    bgpGraphData.edges.forEach(edge => {
        cytoscapeElements.push({
            group: 'edges',
            data: {
                id: `${edge.data.source}-to-${edge.data.target}`,
                source: edge.data.source,
                target: edge.data.target,
                weight: edge.data.weight,
                type: 'router-to-router'
            }
        });
    });

    // Initialize Cytoscape.js
    const cy = cytoscape({
        container: document.getElementById('cy'),
        elements: cytoscapeElements,
        style: [
            {
                selector: 'node[type = "AS"]',
                style: {
                    'background-color': '#ddd',
                    'label': 'data(label)'
                }
            },
            {
                selector: 'node[type = "router"]',
                style: {
                    'background-color': '#00FF00',
                    'label': 'data(label)'
                }
            },
            {
                selector: 'node[type = "interface"]',
                style: {
                    'background-color': '#FFA500',
                    'label': 'data(label)',
                    'width': 10,
                    'height': 10
                }
            },
            {
                selector: 'edge[type = "router-to-interface"]',
                style: {
                    'line-color': 'gray',
                    'width': 1
                }
            },
            {
                selector: 'edge[type = "router-to-router"]',
                style: {
                    'line-color': 'blue',
                    'width': 3
                }
            }
        ],
        layout: {
            name: 'cose', // You might need to experiment with different layouts
            padding: 20
        }
    });

    document.getElementById('loading').style.display = 'none';

    // Add event listeners for controls (example)
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('keyup', (event) => {
       // Implement your search logic here.
    });

    // Implement other control event listeners (filter, zoom, etc.)

    // Implement tooltips using Tippy.js (example)
    cy.nodes().forEach(node => {
        const label = node.data('label');
        const type = node.data('type');
        let content = `${label} (${type})`;

        if (type === 'interface') {
            const parentId = node.data('parent');
            content += ` - Connected to ${parentId}`; // Example: Show parent
        }

        tippy(node.popperRef(), {
            content: content,
            placement: 'top',
            interactive: true,
            arrow: true
        });
    });

    // Example of filtering
    const filterType = document.getElementById('filter-type');

    filterType.addEventListener('change', (event) => {
      const selectedType = event.target.value;
      if (selectedType === 'all') {
        cy.elements().style('display', 'element'); // Show all elements
      } else {
        cy.elements().style('display', 'none'); // Hide all elements
        cy.nodes(`[type = "${selectedType}"]`).style('display', 'element'); // Show only selected type
        if (selectedType !== 'AS') {
          cy.nodes('[type = "AS"]').style('display', 'element');
        }
        cy.edges().forEach(edge => {
          const source = edge.source();
          const target = edge.target();
          if (source.data('type') === selectedType || target.data('type') === selectedType) {
            edge.style('display', 'element');
          }
        });
      }
    });
});