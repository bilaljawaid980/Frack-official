#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const manifestPath = path.resolve(__dirname, "manifest.json");
const outputPath = path.resolve(__dirname, "..", "..", "FRACKS_CLI_COMMAND_REFERENCE.md");

if (!fs.existsSync(manifestPath)) {
  console.error("manifest.json is missing. Run `node scripts/cli/generate.js` first.");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const grouped = new Map();

for (const entry of manifest) {
  if (!grouped.has(entry.program)) {
    grouped.set(entry.program, []);
  }
  grouped.get(entry.program).push(entry);
}

const lines = [];
lines.push("# FRACKS CLI Command Reference");
lines.push("");
lines.push("This file is generated from the built IDLs in `target/idl` and reflects the current contract instruction surface.");
lines.push("");
lines.push("Every command is a dedicated wrapper script under `scripts/cli/<program>/<instruction>.js`.");
lines.push("");
lines.push("Common behavior:");
lines.push("- Write instructions default to `--mode rpc`.");
lines.push("- Read instructions with return values default to `--mode view`.");
lines.push("- Use `--print-schema` on any script to print the exact required args and accounts.");
lines.push("- Use `--provider-url` and `--wallet-path` to override `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET`.");
lines.push("- Use `--remaining-accounts-file <path.json>` for instructions that need dynamic module or hook accounts.");
lines.push("");

for (const [program, entries] of grouped.entries()) {
  lines.push(`## ${program}`);
  lines.push("");
  lines.push(`Program address: \`${entries[0].address || "unknown"}\``);
  lines.push("");
  lines.push("| Instruction | Script | Args | Accounts | Default mode |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const entry of entries) {
    const args = entry.args.length === 0
      ? "none"
      : entry.args.map((arg) => `\`--${arg.name}\``).join(", ");
    const accounts = entry.accounts.length === 0
      ? "none"
      : entry.accounts.map((account) => `\`--${account.name}\``).join(", ");
    const mode = entry.returns ? `view (${entry.returns})` : "rpc";
    lines.push(`| \`${entry.instruction}\` | \`${entry.script}\` | ${args} | ${accounts} | ${mode} |`);
  }
  lines.push("");
}

fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Wrote ${outputPath}`);
