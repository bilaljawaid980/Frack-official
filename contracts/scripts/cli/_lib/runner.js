#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const anchor = require("@coral-xyz/anchor");
const {
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} = require("@solana/web3.js");
const { createHash } = require("crypto");
let TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
let TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
let ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

try {
  const splToken = require("@solana/spl-token");
  TOKEN_2022_PROGRAM_ID = splToken.TOKEN_2022_PROGRAM_ID;
  TOKEN_PROGRAM_ID = splToken.TOKEN_PROGRAM_ID;
  ASSOCIATED_TOKEN_PROGRAM_ID = splToken.ASSOCIATED_TOKEN_PROGRAM_ID;
} catch (_error) {
  // Fall back to hard-coded canonical program IDs so the CLI works even if the package is missing.
}

const ROOT_DIR = path.resolve(__dirname, "../../..");
const IDL_DIR = path.join(ROOT_DIR, "target", "idl");
const DEFAULT_PROVIDER_URL = process.env.ANCHOR_PROVIDER_URL || process.env.SOLANA_URL || "http://127.0.0.1:8899";
const DEFAULT_WALLET = process.env.ANCHOR_WALLET || path.join(process.env.HOME || "/root", ".config", "solana", "id.json");

const PROGRAM_ALIASES = {
  fid_program: "fracks_fid",
  irp_program: "fracks_irp",
  irs_program: "fracks_irs",
  tir_program: "fracks_tir",
  ctr_program: "fracks_ctr",
  compliance_program: "fracks_compliance",
  token_program: "fracks_token",
  hook_program: "fracks_token_hook",
  factory_program: "fracks_factory",
};

const WELL_KNOWN_DEFAULTS = {
  system_program: SystemProgram.programId,
  clock: SYSVAR_CLOCK_PUBKEY,
  rent: SYSVAR_RENT_PUBKEY,
  instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
  instructions_sysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
  token_program_2022: TOKEN_2022_PROGRAM_ID,
  token_2022_program: TOKEN_2022_PROGRAM_ID,
  spl_token_program: TOKEN_PROGRAM_ID,
  associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
};

const DEFAULT_SIGNER_ACCOUNTS = new Set([
  "owner",
  "issuer",
  "issuer_owner",
  "agent",
  "authority",
  "pending_owner",
]);

function isDebugEnabled(flags = {}) {
  const raw = resolveFlag(flags, "debug");
  if (raw !== undefined) {
    return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
  }
  return ["1", "true", "yes", "on"].includes(String(process.env.FRACKS_DEBUG || "").toLowerCase());
}

function debugLog(enabled, label, value) {
  if (!enabled) {
    return;
  }
  if (value === undefined) {
    console.error(`[debug] ${label}`);
    return;
  }
  const rendered = typeof value === "string" ? value : JSON.stringify(serializeOutput(value), null, 2);
  console.error(`[debug] ${label}: ${rendered}`);
}

function snakeToCamel(value) {
  return value.replace(/_([a-z])/g, (_, next) => next.toUpperCase());
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function loadIdl(programName) {
  const idlPath = path.join(IDL_DIR, `${programName}.json`);
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found for ${programName}: ${idlPath}`);
  }
  return JSON.parse(fs.readFileSync(idlPath, "utf8"));
}

function collectProgramAddresses() {
  const addresses = {};
  for (const entry of fs.readdirSync(IDL_DIR).filter((file) => file.endsWith(".json"))) {
    const programName = entry.replace(/\.json$/, "");
    const idl = loadIdl(programName);
    if (idl.address) {
      addresses[programName] = new PublicKey(idl.address);
    }
  }
  return addresses;
}

function parseCliArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }
    const key = current.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { flags, positionals };
}

function resolveFlag(flags, ...candidates) {
  for (const name of candidates) {
    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      return flags[name];
    }
  }
  return undefined;
}

function loadJsonInput(rawValue) {
  if (rawValue === undefined) {
    return undefined;
  }

  // Already parsed object/array
  if (typeof rawValue !== "string") {
    return rawValue;
  }

  const candidate = rawValue.startsWith("@")
    ? rawValue.slice(1)
    : rawValue;

  const resolved = path.resolve(process.cwd(), candidate);

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  }

  return JSON.parse(rawValue);
}

function ensureArray(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }
  if (typeof rawValue === "string" && rawValue.includes(",")) {
    return rawValue
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return loadJsonInput(rawValue);
}

function parseInteger(rawValue, typeName) {
  if (typeof rawValue === "number") {
    return new anchor.BN(rawValue.toString());
  }
  if (typeof rawValue === "bigint") {
    return new anchor.BN(rawValue.toString());
  }
  if (typeof rawValue !== "string") {
    throw new Error(`Expected ${typeName} integer input, received ${typeof rawValue}`);
  }
  return new anchor.BN(rawValue);
}

function parseBytes(rawValue, expectedLength) {
  if (typeof rawValue === "string" && /^0x[0-9a-fA-F]+$/.test(rawValue)) {
    const bytes = Buffer.from(rawValue.slice(2), "hex");
    if (bytes.length !== expectedLength) {
      throw new Error(`Expected ${expectedLength} bytes, received ${bytes.length}`);
    }
    return [...bytes];
  }

  const arrayValue = ensureArray(rawValue);
  if (!Array.isArray(arrayValue) || arrayValue.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} byte values`);
  }
  return arrayValue.map((value) => Number(value));
}

function buildTypeRegistry(idl) {
  const registry = {};
  for (const entry of idl.types || []) {
    registry[entry.name] = entry.type;
  }
  return registry;
}

function parseTypedValue(rawValue, typeDef, typeRegistry) {
  if (typeDef === "pubkey") {
    return new PublicKey(rawValue);
  }
  if (typeDef === "string") {
    return String(rawValue);
  }
  if (typeDef === "bool") {
    if (typeof rawValue === "boolean") {
      return rawValue;
    }
    return ["1", "true", "yes"].includes(String(rawValue).toLowerCase());
  }
  if (["u8", "u16", "u32", "i8", "i16", "i32"].includes(typeDef)) {
    return Number(rawValue);
  }
  if (["u64", "u128", "i64", "i128"].includes(typeDef)) {
    return parseInteger(rawValue, typeDef);
  }

  if (typeof typeDef === "object" && typeDef !== null) {
    if (typeDef.array) {
      const [innerType, length] = typeDef.array;
      if (innerType !== "u8") {
        throw new Error(`Unsupported fixed array inner type: ${JSON.stringify(typeDef)}`);
      }
      return parseBytes(rawValue, length);
    }

    if (typeDef.vec) {
      const values = ensureArray(rawValue);
      if (!Array.isArray(values)) {
        throw new Error(`Expected array input for vector type: ${JSON.stringify(typeDef)}`);
      }
      return values.map((item) => parseTypedValue(item, typeDef.vec, typeRegistry));
    }

    if (typeDef.option) {
      if (rawValue === null || rawValue === undefined || rawValue === "null") {
        return null;
      }
      if (typeof rawValue === "object" && rawValue !== null && !Array.isArray(rawValue)) {
        if (Object.prototype.hasOwnProperty.call(rawValue, "some")) {
          return parseTypedValue(rawValue.some, typeDef.option, typeRegistry);
        }
        if (Object.prototype.hasOwnProperty.call(rawValue, "none")) {
          return null;
        }
      }
      return parseTypedValue(rawValue, typeDef.option, typeRegistry);
    }

    if (typeDef.defined) {
      const name = typeDef.defined.name;
      const structType = typeRegistry[name];
      if (!structType || structType.kind !== "struct") {
        throw new Error(`Unsupported defined type: ${name}`);
      }
      const objectValue = loadJsonInput(rawValue);
      if (typeof objectValue !== "object" || objectValue === null || Array.isArray(objectValue)) {
        throw new Error(`Expected object input for defined type ${name}`);
      }

      const parsed = {};
      for (const field of structType.fields) {
        const candidateNames = [field.name, camelToSnake(field.name), snakeToCamel(field.name)];
        const sourceName = candidateNames.find((name) => Object.prototype.hasOwnProperty.call(objectValue, name));
        if (!sourceName) {
          throw new Error(`Missing field ${field.name} for defined type ${name}`);
        }
        parsed[field.name] = parseTypedValue(objectValue[sourceName], field.type, typeRegistry);
      }
      return parsed;
    }
  }

  throw new Error(`Unsupported argument type: ${JSON.stringify(typeDef)}`);
}

function loadKeypair(walletPath) {
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function buildProvider(providerUrl, walletPath) {
  const connection = new Connection(providerUrl, "confirmed");
  const payer = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(payer);
  return new anchor.AnchorProvider(connection, wallet, anchor.AnchorProvider.defaultOptions());
}

function formatType(typeDef) {
  if (typeof typeDef === "string") {
    return typeDef;
  }
  if (typeDef.array) {
    return `[${formatType(typeDef.array[0])}; ${typeDef.array[1]}]`;
  }
  if (typeDef.vec) {
    return `vec<${formatType(typeDef.vec)}>`;
  }
  if (typeDef.option) {
    return `option<${formatType(typeDef.option)}>`;
  }
  if (typeDef.defined) {
    return typeDef.defined.name;
  }
  return JSON.stringify(typeDef);
}

function printSchema(programName, idl, instruction) {
  const address = idl.address || "unknown";
  console.log(`Program: ${programName}`);
  console.log(`Address: ${address}`);
  console.log(`Instruction: ${instruction.name}`);
  console.log("");
  console.log("Args:");
  if (instruction.args.length === 0) {
    console.log("  - none");
  } else {
    for (const arg of instruction.args) {
      console.log(`  - --${arg.name} <${formatType(arg.type)}>`);
    }
  }
  console.log("");
  console.log("Accounts:");
  for (const account of instruction.accounts) {
    const parts = [];
    if (account.signer) {
      parts.push("signer");
    }
    if (account.writable) {
      parts.push("writable");
    }
    if (account.address) {
      parts.push(`default=${account.address}`);
    }
    console.log(`  - --${account.name} <pubkey>${parts.length ? ` (${parts.join(", ")})` : ""}`);
  }
  console.log("");
  console.log("Optional flags:");
  console.log("  - --mode <rpc|view|simulate>");
  console.log("  - --provider-url <rpc-url>");
  console.log("  - --wallet-path <keypair-path>");
  console.log("  - --<signer-account>_keypair <keypair-path> for signer accounts that are not the wallet");
  console.log("  - --debug <true|false>");
  console.log("  - --remaining-accounts-file <path.json>");
  console.log("  - --remaining-accounts '<json-array>'");
}

function resolveDefaultAccount(accountName, programAddresses) {
  if (WELL_KNOWN_DEFAULTS[accountName]) {
    return WELL_KNOWN_DEFAULTS[accountName];
  }
  const alias = PROGRAM_ALIASES[accountName];
  if (alias && programAddresses[alias]) {
    return programAddresses[alias];
  }
  return null;
}

function buildAccounts(flags, instruction, programAddresses, walletPublicKey) {
  const accounts = {};
  for (const account of instruction.accounts) {
    const rawValue = resolveFlag(
      flags,
      account.name,
      account.name.replace(/_/g, "-"),
      snakeToCamel(account.name),
    );
    if (rawValue !== undefined) {
      accounts[snakeToCamel(account.name)] = new PublicKey(rawValue);
      continue;
    }
    if (account.address) {
      accounts[snakeToCamel(account.name)] = new PublicKey(account.address);
      continue;
    }
    const defaultValue = resolveDefaultAccount(account.name, programAddresses);
    if (defaultValue) {
      accounts[snakeToCamel(account.name)] = defaultValue;
      continue;
    }
    if (account.signer && DEFAULT_SIGNER_ACCOUNTS.has(account.name) && walletPublicKey) {
      accounts[snakeToCamel(account.name)] = walletPublicKey;
      continue;
    }
    throw new Error(`Missing required account flag --${account.name}`);
  }
  return accounts;
}

function buildArgs(flags, instruction, typeRegistry) {
  return instruction.args.map((arg) => {
    const rawValue = resolveFlag(flags, arg.name, arg.name.replace(/_/g, "-"), snakeToCamel(arg.name));
    if (rawValue === undefined) {
      throw new Error(`Missing required argument flag --${arg.name}`);
    }
    return parseTypedValue(rawValue, arg.type, typeRegistry);
  });
}

function buildExtraSigners(flags, instruction, accounts, walletPublicKey) {
  const signers = [];
  for (const account of instruction.accounts) {
    if (!account.signer) {
      continue;
    }
    const accountName = snakeToCamel(account.name);
    const accountPubkey = accounts[accountName];
    if (!accountPubkey || accountPubkey.equals(walletPublicKey)) {
      continue;
    }

    const keypairPath = resolveFlag(
      flags,
      `${account.name}_keypair`,
      `${account.name.replace(/_/g, "-")}-keypair`,
      `${accountName}Keypair`,
    );
    if (!keypairPath) {
      throw new Error(
        `Signer account --${account.name} is not the wallet; provide --${account.name}_keypair <path>`,
      );
    }

    const signer = loadKeypair(path.resolve(keypairPath));
    if (!signer.publicKey.equals(accountPubkey)) {
      throw new Error(
        `Keypair for --${account.name}_keypair resolves to ${signer.publicKey.toBase58()}, expected ${accountPubkey.toBase58()}`,
      );
    }
    signers.push(signer);
  }
  return signers;
}

function buildRemainingAccounts(flags) {
  const filePath = resolveFlag(flags, "remaining-accounts-file", "remaining_accounts_file");
  const rawValue = resolveFlag(flags, "remaining-accounts", "remaining_accounts");
  if (!filePath && !rawValue) {
    return [];
  }

  const parsed = filePath ? loadJsonInput(`@${filePath}`) : loadJsonInput(rawValue);
  if (!Array.isArray(parsed)) {
    throw new Error("Remaining accounts must be a JSON array");
  }

  return parsed.map((entry) => ({
    pubkey: new PublicKey(entry.pubkey),
    isSigner: Boolean(entry.isSigner),
    isWritable: Boolean(entry.isWritable),
  }));
}

async function buildAccountStateSummary(connection, accounts, remainingAccounts) {
  const entries = [];
  for (const [name, pubkey] of Object.entries(accounts)) {
    entries.push({ name, pubkey });
  }
  remainingAccounts.forEach((entry, index) => {
    entries.push({ name: `remaining[${index}]`, pubkey: entry.pubkey });
  });

  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = entry.pubkey.toBase58();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }

  const infos = await connection.getMultipleAccountsInfo(unique.map((entry) => entry.pubkey));
  return unique.map((entry, index) => ({
    name: entry.name,
    pubkey: entry.pubkey,
    exists: Boolean(infos[index]),
    owner: infos[index] ? infos[index].owner.toBase58() : null,
    lamports: infos[index] ? infos[index].lamports : 0,
    dataLength: infos[index] ? infos[index].data.length : 0,
  }));
}

function deriveFactoryExpectedAccounts(accounts, args) {
  const deployArgs = args[0] || {};
  const tokenMint = deployArgs.tokenMint || deployArgs.token_mint;
  const sharedIrs = deployArgs.sharedIrs || deployArgs.shared_irs || null;
  const salt = deployArgs.salt;
  const trustedIssuers = deployArgs.trustedIssuers || deployArgs.trusted_issuers || [];
  const expected = {};
  expected.tokenState = PublicKey.findProgramAddressSync(
    [Buffer.from("token_state"), tokenMint.toBuffer()],
    accounts.tokenProgram,
  )[0];
  expected.ownerState = PublicKey.findProgramAddressSync(
    [Buffer.from("owner"), tokenMint.toBuffer()],
    accounts.tokenProgram,
  )[0];
  expected.tirState = PublicKey.findProgramAddressSync(
    [Buffer.from("tir_state"), tokenMint.toBuffer()],
    accounts.tirProgram,
  )[0];
  expected.ctrState = PublicKey.findProgramAddressSync(
    [Buffer.from("ctr_state"), tokenMint.toBuffer()],
    accounts.ctrProgram,
  )[0];
  expected.irpState = PublicKey.findProgramAddressSync(
    [Buffer.from("irp_state"), tokenMint.toBuffer()],
    accounts.irpProgram,
  )[0];
  expected.complianceState = PublicKey.findProgramAddressSync(
    [Buffer.from("compliance_state"), tokenMint.toBuffer()],
    accounts.complianceProgram,
  )[0];
  expected.irsState = sharedIrs || PublicKey.findProgramAddressSync(
    [Buffer.from("irs_state"), accounts.issuer.toBuffer()],
    accounts.irsProgram,
  )[0];
  expected.deployment = PublicKey.findProgramAddressSync(
    [Buffer.from("deployment"), accounts.issuer.toBuffer(), Buffer.from(salt)],
    new PublicKey(loadIdl("fracks_factory").address),
  )[0];
  expected.trustedIssuerEntries = trustedIssuers.map((issuer) => PublicKey.findProgramAddressSync(
    [Buffer.from("issuer_entry"), expected.tirState.toBuffer(), (issuer.issuerFid || issuer.issuer_fid).toBuffer()],
    accounts.tirProgram,
  )[0]);
  return expected;
}

function summarizeFactoryMatches(accounts, remainingAccounts, expected) {
  return {
    deployment: {
      provided: accounts.deployment,
      expected: expected.deployment,
      match: accounts.deployment.equals(expected.deployment),
    },
    tokenState: {
      provided: accounts.tokenState,
      expected: expected.tokenState,
      match: accounts.tokenState.equals(expected.tokenState),
    },
    ownerState: {
      provided: accounts.ownerState,
      expected: expected.ownerState,
      match: accounts.ownerState.equals(expected.ownerState),
    },
    irsState: {
      provided: accounts.irsState,
      expected: expected.irsState,
      match: accounts.irsState.equals(expected.irsState),
    },
    tirState: {
      provided: accounts.tirState,
      expected: expected.tirState,
      match: accounts.tirState.equals(expected.tirState),
    },
    ctrState: {
      provided: accounts.ctrState,
      expected: expected.ctrState,
      match: accounts.ctrState.equals(expected.ctrState),
    },
    irpState: {
      provided: accounts.irpState,
      expected: expected.irpState,
      match: accounts.irpState.equals(expected.irpState),
    },
    complianceState: {
      provided: accounts.complianceState,
      expected: expected.complianceState,
      match: accounts.complianceState.equals(expected.complianceState),
    },
    trustedIssuerEntries: expected.trustedIssuerEntries.map((expectedPubkey, index) => ({
      index,
      provided: remainingAccounts[index] ? remainingAccounts[index].pubkey : null,
      expected: expectedPubkey,
      match: remainingAccounts[index] ? remainingAccounts[index].pubkey.equals(expectedPubkey) : false,
    })),
  };
}

async function runInstructionCli({ programName, instructionName }) {
  const idl = loadIdl(programName);
  const rawInstruction = (idl.instructions || []).find((entry) => entry.name === instructionName);
  if (!rawInstruction) {
    throw new Error(`Instruction ${instructionName} not found in ${programName}`);
  }

  const { flags } = parseCliArgs(process.argv.slice(2));
  const debugEnabled = isDebugEnabled(flags);
  if (flags.help || flags["print-schema"] || flags.schema) {
    printSchema(programName, idl, rawInstruction);
    return;
  }

  const providerUrl = resolveFlag(flags, "provider-url", "provider_url") || DEFAULT_PROVIDER_URL;
  const walletPath = path.resolve(resolveFlag(flags, "wallet-path", "wallet_path") || DEFAULT_WALLET);
  const mode = resolveFlag(flags, "mode") || (rawInstruction.returns ? "view" : "rpc");

  const provider = buildProvider(providerUrl, walletPath);
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);
  const runtimeInstruction = (program.idl.instructions || []).find((entry) => entry.name === snakeToCamel(instructionName));
  if (!runtimeInstruction) {
    throw new Error(`Anchor runtime instruction ${snakeToCamel(instructionName)} is not available on ${programName}`);
  }
  const typeRegistry = buildTypeRegistry(program.idl);
  const args = buildArgs(flags, runtimeInstruction, typeRegistry);
  debugLog(debugEnabled, "providerUrl", providerUrl);
  debugLog(debugEnabled, "walletPath", walletPath);
  debugLog(debugEnabled, "mode", mode);
  debugLog(debugEnabled, "parsedArgs", args);
  const programAddresses = collectProgramAddresses();
  const accounts = buildAccounts(flags, rawInstruction, programAddresses, provider.wallet.publicKey);
  const remainingAccounts = buildRemainingAccounts(flags);
  const extraSigners = buildExtraSigners(flags, rawInstruction, accounts, provider.wallet.publicKey);
  debugLog(debugEnabled, "accounts", accounts);
  debugLog(debugEnabled, "remainingAccounts", remainingAccounts);
  debugLog(debugEnabled, "extraSigners", extraSigners.map((signer) => signer.publicKey));

  if (debugEnabled && programName === "fracks_factory" && instructionName === "deploy_token_suite") {
    const expected = deriveFactoryExpectedAccounts(accounts, args);
    debugLog(debugEnabled, "factoryExpectedAccounts", expected);
    debugLog(debugEnabled, "factoryPdaMatches", summarizeFactoryMatches(accounts, remainingAccounts, expected));
    const accountStates = await buildAccountStateSummary(provider.connection, accounts, remainingAccounts);
    debugLog(debugEnabled, "accountStateSummary", accountStates);
  }

  const methodName = snakeToCamel(instructionName);
  if (typeof program.methods[methodName] !== "function") {
    throw new Error(`Anchor method ${methodName} is not available on ${programName}`);
  }

  const builder = program.methods[methodName](...args).accounts(accounts);
  if (remainingAccounts.length > 0) {
    builder.remainingAccounts(remainingAccounts);
  }
  if (extraSigners.length > 0) {
    builder.signers(extraSigners);
  }
  await applyInstructionSpecialCases({ program, programName, instructionName, args, accounts, builder });

  if (mode === "view") {
    const result = await builder.view();
    console.log(JSON.stringify(serializeOutput(result), null, 2));
    return;
  }

  if (mode === "simulate") {
    const result = await builder.simulate();
    console.log(JSON.stringify(serializeOutput(result), null, 2));
    return;
  }

  if (mode !== "rpc") {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const signature = await builder.rpc();
  const endpoint = provider.connection.rpcEndpoint;
  let explorer = "";
  if (endpoint.includes("devnet")) {
    explorer = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  } else if (endpoint.includes("testnet")) {
    explorer = `https://explorer.solana.com/tx/${signature}?cluster=testnet`;
  } else if (
    endpoint.includes("mainnet-beta")
    || endpoint.includes("mainnet")
    || endpoint.includes("api.mainnet")
  ) {
    explorer = `https://explorer.solana.com/tx/${signature}`;
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        program: programName,
        instruction: instructionName,
        signature,
        explorer,
      },
      null,
      2,
    ),
  );
}

function serializeOutput(value) {
  if (value instanceof PublicKey) {
    return value.toBase58();
  }
  if (value instanceof anchor.BN) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeOutput(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeOutput(entry)]));
  }
  return value;
}

async function applyInstructionSpecialCases({ program, programName, instructionName, args, accounts, builder }) {
  if (!(programName === "fracks_fid" && instructionName === "add_claim")) {
    return;
  }

  const issuerFid = accounts.issuerFid;
  const targetFid = accounts.targetFid;
  const issuerAccount = await program.account.fidAccount.fetch(issuerFid);
  const topic = args[0];
  const dataHash = Buffer.from(args[1]);
  const signature = Uint8Array.from(args[2]);
  const expiresAt = args[3];

  const payload = Buffer.concat([
    issuerFid.toBuffer(),
    targetFid.toBuffer(),
    topic.toArrayLike(Buffer, "le", 8),
    dataHash,
    expiresAt.toArrayLike(Buffer, "le", 8),
  ]);
  const message = createHash("sha256").update(payload).digest();
  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: issuerAccount.signerKey.toBytes(),
    message,
    signature,
  });

  builder.preInstructions([ed25519Ix]);
}

module.exports = {
  IDL_DIR,
  ROOT_DIR,
  collectProgramAddresses,
  loadIdl,
  parseCliArgs,
  runInstructionCli,
  serializeOutput,
  snakeToCamel,
};
