import { PLUGIN_NAME } from "../config.js";

const seen = new Set();

// Reports a setup problem (typo in a notetag, unknown preset...) once.
// Players never see the console; developers see it with F8 in a playtest.
export function warnOnce(message) {
    if (seen.has(message)) return;
    seen.add(message);
    console.warn(`${PLUGIN_NAME}: ${message}`);
}
