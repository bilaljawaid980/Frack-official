# FRACKS Final Governance Execution Report

Date: 2026-05-08

## Outcome

Governance custody remains green and the Squads execution path is now validated through:

- successful governed proposal creation for a factory upgrade
- successful on-chain approval from one authorized signer
- successful post-action authority audit with `mismatches: 0`

What is not yet complete:

- the actual `vault_transaction_execute` step
- post-execution verification of the upgraded factory binary on testnet

## Exact Commands Used

### Buffer Staging

```bash
solana program write-buffer target/deploy/fracks_factory.so \
  --url https://api.testnet.solana.com
```

### Authority Audit

```bash
node scripts/governance/audit_upgrade_authorities.js \
  --cluster testnet \
  --rpc-url https://api.testnet.solana.com \
  --expected-authority CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z
```

### Local Approval

```bash
squads-multisig-cli proposal-vote \
  --rpc-url https://api.testnet.solana.com \
  --keypair /root/.config/solana/id.json \
  --multisig-pubkey 8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm \
  --transaction-index 1 \
  --action Approve
```

### Corrected Proposal-Creation Path

The stock `initiate-program-upgrade` CLI path failed. The working path used a Squads SDK helper that compiled the inner upgrade instruction into a Squads `TransactionMessage` and then submitted:

- `vault_transaction_create`
- `proposal_create`

in one outer transaction.

## Exact Live State

- multisig: `8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm`
- vault PDA: `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`
- threshold: `2-of-3`
- current proposal index: `1`
- proposal PDA: `3jUe3dcJnu2z2F1VP9TUutvFrnQHsfShRs1WfpKVF5gB`
- vault transaction PDA: `2nVwSoxecJR6CBqjfANjTp5D8i79FmZiHvBoLq4CH3jJ`
- creator signer: `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`
- approved signers currently recorded:
  - `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`

## Signatures

- buffer write:
  - `wSLGYozdsiQKp4SRj1WaLhjGk4ERqn2H3zaMwMNiq41M5ShxM`
- proposal creation:
  - `2M8yEsjHbfDoAy8nFYKQrdhBDYJ2X83arGUtPWGMWsv97NtVHNfzXVDhhWQNZ6esNGAmuZox46UPT4NsH66AMXpN`
- first approval:
  - `XmtuKvQvxEY1C3LBgAvvWtfjd6j3NWQzNfKvdXWj2N5mhRiMpHwcyDDi9d66qx2jDGXXvZ5jLqkQyKUMHrr9mDq`
- execution:
  - not available yet

## Why Execution Did Not Finish

This environment contained only one of the three multisig member keypairs.

Available local signer:

- `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`

Not available locally during this session:

- `4kft3w42bJdgfJQFdwd1VxMXGb7cr2akFeA3XqZrxUSN`
- `GZb3c8AwLUv2HGjHmsP7wThuHxJZbonStW3hweCWppAZ`

Because the threshold is `2-of-3`, the vault transaction cannot be executed honestly from this machine alone.

## Required Final Steps

1. Have either remaining signer approve proposal `3jUe3dcJnu2z2F1VP9TUutvFrnQHsfShRs1WfpKVF5gB`.
2. Execute vault transaction `2nVwSoxecJR6CBqjfANjTp5D8i79FmZiHvBoLq4CH3jJ`.
3. Verify:
   - `fracks_factory` upgraded successfully
   - upgrade authority still equals `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`
   - `anchor build` and `anchor test --skip-build --skip-lint` remain green
