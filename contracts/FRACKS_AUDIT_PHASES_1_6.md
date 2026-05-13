# FRACKS Audit: Phases 1-6

Date: 2026-05-06

Superseded note, 2026-05-07: this historical phase audit predates the current split `fracks_token` / `fracks_token_hook` Token-2022 implementation. Use [FRACKS_CONTRACT_PROTOCOL_AUDIT_2026-05-07.md](/root/ERC3436/FRACKS_CONTRACT_PROTOCOL_AUDIT_2026-05-07.md) for current contract/protocol readiness.

## Verified in this pass

- `cargo check -p fracks-token` passed after token hardening.
- `anchor test --skip-build` passed end-to-end with `17 passing`.
- `anchor deploy` succeeded against a local `solana-test-validator`.

## Fixed in this pass

### Phase 4 loophole closed

The token program no longer trusts caller-supplied verification or compliance booleans.

Implemented in [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs):

- `transfer` and `execute_transfer_hook` now derive receiver verification from IRP-linked IRS/TIR/CTR accounts.
- Compliance is now evaluated from the bound `ComplianceState` plus live module accounts passed in `remaining_accounts`.
- Partial freeze enforcement now reads the stored `PartialFreeze` account instead of trusting inputs.
- `mint` now blocks when paused and verifies the receiver through IRP-linked state.
- `burn` now blocks when paused.
- `forced_transfer` and `recovery` now verify the receiver/new wallet through IRP-linked state.
- `set_identity_registry` and `set_compliance` are now present as owner operations.
- Optional freeze accounts now correctly treat `SystemProgram` as an empty placeholder instead of failing with `InvalidRegistryReference`.

Regression coverage added in [tests/token.ts](/root/ERC3436/tests/token.ts):

- compliance cannot be bypassed by caller flags
- verification cannot be bypassed by caller flags
- partial freeze only blocks the frozen portion
- paused state blocks minting
- owner update and ownership-transfer flow
- wallet freeze / unfreeze flow
- burn / forced transfer / recovery agent flows

### Compliance post-hook wiring added

Implemented in [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs):

- successful `transfer()` now invokes the compliance program `transferred()` hook
- successful `mint()` now invokes the compliance program `created()` hook
- successful `burn()` now invokes the compliance program `destroyed()` hook
- successful `forced_transfer()` now invokes the compliance program `transferred()` hook

This closes the token-side omission where those hooks were not being called at all.

## Docs comparison

Primary docs checked:

- [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md)
- [FRACKS_PRD.docx](/root/ERC3436/FRACKS_PRD.docx)
- [FRACKS_TRD.docx](/root/ERC3436/FRACKS_TRD.docx)
- [FRACKS_Implementation_Plan.docx](/root/ERC3436/FRACKS_Implementation_Plan.docx)

## Matches the docs well

- Phase 1 FID creation, signer rotation, claim issuance, and revocation behavior.
- Phase 2 IRS/TIR/CTR core registries and shared-IRS capable account model.
- Phase 3 IRP verification flow and modular compliance account model.
- Phase 4 on-chain transfer gating logic for paused state, verification, compliance, full freeze, and partial freeze.
- Phase 5 factory orchestration of FRACKS program PDAs and shared IRS reuse at the FRACKS-state level.
- Phase 6 SDK/client surface for the current repo behavior.

## Remaining mismatches with the original docs

These are still real gaps relative to the PRD/TRD/architecture, even though the workspace now builds, tests, and deploys cleanly.

### 1. No real SPL Token-2022 mint or CPI transfer execution yet

The docs require actual Token-2022 mint creation and SPL-level enforcement:

- Architecture: lines `49`, `209-210`, `807-818`, `899-905`, `1211-1261`
- TRD: `8737`, `8915`, `9093`, `9271`
- Implementation plan: `21079`, `23029`, `23265`, `23737`, `23973`, `24209`

Current repo status:

- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs) does not CPI into `spl-token-2022` for mint, burn, transfer, or transfer-hook execution.
- [programs/fracks-factory/src/lib.rs](/root/ERC3436/programs/fracks-factory/src/lib.rs) does not create a real Token-2022 mint.

Impact:

- Compliance is enforced by the FRACKS token program logic when its instructions are used, but not yet at the actual SPL Token-2022 layer the docs specify.

### 2. Compliance post-hooks are only partially complete

The docs require `CP.transferred()`, `CP.created()`, and `CP.destroyed()` after successful token operations:

- Architecture: lines `210`, `959-965`, `987-989`, `1261`
- PRD: `4093`, `5547`, `5585`
- Implementation plan: `17321`, `21307`, `23737`, `23973`, `24209`

Current repo status:

- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs) now calls the compliance program post-hooks.
- [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs) still keeps those hook handlers as aggregators without full module-state fanout logic.

Impact:

- The token-side integration point now exists, but full module-state updates after token operations are still not fully spec-complete.

### 3. Recovery does not perform the documented IRS remap flow

The docs describe recovery as moving tokens to a new verified wallet and updating IRS identity linkage:

- Architecture: lines `304`, `909`, `1276`
- PRD: `3979`, `12103`
- Implementation plan: `25625`, `32985`

Current repo status:

- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs) verifies the new wallet and emits `TokenRecovery`, but does not update IRS state to remap the recovered investor identity.

Impact:

- Recovery is only partial relative to the business flow in the docs.

### 4. IRS agent model is still owner-driven, not IRP identity-agent driven

The docs call for `register_identity()` to be restricted to Identity Agent role:

- Architecture: lines `228`, `274-304`
- PRD: `4953`

Current repo status:

- [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs) is owner-gated for registry mutations.

Impact:

- Safe for a controlled prototype, but not fully aligned with the target operating model.

### 5. Batch token operations from the docs are not implemented

Missing doc-listed instructions:

- `batch_mint`
- `batch_forced_transfer`
- `batch_freeze`

References:

- Architecture: lines `310`, `918-920`, `1310`
- PRD: `8141`

### 6. Error taxonomy is not fully doc-identical

Some runtime behavior is correct, but the exact error enum names/codes do not fully mirror the documented matrix:

- Architecture: lines `1387-1401`

Example:

- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs) uses `InsufficientBalance` with message `Insufficient transferable balance.`

## Bottom line

The phase 4 loophole is fixed, and the repo now passes build, test, and local deployment with the hardened token logic.

The biggest remaining work is no longer a hidden bypass. It is the explicit gap between the current FRACKS control-plane implementation and the original spec’s full Token-2022 / transfer-hook / compliance-post-hook execution model.
