#!/usr/bin/env node

const { PublicKey } = require("@solana/web3.js");
const { collectProgramAddresses, parseCliArgs } = require("./_lib/runner");

const PROGRAMS = collectProgramAddresses();

function littleEndianU64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function littleEndianU16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(Number(value));
  return buffer;
}

function getProgram(programName) {
  const value = PROGRAMS[programName];
  if (!value) {
    throw new Error(`Unknown program: ${programName}`);
  }
  return value;
}

function requireFlag(flags, name) {
  const value = flags[name] || flags[name.replace(/_/g, "-")];
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

function parseSaltHex(rawValue) {
  const normalized = String(rawValue).replace(/^0x/, "");
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error("Salt must be a hex string");
  }
  if (normalized.length !== 64) {
    throw new Error(`Salt must be exactly 32 bytes (64 hex chars), received ${normalized.length} hex chars`);
  }
  return Buffer.from(normalized, "hex");
}

function derive(kind, flags) {
  switch (kind) {
    case "fid":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("fid"), new PublicKey(requireFlag(flags, "wallet")).toBuffer()],
        getProgram("fracks_fid"),
      );
    case "claim":
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("claim"),
          new PublicKey(requireFlag(flags, "fid")).toBuffer(),
          littleEndianU64(requireFlag(flags, "claim_id")),
        ],
        getProgram("fracks_fid"),
      );
    case "irs-state":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("irs_state"), new PublicKey(requireFlag(flags, "owner")).toBuffer()],
        getProgram("fracks_irs"),
      );
    case "wallet-identity":
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("wallet_identity"),
          new PublicKey(requireFlag(flags, "irs")).toBuffer(),
          new PublicKey(requireFlag(flags, "wallet")).toBuffer(),
        ],
        getProgram("fracks_irs"),
      );
    case "tir-state":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("tir_state"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("fracks_tir"),
      );
    case "issuer-entry":
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("issuer_entry"),
          new PublicKey(requireFlag(flags, "tir")).toBuffer(),
          new PublicKey(requireFlag(flags, "issuer_fid")).toBuffer(),
        ],
        getProgram("fracks_tir"),
      );
    case "ctr-state":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("ctr_state"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("fracks_ctr"),
      );
    case "irp-state":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("irp_state"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("fracks_irp"),
      );
    case "compliance-state":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("compliance_state"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("fracks_compliance"),
      );
    case "token-state":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("token_state"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("fracks_token"),
      );
    case "owner-state":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("owner"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("fracks_token"),
      );
    case "agent-role":
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("agent"),
          new PublicKey(requireFlag(flags, "mint")).toBuffer(),
          new PublicKey(requireFlag(flags, "agent")).toBuffer(),
        ],
        getProgram("fracks_token"),
      );
    case "frozen-wallet":
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("frozen"),
          new PublicKey(requireFlag(flags, "mint")).toBuffer(),
          new PublicKey(requireFlag(flags, "wallet")).toBuffer(),
        ],
        getProgram("fracks_token"),
      );
    case "partial-freeze":
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("partial_freeze"),
          new PublicKey(requireFlag(flags, "mint")).toBuffer(),
          new PublicKey(requireFlag(flags, "wallet")).toBuffer(),
        ],
        getProgram("fracks_token"),
      );
    case "factory-state":
      return PublicKey.findProgramAddressSync([Buffer.from("factory_state")], getProgram("fracks_factory"));
    case "deployment":
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("deployment"),
          new PublicKey(requireFlag(flags, "issuer")).toBuffer(),
          parseSaltHex(requireFlag(flags, "salt")),
        ],
        getProgram("fracks_factory"),
      );
    case "mod-country-restrict":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("mod_country"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("mod_country_restrict"),
      );
    case "mod-country-cap":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("mod_country_cap"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("mod_country_cap"),
      );
    case "country-count":
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("country_count"),
          new PublicKey(requireFlag(flags, "module")).toBuffer(),
          littleEndianU16(requireFlag(flags, "country")),
        ],
        getProgram("mod_country_cap"),
      );
    case "mod-daily-limit":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("mod_daily_limit"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("mod_daily_limit"),
      );
    case "mod-lockup":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("mod_lockup"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("mod_lockup"),
      );
    case "mod-max-balance":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("mod_max_balance"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("mod_max_balance"),
      );
    case "mod-max-investors":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("mod_max_investors"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("mod_max_investors"),
      );
    case "mod-max-transfer":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("mod_max_transfer"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("mod_max_transfer"),
      );
    case "mod-supply-cap":
      return PublicKey.findProgramAddressSync(
        [Buffer.from("mod_supply_cap"), new PublicKey(requireFlag(flags, "mint")).toBuffer()],
        getProgram("mod_supply_cap"),
      );
    default:
      throw new Error(`Unsupported PDA kind: ${kind}`);
  }
}

function main() {
  const { flags, positionals } = parseCliArgs(process.argv.slice(2));
  const kind = positionals[0];
  if (!kind || flags.help) {
    console.log("Usage: node scripts/cli/derive-pda.js <kind> [flags]");
    console.log("");
    console.log("Kinds:");
    console.log("  fid --wallet");
    console.log("  claim --fid --claim_id");
    console.log("  irs-state --owner");
    console.log("  wallet-identity --irs --wallet");
    console.log("  tir-state --mint");
    console.log("  issuer-entry --tir --issuer_fid");
    console.log("  ctr-state --mint");
    console.log("  irp-state --mint");
    console.log("  compliance-state --mint");
    console.log("  token-state --mint");
    console.log("  owner-state --mint");
    console.log("  agent-role --mint --agent");
    console.log("  frozen-wallet --mint --wallet");
    console.log("  partial-freeze --mint --wallet");
    console.log("  factory-state");
    console.log("  deployment --issuer --salt <32-byte-hex-no-0x>");
    console.log("  mod-country-restrict --mint");
    console.log("  mod-country-cap --mint");
    console.log("  country-count --module --country");
    console.log("  mod-daily-limit --mint");
    console.log("  mod-lockup --mint");
    console.log("  mod-max-balance --mint");
    console.log("  mod-max-investors --mint");
    console.log("  mod-max-transfer --mint");
    console.log("  mod-supply-cap --mint");
    return;
  }

  const [pubkey, bump] = derive(kind, flags);
  console.log(JSON.stringify({ kind, pubkey: pubkey.toBase58(), bump }, null, 2));
}

main();
