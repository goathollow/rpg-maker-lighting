// Minimal static file server for running the test project in a browser.
// MZ loads its data with fetch/XHR, which file:// URLs do not allow.
//
//   node tools/serve.mjs [root=testproject] [port=8123]

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const [root = "testproject", port = "8123"] = process.argv.slice(2);
const base = resolve(root);

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
};

function resolveFile(pathname) {
    let file;
    try {
        file = resolve(base, "." + decodeURIComponent(pathname));
    } catch {
        return null;
    }
    if (file !== base && !file.startsWith(base + sep)) return null;
    try {
        if (statSync(file).isDirectory()) file = join(file, "index.html");
        return statSync(file).isFile() ? file : null;
    } catch {
        return null;
    }
}

createServer((req, res) => {
    const file = resolveFile(new URL(req.url, "http://localhost").pathname);
    if (!file) {
        res.writeHead(404).end("Not found");
        return;
    }
    res.writeHead(200, {
        "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-store",
    });
    createReadStream(file).pipe(res);
}).listen(Number(port), "127.0.0.1", () => {
    console.log(`Serving ${base} at http://127.0.0.1:${port}/`);
});
