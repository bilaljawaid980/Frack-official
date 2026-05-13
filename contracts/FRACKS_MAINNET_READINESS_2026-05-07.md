# FRACKS Mainnet Readiness Gate

Date: 2026-05-07

This note records the final governance and large transfer-hook account review after the Token-2022 controller/hook architecture and compliance-dispatch hardening were tested and deployed to Solana testnet.

## Current Verdict

FRACKS is testnet green for the audited Token-2022 hook path, but it is not mainnet green until program upgrade authority is moved away from the deployer wallet and into the protocol governance authority.

Mainnet readiness is blocked by governance custody, not by the specific daily-limit/country-cap hook bug.

## Verification Completed

- `anchor build` passed.
- `anchor test --skip-build --skip-lint` passed with `29 passing`.
- CLI wrapper schema smoke test passed.
- Testnet IDLs fetched successfully for `fracks_token` and `fracks_token_hook`.
- `fracks_token_hook` deployed to Solana testnet.
- `fracks_token` upgraded on Solana testnet after the compliance-dispatch fix.

## Testnet Deployment State

The following program metadata was confirmed on Solana testnet:

| Program | Program ID | Upgrade Authority |
| --- | --- | --- |
| `fracks_token` | `Gr9Y5q2aHtQEpYHgqme3hctqQ2sNRGF1ZVx9cQvMDjBn` | `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E` |
| `fracks_token_hook` | `CQwdsA97gSiPMUzNXjS22AUu6HmvzMK2XZVqhswYEHLi` | `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E` |

The current upgrade authority is a deployer wallet. That is acceptable for testnet iteration and unacceptable for mainnet regulated issuance.

## Governance Requirement

Before mainnet deployment, every core and module program must be controlled by a governance-grade authority, preferably Squads or another audited Solana multisig.

Minimum recommended policy:

- Use a 3-of-5 or stronger multisig for all program upgrade authorities.
- Use separate operational multisigs for high-value token owners and agent roles where practical.
- Require at least one independent technical reviewer and one business/compliance approver for program upgrades.
- Require a timelock or public upgrade notice period for production programs if the issuer governance model allows it.
- Store build artifacts, commit hash, program ids, IDL hashes, and deployment signatures in the release record.

Mainnet deployment must not leave upgrade authority on a single hot wallet.

## Upgrade Authority Transfer Runbook

After mainnet programs are deployed and verified, transfer each program authority to the governance multisig:

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <GOVERNANCE_MULTISIG> \
  --url https://api.mainnet-beta.solana.com
```

Verify each program after transfer:

```bash
solana program show <PROGRAM_ID> --url https://api.mainnet-beta.solana.com
```

The `Authority:` field must equal the governance multisig, not the deployer wallet.

Apply this to all FRACKS programs:

- `fracks_factory`
- `fracks_token`
- `fracks_token_hook`
- `fracks_fid`
- `fracks_irp`
- `fracks_irs`
- `fracks_tir`
- `fracks_ctr`
- `fracks_compliance`
- all compliance module programs

## Large Hook-Account Policy

FRACKS uses Token-2022 transfer hooks and extra-account-metas. Small module sets can fit controller approval and Token-2022 transfer in one legacy transaction. Larger module sets, especially those including stateful daily-limit and country-cap support accounts, can exceed the legacy transaction size limit.

Mainnet policy:

- Use a single transaction only when the fully assembled transaction is below the Solana packet limit.
- Use split transactions for large account sets:
  1. Submit the FRACKS controller approval transaction.
  2. Submit the Token-2022 `transfer_checked` transaction that consumes the transfer approval through the hook.
- Use versioned transactions and address lookup tables only after a dedicated client implementation and adversarial test pass.

The split-transaction model is acceptable because the transfer approval is bound to:

- token state
- source token account
- destination token account
- Token-2022 authority
- source wallet
- destination wallet
- exact amount
- source pre-transfer balance
- destination pre-transfer balance
- source country
- destination country
- transfer kind

A third party cannot consume a normal approval without the Token-2022 authority. A stale approval fails if balances no longer match the approval snapshot.

## Mainnet Gate Checklist

FRACKS can receive a mainnet green signal only after all checklist items are complete:

- `anchor build` passes from a clean checkout.
- Full local integration suite passes with the expected count.
- Public testnet deployment is verified.
- Mainnet program IDs are final and recorded.
- Mainnet IDLs are uploaded and fetched back for verification.
- Program upgrade authority for every program is transferred to governance multisig.
- Token owner, compliance owner, IRS owner, and agent roles are assigned according to issuer governance policy.
- Large hook-account transfers use split transactions or an audited versioned transaction/ALT client.
- A final release commit hash is recorded in the deployment record.

Until the governance transfer is complete, the correct status is:

```text
Testnet green. Mainnet not green.
```
