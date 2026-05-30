# FRACKS Full Governance Guide

Date: 2026-05-08

## Overview

FRACKS uses Squads-based multisig governance for program upgrade custody. The intended model is:

- shared core and module programs are governed by a protocol multisig
- token-suite operational ownership can be issuer-specific and may also be multisig-controlled
- upgrade custody and issuer operational ownership are distinct control planes

## Multisig Setup

Current testnet governance configuration:

- multisig: `8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm`
- threshold: `2-of-3`
- signers:
  - `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`
  - `4kft3w42bJdgfJQFdwd1VxMXGb7cr2akFeA3XqZrxUSN`
  - `GZb3c8AwLUv2HGjHmsP7wThuHxJZbonStW3hweCWppAZ`
- vault PDA: `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`

## Governance Custody Model

### Protocol Level

- `fracks_factory`
- `fracks_token`
- `fracks_token_hook`
- `fracks_fid`
- `fracks_irp`
- `fracks_irs`
- `fracks_tir`
- `fracks_ctr`
- `fracks_compliance`
- all configured compliance modules

All of the above now verify to the vault PDA on testnet.

### Issuer Level

Issuer-facing control is separate from upgrade custody. Typical controls:

- token owner
- compliance owner
- registry ownership
- agent management

Best practice:

- deploy new issuer suites directly under the final issuer multisig
- avoid EOA-first deployment if the steady-state owner is intended to be governed

## Why PDA Authorities Need Special Handling

The Solana CLI expects signer-based authority checks. A Squads vault PDA is not a normal signer keypair. Two consequences follow:

1. assigning a PDA as new authority needs:

```bash
--skip-new-upgrade-authority-signer-check
```

2. future upgrades cannot be done unilaterally with the normal signer-only deploy flow

## How Solana Upgradeable Loader Custody Works

- the executable program points at a `ProgramData` account
- the `ProgramData` account stores authority metadata
- when authority is a multisig PDA, execution must happen through the multisig program path

## Governance Upgrade Flow Through Squads

Intended release flow:

1. build program artifact
2. write buffer to chain
3. create Squads proposal
4. vote approvals until threshold reached
5. execute vault transaction
6. verify upgraded program and unchanged authority

## Governance Migration Runbook

### Transfer From Signer To Vault PDA

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <VAULT_PDA> \
  --skip-new-upgrade-authority-signer-check \
  --url https://api.testnet.solana.com
```

### Verify After Transfer

```bash
solana program show <PROGRAM_ID> --url https://api.testnet.solana.com --output json
```

Expected:

- `authority` equals the vault PDA

## Operational Policy

### Approval Policy

- at least one technical reviewer
- at least one business/compliance approver
- no emergency upgrade from a single signer

### Key Management

- hardware wallets preferred for production signers
- separate workstation from daily development machines
- maintain documented signer rotation procedure

### Emergency Recovery

- retain tested process for replacing a compromised signer
- retain tested process for pausing future upgrades while governance is reconstituted

## Governance Execution Status

The original execution-tooling blocker has been diagnosed and worked around.

Verified root cause:

- local `squads-multisig-cli` crate version: `0.1.7`
- local Squads SDK crate version used for the workaround: `squads-multisig = 2.1.0`
- local Squads program crate version used for the workaround: `squads-multisig-program = 2.0.0`
- on-chain Squads program: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
- the CLI command `initiate-program-upgrade` serialized the inner upgrade message with Solana `v0::Message::serialize()`
- the Squads v4 program expects a Squads `TransactionMessage` payload for `vault_transaction_create`

Operational result:

- a valid governed factory-upgrade proposal was created on testnet
- proposal PDA: `3jUe3dcJnu2z2F1VP9TUutvFrnQHsfShRs1WfpKVF5gB`
- vault transaction PDA: `2nVwSoxecJR6CBqjfANjTp5D8i79FmZiHvBoLq4CH3jJ`
- proposal creation signature: `2M8yEsjHbfDoAy8nFYKQrdhBDYJ2X83arGUtPWGMWsv97NtVHNfzXVDhhWQNZ6esNGAmuZox46UPT4NsH66AMXpN`
- first approval signature: `XmtuKvQvxEY1C3LBgAvvWtfjd6j3NWQzNfKvdXWj2N5mhRiMpHwcyDDi9d66qx2jDGXXvZ5jLqkQyKUMHrr9mDq`
- on-chain proposal state now records one approval from `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`

## Current Open Governance Issue

The remaining blocker is no longer Squads serialization compatibility. The remaining blocker is signer availability in this environment.

Current state:

- threshold remains `2-of-3`
- only one governed signer key was available locally during this release session
- the proposal is active and valid, but not yet executable until a second signer approves it

Required follow-up:

- obtain approval from either `4kft3w42bJdgfJQFdwd1VxMXGb7cr2akFeA3XqZrxUSN` or `GZb3c8AwLUv2HGjHmsP7wThuHxJZbonStW3hweCWppAZ`
- execute the vault transaction through Squads after the second approval
- verify the factory program upgrade completed and that upgrade authority remains `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`
