/**
 * @fileoverview Utility functions and configuration for the BGP visualization.
 * Contains shared constants, IP handling functions, and UI helpers.
 */

/**
 * Global configuration parameters for the visualization
 * @constant {Object}
 */
export const CONFIG = {
    AS_SIZE: { width: 250, height: 250 },
    INTERFACE_RADIUS: 10,
    DEFAULT_COLORS: {
        AS: "#ddd",
        ROUTER: "#00FF00",
        INTERFACE: "#FFA500",
        EDGE: "#000",
    },
    MAX_ITERATIONS: {
        REAL_TIME: 50,
        DEFAULT: 500
    },
    LAYOUT_THRESHOLDS: {
        USE_COSE_BILKENT: 50 // Use cose-bilkent layout if node count exceeds this
    }
};

/** Enable or disable debug logging */
export const DEBUG = true;

/**
 * Console log wrapper that only outputs when DEBUG is true
 * @param {...*} args - Arguments to log
 */
export const log = (...args) => DEBUG && console.log(...args);

/**
 * Check if localStorage is available in the current environment
 * @returns {boolean} True if localStorage is available
 */
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

/**
 * Generate a random position for a node
 * @returns {{x: number, y: number}} Random coordinates
 */
export const getRandomPosition = () => ({
    x: Math.floor(Math.random() * 800) + 100,
    y: Math.floor(Math.random() * 600) + 100,
});

/**
 * Convert RGB color string to hex format
 * @param {string} rgb - RGB color string (e.g., "rgb(255, 0, 0)")
 * @returns {string} Hex color string (e.g., "#ff0000")
 */
export const rgbToHex = (rgb) => {
    if (!rgb || typeof rgb !== "string") return CONFIG.DEFAULT_COLORS.AS;
    const match = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (!match) return CONFIG.DEFAULT_COLORS.AS;
    const [_, r, g, b] = match;
    return `#${[r, g, b].map(x => parseInt(x).toString(16).padStart(2, "0")).join("")}`;
};

/**
 * Extract the host number from an IP address
 * @param {string} ip - IP address with optional subnet mask
 * @returns {string} Host number or "N/A" if invalid
 */
export const getHostNumber = (ip) => {
    if (!ip || typeof ip !== "string") return "N/A";
    const parts = ip.split(".");
    return parts.length >= 4 ? parts[3].split("/")[0] : "N/A";
};

/**
 * Display a notification message to the user
 * @param {string} message - Message to display
 * @param {string} [type="success"] - Type of notification ("success" or "error")
 */
export const showNotification = (message, type = "success") => {
    const notification = document.createElement("div");
    notification.textContent = message;
    notification.className = "notification";
    notification.style.backgroundColor = type === "success" ? "#28a745" : "#dc3545";
    document.getElementById("notification-container").appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
};

/**
 * Validate if a string is a valid IP address
 * @param {string} ip - IP address to validate
 * @returns {boolean} True if valid IP
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
 * Validate if a string is a valid subnet mask (0-32)
 * @param {string} subnet - Subnet mask to validate
 * @returns {boolean} True if valid subnet
 */
export const is_valid_subnet = (subnet) => {
    if (!subnet || typeof subnet !== "string") return false;
    const num = parseInt(subnet, 10);
    return !isNaN(num) && num >= 0 && num <= 32;
};

/**
 * Convert an IP address to its integer representation
 * @param {string} ip - IP address (e.g., "192.168.1.1")
 * @returns {number} Integer representation of the IP
 */
export const ipToInt = (ip) => {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
};

/**
 * Create a netmask from a prefix length
 * @param {number} prefix - Prefix length (0-32)
 * @returns {number} Netmask as integer
 */
export const getNetmask = (prefix) => {
    return prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
};

/**
 * Get the network address for an IP and subnet mask
 * @param {string} ip - IP address
 * @param {number} prefix - Subnet mask (0-32)
 * @returns {string} Network address in dotted decimal notation
 */
export const getNetworkAddress = (ip, prefix) => {
    const ipInt = ipToInt(ip);
    const maskInt = getNetmask(prefix);
    const networkInt = ipInt & maskInt;
    return [
        (networkInt >>> 24) & 0xFF,
        (networkInt >>> 16) & 0xFF,
        (networkInt >>> 8) & 0xFF,
        networkInt & 0xFF
    ].join('.');
};

/**
 * Debounce a function to limit how often it can be called
 * @param {Function} func - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
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