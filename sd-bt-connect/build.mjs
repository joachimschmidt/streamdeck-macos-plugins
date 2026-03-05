import { build } from "esbuild";
import { cpSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { execSync } from "child_process";

const PLUGIN_DIR = "com.local.bt-connect.sdPlugin";

mkdirSync(`${PLUGIN_DIR}/bin`, { recursive: true });
mkdirSync(`${PLUGIN_DIR}/ui`, { recursive: true });
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
cpSync("ui/settings.html", `${PLUGIN_DIR}/ui/settings.html`);

// Compile Swift bt-info helper as universal binary (ARM64 + x86_64)
console.log("Compiling bt-info helper (universal binary)...");
execSync("swiftc helpers/bt-info.swift -o helpers/bt-info-arm64 -target arm64-apple-macosx10.15 -framework IOBluetooth", { stdio: "inherit" });
execSync("swiftc helpers/bt-info.swift -o helpers/bt-info-x86 -target x86_64-apple-macosx10.15 -framework IOBluetooth", { stdio: "inherit" });
execSync("lipo -create helpers/bt-info-arm64 helpers/bt-info-x86 -output helpers/bt-info", { stdio: "inherit" });
execSync("rm helpers/bt-info-arm64 helpers/bt-info-x86");
cpSync("helpers/bt-info", `${PLUGIN_DIR}/bin/bt-info`);
chmodSync(`${PLUGIN_DIR}/bin/bt-info`, 0o755);

// Placeholder icons
const placeholderPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAFElEQVQ4y2NgGAWjYBSMglEwCogHAATYAAGEIJLfAAAAAElFTkSuQmCC",
  "base64"
);
for (const name of ["action", "plugin", "category"]) {
  writeFileSync(`${PLUGIN_DIR}/imgs/${name}.png`, placeholderPng);
  writeFileSync(`${PLUGIN_DIR}/imgs/${name}@2x.png`, placeholderPng);
}

console.log("Build complete → " + PLUGIN_DIR);
