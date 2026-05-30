#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const manifestPath = path.resolve(__dirname, "manifest.json");
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

for (const [program, entries] of grouped.entries()) {
  console.log(`${program} (${entries[0].address || "unknown-address"})`);
  for (const entry of entries) {
    const suffix = entry.returns ? ` [view default, returns ${entry.returns}]` : "";
    console.log(`  - ${entry.instruction}: ${entry.script}${suffix}`);
  }
  console.log("");
}
