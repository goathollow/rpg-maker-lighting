// Fills testproject/ with the engine files and RTP assets from the local
// RPG Maker MZ install. Those files are not committed (they are licensed for
// use in MZ games, not for redistribution), so run this after cloning.
//
// Existing files are never overwritten, so maps and settings edited in the
// MZ editor survive. Pass --refresh-engine to replace the core scripts after
// an MZ update.
//
//   node tools/setup-testproject.mjs [--refresh-engine]
//   MZ_PATH="D:/Games/RPG Maker MZ" node tools/setup-testproject.mjs

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { makeTestMaps } from "./make-test-maps.mjs";

const DEFAULT_MZ_PATH = "C:/Program Files (x86)/Steam/steamapps/common/RPG Maker MZ";
const mzPath = process.env.MZ_PATH ?? DEFAULT_MZ_PATH;
const template = join(mzPath, "newdata");
const target = "testproject";
const refreshEngine = process.argv.includes("--refresh-engine");

if (!existsSync(template)) {
    console.error(`MZ template not found at ${template}. Set MZ_PATH to your RPG Maker MZ folder.`);
    process.exit(1);
}

function isEngineFile(rel) {
    const p = rel.replaceAll("\\", "/");
    return p === "js/main.js" || /^js\/rmmz_\w+\.js$/.test(p) || p.startsWith("js/libs/");
}

let copied = 0;
let refreshed = 0;
function copyTree(from, to) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
        const src = join(from, name);
        const dst = join(to, name);
        if (statSync(src).isDirectory()) {
            copyTree(src, dst);
            continue;
        }
        const exists = existsSync(dst);
        if (exists && !(refreshEngine && isEngineFile(relative(target, dst)))) continue;
        copyFileSync(src, dst);
        exists ? refreshed++ : copied++;
    }
}

// The raw template predates fields that newer core scripts read; the editor
// adds them when it creates or saves a project. Fill in only what is missing.
const ADVANCED_DEFAULTS = { screenScale: 1, windowOpacity: 192, picturesUpperLimit: 100 };
function upgradeSystemJson() {
    const path = join(target, "data", "System.json");
    const system = JSON.parse(readFileSync(path, "utf8"));
    const missing = Object.keys(ADVANCED_DEFAULTS).filter((key) => !(key in system.advanced));
    if (missing.length === 0) return;
    for (const key of missing) system.advanced[key] = ADVANCED_DEFAULTS[key];
    writeFileSync(path, JSON.stringify(system));
    console.log(`Added missing System.json fields: ${missing.join(", ")}`);
}

copyTree(template, target);
upgradeSystemJson();
makeTestMaps();
console.log(`Copied ${copied} new files from ${template}` + (refreshEngine ? `, refreshed ${refreshed} engine files.` : "."));
