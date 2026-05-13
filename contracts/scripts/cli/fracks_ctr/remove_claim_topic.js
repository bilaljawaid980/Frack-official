#!/usr/bin/env node

const { runInstructionCli } = require("../_lib/runner");

runInstructionCli({ programName: "fracks_ctr", instructionName: "remove_claim_topic" }).catch((error) => {
  const debugEnabled = process.argv.includes("--debug") || ["1", "true", "yes", "on"].includes(String(process.env.FRACKS_DEBUG || "").toLowerCase());
  console.error(debugEnabled && error.stack ? error.stack : error.message);
  process.exit(1);
});
