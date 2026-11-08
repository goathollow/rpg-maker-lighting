import os from "node:os";
import { defineConfig, devices } from "@playwright/test";

// Software WebGL is CPU-heavy and every browser runs its own render threads,
// so keep the machine usable while tests run: few workers, and below-normal
// priority, which the browsers inherit (the GPU process is lowered in
// tests/visual/fixtures.js). More workers barely help: 14 were only ~15%
// faster than 3. Override with --workers=N.
try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch {
    // Not allowed on this system; run at normal priority.
}

const PORT = 8123;
const desktop = {
    ...devices["Desktop Chrome"],
    viewport: { width: 816, height: 624 },
    deviceScaleFactor: 1,
};

export default defineConfig({
    testDir: "tests/visual",
    snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
    timeout: 90_000,
    fullyParallel: true,
    workers: 3,
    reporter: [["list"], ["html", { open: "never" }]],
    expect: {
        // SwiftShader output is deterministic, so a pixel counts as changed
        // once it is off by more than about 4 levels (Playwright's default
        // threshold, 0.2, ignores up to about 37 and missed a real change in
        // cone edges). The small pixel allowance only covers anti-aliasing
        // differences between Playwright Chromium versions.
        toHaveScreenshot: { threshold: 0.02, maxDiffPixelRatio: 0.002, timeout: 20_000 },
    },
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        launchOptions: {
            // Software WebGL: identical pixels on any machine, GPU or not.
            args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
        },
    },
    webServer: {
        command: `node tools/serve.mjs testproject ${PORT}`,
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: true,
    },
    projects: [
        { name: "desktop-webgl2", use: { ...desktop } },
        { name: "desktop-webgl1", use: { ...desktop, harnessQuery: { webgl1: "" } } },
        { name: "mobile", use: { ...devices["Pixel 7"] } },
    ],
});
