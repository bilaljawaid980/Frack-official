# FRACKS Full Deployment Guide

Date: 2026-05-08  
Audience: protocol engineers, auditors, maintainers

## Section A — Environment Setup

### Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable
rustc --version
cargo --version
```

### Solana CLI

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
solana --version
```

### Anchor

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
anchor --version
```

### Node And npm

```bash
node --version
npm --version
```

If Node is missing, install from your platform package manager or NodeSource and confirm:

```bash
node --version
npm --version
```

### Validator Setup

Local validator:

```bash
solana-test-validator --reset
```

Testnet configuration:

```bash
solana config set --url https://api.testnet.solana.com
solana config get
```

### Wallet Creation

```bash
solana-keygen new --outfile ~/.config/solana/id.json
solana-keygen pubkey ~/.config/solana/id.json
```

### Funding Wallets

Localnet:

```bash
solana airdrop 100
```

Testnet:

```bash
solana balance --url https://api.testnet.solana.com
```

Use faucet or funded operational wallets as needed.

## Section B — Project Setup

### Repository Setup

```bash
git clone <repo-url>
cd ERC3436
npm install
```

### Anchor Configuration

Check [Anchor.toml](/root/ERC3436/Anchor.toml). Important values:

- test cluster
- localnet/testnet program IDs
- wallet path
- workspace members

### Build Commands

```bash
anchor build
```

### Test Commands

```bash
anchor test --skip-build --skip-lint
```

### Common Troubleshooting

- If `IDL not found`, run `anchor build` first.
- If CLI wrappers are missing new instructions, run:

```bash
npm run cli:generate
```

- If testnet RPC is flaky, re-run with `solana config get` and verify cluster.

## Section C — Program Deployment

### Standard Deploy

Initial deploy or upgrade authority still on local signer:

```bash
solana program deploy target/deploy/<program>.so --url https://api.testnet.solana.com
```

### Write Buffer

Governed release staging:

```bash
solana program write-buffer target/deploy/fracks_factory.so --url https://api.testnet.solana.com
```

### Upgrade Via Governance

Once authority is on Squads, do not use unilateral `solana program deploy`.

Use:

1. buffer write
2. Squads proposal creation
3. threshold approvals
4. Squads execution

### Verification Commands

```bash
solana program show <PROGRAM_ID> --url https://api.testnet.solana.com --output json
```

### Explorer Verification

- address: `https://explorer.solana.com/address/<ADDRESS>?cluster=testnet`
- transaction: `https://explorer.solana.com/tx/<SIGNATURE>?cluster=testnet`

## Section D — Token-2022 Deployment

### Mint Creation

FRACKS factory uses `create_token_mint` to create a Token-2022 mint configured for:

- transfer hook
- permanent delegate

### Transfer Hook Setup

The hook program is `fracks_token_hook`. The mint is created with the hook extension enabled and the FRACKS controller path expects approval before the hook transfer succeeds.

### Extra-Account-Meta Setup

The hook extra-account-meta PDA is initialized during suite deployment:

- used to encode the controller/compliance account set
- must stay consistent with the module set

### Compliance Integration

During `deploy_token_suite`, the factory:

- initializes token, IRP, IRS, TIR, CTR, compliance state
- binds compliance modules
- initializes extra-account-metas

### Hook Validation

Use the existing tests as the canonical validation set:

- malformed extra-account-metas rejected
- fake compliance state rejected
- fake module PDAs rejected
- replayed approvals rejected

## Section E — Factory Deployment Flow

### Factory Initialization

Current repo-side migration entrypoint:

```bash
anchor run deploy
```

Repo-side migration now supports:

- `FRACKS_FACTORY_OWNER`
- `FRACKS_PROTOCOL_MULTISIG`

### PDA Derivation

Examples:

- `factory_state`: `[b"factory_state"]`
- `deployment`: `[b"deployment", issuer, salt]`
- `token_state`: `[b"token_state", mint]`
- `owner_state`: `[b"owner", mint]`
- `irs_state`: `[b"irs_state", owner]`
- `tir_state`: `[b"tir_state", mint]`
- `ctr_state`: `[b"ctr_state", mint]`
- `irp_state`: `[b"irp_state", mint]`
- `compliance_state`: `[b"compliance_state", mint]`

### deploy_token_suite Flow

Canonical CLI schema:

```bash
node scripts/cli/fracks_factory/deploy_token_suite.js --print-schema
```

Expected deployment phases:

1. create Token-2022 mint
2. initialize token state and owner state
3. initialize CTR and claim topics
4. initialize TIR and issuer entries
5. initialize or reuse IRS
6. initialize IRP
7. bind IRS to IRP
8. initialize compliance state
9. bind compliance modules
10. initialize hook extra-account-metas
11. record `TokenDeployment`

### Remaining Accounts Structure

Order matters:

1. trusted issuer entry PDAs
2. compliance module PDAs

Support accounts for transfers are provided later by controller/hook flows, not by factory deployment itself.

### Issuer Registration Flow

High-level issuer flow:

1. issuer FID exists
2. trusted issuer entries are added to TIR
3. claim topics are added to CTR
4. IRS/IRP/compliance/token state are linked

## Section F — Governance Setup

### Squads Multisig Setup

Required items:

- multisig address
- threshold
- members
- vault index
- vault PDA

Current testnet values:

- multisig: `8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm`
- threshold: `2-of-3`
- vault PDA: `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`

### Governance Custody Model

- all shared FRACKS programs point to the Squads vault PDA as upgrade authority
- individual signers do not directly own upgrade authority after migration
- upgrades must be performed through the multisig

### Authority Transfer Process

From a wallet that is still the current upgrade authority:

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <VAULT_PDA> \
  --skip-new-upgrade-authority-signer-check \
  --url https://api.testnet.solana.com
```

### Why `--skip-new-upgrade-authority-signer-check` Is Required

The new authority is a PDA, not a conventional externally controlled signer wallet. The CLI cannot produce a signature for that PDA, so the check must be skipped at assignment time.

### Governance Execution Model

Once the PDA is the authority:

- direct signer-based upgrades stop working
- Squads must derive/sign through its own program logic
- the proposal, approval, and execution path becomes mandatory

## Section G — Governance Migration

### How Upgrade Authorities Were Migrated

On 2026-05-08, the remaining mismatched testnet programs were transferred from deployer wallet `7LA1...` to vault PDA `Cftz...`.

### Exact Command Pattern Used

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z \
  --skip-new-upgrade-authority-signer-check \
  --url https://api.testnet.solana.com
```

### ProgramData Explanation

Upgradeable Solana programs are split between:

- the executable program account
- the `ProgramData` account that stores the deployable bytes and authority metadata

`solana program show` surfaces:

- `programId`
- `programdataAddress`
- `authority`
- `lastDeploySlot`

### Rent-Exempt SOL Explanation

Buffers and `ProgramData` accounts consume SOL to remain rent exempt. This is why writing a buffer for a large program requires a meaningful SOL balance.

## Section H — Final Testnet Deployment State

### Program IDs

Use the mapping in [FRACKS_FINAL_AUDIT_REPORT_2026-05-08.md](/root/ERC3436/FRACKS_FINAL_AUDIT_REPORT_2026-05-08.md).

### Governance Multisig

- multisig: `8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm`
- vault PDA: `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`

### Final Upgrade Authorities

All configured FRACKS core and module programs now verify to the vault PDA.

### Buffer Staging

- factory buffer: `AghYNVsNAuHTMQJEYYPUs7rfNqGiUeaPe5uq7uxoMh42`

### Governance Proposal Status

- proposal creation attempted
- not completed due local Squads CLI deserialization error

## Section I — Mainnet Checklist

- hardware-backed signer custody
- version-matched Squads operator tooling
- successful governed testnet upgrade dry run
- clean build from release commit
- full test pass from release commit
- final buffer hash recorded
- final proposal index recorded
- final execution signature recorded
- post-upgrade authority verification recorded
