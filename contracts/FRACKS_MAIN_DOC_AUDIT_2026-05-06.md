# FRACKS Main-Doc Audit

Date: 2026-05-06

Superseded note, 2026-05-07: this historical audit predates the current split `fracks_token` / `fracks_token_hook` Token-2022 implementation. Use [FRACKS_CONTRACT_PROTOCOL_AUDIT_2026-05-07.md](/root/ERC3436/FRACKS_CONTRACT_PROTOCOL_AUDIT_2026-05-07.md) for current contract/protocol readiness.

Primary spec reviewed: [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md)

## Scope

This audit compares the live codebase against the main architecture spec and focuses on:

- code-level security flaws
- business-logic loopholes
- architecture mismatches
- verification and deployment status

Reviewed implementation areas:

- [programs/fracks-fid/src/lib.rs](/root/ERC3436/programs/fracks-fid/src/lib.rs:13)
- [programs/fracks-fid/src/utils.rs](/root/ERC3436/programs/fracks-fid/src/utils.rs:1)
- [programs/fracks-irp/src/lib.rs](/root/ERC3436/programs/fracks-irp/src/lib.rs:14)
- [programs/fracks-irp/src/utils.rs](/root/ERC3436/programs/fracks-irp/src/utils.rs:1)
- [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs:11)
- [programs/fracks-tir/src/lib.rs](/root/ERC3436/programs/fracks-tir/src/lib.rs:9)
- [programs/fracks-ctr/src/lib.rs](/root/ERC3436/programs/fracks-ctr/src/lib.rs:8)
- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:35)
- [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:12)
- [programs/fracks-factory/src/lib.rs](/root/ERC3436/programs/fracks-factory/src/lib.rs:26)
- [tests](/root/ERC3436/tests)
- [scripts/cli](/root/ERC3436/scripts/cli)

## Verification performed

- `anchor build` passed
- `anchor test --skip-build` passed with `20 passing`
- `anchor deploy` succeeded on a local `solana-test-validator`
- `npm run cli:generate` regenerated CLI wrappers from the current IDLs
- `npm run cli:reference` regenerated [FRACKS_CLI_COMMAND_REFERENCE.md](/root/ERC3436/FRACKS_CLI_COMMAND_REFERENCE.md)
- `npm run cli:testcases` regenerated [FRACKS_CLI_TEST_CASES.md](/root/ERC3436/FRACKS_CLI_TEST_CASES.md)

## Executive summary

The important code bugs from the previous audit pass are materially improved:

- IRP now enforces trusted issuer topic scoping.
- IRP now invalidates claims when the issuer rotates away from the signing key snapshot stored on the claim.
- IRS mutations now support identity-agent authorization through a bound IRP registry path.
- Recovery now performs IRS remap steps instead of only emitting an event.
- Compliance post-hooks now update `MaxInvestors` and `SupplyCap` state through CPI.

The repo is in a much better state than before, and the current local build, test, deploy, CLI, and documentation loop is healthy.

But the honest answer is still:

- the implementation is not yet perfectly identical to the architecture doc
- the remaining gaps are mostly architectural, not basic test failures
- the biggest unresolved gap is still the absence of real SPL Token-2022 balance enforcement and transfer-hook wiring

Bottom line:

- current status is strong prototype / integration baseline
- current status is not full main-doc parity yet
- current status is not ready for a truthful “everything matches the spec perfectly” sign-off

## Findings

### 1. Critical: the token layer is still not a real SPL Token-2022 mint plus enforced transfer-hook implementation

Architecture requirement:

- The spec requires an SPL Token-2022 mint with FRACKS wired as the transfer hook so no direct token movement can bypass FRACKS verification and compliance. See [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:49), [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:807), [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:817), and [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:899).

Current code:

- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:80) `transfer()` evaluates FRACKS rules and calls compliance, but does not CPI into SPL Token-2022 to move balances.
- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:111) `mint()` does not mint real SPL tokens.
- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:152) `burn()` does not burn real SPL tokens.
- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:182) `forced_transfer()` does not perform a real SPL transfer CPI.
- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:70) `execute_transfer_hook()` is a FRACKS-side evaluation entrypoint, but the repo does not create and configure a Token-2022 mint that actually invokes it.
- [programs/fracks-factory/src/lib.rs](/root/ERC3436/programs/fracks-factory/src/lib.rs:161) initializes FRACKS state PDAs, but does not create a live Token-2022 mint or configure transfer-hook extension metadata.

Impact:

- FRACKS business logic is enforced only inside the FRACKS control plane.
- The core architecture guarantee that all token movement is enforced at the SPL layer is still missing.

Assessment:

- This remains the primary production-blocking gap versus the main doc.

Recommended fix:

- Create a real Token-2022 mint in factory deployment.
- Configure transfer-hook extension and extra-account-meta plumbing.
- Move transfer, mint, burn, forced transfer, and recovery to real Token-2022 CPIs with live token-account tests.

### 2. High: compliance post-hooks are only partially implemented

Architecture requirement:

- The compliance layer should update bound module state after successful token actions. See [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:959), [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:987), [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:988), and [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:989).

Current code:

- [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:180) `transferred()` updates `MaxInvestors` only.
- [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:235) `created()` updates `MaxInvestors` and `SupplyCap`.
- [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:311) `destroyed()` updates `MaxInvestors` and `SupplyCap`.
- There is no post-hook fanout yet for `DailyTransferLimit` usage updates or `CountryCap` investor-count updates, even though those modules expose mutable post-hook instructions under [programs/modules/mod-daily-limit/src/lib.rs](/root/ERC3436/programs/modules/mod-daily-limit/src/lib.rs:37) and [programs/modules/mod-country-cap/src/lib.rs](/root/ERC3436/programs/modules/mod-country-cap/src/lib.rs:60).

Impact:

- Some compliance modules are enforced only at read time and their mutable bookkeeping is still incomplete.
- The current implementation is internally consistent for the tests that exist, but not yet doc-complete across all module types.

Assessment:

- This is an architecture-completeness gap, not a failing test baseline.

Recommended fix:

- Extend compliance post-hooks to update `DailyWalletUsage` and `CountryInvestorCount` through CPI.
- Add module-level and token-level tests that prove those counters change after transfer, mint, and burn paths.

### 3. High: recovery still does not perform the documented asset recovery flow

Architecture requirement:

- Recovery should force-transfer the investor’s balance to the replacement wallet and update identity records. See [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:304), [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:909), and [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:1276).

Current code:

- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:252) `recovery()` now remaps IRS state by updating the replacement wallet identity and removing the lost wallet identity.
- It still does not move real SPL token balances because the token layer itself is not wired to Token-2022.
- The `amount` parameter is currently logged and passed through event semantics, but not backed by SPL state movement.

Impact:

- Identity remapping is now much better than before.
- The full “recover assets from lost wallet” workflow in the architecture is still incomplete until real token movement exists underneath it.

Assessment:

- This is now a narrower follow-on gap, mostly downstream of the missing Token-2022 layer.

Recommended fix:

- Complete recovery as a real forced token transfer against Token-2022 accounts.
- Add end-to-end recovery tests that assert both IRS remap and balance migration.

### 4. Medium: IRS authority still allows owner bootstrap actions beyond the strict identity-agent model in the doc

Architecture requirement:

- The main doc describes identity-agent-led IRS operations for investor registration and maintenance. See [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:687), [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:1200), and [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:1282).

Current code:

- [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs:44) through [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs:155) now authorize IRS mutations through a bound IRP registry and identity-agent signer path.
- The implementation still permits the IRS owner to perform bootstrap-compatible mutation flows when `registry_state` is not used, as documented in the account comments around [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs:210), [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs:232), and [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs:253).

Impact:

- The repo is safer than the previous owner-only model.
- It still does not enforce the strictest possible interpretation of the architecture’s identity-agent-only operating model.

Assessment:

- This is a design-deviation tradeoff, not an immediate exploit path in the current code.

Recommended fix:

- Remove the owner bootstrap path once the IRP/agent deployment workflow is fully stable.
- Or explicitly downgrade the architecture doc to acknowledge owner bootstrap rights.

### 5. Medium: IRP verification no longer performs cryptographic signature verification at read time

Architecture requirement:

- The architecture text describes `ed25519_verify(signature, message, issuer_fid.signer_key)` during verification. See [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:572).

Current code:

- [programs/fracks-fid/src/utils.rs](/root/ERC3436/programs/fracks-fid/src/utils.rs:31) verifies Ed25519 correctness at claim issuance time.
- [programs/fracks-irp/src/utils.rs](/root/ERC3436/programs/fracks-irp/src/utils.rs:31) now checks the stored claim fields structurally, validates trusted issuer topic scoping, checks issuer activity, and confirms the claim’s stored `signer_key` snapshot still matches the issuer’s current signer key.
- IRP does not re-run Ed25519 verification on every `is_verified()` call.

Impact:

- The old “garbage signature bytes can pass” bug is closed.
- The runtime behavior is secure relative to the stored-claim model implemented here, but it is still not a literal implementation of the architecture’s per-verification cryptographic step.

Assessment:

- This is now a spec-parity gap rather than the earlier critical security flaw.

Recommended fix:

- Either implement true on-chain verification flow compatible with Solana compute limits and instruction-introspection constraints, or update the architecture doc to formalize the issuance-time verification plus signer-snapshot model.

### 6. Medium: documented batch token operations are still missing

Architecture requirement:

- The architecture lists `batch_mint`, `batch_forced_transfer`, `batch_freeze`, and broader batch workflows. See [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:310), [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:918), [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:919), and [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md:920).

Current code:

- Those batch token instructions are not present in [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs).

Impact:

- The runtime surface area is narrower than the documented one.

Assessment:

- This is a functional completeness gap.

Recommended fix:

- Implement the missing batch flows or trim the doc to the currently supported scope.

## Findings closed since the previous audit

- The old IRP topic-scope bug is fixed in [programs/fracks-irp/src/utils.rs](/root/ERC3436/programs/fracks-irp/src/utils.rs:52).
- The old IRP “non-zero signature bytes can pass” flaw is closed by claim-issuance verification plus signer-key snapshot enforcement across [programs/fracks-fid/src/utils.rs](/root/ERC3436/programs/fracks-fid/src/utils.rs:31) and [programs/fracks-irp/src/utils.rs](/root/ERC3436/programs/fracks-irp/src/utils.rs:60).
- The old compliance no-op finding is partially closed: `MaxInvestors` and `SupplyCap` post-hooks now mutate state via CPI in [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:212), [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:264), [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:294), [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:340), and [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:370).
- The old IRS authority mismatch is partially closed by identity-agent authorization in [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs:44).
- The old recovery “event only” finding is partially closed by IRS remap actions in [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:281).

## What currently matches well

- FID claim issuance validates Ed25519 proof at creation time and stores the issuer signer snapshot.
- IRP now correctly enforces trusted issuer topic binding, issuer activity, issuer role, expiry, revocation, and signer-key rotation invalidation.
- IRS, TIR, CTR, compliance, and factory PDA derivations are coherent and tested together.
- Compliance read-path aggregation works for the current module set and mutable hooks now operate for `MaxInvestors` and `SupplyCap`.
- The CLI wrappers and generated CLI docs are in sync with the current IDLs.
- The full local build, test, and deploy loop now succeeds.

## Final status

Has the codebase improved meaningfully from the prior audit?

- Yes.

Can I honestly say “everything is now the same as the main docs”?

- No.

Can I honestly say the current repo is buildable, locally deployable, and backed by a green automated suite?

- Yes.
