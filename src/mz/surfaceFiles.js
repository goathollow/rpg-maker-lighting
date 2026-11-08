import { buildManifest, MANIFEST_FILE, readManifest, SURFACE_FOLDERS, surfaceMapsIn } from "../core/surfaces.js";
import { warnOnce } from "./warn.js";

// Which images have surface maps: folder -> Map(lower-cased image name ->
// { normal, ao, specular } file stems). Null until known.
let listing = null;

// On the desktop (NW.js) the image folders are read directly, so new maps
// work as soon as they are saved, and a play-test saves what it finds to
// MANIFEST_FILE. Browsers and phones cannot list folders, so they read that
// file instead; without it, there are no maps.
export function loadSurfaceListing(enabled) {
    if (!enabled) {
        listing = readManifest(null);
        return;
    }
    if (Utils.isNwjs()) {
        try {
            listing = scanFolders();
        } catch (e) {
            warnOnce(`couldn't read the image folders (${e.message}), so normal and AO maps are off`);
            listing = readManifest(null);
        }
        return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("GET", MANIFEST_FILE);
    xhr.overrideMimeType("application/json");
    xhr.onload = () => {
        let manifest = null;
        if (xhr.status < 400) {
            try {
                manifest = JSON.parse(xhr.responseText);
            } catch {
                warnOnce(`${MANIFEST_FILE} is unreadable; play-test once on a PC to rebuild it`);
            }
        }
        listing = readManifest(manifest);
    };
    xhr.onerror = () => {
        listing = readManifest(null);
    };
    xhr.send();
}

export function isSurfaceListingLoaded() {
    return listing !== null;
}

// The surface map stems of an image, e.g. surfaceFilesFor("characters",
// "Actor1") -> { normal: "Actor1_normal" }, or null if it has none.
export function surfaceFilesFor(folder, name) {
    if (!listing || !name) return null;
    const maps = listing.get(folder);
    return (maps && maps.get(name.toLowerCase())) || null;
}

// NW.js's require, looked up at run time so the bundler leaves it alone.
const nodeRequire = (name) => window.require(name);

function scanFolders() {
    const fs = nodeRequire("fs");
    const path = nodeRequire("path");
    const base = path.dirname(process.mainModule.filename);
    const files = {};
    for (const folder of SURFACE_FOLDERS) {
        const dir = path.join(base, "img", folder);
        files[folder] = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    }
    if (Utils.isOptionValid("test")) saveManifest(fs, path.join(base, MANIFEST_FILE), buildManifest(files));
    const out = new Map();
    for (const folder of SURFACE_FOLDERS) out.set(folder, surfaceMapsIn(files[folder]));
    return out;
}

// Rewritten only when the maps changed, so it does not show up as edited
// after every play-test, and never made for a project without any.
function saveManifest(fs, file, manifest) {
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    try {
        if (fs.existsSync(file)) {
            if (fs.readFileSync(file, "utf8") === text) return;
        } else if (Object.values(manifest).every((stems) => stems.length === 0)) {
            return;
        }
        fs.writeFileSync(file, text);
    } catch (e) {
        warnOnce(`couldn't save ${MANIFEST_FILE} (${e.message}); browsers and phones won't find normal and AO maps`);
    }
}
