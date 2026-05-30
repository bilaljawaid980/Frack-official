# FRACKS Testing Guide

Date: 2026-05-06

## Quick commands

Run all tests against a running local validator:

```bash
anchor test --skip-build
```

Rebuild all programs and IDLs:

```bash
anchor build
```

Check only the token crate:

```bash
cargo check -p fracks-token
```

## Current passing test suites

The latest confirmed runtime pass is:

- `29 passing`

Covered suites:

- `fracks-fid phase 1`
- `fracks-irs phase 2`
- `fracks-tir phase 2`
- `fracks-ctr phase 2`
- `fracks-irp phase 3`
- `fracks-compliance phase 3`
- `fracks-token phase 4 hardening`
- `fracks-factory and sdk phase 6`

## Function coverage map

### FID

Covered by [tests/fid.ts](/root/ERC3436/tests/fid.ts):

- `create_fid`
- `set_signer_key`
- `add_claim`
- `revoke_claim`
- duplicate-FID rejection
- signer-rotation invalidation behavior

### IRS

Covered by [tests/irs.ts](/root/ERC3436/tests/irs.ts):

- `initialize_irs`
- `bind_registry`
- `register_identity`
- duplicate registration rejection
- `update_identity`
- `update_country`
- `remove_identity`

### TIR

Covered by [tests/tir.ts](/root/ERC3436/tests/tir.ts):

- `initialize_tir`
- `add_trusted_issuer`
- `deactivate_issuer`
- `is_trusted_for_topic`

### CTR

Covered by [tests/ctr.ts](/root/ERC3436/tests/ctr.ts):

- `initialize_ctr`
- `add_claim_topic`
- `remove_claim_topic`

### IRP

Covered by [tests/irp.ts](/root/ERC3436/tests/irp.ts):

- `initialize_registry`
- `is_verified`
- positive claim-chain verification
- missing-claim rejection
- revoked-claim rejection
- expired-claim rejection
- inactive-issuer rejection

### Compliance

Covered by [tests/compliance.ts](/root/ERC3436/tests/compliance.ts):

- `initialize_compliance`
- `bind_module`
- `set_modules_paused`
- module boundary behavior
- pause bypass behavior
- built-in module logic for the tested modules

### Token

Covered by [tests/token.ts](/root/ERC3436/tests/token.ts):

- `initialize_token`
- `add_agent`
- `transfer`
- `mint`
- `burn`
- `forced_transfer`
- `recovery`
- `pause`
- `set_identity_registry`
- `set_compliance`
- `transfer_ownership`
- `accept_ownership`
- `freeze_wallet`
- `unfreeze_wallet`
- `freeze_partial`

Behavioral coverage includes:

- on-chain verification derivation
- on-chain compliance derivation
- partial-freeze enforcement
- paused mint blocking
- wallet freeze blocking
- owner control updates
- ownership transfer lifecycle
- agent burn / forced-transfer / recovery flows
- canonical Token-2022 transfer-hook execution
- daily-limit and country-cap support-account updates through the hook

### Token Hook Red Team

Covered by [tests/token_hook_red_team.ts](/root/ERC3436/tests/token_hook_red_team.ts):

- direct Token-2022 transfer without controller approval is rejected
- direct hook invocation outside a Token-2022 transfer is rejected
- malformed extra-account-metas are rejected
- consumed approvals cannot be replayed
- fake compliance state is rejected
- fake compliance module PDAs are rejected
- reordered controller remaining accounts do not affect canonical hook resolution
- cross-mint transfer approvals are rejected

### Factory and SDK

Covered by [tests/factory.ts](/root/ERC3436/tests/factory.ts):

- `initialize_factory`
- `deploy_token_suite`
- shared IRS reuse path
- linked deployment recording

## Test commands by area

Run a single suite group with mocha grep:

```bash
./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts" --grep "fracks-token phase 4 hardening"
```

```bash
./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts" --grep "fracks-fid phase 1"
```

```bash
./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts" --grep "fracks-irp phase 3"
```

```bash
./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts" --grep "fracks-factory and sdk phase 6"
```

If you want those grep runs to work reliably, first make sure the Anchor artifacts are fresh:

```bash
anchor build
```

Then start a local validator or let Anchor do it for you:

```bash
anchor test --skip-build
```

## Manual validation checklist

Use this checklist when you want to inspect behavior manually after the automated suite:

1. Create issuer and investor FIDs.
2. Initialize IRS, TIR, CTR, IRP, Compliance, and Token PDAs for a mint.
3. Register investors in IRS.
4. Add required claim topics in CTR.
5. Add trusted issuers in TIR.
6. Issue a signed claim to a verified receiver.
7. Bind a compliance module such as max-transfer.
8. Attempt a non-compliant transfer and confirm rejection.
9. Attempt a compliant transfer and confirm success.
10. Add a partial freeze and confirm only the unfrozen amount can move.
11. Pause the token and confirm mint is rejected.
12. Freeze a wallet and confirm transfers to it are rejected.
13. Transfer ownership and confirm only the pending owner can accept.
14. Burn through an agent path and confirm success.
15. Forced-transfer through an agent path and confirm success.
16. Run recovery to a verified wallet and confirm success.

## Public deployment command

For public Solana testnet deployment:

```bash
anchor deploy --provider.cluster testnet
```

Important:

- the wallet in `/root/.config/solana/id.json` must have enough SOL for the whole workspace
- this workspace deploys many programs, so a partial deploy can succeed for some programs and still fail overall if the wallet runs short
- prefer targeted deploys for changed programs after the initial workspace deployment to avoid wasting testnet SOL

## Public testnet deployment status

The latest public testnet deployment on 2026-05-07 completed successfully.

Notes:

- the first full-workspace sweep stopped near the end with a transient insufficient-funds error during `mod_supply_cap`
- a targeted resume with `anchor deploy -p mod_supply_cap --provider.cluster testnet` and `anchor deploy -p mod_country_cap --provider.cluster testnet` completed the workspace
- `fracks_token_hook` was later deployed with `anchor deploy --program-name fracks_token_hook --provider.cluster testnet`
- `fracks_token` was later upgraded with `anchor deploy --program-name fracks_token --provider.cluster testnet`

That means:

- local build and tests are green
- the full workspace is now deployed on public Solana testnet

Programs confirmed on testnet from the 2026-05-07 pass:

- `fracks_factory`: `6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe`
- `fracks_token`: `Gr9Y5q2aHtQEpYHgqme3hctqQ2sNRGF1ZVx9cQvMDjBn`
- `fracks_token_hook`: `CQwdsA97gSiPMUzNXjS22AUu6HmvzMK2XZVqhswYEHLi`
- `fracks_fid`: `7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH`
- `fracks_irp`: `6dDKwtRbGkHJhU9LztpDkBC3fUdM46WeKJdrASFikce6`
- `fracks_irs`: `CsrdR7QK3ma6hxU46Cp4DZHAdbGPWPiwmGjhKsR9VzdS`
- `fracks_tir`: `Am5W7oEe8NCU4jdLP8qyUT3gjUPCDsvTSxGhdCQp1ETS`
- `fracks_ctr`: `B15EFQKwnfbNHXHhPVvVcw18PaBeTDsRLNRno3QS8Yna`
- `fracks_compliance`: `9XYxZzDfU17BBpN1qhdu7RDCCrV6uebDgi5xse7Jbz5d`
- `mod_max_investors`: `4KVbq2esECUHZZdsBiDMM3mxYt8K7rNJUdotG6uZJfRQ`
- `mod_country_restrict`: `BCGKsDTyncA4EbHzxGVmEi3pheotJiaxCwYvHGxERiZ7`
- `mod_max_balance`: `9BjLakhcX1ms34VjRwUgMZQAgdbsMM8C1gSPqrJTyCpH`
- `mod_max_transfer`: `Ee6RXC46Nb4Bo2BTQcXBHfuxLZdzbKtPmb3sGf2Egiqh`
- `mod_lockup`: `6XqxWPwZQrfTo2ZJeT7wBhJaXd1eKjB2kx5ZrP1CLwa9`
- `mod_daily_limit`: `FYJ1K8cWUsDmbxNpgaBaEmm3RpvvfpxBBWg2MLm4x8Sq`
- `mod_supply_cap`: `EkgX6pGFCFT7FuNWuBAAMePy43iU9oETLDota4nTA3x8`
- `mod_country_cap`: `Cv1HA7nHX8vxZvyCKXjk3gYPkqhfHFXxEsyxSXyRT3Ci`

## Mainnet Readiness Gate

See [FRACKS_MAINNET_READINESS_2026-05-07.md](/root/ERC3436/FRACKS_MAINNET_READINESS_2026-05-07.md).

Short version:

- the Token-2022 hook path is testnet green
- mainnet is not green while program upgrade authority remains on a deployer wallet
- transfer all program upgrade authorities to governance multisig before production issuance
- use split transactions for large transfer-hook account sets unless a versioned transaction plus ALT client has been separately audited
