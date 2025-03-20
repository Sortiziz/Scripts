import { initializeGraph } from './visualization.js';
import { setupInteractivity, setupSearchAndFilter } from './interactivity.js';
import { updateEdgeLabels, updateLegend } from './visualization.js';

async function main() {
    const cy = await initializeGraph();
    updateEdgeLabels(cy);
    updateLegend(cy);
    setupInteractivity(cy);
    setupSearchAndFilter(cy);
}

main().catch(err => console.error("Error en la inicialización:", err));