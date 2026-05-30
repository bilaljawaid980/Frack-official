# FRACKS Audit Through Phase 3

Date: 2026-05-06

## Scope

This audit reviews the current implementation against:

- `FRACKS_PRD.docx`
- `FRACKS_TRD.docx`
- `FRACKS_Protocol_Architecture.md`
- `FRACKS_Implementation_Plan.docx`

The audit covers phases 1 through 3:

- Phase 1: `fracks-fid`
- Phase 2: `fracks-irs`, `fracks-tir`, `fracks-ctr`
- Phase 3: `fracks-irp`, `fracks-compliance`, built-in compliance modules

Where the docs diverged, the PRD, TRD, and implementation plan were treated as the primary source of truth.

## Summary

- Phase 1 is implemented and locally tested.
- Phase 2 is implemented and locally tested.
- Phase 3 is implemented, buildable, and runtime-tested.
- Local full-workspace `anchor build` and `anchor test` now pass through the phase 3 programs and modules without the earlier IRP SBF stack failure.
- The previous IRP happy-path verification failure is fixed. The full validator-backed suite reached `12 passing`.
- Phase 4 has now started with a compileable token-program control-plane implementation, but it is not yet doc-complete and is not yet covered by dedicated token tests.

## Phase 1 Findings

Status: Implemented and runtime-tested.

Covered behavior:

- `create_fid`
- `set_management_key`
- `set_signer_key`
- `add_claim`
- `revoke_claim`
- `remove_claim`
- ed25519 instruction introspection on claim issuance

Verified locally:

- FID creation works.
- Duplicate FID creation is rejected.
- Valid claims can be added.
- Invalid claim signatures are rejected at issuance.
- Claim revocation works.
- Signer rotation invalidates newly submitted claims that reuse old signatures in the phase 1 flow.

Residual notes:

- Generated IDL error codes can still drift from runtime `60xx` codes in some artifacts.
- `fracks-fid` still carries the non-blocking direct `solana-program` dependency warning.

## Phase 2 Findings

Status: Implemented and runtime-tested.

Covered behavior:

- IRS initialization and registry binding
- Wallet identity registration, update, country update, removal
- TIR initialization and issuer lifecycle
- CTR initialization and topic lifecycle

Verified locally:

- IRS register/update/remove flows work.
- Duplicate IRS registration is blocked.
- TIR trusted-issuer add/deactivate/reactivate flows work.
- CTR topic add/remove flows work.

Residual notes:

- IRS write authorization is still owner-gated in the current codebase instead of being enforced through IRP-managed identity agents. This is a known cross-phase mismatch with the docs.

## Phase 3 Findings

Status: Closed out for the current phase boundary.

Implemented:

- `fracks-irp` registry state and reference management
- `fracks-irp.is_verified()`
- `fracks-compliance` state, module binding, pause flag, aggregate `can_transfer()`
- Built-in module programs:
  - `mod-max-investors`
  - `mod-country-restrict`
  - `mod-max-balance`
  - `mod-max-transfer`
  - `mod-lockup`
  - `mod-daily-limit`
  - `mod-supply-cap`
  - `mod-country-cap`

Verified locally:

- Compliance phase 3 module boundary test passes for:
  - max investors
  - country restriction
  - max balance
  - max transfer
  - lockup
  - supply cap
  - country cap
  - compliance `modules_paused` bypass
- IRP negative cases pass:
  - missing claim
  - revoked claim
  - expired claim
  - inactive issuer

Additional verified behavior:

- IRP positive case now passes:
  - `is_verified(wallet) == true` when the wallet is registered and the required claim chain is present
- Full phase 3 runtime suite is green alongside phases 1 and 2

## Important Phase 3 Tradeoffs

These are the main places where the current phase 3 implementation does not yet fully match the original business logic:

- The deployable IRP build does not currently perform full ed25519 claim signature re-verification inside `is_verified()`.
  - Reason: the straightforward `ed25519-dalek` approach exceeded Solana SBF stack limits during build.
  - Effect: signer-rotation-based invalidation inside IRP is not yet fully enforced the way the docs describe.
- Compliance currently aggregates module rule state directly for `can_transfer()` rather than orchestrating a full CPI-return-value pattern from every module.
  - The module programs themselves exist and compile.
  - The aggregate compliance behavior is present for the tested rule paths.
- The daily-limit module compiles and builds after Anchor safety-lint fixes, but it has not yet been re-added to the runtime compliance test coverage in the current iteration.

## Build And Deployment Status

Current local status:

- `cargo check` passes for the phase 3 programs and module crates.
- `anchor build` progresses through the full workspace, including phase 3 programs and modules, after the earlier IRP SBF stack issue was removed.
- The local validator-based test flow is operational.

Current local status:

- `cargo check` passes for the phase 3 programs and modules.
- `anchor build` passes through the full workspace after the IRP deserialization fix and the phase 4 token-program compile pass.
- The local validator-based test flow is operational, and the last completed phase 1-3 suite run finished with `12 passing`.

## Phase 4 Snapshot

Status: In progress.

What exists now:

- `fracks-token` now has the documented per-token control-plane PDAs:
  - `TokenState`
  - `OwnerState`
  - `AgentRole`
  - `FrozenWallet`
  - `PartialFreeze`
- Owner, agent, freeze, partial-freeze, pause, and ownership-transfer flows are implemented and buildable.
- Transfer/mint/burn/forced-transfer/recovery instruction shells exist and enforce a reduced set of control-plane checks.

Important current deviations from the docs:

- Phase 4 is not yet wired to live SPL Token-2022 mint/account CPIs.
- The transfer hook is not yet integrated with actual Token-2022 transfer-hook execution.
- IRP and Compliance are not yet called from the token program through on-chain CPI in the current phase 4 build; the token layer currently accepts verification/compliance outcomes as instruction inputs for control-plane validation only.
- Partial freeze currently behaves conservatively in the compileable phase 4 baseline: any existing partial-freeze PDA blocks outgoing transfer capacity in the current transfer shell instead of decrementing a live SPL balance.

Recommendation:

1. Keep phases 1-3 as the green baseline.
2. Finish phase 4 by replacing the current token-program shells with real Token-2022 CPI flows and on-chain IRP/Compliance calls.
3. Add dedicated `tests/token.ts` before treating phase 4 as closed.
