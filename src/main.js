/**
 * @fileoverview Entry point for the BGP network visualization application.
 * Initializes the graph and sets up user interactions.
 */

import { log, showNotification } from './utils.js';
import { initializeGraph, updateEdgeLabels, updateLegend } from './visualization.js';
import { setupInteractivity, setupSearchAndFilter } from './interactivity.js';

/**
 * Main application initialization function.
 * Sets up the graph, applies styling, and attaches event handlers.
 */
async function main() {
    try {
        // Display loading indicator
        const loadingElement = document.getElementById("loading");
        if (loadingElement) {
            loadingElement.style.display = "block";
            loadingElement.textContent = "Inicializando visualización de BGP...";
        }
        
        // Initialize and configure the graph
        const cy = await initializeGraph();
        
        // Setup interactivity and update UI components
        cy
            .ready(() => {
                // These methods can be chained because they don't return values
                updateEdgeLabels(cy);
                updateLegend(cy);
                setupInteractivity(cy);
                setupSearchAndFilter(cy);
                
                log("Grafo inicializado correctamente");
                showNotification("Grafo de BGP cargado correctamente.");
            })
            .on('resize', () => {
                log("Grafo redimensionado");
                // Reapply layout if needed on resize
                cy.fit();
                cy.zoom(0.8);
                cy.center();
            });
            
    } catch (error) {
        // Handle and display initialization errors
        log("Error en la inicialización:", error);
        showNotification(`Error al inicializar: ${error.message}`, "error");
        
        const loadingElement = document.getElementById("loading");
        if (loadingElement) {
            loadingElement.textContent = `Error: ${error.message}. Por favor, recarga la página.`;
            loadingElement.style.display = "block";
            loadingElement.style.backgroundColor = "#f8d7da";
            loadingElement.style.color = "#721c24";
            loadingElement.style.padding = "10px";
            loadingElement.style.borderRadius = "5px";
        }
    }
}

// Run the application when DOM content is loaded
document.addEventListener('DOMContentLoaded', main);

// Export main function for testing or manual initialization
export default main;