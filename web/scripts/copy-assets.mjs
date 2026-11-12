// Copies Excalidraw's fonts into public/ so drawings work without a CDN.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The package may be hoisted to the workspace root, so look upwards for it.
let pkg = "";
for (let dir = here; dir !== path.dirname(dir); dir = path.dirname(dir)) {
  const candidate = path.join(dir, "node_modules", "@excalidraw", "excalidraw");
  if (existsSync(candidate)) {
    pkg = candidate;
    break;
  }
}
const from = path.join(pkg, "dist", "prod", "fonts");
const to = path.join(here, "..", "public", "excalidraw-assets", "fonts");
if (!existsSync(from)) {
  console.warn("Excalidraw fonts not found at", from);
  process.exit(0);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log("Copied Excalidraw fonts to public/excalidraw-assets/fonts");
