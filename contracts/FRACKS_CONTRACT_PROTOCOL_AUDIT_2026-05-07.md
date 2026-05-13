# FRACKS Contract and Protocol Audit

Date: 2026-05-07

Reviewed scope: on-chain programs, protocol invariants, PDA model, CPI flows, access control, Token-2022 transfer-hook enforcement, factory orchestration, compliance modules, and parity against `FRACKS_Protocol_Architecture.md`.

Out of scope: CLI UX, shell ergonomics, deployment convenience scripts, and formatting-only concerns.

## 1. Executive Summary

The current FRACKS implementation is materially closer to the main architecture document than the earlier 2026-05-06 and early 2026-05-07 audit notes. Those older reports correctly identified a missing Token-2022 enforcement layer at the time, but that finding is now superseded by the current codebase.

The reviewed code now includes:

- a split `fracks_token` controller program and `fracks_token_hook` Token-2022 transfer-hook program
- real Token-2022 mint creation in factory with `TransferHook` and `PermanentDelegate` extensions
- real Token-2022 CPIs for mint, burn, forced transfer, and recovery token movement
- controller approval coupled to canonical Token-2022 hook execution
- extra-account-metas initialization for FRACKS verification and compliance accounts
- stateful post-transfer maintenance for daily limit, country cap, max investors, and supply-cap modules

Current verdict:

```text
Testnet green for the audited Token-2022 hook path.
Not mainnet green until the high-severity governance and hook-authority custody gates are closed.
```

Verification performed during this audit pass:

- `anchor test --skip-build --skip-lint` passed with `29 passing`.
- The passing suite includes Token-2022 hook red-team tests, daily-limit and country-cap post-hook maintenance, burn, forced transfer, and recovery agent flows.

No open Critical severity contract bug was identified in the reviewed state. Two High severity production blockers remain because they affect mainnet custody and canonical hook enforcement assumptions.

## 2. Protocol Architecture Review

FRACKS implements a Solana ERC-3643-style regulated asset stack:

- `fracks_fid`: identity accounts and signed claim issuance
- `fracks_irs`: wallet-to-identity registry and identity registry storage
- `fracks_tir`: trusted issuer registry
- `fracks_ctr`: required claim topic registry
- `fracks_irp`: identity registry proxy and claim verification
- `fracks_compliance`: module registry, aggregate compliance checks, and post-transfer hooks
- `fracks_token`: regulated token controller, pause/freeze/agent controls, and Token-2022 CPI authority
- `fracks_token_hook`: canonical Token-2022 transfer-hook enforcement
- `fracks_factory`: deterministic suite deployment and Token-2022 mint initialization
- compliance modules: max balance, max transfer, country restrict, country cap, daily limit, lockup, max investors, and supply cap

The architecture document requires Token-2022 mint enforcement through transfer hooks. Current code now matches that high-level design: factory creates a real Token-2022 mint, `fracks_token` validates mint extensions before controller operations, and `fracks_token_hook` rejects hook calls that are not made during an active Token-2022 transfer.

The main remaining differences are governance/custody and operational policy, not the absence of the Token-2022 layer.

## 3. Main Documentation Parity

| Main-doc requirement | Current implementation | Audit status |
| --- | --- | --- |
| Token-2022 mint with transfer hook | Factory creates a Token-2022 mint with `TransferHook` and `PermanentDelegate` extensions. | Implemented |
| Canonical SPL-level transfer enforcement | User transfer is controller approval plus Token-2022 transfer-hook consumption. Direct hook calls outside active transfer are rejected. | Implemented |
| Real token movement for privileged flows | Mint, burn, forced transfer, and recovery use Token-2022 CPIs. | Implemented |
| Compliance post-transfer maintenance | Compliance program invokes module `transferred` hooks; stateful daily-limit and country-cap paths are maintained. | Implemented |
| Shared IRS support | Factory supports supplied shared IRS and validates deployment assumptions. | Implemented |
| Deterministic PDA suite deployment | Factory validates deterministic token, owner, registry, compliance, deployment, and hook PDA relationships. | Implemented |
| Upgrade authority via governance multisig | Testnet deployment note shows upgrade authority on deployer wallet. | Not mainnet ready |
| Canonical hook authority custody | Factory initializes transfer-hook authority to payer. | Not mainnet ready |
| Large transfer-hook account scalability | Split approval and Token-2022 transfer policy is documented. | Requires production policy |
| Batch operations | Architecture mentions batch-style regulated operations, but current implementation is primarily single-operation. | Future enhancement |

The old audit files `FRACKS_MAIN_DOC_AUDIT_2026-05-06.md`, `FRACKS_MAIN_DOC_AUDIT_2026-05-07.md`, and `FRACKS_AUDIT_PHASES_1_6.md` contain now-stale statements that Token-2022 integration is missing. This document supersedes those statements for the current codebase.

## 4. Threat Model

Primary adversaries considered:

- unverified investor attempting to receive or move regulated tokens
- malicious or revoked issuer attempting to satisfy claim topics
- user attempting to bypass FRACKS through direct Token-2022 transfer
- caller attempting direct hook invocation outside Token-2022
- malicious remaining-account ordering or substitution attack
- compromised token agent
- compromised token owner or registry owner
- compromised deployer or upgrade authority
- malicious or misconfigured compliance module binding
- large-account-set denial-of-service through transfer-hook account pressure

Assets protected:

- regulated token transfer restrictions
- identity registry integrity
- trusted issuer and claim-topic policy
- compliance module state
- supply and privileged token movement controls
- deterministic deployment namespace
- canonical Token-2022 hook path

## 5. Trust Assumptions

- Program upgrade authorities are trusted until transferred to governance. This is unacceptable for mainnet if any program remains controlled by a single deployer wallet.
- Token owners and agents are privileged regulated operators. Compromise of these keys can freeze wallets, force transfers, perform recovery flows, or change token policy within program limits.
- Registry owners are trusted to manage issuers, claim topics, identities, and compliance modules correctly.
- Trusted issuers are trusted only for explicitly registered claim topics.
- Compliance modules are trusted only when owner-bound and validated by their expected account shape and module logic.
- Token-2022 itself and the SPL transfer-hook interface are assumed correct and canonical.

## 6. Security Findings

| ID | Severity | Status | Finding |
| --- | --- | --- | --- |
| H-01 | High | Open | Program upgrade authority must be moved to governance before mainnet. |
| H-02 | High | Open | Token-2022 transfer-hook update authority is payer-controlled after factory mint creation. |
| M-01 | Medium | Open | Large hook-account flows require enforced production transaction policy. |
| M-02 | Medium | Open | Recovery is split between token movement and identity remap finalization. |
| M-03 | Medium | Accepted risk | IRS owner bootstrap authority is broader than the identity-agent-only model described in the docs. |
| M-04 | Medium | Accepted risk | Claim signatures are verified at issuance time, not re-run during every IRP verification. |
| M-05 | Medium | Accepted risk | Compliance module binding is governance-trustful and not strongly typed at bind time. |
| L-01 | Low | Open | Batch regulated operations from the architecture remain future work. |
| I-01 | Informational | Open | Old audit documents contain stale Token-2022 conclusions and should be treated as historical. |

### H-01: Program Upgrade Authority Must Be Governance-Controlled

The architecture document requires Squads or equivalent governance control for production programs. `FRACKS_MAINNET_READINESS_2026-05-07.md` records testnet `fracks_token` and `fracks_token_hook` upgrade authority as deployer wallet `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`.

Impact:

- A compromised deployer can upgrade production code.
- Users and institutions cannot rely on the audited bytecode remaining intact.
- This violates the protocol's own governance posture.

Recommendation:

- Before mainnet, transfer every FRACKS core and module program upgrade authority to a governance multisig.
- Record program IDs, IDL hashes, buffer hashes, commit hash, deployment signatures, and final authorities in the release record.
- Do not give mainnet green status while any program authority remains a single hot wallet.

### H-02: Transfer-Hook Update Authority Is Payer-Controlled

Factory mint creation initializes the Token-2022 transfer-hook extension with `Some(payer.key())` as authority in `programs/fracks-factory/src/lib.rs`.

Impact:

- If the payer authority remains a hot wallet, it may be able to reconfigure the mint's transfer-hook program.
- A compromised hook authority can threaten the canonical enforcement assumption even if the FRACKS programs themselves are sound.
- `fracks_token` validates the expected hook before controller operations, but direct Token-2022 movement safety depends on the mint's actual hook configuration.

Recommendation:

- Mainnet deployments must transfer or assign transfer-hook authority to protocol governance, token-owner multisig, or an intentionally immutable authority policy.
- Add a release checklist item that verifies the mint transfer-hook program and authority after deployment.
- Consider adding a dedicated factory/governance instruction to rotate or revoke hook authority in a controlled way if Token-2022 supports the intended authority model for the deployment.

### M-01: Large Hook-Account Flows Require Production Transaction Policy

FRACKS transfer hooks require token, identity, registry, compliance, module, and support accounts. With stateful modules such as daily limit and country cap, a single legacy transaction can exceed practical account or packet limits.

Impact:

- Large regulated transfers can fail client-side due to transaction size.
- Poorly built clients may create unreliable or inconsistent transfer UX.

Recommendation:

- Use the documented split flow for large transfers: controller approval first, Token-2022 `transfer_checked` second.
- Use versioned transactions and address lookup tables only after a dedicated adversarial test pass.
- Keep the approval snapshot checks because they protect split flow safety by binding amount, authority, source, destination, balances, countries, and transfer kind.

### M-02: Recovery Is Not Fully Atomic Across Identity Remap

The recovery flow performs privileged token movement and then requires `finalize_recovery` to remap IRS identity state from the lost wallet to the new wallet.

Impact:

- If token movement succeeds but finalization is not executed, the token balance and identity registry state can temporarily diverge.
- Operational mistakes can leave recovery state incomplete until an agent finalizes it.

Recommendation:

- Prefer same-transaction recovery plus finalization when the account set fits.
- For split recovery, require an operational watchdog that detects consumed recovery approvals that are not finalized.
- Add release tests covering interrupted recovery and successful later finalization.

### M-03: IRS Owner Bootstrap Authority Is Broader Than Agent-Only Model

The IRS program allows owner-level identity mutation in addition to registry-agent paths. This can be useful during setup and remediation, but it is broader than a strict identity-agent-only lifecycle.

Impact:

- IRS owner compromise has direct identity registry impact.
- Documentation that only mentions agents understates the IRS owner trust boundary.

Recommendation:

- Keep this as an accepted governance trust assumption if intended.
- Update main docs to state that IRS owner has bootstrap/remediation powers.
- For mainnet issuers, place IRS owner under multisig.

### M-04: Claim Signature Verification Is Issuance-Time, Not Every Read

FID claim addition verifies the Ed25519 instruction when the claim is written. IRP verification then checks stored claim data, current trusted issuer status, issuer active status, topic authorization, expiration, revocation, and current issuer signer key snapshot.

Impact:

- The implementation is coherent under an issuance-time verified claim model.
- It does not exactly match wording that implies signature verification is recomputed during every `is_verified` call.

Recommendation:

- Update docs to describe the actual model: Ed25519 is verified at claim issuance, then IRP validates the stored claim against current registry and issuer state.
- Keep issuer signer key matching during IRP verification because it invalidates stale claims after issuer signer rotation unless deliberately reissued.

### M-05: Compliance Module Binding Is Governance-Trustful

Compliance module pubkeys are bound by the compliance owner and validated more deeply during use and extra-account-metas initialization. This preserves modularity, but module admission is still owner-trustful.

Impact:

- A compromised or careless compliance owner can bind an invalid module and cause denial of service or unexpected compliance behavior.
- The design relies on governance discipline rather than purely type-locked admission.

Recommendation:

- Keep owner trust if modular extensibility is required.
- Maintain an allowlist of audited module program IDs and state account derivation rules in governance policy.
- Add tests for binding malformed module accounts and verifying rejection during transfer evaluation or hook EAM initialization.

### L-01: Batch Operations Remain Future Work

The main architecture references batch-style regulated operations. The current implementation focuses on single mint, burn, transfer, forced transfer, and recovery operations.

Impact:

- This is not a bypass.
- Large issuers may need batching for operational efficiency.

Recommendation:

- Treat batch operations as a post-mainnet scalability feature unless required by launch scope.
- Do not add batch paths without reproducing the same Token-2022 CPI, hook, approval, and compliance invariants.

### I-01: Historical Audit Docs Are Stale

Several older documents still state that real Token-2022 integration is missing. That was accurate before the current controller/hook work, but it is no longer accurate.

Recommendation:

- Treat this document as the current contract/protocol parity audit.
- Optionally add superseded notices to older audit files to avoid confusing future reviewers.

## 7. Fixed Vulnerabilities and Closed Prior Findings

The following previously material issues appear addressed in the current codebase:

- Missing Token-2022 transfer-hook enforcement layer: fixed by split controller and hook programs.
- Protocol-side-only mint, burn, forced transfer, and recovery: fixed by real Token-2022 CPIs.
- Daily-limit and country-cap modules checked but not maintained: fixed by compliance post-transfer module updates.
- Direct hook invocation risk: mitigated by Token-2022 transfer-state validation.
- Malicious extra-account-metas initialization: hardened by owner gating, token state validation, compliance state validation, and module-account validation.
- Compliance module discriminator shape-confusion in token-side dispatch: hardened by discriminator checks before deserializing module views.

## 8. Transfer and Compliance Flow Assessment

Normal transfer flow:

1. User calls `fracks_token::transfer` to evaluate identity, claim topics, trusted issuers, frozen state, paused state, and compliance modules.
2. Controller writes a hook approval PDA bound to exact transfer parameters and balance snapshots.
3. User performs canonical Token-2022 transfer.
4. Token-2022 invokes `fracks_token_hook`.
5. Hook validates active transfer context, mint, token accounts, approval, post-transfer balances, compliance state, and remaining accounts.
6. Hook invokes compliance post-transfer maintenance.

Security assessment:

- Direct Token-2022 transfer without controller approval should fail through the hook.
- Direct hook invocation outside Token-2022 should fail.
- Stale approval should fail because balances and transfer parameters are snapshotted.
- Remaining-account ordering is constrained by extra-account-metas and module validation.
- Stateful modules now receive post-transfer maintenance.

Main residual risk:

- Canonical enforcement depends on transfer-hook authority custody. This is H-02 and must be closed before mainnet.

## 9. Factory Orchestration Assessment

Factory orchestration now follows the intended deterministic suite deployment model:

- `create_token_mint` creates the real Token-2022 mint.
- `deploy_token_suite` initializes token, owner, TIR, CTR, IRS/IRP, compliance, deployment, trusted issuer entries, claim topics, module bindings, and hook extra-account-metas.
- Supplied shared IRS must exist when used.
- Deployment PDA replay is blocked by deployment state and deterministic PDA validation.
- Trusted issuer remaining accounts are consumed in declared order.

Assessment:

- No partial-state corruption issue was identified inside a single Solana transaction because transaction failure rolls back state.
- Deployment collisions are constrained by deterministic PDAs and initialization checks.
- Mainnet factory usage must include post-deployment authority verification for program upgrade authority and Token-2022 hook authority.

## 10. PDA and Account-Substitution Assessment

Positive observations:

- Core state PDAs use deterministic seeds tied to mint, wallet, owner, topic, issuer, registry, or deployment salt.
- Token mint validation checks Token-2022 owner, mint address, transfer-hook program, mint authority, and permanent delegate.
- Hook extra-account-metas PDA is derived from mint and owned by the hook program.
- Hook approval PDA binds source account, destination account, and Token-2022 authority.
- IRP claim verification derives expected claim PDAs against the FID program and checks topic, issuer, expiration, revocation, trusted issuer status, issuer active status, and signer key continuity.

Residual hardening opportunities:

- Add explicit owner checks before every view deserialization where the PDA proof already makes substitution impractical. This is defense-in-depth, not a currently identified exploit.
- Add more malicious remaining-account tests for malformed module state accounts and module program accounts.

## 11. Mainnet Scalability Review

Scalability constraints:

- Compliance modules are bounded to 15.
- Factory trusted issuer count is bounded.
- Claim topics and issuer topic lists are bounded.
- IRS bound registries and identity agents are bounded.
- Hook account sets grow with module count and stateful module support accounts.
- CPI depth increases when hook post-transfer maintenance invokes multiple modules.

Mainnet assessment:

- Suitable for controlled regulated deployments with small to moderate module sets.
- Large issuer and complex module deployments require split transfer flows or an audited versioned transaction/ALT client.
- High-volume retail-scale transfer-hook usage should be load-tested before production promises.
- Transfer hooks are not free: every transfer carries verification and compliance account overhead by design.

## 12. Testing and Hardening Recommendations

Required before mainnet green:

- Verify upgrade authority transfer for all core and module programs.
- Verify Token-2022 transfer-hook authority custody or immutability policy for every production mint.
- Add adversarial tests for transfer-hook authority misconfiguration.
- Add interrupted recovery tests: token moved, finalization delayed, then finalized.
- Add malformed module binding tests at compliance bind time and hook EAM init time.
- Add large account-set tests using split transactions.
- Add versioned transaction and ALT tests if they will be supported by production clients.

Recommended after mainnet:

- Property tests for transfer approval snapshots.
- Fuzz remaining-account ordering for IRP and compliance paths.
- Compute profiling by module combination.
- Governance runbook tests against a staging multisig.
- External audit focused on Token-2022 hook authority, SPL extension configuration, and upgrade governance.

## 13. Mainnet Readiness Assessment

Current status:

```text
Testnet green.
Mainnet not green.
```

Mainnet green requires:

- H-01 closed: every program upgrade authority transferred to governance multisig.
- H-02 closed: every Token-2022 mint transfer-hook authority governed, revoked, or otherwise controlled according to a documented immutable/custodial policy.
- Split transaction policy adopted for large hook-account transfers.
- Final clean `anchor build` and full test pass from the release commit.
- Final testnet smoke deployment and IDL verification from the release commit.
- Release record containing commit hash, program IDs, IDL hashes, authorities, deployment signatures, and governance approvals.

## 14. Governance Recommendations

- Use Squads or equivalent audited multisig for program upgrade authority.
- Use multisig for token owner, compliance owner, IRS owner, and high-value agent roles.
- Maintain an audited module allowlist.
- Require governance approval for transfer-hook authority changes.
- Require public release notes for program upgrades.
- Keep a post-deployment authority verification checklist for every token suite.

## 15. Final Auditor Statement

The current contracts now implement the central regulated-asset enforcement model described in the main architecture: identity, trusted issuer checks, claim topics, compliance modules, real Token-2022 minting, and canonical transfer-hook enforcement are present.

The protocol should not be represented as mainnet ready yet. The remaining blockers are not the old missing-Token-2022 bug; they are production custody and governance controls around upgrade authority and Token-2022 hook authority. Once those are closed and the release commit passes final build, tests, testnet verification, and authority checks, the protocol can be reassessed for mainnet deployment.
