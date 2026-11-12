// Starts the server and the web dev server together, on any OS.
// Tools are launched with node directly instead of through npm's .cmd shims,
// which break on Windows when the folder path contains "&".
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = (...p) => path.join(root, "node_modules", ...p);

const jobs = [
  { name: "server", cwd: path.join(root, "server"), args: [bin("tsx", "dist", "cli.mjs"), "watch", "src/index.ts"] },
  { name: "web", cwd: path.join(root, "web"), args: [bin("vite", "bin", "vite.js")] },
];

const children = jobs.map((job) => {
  const child = spawn(process.execPath, job.args, { cwd: job.cwd, stdio: "inherit" });
  child.on("exit", (code) => {
    console.log(`[${job.name}] exited${code === null ? "" : ` with code ${code}`}`);
    for (const other of children) if (other !== child && other.exitCode === null) other.kill();
    process.exitCode = code ?? 0;
  });
  return child;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) if (child.exitCode === null) child.kill(signal);
  });
}
