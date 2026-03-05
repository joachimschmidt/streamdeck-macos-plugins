import { build } from "esbuild";
import { cpSync, mkdirSync, writeFileSync } from "fs";

const PLUGIN_DIR = "com.local.ha-graph.sdPlugin";

// Create output directories
mkdirSync(`${PLUGIN_DIR}/bin`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/ui`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/imgs`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/layouts`, { recursive: true });

// Bundle plugin
await build({
  entryPoints: ["src/plugin.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: `${PLUGIN_DIR}/bin/plugin.js`,
});

// Copy manifest, UI, and layouts
cpSync("manifest.json", `${PLUGIN_DIR}/manifest.json`);
cpSync("ui/settings.html", `${PLUGIN_DIR}/ui/settings.html`);
cpSync("layouts/graph.json", `${PLUGIN_DIR}/layouts/graph.json`);

// Create minimal placeholder icon (20x20 gray PNG)
const placeholderPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAFElEQVQ4y2NgGAWjYBSMglEwCogHAATYAAGEIJLfAAAAAElFTkSuQmCC",
  "base64"
);
writeFileSync(`${PLUGIN_DIR}/imgs/action.png`, placeholderPng);
writeFileSync(`${PLUGIN_DIR}/imgs/action@2x.png`, placeholderPng);
writeFileSync(`${PLUGIN_DIR}/imgs/plugin.png`, placeholderPng);
writeFileSync(`${PLUGIN_DIR}/imgs/plugin@2x.png`, placeholderPng);
writeFileSync(`${PLUGIN_DIR}/imgs/category.png`, placeholderPng);
writeFileSync(`${PLUGIN_DIR}/imgs/category@2x.png`, placeholderPng);

console.log("Build complete → " + PLUGIN_DIR);
