import { build } from "esbuild";
import { cpSync, mkdirSync, writeFileSync } from "fs";

const PLUGIN_DIR = "com.local.memory-monitor.sdPlugin";

mkdirSync(`${PLUGIN_DIR}/bin`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/imgs`, { recursive: true });

await build({
  entryPoints: ["src/plugin.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: `${PLUGIN_DIR}/bin/plugin.js`,
});

cpSync("manifest.json", `${PLUGIN_DIR}/manifest.json`);

const placeholderPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAFElEQVQ4y2NgGAWjYBSMglEwCogHAATYAAGEIJLfAAAAAElFTkSuQmCC",
  "base64"
);
for (const name of ["action", "plugin", "category"]) {
  writeFileSync(`${PLUGIN_DIR}/imgs/${name}.png`, placeholderPng);
  writeFileSync(`${PLUGIN_DIR}/imgs/${name}@2x.png`, placeholderPng);
}

console.log("Build complete → " + PLUGIN_DIR);
