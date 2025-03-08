// src/main.js
import { validateGraphData, loadData, generateInterfaceNodes, transformEdges, addHierarchicalEdges } from './data.js';
import { initializeGraph, updateEdgeLabels, updateLegend } from './visualization.js';
import { setupInteractivity, setupSearchAndFilter } from './interactivity.js';
import { log, CONFIG } from './utils.js';

let cy;

const main = async () => {
    try {
        cy = await initializeGraph();
        updateEdgeLabels(cy);
        setupInteractivity(cy);
        setupSearchAndFilter(cy);
        updateLegend(cy);
        log("Grafo listo");
    } catch (error) {
        log("Inicialización fallida:", error);
    }
};

main();