import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = execFileSync("git", ["-C", repoRoot, "ls-files", "--", "*.md"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);

const checks = [
  {
    name: "private key material",
    pattern: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i,
  },
  {
    name: "common access-token prefix",
    pattern: /(?:gh[pousr]_|github_pat_|AIza|xox[baprs]-|AKIA[0-9A-Z]{16})/,
  },
  {
    name: "personal email address",
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  },
  {
    name: "local user path",
    pattern: /(?:[A-Z]:[\\/]+Users[\\/]|\/Users\/)/i,
  },
  {
    name: "environment project identifier",
    pattern: /app-vendedores-shimano/i,
  },
  {
    name: "secret-administration command",
    pattern:
      /(?:gcloud\s+secrets|functions:secrets:(?:access|set|destroy|prune)|secretmanager\.googleapis\.com)/i,
  },
];

const failures = [];

for (const file of files) {
  const source = readFileSync(resolve(repoRoot, file), "utf8");

  for (const check of checks) {
    if (check.pattern.test(source)) {
      failures.push(file + ": " + check.name);
    }
  }
}

if (failures.length > 0) {
  console.error("Documentation safety check failed:");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log(
  "Documentation safety check passed (" + files.length + " Markdown files).",
);
