// Bundles src/ into the single plugin file MZ expects, with the Plugin Manager
// header on top, and drops a copy into the test project.
//
//   node tools/build.mjs           one-off build
//   node tools/build.mjs --watch   rebuild on save (then F5 in a playtest)

import * as esbuild from "esbuild";
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { PLUGIN_NAME } from "../src/config.js";
import { buildManifest, MANIFEST_FILE, SURFACE_FOLDERS } from "../src/core/surfaces.js";
import { makeTestMaps } from "./make-test-maps.mjs";
import { DEFAULT_AMBIENT_PRESETS, DEFAULT_FLICKER_PRESETS, DEFAULT_LIGHT_PRESETS } from "../src/presets.js";

// The Plugin Manager stores struct lists as a JSON array of JSON strings.
const structListDefault = (list) => JSON.stringify(list.map((item) => JSON.stringify(item)));
const comboOptions = (list) => list.map((item) => ` * @option ${item.name}`).join("\n");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
// The MIT license asks for its notice in every copy. It follows the Plugin
// Manager blocks, so they stay first in the file, where the editor reads them.
const license = [
    `${PLUGIN_NAME}.js v${pkg.version}`,
    pkg.homepage.replace(/#.*$/, ""),
    "",
    ...readFileSync("LICENSE", "utf8").trim().split(/\r?\n/),
];
const notice = `/*!\n${license.map((line) => ` * ${line}`.trimEnd()).join("\n")}\n */\n`;
const header = readFileSync("src/header.txt", "utf8")
    .replaceAll("{{VERSION}}", pkg.version)
    .replaceAll("{{NAME}}", PLUGIN_NAME)
    .replaceAll("{{LIGHT_PRESETS}}", structListDefault(DEFAULT_LIGHT_PRESETS))
    .replaceAll("{{AMBIENT_PRESETS}}", structListDefault(DEFAULT_AMBIENT_PRESETS))
    .replaceAll("{{FLICKER_PRESETS}}", structListDefault(DEFAULT_FLICKER_PRESETS))
    .replaceAll("{{LIGHT_PRESET_OPTIONS}}", comboOptions(DEFAULT_LIGHT_PRESETS))
    .replaceAll("{{AMBIENT_PRESET_OPTIONS}}", comboOptions(DEFAULT_AMBIENT_PRESETS))
    .replaceAll("{{FLICKER_PRESET_OPTIONS}}", comboOptions(DEFAULT_FLICKER_PRESETS));
const outfile = `dist/${PLUGIN_NAME}.js`;
const testPluginDir = "testproject/js/plugins";

// The list of normal and AO maps a play-test would save, which the browser
// tests need: they cannot list folders either.
function writeTestManifest() {
    const files = {};
    for (const folder of SURFACE_FOLDERS) {
        const dir = `testproject/img/${folder}`;
        files[folder] = existsSync(dir) ? readdirSync(dir) : [];
    }
    const text = `${JSON.stringify(buildManifest(files), null, 2)}
`;
    const file = `testproject/${MANIFEST_FILE}`;
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) writeFileSync(file, text);
}

const copyToTestProject = {
    name: "copy-to-testproject",
    setup(build) {
        build.onEnd((result) => {
            if (result.errors.length > 0) return;
            if (existsSync(testPluginDir)) {
                copyFileSync(outfile, `${testPluginDir}/${PLUGIN_NAME}.js`);
                makeTestMaps();
                writeTestManifest();
            }
            console.log(`[build] ${outfile} v${pkg.version}`);
        });
    },
};

const options = {
    entryPoints: ["src/index.js"],
    bundle: true,
    format: "iife",
    // NW.js 0.48 (Chromium 85) is what desktop players run; Safari 14.1
    // (iOS 14.5) is the oldest iOS we aim to support. This only lowers syntax:
    // newer runtime APIs (Array.prototype.at, structuredClone, ...) must be
    // avoided by hand.
    target: ["chrome85", "safari14.1"],
    banner: { js: header + notice },
    define: { __VERSION__: JSON.stringify(pkg.version) },
    outfile,
    charset: "utf8",
    legalComments: "none",
    logLevel: "warning",
    plugins: [copyToTestProject],
};

if (process.argv.includes("--watch")) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("[build] watching src/ for changes...");
} else {
    await esbuild.build(options);
}
