// src/utils.js
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

export const rgbToHex = (rgb) => {
    if (!rgb || typeof rgb !== "string") return CONFIG.DEFAULT_COLORS.AS;
    const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
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