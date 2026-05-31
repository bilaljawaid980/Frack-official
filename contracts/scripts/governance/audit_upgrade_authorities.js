#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

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

function showProgram(programId, rpcUrl) {
  const args = ["program", "show", programId, "--output", "json"];
  if (rpcUrl) {
    args.push("--url", rpcUrl);
  }
  const output = execFileSync("solana", args, { encoding: "utf8" });
  return JSON.parse(output);
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cluster = flags.cluster || DEFAULT_CLUSTER;
  const rpcUrl = flags["rpc-url"] || process.env.ANCHOR_PROVIDER_URL || process.env.SOLANA_URL;
  const expectedAuthority = flags["expected-authority"] || process.env.FRACKS_PROTOCOL_MULTISIG || null;
  const programs = parseProgramIds(cluster);

  const rows = [];
  let mismatches = 0;
  for (const program of programs) {
    const details = showProgram(program.programId, rpcUrl);
    const upgradeAuthority = details.programdataAddress ? (details.authority ?? null) : null;
    const status = expectedAuthority && upgradeAuthority !== expectedAuthority ? "MISMATCH" : "OK";
    if (status !== "OK") {
      mismatches += 1;
    }
    rows.push({
      program: program.name,
      programId: program.programId,
      upgradeAuthority: upgradeAuthority || "none",
      status,
    });
  }

  console.log(JSON.stringify({
    cluster,
    rpcUrl: rpcUrl || null,
    expectedAuthority,
    mismatches,
    programs: rows,
  }, null, 2));

  if (mismatches > 0) {
    process.exitCode = 2;
  }
}

main();
