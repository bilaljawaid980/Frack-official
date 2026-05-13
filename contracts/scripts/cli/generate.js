#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { IDL_DIR, loadIdl } = require("./_lib/runner");

const OUTPUT_ROOT = path.resolve(__dirname);

function ensureDirectory(target) {
  fs.mkdirSync(target, { recursive: true });
}

function buildWrapper(programName, instructionName) {
  return `#!/usr/bin/env node

const { runInstructionCli } = require("../_lib/runner");

runInstructionCli({ programName: "${programName}", instructionName: "${instructionName}" }).catch((error) => {
  const debugEnabled = process.argv.includes("--debug") || ["1", "true", "yes", "on"].includes(String(process.env.FRACKS_DEBUG || "").toLowerCase());
  console.error(debugEnabled && error.stack ? error.stack : error.message);
  process.exit(1);
});
`;
}

function main() {
  const manifest = [];
  for (const entry of fs.readdirSync(IDL_DIR).filter((file) => file.endsWith(".json")).sort()) {
    const programName = entry.replace(/\.json$/, "");
    const idl = loadIdl(programName);
    const programDir = path.join(OUTPUT_ROOT, programName);
    ensureDirectory(programDir);

    for (const instruction of idl.instructions || []) {
      const wrapperPath = path.join(programDir, `${instruction.name}.js`);
      fs.writeFileSync(wrapperPath, buildWrapper(programName, instruction.name));
      fs.chmodSync(wrapperPath, 0o755);
      manifest.push({
        program: programName,
        address: idl.address || null,
        instruction: instruction.name,
        script: path.relative(path.resolve(__dirname, "..", ".."), wrapperPath).replace(/\\/g, "/"),
        returns: instruction.returns || null,
        args: instruction.args || [],
        accounts: instruction.accounts || [],
      });
    }
  }

  fs.writeFileSync(path.join(OUTPUT_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated ${manifest.length} CLI wrappers in ${OUTPUT_ROOT}`);
}

main();
