// Readers for values typed in by game developers: Plugin Manager parameters
// (always strings) and notetags. Old or hand-edited projects can contain
// anything, so a reader falls back to its default instead of throwing.

export function readNumber(raw, fallback, { min = -Infinity, max = Infinity } = {}) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
        return fallback;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, n));
}

export function readBoolean(raw, fallback) {
    if (raw === true || raw === false) return raw;
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
    return fallback;
}

export function readString(raw, fallback) {
    return typeof raw === "string" ? raw.trim() : fallback;
}

// One of a fixed set of words, as a select parameter gives; anything else
// gives the fallback. Not case sensitive.
export function readChoice(raw, fallback, choices) {
    const s = String(raw ?? "").trim().toLowerCase();
    return choices.includes(s) ? s : fallback;
}

// Struct lists arrive JSON-encoded twice: a JSON array of JSON strings.
// Unreadable entries are dropped; an unreadable list gives the fallback.
export function readStructList(raw, fallback) {
    if (typeof raw !== "string") return fallback;
    let list;
    try {
        list = JSON.parse(raw);
    } catch {
        return fallback;
    }
    if (!Array.isArray(list)) return fallback;
    const out = [];
    for (const item of list) {
        try {
            const value = typeof item === "string" ? JSON.parse(item) : item;
            if (value && typeof value === "object" && !Array.isArray(value)) out.push(value);
        } catch {
            // Skip the broken entry, keep the rest.
        }
    }
    return out;
}

// A list of whole numbers: the Plugin Manager's number[] (a JSON array of
// strings), or numbers typed with commas or spaces. Values out of range or
// unreadable are dropped; duplicates are removed.
export function readNumberList(raw, fallback, { min = -Infinity, max = Infinity } = {}) {
    if (raw === undefined || raw === null) return fallback;
    let items;
    try {
        const parsed = JSON.parse(raw);
        items = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
        items = String(raw).split(/[\s,;]+/);
    }
    const out = new Set();
    for (const item of items) {
        if (String(item).trim() === "") continue;
        const n = Number(item);
        if (Number.isInteger(n) && n >= min && n <= max) out.add(n);
    }
    return [...out].sort((a, b) => a - b);
}
