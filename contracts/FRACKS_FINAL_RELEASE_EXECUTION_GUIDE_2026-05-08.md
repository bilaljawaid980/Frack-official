# FRACKS Final Release Execution Guide

Date: 2026-05-08

## Purpose

This guide documents the exact remaining steps to complete the factory governed upgrade that is already staged on Solana testnet.

## Current Staged State

- multisig: `8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm`
- vault PDA: `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`
- threshold: `2-of-3`
- factory program: `6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe`
- staged buffer: `AghYNVsNAuHTMQJEYYPUs7rfNqGiUeaPe5uq7uxoMh42`
- proposal PDA: `3jUe3dcJnu2z2F1VP9TUutvFrnQHsfShRs1WfpKVF5gB`
- vault transaction PDA: `2nVwSoxecJR6CBqjfANjTp5D8i79FmZiHvBoLq4CH3jJ`
- transaction index: `1`
- first approval already recorded from `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`

## Step 1: Second Approval

Run from either remaining member key:

```bash
squads-multisig-cli proposal-vote \
  --rpc-url https://api.testnet.solana.com \
  --keypair /path/to/second-signer.json \
  --multisig-pubkey 8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm \
  --transaction-index 1 \
  --action Approve
```

Valid second signers:

- `4kft3w42bJdgfJQFdwd1VxMXGb7cr2akFeA3XqZrxUSN`
- `GZb3c8AwLUv2HGjHmsP7wThuHxJZbonStW3hweCWppAZ`

## Step 2: Execute The Vault Transaction

After the second approval:

```bash
squads-multisig-cli vault-transaction-execute \
  --rpc-url https://api.testnet.solana.com \
  --keypair /path/to/executor-signer.json \
  --multisig-pubkey 8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm \
  --transaction-index 1
```

## Step 3: Verify Factory Program Authority

```bash
solana program show 6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe \
  --url https://api.testnet.solana.com \
  --output json
```

Expected:

- `authority` = `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`

## Step 4: Re-run Authority Audit

```bash
node scripts/governance/audit_upgrade_authorities.js \
  --cluster testnet \
  --rpc-url https://api.testnet.solana.com \
  --expected-authority CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z
```

Expected:

- `mismatches: 0`

## Step 5: Re-run Protocol Validation

```bash
anchor build
anchor test --skip-build --skip-lint
```

Expected:

- build succeeds
- tests pass

## Important Operational Note

Do not use the local `squads-multisig-cli initiate-program-upgrade` path for this multisig/program combination until the serialization bug is fixed upstream or a locally patched CLI is installed. The staged proposal on testnet was created with a corrected Squads SDK path that encoded the inner message as a Squads `TransactionMessage`.
