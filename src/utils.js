export const CONFIG = {
    AS_SIZE: { width: 250, height: 250 },
    INTERFACE_RADIUS: 10,
    DEFAULT_COLORS: {
        AS: "#ddd",
        ROUTER: "#00FF00",
        INTERFACE: "#FFA500",
        EDGE: "#000",
    },
};

export const DEBUG = true;
export const log = (...args) => DEBUG && console.log(...args);

export const isLocalStorageAvailable = () => {
    try {
        const test = "__test__";
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
    } catch (e) {
        console.warn("localStorage no está disponible. Los datos no se guardarán.");
        return false;
    }
};

export const getRandomPosition = () => ({
    x: Math.floor(Math.random() * 800) + 100,
    y: Math.floor(Math.random() * 600) + 100,
});

/**
 * Convierte una cadena RGB a hexadecimal, manejando espacios y entradas inválidas.
 * @param {string} rgb - Cadena RGB, e.g., "rgb(255, 0, 0)".
 * @returns {string} Color hexadecimal, e.g., "#FF0000".
 */
export const rgbToHex = (rgb) => {
    if (!rgb || typeof rgb !== "string") return CONFIG.DEFAULT_COLORS.AS;
    const match = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (!match) return CONFIG.DEFAULT_COLORS.AS;
    const [_, r, g, b] = match;
    return `#${[r, g, b].map(x => parseInt(x).toString(16).padStart(2, "0")).join("")}`;
};

export const getHostNumber = (ip) => {
    if (!ip || typeof ip !== "string") return "N/A";
    const parts = ip.split(".");
    return parts.length >= 4 ? parts[3].split("/")[0] : "N/A";
};

export const showNotification = (message, type = "success") => {
    const notification = document.createElement("div");
    notification.textContent = message;
    notification.className = "notification";
    notification.style.backgroundColor = type === "success" ? "#28a745" : "#dc3545";
    document.getElementById("notification-container").appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
};

/**
 * Valida una dirección IP (IPv4) para asegurarse de que cada octeto esté entre 0 y 255.
 * @param {string} ip - Dirección IP, e.g., "192.168.1.1".
 * @returns {boolean} True si es válida, false si no.
 */
export const is_valid_ip = (ip) => {
    if (!ip || typeof ip !== "string") return false;
    const octets = ip.split(".");
    if (octets.length !== 4) return false;
    return octets.every(octet => {
        const num = parseInt(octet, 10);
        return !isNaN(num) && num >= 0 && num <= 255;
    });
};

/**
 * Valida una máscara de subred para asegurarse de que sea un número entre 0 y 32.
 * @param {string} subnet - Máscara de subred, e.g., "30".
 * @returns {boolean} True si es válida, false si no.
 */
export const is_valid_subnet = (subnet) => {
    if (!subnet || typeof subnet !== "string") return false;
    const num = parseInt(subnet, 10);
    return !isNaN(num) && num >= 0 && num <= 32;
};

/**
 * Retrasa la ejecución de una función para mejorar el rendimiento en eventos frecuentes.
 * @param {Function} func - Función a retrasar.
 * @param {number} delay - Retraso en milisegundos.
 * @returns {Function} Función retrasada.
 */
export const debounce = (func, delay) => {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
};