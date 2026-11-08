// Screenshots a test-project map through the harness, without opening the
// editor. Handy for eyeballing lighting changes.
//
//   node tools/shoot.mjs <out.png> [harness options...]
//   node tools/shoot.mjs shots/tavern.png map=1 x=9 y=8 webgl1

import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";

const [out, ...options] = process.argv.slice(2);
if (!out) {
    console.error("Usage: node tools/shoot.mjs <out.png> [map=N x=N y=N frames=N webgl1 hideplayer ...]");
    process.exit(1);
}

const PORT = 8125;
const server = spawn(process.execPath, ["tools/serve.mjs", "testproject", String(PORT)], { stdio: "ignore" });
const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
    const page = await browser.newPage({ viewport: { width: 816, height: 624 } });
    page.on("console", (m) => {
        if (m.type() === "warning" || m.type() === "error") console.log(`[${m.type()}] ${m.text()}`);
    });
    const query = new URLSearchParams({ harness: "" });
    for (const option of options) {
        const [key, value = ""] = option.split("=");
        query.set(key, value);
    }
    for (let attempt = 0; ; attempt++) {
        try {
            await page.goto(`http://127.0.0.1:${PORT}/index.html?${query}`);
            break;
        } catch (e) {
            if (attempt > 20) throw e;
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    await page.waitForFunction(() => window.__harness && window.__harness.ready, null, { timeout: 60_000 });
    const errors = await page.evaluate(() => window.__harness.errors);
    if (errors.length) console.log(errors.join("\n"));
    await page.locator("#gameCanvas").screenshot({ path: out });
    console.log(`Saved ${out}`);
} finally {
    await browser.close();
    server.kill();
}
