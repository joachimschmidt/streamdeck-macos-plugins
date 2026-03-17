import { build } from "esbuild";
import { cpSync, mkdirSync, writeFileSync, existsSync } from "fs";

const PLUGIN_DIR = "com.local.claude-usage.sdPlugin";

mkdirSync(`${PLUGIN_DIR}/bin`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/imgs`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/ui`, { recursive: true });

await build({
  entryPoints: ["src/plugin.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: `${PLUGIN_DIR}/bin/plugin.js`,
});

cpSync("manifest.json", `${PLUGIN_DIR}/manifest.json`);

if (existsSync("ui/settings.html")) {
  cpSync("ui/settings.html", `${PLUGIN_DIR}/ui/settings.html`);
}

const placeholderPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAFElEQVQ4y2NgGAWjYBSMglEwCogHAATYAAGEIJLfAAAAAElFTkSuQmCC",
  "base64"
);
for (const name of ["action", "plugin", "category"]) {
  writeFileSync(`${PLUGIN_DIR}/imgs/${name}.png`, placeholderPng);
  writeFileSync(`${PLUGIN_DIR}/imgs/${name}@2x.png`, placeholderPng);
}
