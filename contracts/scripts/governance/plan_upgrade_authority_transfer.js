#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const ANCHOR_TOML = path.join(ROOT, "Anchor.toml");
const DEFAULT_CLUSTER = process.env.FRACKS_CLUSTER || "testnet";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function parseProgramIds(cluster) {
  const source = fs.readFileSync(ANCHOR_TOML, "utf8");
  const lines = source.split(/\r?\n/);
  const sectionHeader = `[programs.${cluster}]`;
  const start = lines.findIndex((line) => line.trim() === sectionHeader);
  if (start === -1) {
    throw new Error(`Cluster section ${sectionHeader} not found in Anchor.toml`);
  }

  const programIds = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("[")) {
      break;
    }
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]+)"$/);
    if (!match) {
      continue;
    }
    programIds.push({ name: match[1], programId: match[2] });
  }
  return programIds;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cluster = flags.cluster || DEFAULT_CLUSTER;
  const targetAuthority = flags["target-authority"] || process.env.FRACKS_PROTOCOL_MULTISIG;
  const rpcUrl = flags["rpc-url"] || process.env.ANCHOR_PROVIDER_URL || process.env.SOLANA_URL;

  if (!targetAuthority) {
    throw new Error("Missing --target-authority or FRACKS_PROTOCOL_MULTISIG");
  }

  const programs = parseProgramIds(cluster);
  for (const program of programs) {
    const parts = [
      "solana",
      "program",
      "set-upgrade-authority",
      program.programId,
      "--new-upgrade-authority",
      targetAuthority,
    ];
    if (rpcUrl) {
      parts.push("--url", rpcUrl);
    }
    console.log(`# ${program.name}`);
    console.log(parts.join(" "));
    console.log("");
  }
}

main();
