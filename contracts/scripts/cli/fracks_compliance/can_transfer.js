#!/usr/bin/env node

const { runInstructionCli } = require("../_lib/runner");

runInstructionCli({ programName: "fracks_compliance", instructionName: "can_transfer" }).catch((error) => {
  const debugEnabled = process.argv.includes("--debug") || ["1", "true", "yes", "on"].includes(String(process.env.FRACKS_DEBUG || "").toLowerCase());
  console.error(debugEnabled && error.stack ? error.stack : error.message);
  process.exit(1);
});
