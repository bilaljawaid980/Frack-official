#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const manifestPath = path.resolve(__dirname, "manifest.json");
const outputPath = path.resolve(__dirname, "..", "..", "FRACKS_CLI_TEST_CASES.md");

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

const overrides = {
  "fracks_fid:add_claim": {
    success: "Issue a valid signed claim from an issuer FID to a target FID. Expect the claim PDA to be created with `revoked = false`.",
    negative: "Flip one byte in `--signature` and rerun. Expect `InvalidClaimSignature`.",
  },
  "fracks_fid:create_fid": {
    success: "Create a new FID for a wallet that does not already own one. Expect the FID PDA to initialize.",
    negative: "Run it a second time for the same wallet/FID PDA. Expect duplicate creation to fail.",
  },
  "fracks_irp:is_verified": {
    success: "Use a wallet with IRS identity, required CTR topic, and a trusted active issuer claim. Expect `true`.",
    negative: "Remove the identity, revoke the claim, expire the claim, or deactivate the issuer. Expect `false`.",
  },
  "fracks_tir:is_trusted_for_topic": {
    success: "Query an active issuer entry that contains the requested topic. Expect `true`.",
    negative: "Query an inactive issuer or missing topic. Expect `false`.",
  },
  "fracks_compliance:can_transfer": {
    success: "Evaluate a transfer that satisfies all bound modules. Expect `true`.",
    negative: "Pass a transfer that violates at least one bound module. Expect `false`.",
  },
  "fracks_token_hook:execute_transfer_hook": {
    success: "Invoke through the canonical Token-2022 transfer-hook path after controller approval. Expect the hook to finalize verification/compliance bookkeeping.",
    negative: "Call without a matching approval, with spoofed extra accounts, or outside a Token-2022 transfer invocation. Expect rejection.",
  },
  "fracks_token_hook:initialize_extra_account_metas": {
    success: "Initialize the Token-2022 extra-account-metas PDA for a configured FRACKS mint and compliance module set. Expect the TLV account to be created.",
    negative: "Use a non-canonical mint, wrong token state, or incomplete module remaining accounts. Expect rejection.",
  },
  "fracks_token:transfer": {
    success: "Approve a compliant Token-2022 transfer with all required IRP/IRS/TIR/CTR/compliance accounts and any module remaining accounts. Expect an approval transaction signature, followed by a canonical Token-2022 transfer-hook movement.",
    negative: "Try a non-compliant transfer, paused token, or frozen wallet path. Expect rejection.",
  },
  "fracks_token:mint": {
    success: "Mint through an authorized agent to a verified and compliant wallet. Expect a transaction signature.",
    negative: "Try minting while paused, to a frozen wallet, or to an unverified wallet. Expect rejection.",
  },
  "fracks_token:burn": {
    success: "Burn through an authorized agent from a verified holder. Expect a transaction signature.",
    negative: "Try from an unauthorized agent or with missing identity/compliance context. Expect rejection.",
  },
  "fracks_token:forced_transfer": {
    success: "Move tokens through an authorized agent between compliant wallets. Expect a transaction signature.",
    negative: "Use an unauthorized agent or invalid compliance inputs. Expect rejection.",
  },
  "fracks_token:recovery": {
    success: "Recover balances from a lost wallet to a verified replacement wallet through an authorized agent. Expect a transaction signature.",
    negative: "Use an unauthorized agent or an ineligible replacement identity. Expect rejection.",
  },
  "fracks_factory:deploy_token_suite": {
    success: "After `create_token_mint`, deploy a full token suite with all pre-derived PDAs and optional trusted issuer/module remaining accounts. Expect linked state accounts and extra-account-metas to initialize.",
    negative: "Reuse the same deployment PDA inputs or omit required linked accounts. Expect deployment failure.",
  },
  "fracks_factory:create_token_mint": {
    success: "Create a real Token-2022 mint account with TransferHook and PermanentDelegate extensions before suite deployment. Expect the mint account to initialize.",
    negative: "Reuse an initialized mint or pass a non-signing mint account. Expect rejection.",
  },
};

function genericSuccess(entry) {
  const name = entry.instruction;
  if (name.startsWith("initialize_")) {
    return "Run against a fresh PDA. Expect the state account to be initialized.";
  }
  if (name.startsWith("add_")) {
    return "Run after the parent state exists. Expect the new member, topic, or agent record to be added.";
  }
  if (name.startsWith("remove_")) {
    return "Run after the target record exists. Expect it to be removed or closed.";
  }
  if (name.startsWith("update_")) {
    return "Run after initialization with a new value. Expect the target field set to the new value.";
  }
  if (name.startsWith("bind_")) {
    return "Run after both state accounts exist. Expect the referenced module or registry to be recorded.";
  }
  if (name.startsWith("unbind_")) {
    return "Run after the binding exists. Expect the reference to be removed.";
  }
  if (name.startsWith("set_")) {
    return "Run after initialization with the new config value. Expect the config field or pause bit to update.";
  }
  if (name.startsWith("transfer_")) {
    return "Run after the source state exists. Expect the pending owner or owner field to update according to the instruction.";
  }
  if (name.startsWith("accept_")) {
    return "Run as the pending owner. Expect ownership finalization.";
  }
  if (name.startsWith("is_") || name === "can_transfer") {
    return "Run in default view mode. Expect a boolean response.";
  }
  if (name === "pause" || name === "unpause") {
    return "Run as the owner and confirm the paused state flips.";
  }
  if (name.startsWith("freeze_") || name.startsWith("unfreeze_")) {
    return "Run as an authorized agent and confirm the target freeze state changes.";
  }
  if (name === "created" || name === "destroyed" || name === "transferred") {
    return "Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed.";
  }
  if (name === "register_identity") {
    return "Register a wallet to an initialized IRS state. Expect the wallet identity PDA to initialize.";
  }
  if (name === "initialize_country_count") {
    return "Initialize the per-country counter PDA for a configured country cap module. Expect the counter account to be created.";
  }
  return "Run with the schema accounts and valid state prerequisites. Expect a successful transaction.";
}

function genericNegative(entry) {
  const name = entry.instruction;
  if (name.startsWith("initialize_")) {
    return "Retry against the same PDA. Expect duplicate initialization to fail.";
  }
  if (name.startsWith("add_")) {
    return "Retry the same addition or use an unauthorized signer. Expect rejection.";
  }
  if (name.startsWith("remove_") || name.startsWith("unbind_")) {
    return "Call it from an unauthorized signer or against a missing record. Expect rejection.";
  }
  if (name.startsWith("update_") || name.startsWith("set_")) {
    return "Call it from an unauthorized signer. Expect rejection.";
  }
  if (name.startsWith("transfer_") || name.startsWith("accept_")) {
    return "Use a non-owner or wrong pending owner. Expect rejection.";
  }
  if (name.startsWith("is_") || name === "can_transfer") {
    return "Remove the prerequisite state or pass violating inputs. Expect `false` or simulation failure.";
  }
  if (name.startsWith("freeze_") || name.startsWith("unfreeze_")) {
    return "Use a non-agent or wrong PDA. Expect rejection.";
  }
  if (name === "created" || name === "destroyed" || name === "transferred") {
    return "Use incomplete remaining accounts or unauthorized owners where required. Expect failure.";
  }
  return "Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection.";
}

const lines = [];
lines.push("# FRACKS CLI Test Cases");
lines.push("");
lines.push("This file is the manual test matrix for the generated CLI wrappers.");
lines.push("");
lines.push("Use these files together:");
lines.push("- `FRACKS_CLI_SCRIPTS_GUIDE.md` for environment setup and execution order.");
lines.push("- `FRACKS_CLI_COMMAND_REFERENCE.md` for exact script paths, args, and account flags.");
lines.push("- `node <script> --print-schema` when you want the live IDL-backed schema for one instruction.");
lines.push("");
lines.push("Conventions:");
lines.push("- A success case means the instruction should return a transaction signature or a boolean `true`/`false` response in view mode, depending on the instruction.");
lines.push("- A negative case means you intentionally break one prerequisite to confirm the contract rejects bad state transitions.");
lines.push("");

for (const [program, entries] of grouped.entries()) {
  lines.push(`## ${program}`);
  lines.push("");
  lines.push("| Instruction | Script | Success case | Negative case |");
  lines.push("| --- | --- | --- | --- |");
  for (const entry of entries) {
    const key = `${entry.program}:${entry.instruction}`;
    const override = overrides[key];
    const success = override ? override.success : genericSuccess(entry);
    const negative = override ? override.negative : genericNegative(entry);
    lines.push(`| \`${entry.instruction}\` | \`${entry.script}\` | ${success} | ${negative} |`);
  }
  lines.push("");
}

fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Wrote ${outputPath}`);
