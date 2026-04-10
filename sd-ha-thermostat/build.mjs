import { build } from "esbuild";
import { cpSync, mkdirSync, writeFileSync } from "fs";

const PLUGIN_DIR = "com.local.ha-thermostat.sdPlugin";

mkdirSync(`${PLUGIN_DIR}/bin`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/ui`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/imgs`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/layouts`, { recursive: true });

await build({
  entryPoints: ["src/plugin.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: `${PLUGIN_DIR}/bin/plugin.js`,
});

cpSync("manifest.json", `${PLUGIN_DIR}/manifest.json`);
cpSync("ui/settings.html", `${PLUGIN_DIR}/ui/settings.html`);
cpSync("layouts/thermostat.json", `${PLUGIN_DIR}/layouts/thermostat.json`);

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
