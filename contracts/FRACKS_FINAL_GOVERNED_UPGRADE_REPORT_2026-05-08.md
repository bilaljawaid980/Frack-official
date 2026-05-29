# FRACKS Final Governed Upgrade Report

Date: 2026-05-08

## Executive Summary

The Squads-governed factory upgrade path was successfully restored to a working proposal path on Solana testnet. The original failure was caused by the local `squads-multisig-cli` upgrade wrapper serializing the inner program-upgrade transaction in the wrong format for Squads v4 `vault_transaction_create`.

The result of this session is:

- valid factory upgrade proposal created on testnet
- first multisig approval recorded on-chain
- protocol upgrade authorities still fully governed by the Squads vault PDA
- final execute step still pending because only one of the three multisig member keys was available in this environment

## Governance Topology

- multisig: `8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm`
- vault PDA: `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`
- threshold: `2-of-3`
- live members:
  - `4kft3w42bJdgfJQFdwd1VxMXGb7cr2akFeA3XqZrxUSN`
  - `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`
  - `GZb3c8AwLUv2HGjHmsP7wThuHxJZbonStW3hweCWppAZ`

## Versions Used

- Squads CLI crate installed locally: `squads-multisig-cli 0.1.7`
- Squads SDK crate used for workaround: `squads-multisig 2.1.0`
- Squads on-chain multisig program crate layout matched: `squads-multisig-program 2.0.0`
- on-chain Squads program ID: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`

## Root Cause

Observed failure from the stock CLI path:

```text
Transaction simulation failed:
Error processing Instruction 1:
Failed to serialize or deserialize account data
```

Verified cause:

- `initiate-program-upgrade` in the installed CLI built the inner upgrade payload with Solana `v0::Message::serialize()`
- Squads v4 `vault_transaction_create` expects a Squads `TransactionMessage` payload
- this caused the live multisig program to reject the transaction during deserialization

Control check:

- the same CLI and live program could decode the multisig and derive the vault correctly
- the fault was in proposal payload construction, not in FRACKS protocol code and not in multisig custody

## Governed Upgrade Artifacts

- program to upgrade: `6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe`
- program name: `fracks_factory`
- upgrade buffer: `AghYNVsNAuHTMQJEYYPUs7rfNqGiUeaPe5uq7uxoMh42`
- buffer write signature: `wSLGYozdsiQKp4SRj1WaLhjGk4ERqn2H3zaMwMNiq41M5ShxM`
- vault transaction PDA: `2nVwSoxecJR6CBqjfANjTp5D8i79FmZiHvBoLq4CH3jJ`
- proposal PDA: `3jUe3dcJnu2z2F1VP9TUutvFrnQHsfShRs1WfpKVF5gB`
- proposal creation signature: `2M8yEsjHbfDoAy8nFYKQrdhBDYJ2X83arGUtPWGMWsv97NtVHNfzXVDhhWQNZ6esNGAmuZox46UPT4NsH66AMXpN`
- first approval signature: `XmtuKvQvxEY1C3LBgAvvWtfjd6j3NWQzNfKvdXWj2N5mhRiMpHwcyDDi9d66qx2jDGXXvZ5jLqkQyKUMHrr9mDq`

## On-Chain Proposal State

Decoded directly from the live proposal account after approval:

- transaction index: `1`
- proposal status variant: `1`
- approved signers:
  - `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`
- rejected signers: none
- cancelled signers: none

Interpretation:

- the proposal is active and valid
- one approval is recorded
- one additional approval is still required before execution

## Verification

Authority audit after proposal creation:

- expected authority: `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`
- mismatches: `0`

Build and tests:

- `anchor build` passed
- `anchor test --skip-build --skip-lint` passed with `30 passing`

## Explorer Links

- multisig:
  - https://explorer.solana.com/address/8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm?cluster=testnet
- vault PDA:
  - https://explorer.solana.com/address/CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z?cluster=testnet
- factory program:
  - https://explorer.solana.com/address/6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe?cluster=testnet
- buffer:
  - https://explorer.solana.com/address/AghYNVsNAuHTMQJEYYPUs7rfNqGiUeaPe5uq7uxoMh42?cluster=testnet
- proposal:
  - https://explorer.solana.com/address/3jUe3dcJnu2z2F1VP9TUutvFrnQHsfShRs1WfpKVF5gB?cluster=testnet
- vault transaction:
  - https://explorer.solana.com/address/2nVwSoxecJR6CBqjfANjTp5D8i79FmZiHvBoLq4CH3jJ?cluster=testnet
- proposal creation signature:
  - https://explorer.solana.com/tx/2M8yEsjHbfDoAy8nFYKQrdhBDYJ2X83arGUtPWGMWsv97NtVHNfzXVDhhWQNZ6esNGAmuZox46UPT4NsH66AMXpN?cluster=testnet
- approval signature:
  - https://explorer.solana.com/tx/XmtuKvQvxEY1C3LBgAvvWtfjd6j3NWQzNfKvdXWj2N5mhRiMpHwcyDDi9d66qx2jDGXXvZ5jLqkQyKUMHrr9mDq?cluster=testnet

## Remaining Blocker

The remaining blocker is operational signer access, not governance compatibility.

Still required:

1. approve proposal `3jUe3dcJnu2z2F1VP9TUutvFrnQHsfShRs1WfpKVF5gB` with either `4kft3w42...` or `GZb3c8Aw...`
2. execute vault transaction `2nVwSoxecJR6CBqjfANjTp5D8i79FmZiHvBoLq4CH3jJ`
3. verify the upgraded factory binary and unchanged upgrade authority

## Conservative Conclusion

The final governance execution blocker was partially closed:

- proposal-initiation tooling is now proven workable
- one governed approval is proven workable
- full governed execution is not yet proven from this session because the environment did not include a second member signer
