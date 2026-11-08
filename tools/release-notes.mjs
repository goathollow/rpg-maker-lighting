// Prints one version's section of CHANGELOG.md, for the release workflow.
//
//   node tools/release-notes.mjs 0.9.0

import { readFileSync } from "node:fs";

const version = process.argv[2];
const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
const start = lines.findIndex((line) => line.trim() === `## ${version}` || line.startsWith(`## ${version} `));
if (!version || start < 0) {
    console.error(`No "## ${version}" section in CHANGELOG.md`);
    process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
if (end < 0) end = lines.length;
console.log(lines.slice(start + 1, end).join("\n").trim());
