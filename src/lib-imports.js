/**
 * @fileoverview Centraliza la importación de bibliotecas externas usando las versiones disponibles.
 * Crea un puente entre bibliotecas globales y módulos ES6.
 */

// Este archivo actúa como un "puente" entre las bibliotecas globales y los módulos ES6

// Función para esperar a que una biblioteca global se cargue
const waitForGlobal = (name, timeout = 5000) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      
      const check = () => {
        // Verificar si la biblioteca está disponible en el ámbito global
        if (window[name] !== undefined) {
          resolve(window[name]);
          return;
        }
        
        // Comprobar si ha pasado el tiempo límite
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout esperando a que ${name} esté disponible globalmente`));
          return;
        }
        
        // Intentar nuevamente en 100ms
        setTimeout(check, 100);
      };
      
      check();
    });
  };
  
  // Cytoscape y su extensión cose-bilkent
  let _cytoscape = null;
  let _coseBilkentRegistered = false;
  
  /**
   * Obtiene o espera a que Cytoscape esté disponible
   * @returns {Promise<Object>} La instancia global de Cytoscape
   */
  export const getCytoscape = async () => {
    if (_cytoscape) return _cytoscape;
    
    try {
      _cytoscape = await waitForGlobal('cytoscape');
      console.log('Cytoscape global cargado correctamente');
      return _cytoscape;
    } catch (e) {
      console.error('Error al cargar Cytoscape:', e);
      throw e;
    }
  };
  
  /**
   * Registra el plugin cose-bilkent directamente en lugar de esperar que se registre automáticamente
   * @returns {Promise<boolean>} True si el plugin se registró correctamente
   */
  export const ensureCoseBilkent = async () => {
    if (_coseBilkentRegistered) return true;
    
    try {
      const cy = await getCytoscape();
      
      // Si ya existe el layout, no necesitamos registrarlo de nuevo
      if (cy.layout && cy.layout.prototype && cy.layout.prototype.coseBilkent) {
        _coseBilkentRegistered = true;
        return true;
      }
  
      // Intento con global definido por script original
      if (typeof window.cytoscapeCoseBilkent === 'function') {
        window.cytoscapeCoseBilkent(cy);
        _coseBilkentRegistered = true;
        console.log('Plugin cose-bilkent registrado correctamente desde global');
        return true;
      }
      
      console.warn('Plugin cose-bilkent no está disponible. Si necesitas este layout, por favor asegúrate de incluir el script en el HTML.');
      return false;
    } catch (e) {
      console.error('Error al registrar cose-bilkent:', e);
      return false;
    }
  };
  
  /**
   * Obtiene o espera a que tippy esté disponible
   * @returns {Promise<Function>} La función global tippy
   */
  export const getTippy = async () => {
    try {
      return await waitForGlobal('tippy');
    } catch (e) {
      console.error('Error al cargar tippy:', e);
      throw e;
    }
  };