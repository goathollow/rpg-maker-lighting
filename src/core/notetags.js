// Notetags as typed into map notes, event notes and page comments:
//
//   <light>   <light: Torch>   <light: Torch, radius: 200, color: #ff0000>
//
// Parsing is forgiving about case, spacing and commas, because the people
// writing these are mostly not programmers.

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The argument text of every <name> or <name: args> tag in `text`, in order;
// "" for a bare tag. Longer names such as <lightning> do not match.
export function findTags(text, name) {
    if (typeof text !== "string") return [];
    const re = new RegExp(`<\\s*${escapeRegExp(name)}\\s*(?::([^>]*))?>`, "gi");
    const out = [];
    for (const m of text.matchAll(re)) out.push((m[1] ?? "").trim());
    return out;
}

const NUMBER = String.raw`-?(?:\d+\.?\d*|\.\d+)`;
// key: value, where value is a hex color, one to three numbers (so that
// "color: 255, 128, 0" stays together), or a single word.
const KEY_VALUE = new RegExp(
    String.raw`([a-z]+)\s*[:=]\s*(#[0-9a-f]+|${NUMBER}(?:\s*,\s*${NUMBER}){0,2}|[a-z_]\w*)`,
    "gi"
);

// "Big Torch, radius: 200" -> { name: "Big Torch", values: { radius: "200" } }
// Keys are lower-cased; values are left as text for the caller to read.
export function parseTagArgs(args) {
    const values = {};
    const rest = String(args ?? "").replace(KEY_VALUE, (_, key, value) => {
        values[key.toLowerCase()] = value.trim();
        return " ";
    });
    const name = rest.replace(/[,;]/g, " ").replace(/\s+/g, " ").trim();
    return { name, values };
}

// All comment text on an event page. Comment commands are code 108 for the
// first line and 408 for each line after it.
export function pageCommentText(list) {
    if (!Array.isArray(list)) return "";
    return list
        .filter((command) => command && (command.code === 108 || command.code === 408))
        .map((command) => command.parameters[0])
        .join("\n");
}
