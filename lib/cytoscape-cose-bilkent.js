;(function () {
  'use strict';

  // El código del registrador para el plugin cose-bilkent
  function register(cytoscape) {
      if (!cytoscape) {
          console.error('Cytoscape no está disponible. No se puede registrar el plugin cose-bilkent.');
          return;
      }

      // Definimos un layout dummy para evitar errores
      // En un ambiente real, aquí se implementaría el algoritmo completo
      var CoseBilkent = function(options) {
          var opts = options || {};
          this.options = Object.assign({}, {
              // Opciones del layout
              name: 'cose-bilkent',
              // Whether to fit the network view after when done
              fit: true,
              // Padding on fit
              padding: 10,
              // Whether to enable incremental mode
              randomize: true,
              // Node repulsion (non overlapping) multiplier
              nodeRepulsion: 4500,
              // Ideal edge (non nested) length
              idealEdgeLength: 50,
              // Divisor to compute edge forces
              edgeElasticity: 0.45,
              // Nesting factor (multiplier) to compute ideal edge length for nested edges
              nestingFactor: 0.1,
              // Gravity force (constant)
              gravity: 0.25,
              // Maximum number of iterations to perform
              numIter: 2500,
              // For enabling tiling (Must be true for other tiling options to take effect)
              tile: true,
              // Represents the amount of the vertical space to put between the zero degree members during the tiling operation
              tilingPaddingVertical: 10,
              // Represents the amount of the horizontal space to put between the zero degree members during the tiling operation
              tilingPaddingHorizontal: 10,
              // Gravity range (constant) for compounds
              gravityRangeCompound: 1.5,
              // Gravity force (constant) for compounds
              gravityCompound: 1.0,
              // Gravity range (constant)
              gravityRange: 3.8,
              initialEnergyOnIncremental: 0.5
          }, opts);
      };

      // Implementar método run
      CoseBilkent.prototype.run = function() {
          var layout = this;
          var options = this.options;
          var cy = options.cy;

          console.log('Ejecutando layout cose-bilkent (versión modificada)');

          // Crear un layout simple para posicionar elementos
          var randomLayout = {
              name: 'random',
              fit: options.fit,
              padding: options.padding,
              animate: false,
              randomize: true
          };

          cy.layout(randomLayout).run();
          layout.trigger('layoutready');
          layout.trigger('layoutstop');
          return this;
      };

      // Para compatibilidad con eventos
      CoseBilkent.prototype.trigger = function(eventName) {
          var event = new CustomEvent(eventName, { 
              bubbles: true, 
              detail: { layout: this } 
          });
          
          this.options.cy.container().dispatchEvent(event);
          return this;
      };

      // Métodos adicionales requeridos
      CoseBilkent.prototype.stop = function() {
          return this;
      };

      CoseBilkent.prototype.destroy = function() {
          return this;
      };

      // Registrar el layout con Cytoscape
      cytoscape('layout', 'cose-bilkent', CoseBilkent);
      
      console.log('Plugin cose-bilkent (versión modificada) registrado correctamente');
  }

  // Exponer el registrador como una función global
  if (typeof window !== 'undefined') {
      window.cytoscapeCoseBilkent = register;
      
      // Si ya existe Cytoscape, registrarlo inmediatamente
      if (typeof window.cytoscape !== 'undefined') {
          register(window.cytoscape);
      }
  }
  
  // Compatibilidad con diferentes entornos
  if (typeof module !== 'undefined' && module.exports) {
      module.exports = register;
  }
  
  if (typeof define !== 'undefined' && define.amd) {
      define('cytoscape-cose-bilkent', function() {
          return register;
      });
  }
})();