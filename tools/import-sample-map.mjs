// Copies one of MZ's bundled sample maps into the test project and registers
// it in MapInfos.json, so it shows up in the editor's map tree.
//
//   node tools/import-sample-map.mjs <sampleNumber> <mapId> <name>
//   node tools/import-sample-map.mjs 36 1 "Tavern"

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_MZ_PATH = "C:/Program Files (x86)/Steam/steamapps/common/RPG Maker MZ";
const mzPath = process.env.MZ_PATH ?? DEFAULT_MZ_PATH;
const [sample, mapIdArg, name] = process.argv.slice(2);
const mapId = Number(mapIdArg);

if (!sample || !Number.isInteger(mapId) || mapId < 1 || !name) {
    console.error("Usage: node tools/import-sample-map.mjs <sampleNumber> <mapId> <name>");
    process.exit(1);
}

const pad = (n) => String(n).padStart(3, "0");
const dataDir = "testproject/data";
copyFileSync(join(mzPath, "samplemaps", `Map${pad(sample)}.json`), join(dataDir, `Map${pad(mapId)}.json`));

const infosPath = join(dataDir, "MapInfos.json");
const infos = JSON.parse(readFileSync(infosPath, "utf8"));
const order = Math.max(0, ...infos.filter(Boolean).map((m) => m.order)) + 1;
infos[mapId] = { id: mapId, expanded: false, name, order: infos[mapId]?.order ?? order, parentId: 0, scrollX: 0, scrollY: 0 };
for (let i = 0; i < mapId; i++) infos[i] ??= null;

// MZ writes MapInfos.json one entry per line; keep that so diffs stay small.
writeFileSync(infosPath, "[\n" + infos.map((m) => JSON.stringify(m)).join(",\n") + "\n]");
console.log(`Imported sample map ${sample} as Map${pad(mapId)} "${name}".`);
