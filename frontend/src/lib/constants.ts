import { PublicKey } from "@solana/web3.js";

// ─── Network ────────────────────────────────────────────────────────────────

export const SOLANA_NETWORK = "testnet" as const;
export const RPC_URLS = [
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL1,
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL2,
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
  process.env.NEXT_PUBLIC_RPC_URL,
  "https://api.testnet.solana.com",
]
  .map((url) => url?.trim())
  .filter((url): url is string => Boolean(url))
  .filter((url, index, list) => list.indexOf(url) === index);
export const RPC_URL = RPC_URLS[0];
export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.solana.com";
export const PUBLIC_TOKEN_MINTS = (
  process.env.NEXT_PUBLIC_TOKEN_MINTS ?? ""
)
  .split(",")
  .map((mint) => mint.trim())
  .filter(Boolean);
export const PUBLIC_TOKEN_HOLDER_INDEX = (
  process.env.NEXT_PUBLIC_TOKEN_HOLDER_INDEX ?? ""
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [mint, wallet] = entry.split(":").map((part) => part.trim());
    return { mint, wallet };
  })
  .filter((entry) => Boolean(entry.mint && entry.wallet));
export const KYC_PROVIDER_WALLET =
  process.env.NEXT_PUBLIC_KYC_PROVIDER_WALLET ?? "";
export const AML_PROVIDER_WALLET =
  process.env.NEXT_PUBLIC_AML_PROVIDER_WALLET ?? "";

// ─── Core Program IDs ────────────────────────────────────────────────────────

export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
export const FACTORY_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_FACTORY_PROGRAM_ID ?? "6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe"
);
export const TOKEN_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_TOKEN_PROGRAM_ID ?? "92MCTz2KpWqhSD7LWay97LmZbdmpAj4fJ3FXtV7rbW9s"
);
export const TOKEN_HOOK_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_TOKEN_HOOK_PROGRAM_ID ?? "4sLPqAViuzo1yJJExKn2TfP42enBQPhvAUZq5japm85m"
);
export const COMPLIANCE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_COMPLIANCE_PROGRAM_ID ?? "FhMXw2VmYYksR4VcjQCUNWYrhzba1rmfiU1EDvaTsxHj"
);
export const IRP_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_IRP_PROGRAM_ID ?? "C8jtErJYtuu7pSZczfSm1JvDmv254Nmmw1KLX6rBdY8o"
);
export const IRS_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_IRS_PROGRAM_ID ?? "GSLErK4bEfF6ZozTWfjYikWfnBitMYrdbbgfXubJBgVJ"
);
export const FID_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_FID_PROGRAM_ID ?? "EoENMXgL9GZBEVfjhn5KU4SkfjZeyoTEdd8NHAcMQsEB"
);
export const TIR_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_TIR_PROGRAM_ID ?? "8KDYYPx74w6ZLKZgcvVWrj1mCv1gcULdTh2jbxcJwGMJ"
);
export const CTR_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_CTR_PROGRAM_ID ?? "12rCF9fuSth8T3o6sfpfWdGyaDEQ1jNsxe1ZvKH7q2tS"
);

// ─── Governance / Deployment PDAs ────────────────────────────────────────────

export const GOVERNANCE_MULTISIG = new PublicKey(
  "8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm"
);
export const VAULT_PDA = new PublicKey(
  "CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z"
);
export const FRONTEND_DEPLOYMENT_PDA = new PublicKey(
  "HTfp61aqvFfM8rXaCRVnC4vcsDqVEtp1yqHDeNSNszEx"
);

// ─── Compliance Module Program IDs ───────────────────────────────────────────

export const MOD_MAX_INVESTORS = new PublicKey(
  "FMSVzD74EbSiTj2XHi8xsqcp6pigdxHL7MGHxtRLYte7"
);
export const MOD_COUNTRY_RESTRICT = new PublicKey(
  "6JcKpK45GvhwaPRZoEfLFCNos2eCxCr3N3tGzzaC1ECQ"
);
export const MOD_MAX_BALANCE = new PublicKey(
  "8r9euzP3dFg8d3sA6fh3Ur73cMbvEAbj5UbigHVEXimZ"
);
export const MOD_MAX_TRANSFER = new PublicKey(
  "8EiBd6256x7CfFE1vqGLGBqviiCs64ubZzTVmDwjnQAw"
);
export const MOD_LOCKUP = new PublicKey(
  "GqsAXZggWEwVF9EFHHXiAKiKBkcrpzQp3SK7NPZWAfR5"
);
export const MOD_DAILY_LIMIT = new PublicKey(
  "EmCSJJLnshcnC7jLHmcHKN3XbMjnHY9mZDMYF1Xppig9"
);
export const MOD_SUPPLY_CAP = new PublicKey(
  "EGJvV5cBN7et6Pdthyj6z7xuN8FN2u1wtGQsUjR69Rxb"
);
export const MOD_COUNTRY_CAP = new PublicKey(
  "HgJQy5kxbmVGHJs68U1axyWsyWTqkPme8YEhv1QU72sW"
);

// ─── PDA Seed Constants ───────────────────────────────────────────────────────

export const SEED_TOKEN_STATE = Buffer.from("token_state");
export const SEED_OWNER = Buffer.from("owner");
export const SEED_AGENT = Buffer.from("agent");
export const SEED_COMPLIANCE_STATE = Buffer.from("compliance_state");
export const SEED_FACTORY_STATE = Buffer.from("factory_state");
export const SEED_DEPLOYMENT = Buffer.from("deployment");
export const SEED_IRP_STATE = Buffer.from("irp_state");
export const SEED_IRS_STATE = Buffer.from("irs_state");
export const SEED_TIR_STATE = Buffer.from("tir_state");
export const SEED_CTR_STATE = Buffer.from("ctr_state");
export const SEED_WALLET_IDENTITY = Buffer.from("wallet_identity");
export const SEED_FID = Buffer.from("fid");
export const SEED_CLAIM = Buffer.from("claim");
export const SEED_ISSUER_ENTRY = Buffer.from("issuer_entry");
export const SEED_TRANSFER_APPROVAL = Buffer.from("transfer_approval");
export const SEED_EXTRA_ACCOUNT_METAS = Buffer.from("extra-account-metas");
export const SEED_FROZEN_WALLET = Buffer.from("frozen_wallet");
export const SEED_PARTIAL_FREEZE = Buffer.from("partial_freeze");
export const SEED_DAILY_USAGE = Buffer.from("daily_wallet_usage");
export const SEED_COUNTRY_COUNT = Buffer.from("country_investor_count");

// ─── Compliance Modules Registry ─────────────────────────────────────────────

export interface ComplianceModuleDefinition {
  id: string;
  name: string;
  programId: PublicKey;
  description: string;
  fields: ComplianceModuleField[];
}

export interface ComplianceModuleField {
  key: string;
  label: string;
  type: "number" | "bigint" | "timestamp" | "countries" | "country_caps";
  required: boolean;
  description: string;
}

export const COMPLIANCE_MODULES: ComplianceModuleDefinition[] = [
  {
    id: "max_investors",
    name: "Max Investors",
    programId: MOD_MAX_INVESTORS,
    description: "Limits the maximum number of unique token holders.",
    fields: [
      {
        key: "max_investors",
        label: "Maximum Investors",
        type: "number",
        required: true,
        description: "Maximum number of unique token holders allowed.",
      },
    ],
  },
  {
    id: "country_restrict",
    name: "Country Restriction",
    programId: MOD_COUNTRY_RESTRICT,
    description: "Blocks transfers to or from wallets in restricted countries.",
    fields: [
      {
        key: "blocked_countries",
        label: "Blocked Countries",
        type: "countries",
        required: true,
        description: "ISO 3166-1 numeric country codes to block.",
      },
    ],
  },
  {
    id: "max_balance",
    name: "Max Balance",
    programId: MOD_MAX_BALANCE,
    description:
      "Prevents any single wallet from holding more than the configured balance.",
    fields: [
      {
        key: "max_balance",
        label: "Maximum Balance",
        type: "bigint",
        required: true,
        description: "Maximum token balance a wallet may hold (in base units).",
      },
    ],
  },
  {
    id: "max_transfer",
    name: "Max Transfer",
    programId: MOD_MAX_TRANSFER,
    description: "Caps the size of a single transfer.",
    fields: [
      {
        key: "max_amount",
        label: "Maximum Transfer Amount",
        type: "bigint",
        required: true,
        description:
          "Maximum amount that may be transferred in a single transaction (in base units).",
      },
    ],
  },
  {
    id: "lockup",
    name: "Lockup",
    programId: MOD_LOCKUP,
    description: "Prevents all transfers until the lockup period expires.",
    fields: [
      {
        key: "lockup_end",
        label: "Lockup End (Unix timestamp)",
        type: "timestamp",
        required: true,
        description: "Unix timestamp after which transfers are permitted.",
      },
    ],
  },
  {
    id: "daily_limit",
    name: "Daily Transfer Limit",
    programId: MOD_DAILY_LIMIT,
    description: "Restricts the total volume a wallet can transfer per day.",
    fields: [
      {
        key: "daily_limit",
        label: "Daily Limit",
        type: "bigint",
        required: true,
        description:
          "Maximum cumulative transfer volume per wallet per 24-hour window (in base units).",
      },
    ],
  },
  {
    id: "supply_cap",
    name: "Supply Cap",
    programId: MOD_SUPPLY_CAP,
    description: "Enforces an absolute cap on the total token supply.",
    fields: [
      {
        key: "max_supply",
        label: "Maximum Supply",
        type: "bigint",
        required: true,
        description: "Hard cap on the total token supply (in base units).",
      },
    ],
  },
  {
    id: "country_cap",
    name: "Country Investor Cap",
    programId: MOD_COUNTRY_CAP,
    description:
      "Limits the number of investors from any individual country.",
    fields: [
      {
        key: "country_caps",
        label: "Country Caps",
        type: "country_caps",
        required: true,
        description:
          "Per-country investor caps expressed as {country: number, cap: number}[].",
      },
    ],
  },
];

// ─── Explorer Helpers ─────────────────────────────────────────────────────────

export function getExplorerTxUrl(signature: string): string {
  return `${EXPLORER_URL}/tx/${signature}?cluster=${SOLANA_NETWORK}`;
}

export function getExplorerAccountUrl(address: string | PublicKey): string {
  const addr =
    typeof address === "string" ? address : address.toBase58();
  return `${EXPLORER_URL}/address/${addr}?cluster=${SOLANA_NETWORK}`;
}
