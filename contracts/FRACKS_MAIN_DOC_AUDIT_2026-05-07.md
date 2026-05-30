# FRACKS Contract And Protocol Audit

Date: 2026-05-07

Superseded note: this earlier 2026-05-07 audit predates the current split `fracks_token` / `fracks_token_hook` Token-2022 implementation. Use [FRACKS_CONTRACT_PROTOCOL_AUDIT_2026-05-07.md](/root/ERC3436/FRACKS_CONTRACT_PROTOCOL_AUDIT_2026-05-07.md) for current contract/protocol readiness.

Primary spec reviewed: [FRACKS_Protocol_Architecture.md](/root/ERC3436/FRACKS_Protocol_Architecture.md)

## 1. Executive Summary

FRACKS is now materially stronger than the prior 2026-05-06 audit baseline. The previously high-impact remaining-account spoofing issues and compliance post-hook maintenance gaps have been fixed in the live code, and the current local integration suite passes end to end.

The protocol is not yet ready for a full production-grade sign-off because one architectural security gap remains open:

- the token layer is still not enforced at the real SPL Token-2022 transfer layer

That means the protocol’s core compliance guarantees are strong when FRACKS instructions are used, but they are not yet anchored to the actual token-ledger primitive described in the architecture spec.

Current status:

- strong regulated-asset control-plane prototype
- coherent PDA model and CPI orchestration
- materially improved compliance and verification hardening
- not yet full main-doc parity
- not yet institution-ready for mainnet as specified

## 2. Protocol Architecture Review

Reviewed on-chain scope:

- [programs/fracks-fid/src/lib.rs](/root/ERC3436/programs/fracks-fid/src/lib.rs:1)
- [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs:1)
- [programs/fracks-tir/src/lib.rs](/root/ERC3436/programs/fracks-tir/src/lib.rs:1)
- [programs/fracks-ctr/src/lib.rs](/root/ERC3436/programs/fracks-ctr/src/lib.rs:1)
- [programs/fracks-irp/src/lib.rs](/root/ERC3436/programs/fracks-irp/src/lib.rs:1)
- [programs/fracks-irp/src/utils.rs](/root/ERC3436/programs/fracks-irp/src/utils.rs:1)
- [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:1)
- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:1)
- [programs/fracks-factory/src/lib.rs](/root/ERC3436/programs/fracks-factory/src/lib.rs:1)
- [programs/modules](/root/ERC3436/programs/modules)

Architecture observations:

- The identity, registry, trusted-issuer, and topic-registry separation is coherent and deterministic.
- The factory orchestration flow correctly links the per-token suite with deterministic PDA derivations.
- The shared IRS model is preserved and correctly supported by factory deployment.
- The compliance layer now behaves like a real modular post-hook engine for the stateful modules already wired into it.
- The largest remaining mismatch against the main architecture document is the missing Token-2022 mint plus transfer-hook enforcement layer.

## 3. Threat Model

This audit evaluated attacks from:

- unverified investors attempting transfer eligibility bypass
- malicious remaining-account injection
- malicious module support-account spoofing
- rogue or mistaken identity agents
- privileged owners binding malformed or inert compliance modules
- replay or stale-claim usage
- unsafe CPI fanout and PDA signer misuse
- deployment collisions or suite reinitialization attempts

Trusted governance actors were still assumed capable of:

- owning the per-token suite
- binding or unbinding modules
- managing IRS and IRP ownership paths
- adding trusted issuers and required topics

## 4. Trust Assumptions

The current implementation assumes:

- token owners and factory owners act within governance policy
- IRS owners and approved identity agents are trusted to manage wallet identity mappings
- trusted issuers in TIR are curated correctly by the owner
- compliance module pubkeys bound by the owner are legitimate module accounts

These assumptions are acceptable for a permissioned RWA protocol, but they must be made explicit because the code still grants meaningful power to governance actors.

## 5. Attack Surface Analysis

Primary surfaces:

- FID claim issuance and signer-key rotation
- IRS wallet-to-FID registration and mutation
- IRP verification using remaining accounts
- compliance module aggregation and post-hook CPI fanout
- token transfer, mint, burn, forced transfer, and recovery flows
- factory deployment orchestration and CPI initialization ordering

Highest sensitivity areas:

- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:71)
- [programs/fracks-irp/src/utils.rs](/root/ERC3436/programs/fracks-irp/src/utils.rs:14)
- [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:78)
- [programs/fracks-factory/src/lib.rs](/root/ERC3436/programs/fracks-factory/src/lib.rs:68)

## 6. Security Findings

### Critical

1. The token layer is still not enforced by a real Token-2022 mint and transfer-hook path.
   - [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:71) `execute_transfer_hook()` is callable as a FRACKS instruction, not as a live Token-2022-enforced mint hook.
   - [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:80) `transfer()` evaluates compliance and emits events, but does not CPI into Token-2022 to move balances.
   - [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:111), [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:145), [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:166), and [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:246) likewise do not mutate real SPL balances.
   - [programs/fracks-factory/src/lib.rs](/root/ERC3436/programs/fracks-factory/src/lib.rs:68) deploys FRACKS state PDAs only; it does not create or configure a Token-2022 mint with transfer-hook metadata.
   - Impact: the protocol’s strongest stated invariant, “no token transfer executes without FRACKS verification and compliance at the SPL layer,” is not yet true.

### Medium

2. IRS identity registration still accepts an arbitrary `fid` pubkey under trusted actor control.
   - [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs:62) stores the caller-provided `fid` directly into the wallet mapping.
   - The architecture doc allows `update_identity(wallet, new_fid)`, so this may be intentional, but it creates a meaningful trust boundary around identity agents and IRS owners.
   - Impact: a trusted registration actor can link a wallet to an unexpected FID unless off-chain governance policy prevents it.

3. Compliance module binding remains governance-trustful and weakly typed.
   - [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:34) stores arbitrary pubkeys in the bound module list.
   - Runtime behavior depends on deserializing remaining accounts into known module shapes in [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:96).
   - Impact: a misconfigured owner can bind malformed, inert, or operationally dangerous module accounts even if outsiders cannot exploit this directly.

4. Stateful module helper accounts must already exist before some live post-hook flows.
   - [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:789) and [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:833) require canonical helper accounts for daily usage and country counts during mutation.
   - Impact: token operations can fail with `MissingModuleSupportAccount` unless those support PDAs are provisioned operationally in advance.

### Low

5. IRP keeps a `registered_count` field that is initialized but not maintained.
   - [programs/fracks-irp/src/lib.rs](/root/ERC3436/programs/fracks-irp/src/lib.rs:32)
   - Impact: state-reporting inconsistency only.

6. Some standalone module read APIs are looser than the protocol’s core aggregation path.
   - Example: [programs/modules/mod-country-cap/src/lib.rs](/root/ERC3436/programs/modules/mod-country-cap/src/lib.rs:36) trusts the provided `country_count` account shape more than the compliance aggregator does.
   - Impact: low, because FRACKS core transfer enforcement does not depend on those weaker direct-read entrypoints.

## 7. Severity Ratings

- Critical: 1
- High: 0
- Medium: 3
- Low: 2
- Informational: multiple architectural/documentation parity notes

## 8. Fixed Vulnerabilities

The following issues identified in prior passes are now fixed in the on-chain code:

1. Remaining-account spoofing during IRP verification.
   - Fixed in [programs/fracks-irp/src/utils.rs](/root/ERC3436/programs/fracks-irp/src/utils.rs:14)
   - Wallet-identity, claim, issuer-entry, and issuer-FID accounts are now validated against canonical PDAs.

2. Compliance helper-account spoofing for daily usage and country count state.
   - Fixed in [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs:1316)
   - Fixed in [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:577)

3. Silent saturating arithmetic in mutable modules.
   - Fixed in:
   - [programs/modules/mod-max-investors/src/lib.rs](/root/ERC3436/programs/modules/mod-max-investors/src/lib.rs:45)
   - [programs/modules/mod-daily-limit/src/lib.rs](/root/ERC3436/programs/modules/mod-daily-limit/src/lib.rs:59)
   - [programs/modules/mod-country-cap/src/lib.rs](/root/ERC3436/programs/modules/mod-country-cap/src/lib.rs:69)
   - [programs/modules/mod-supply-cap/src/lib.rs](/root/ERC3436/programs/modules/mod-supply-cap/src/lib.rs:42)

4. Daily-limit and country-cap modules were checked but not maintained.
   - Fixed by compliance CPI fanout in [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs:181)
   - Hook-authority support added in:
   - [programs/modules/mod-daily-limit/src/lib.rs](/root/ERC3436/programs/modules/mod-daily-limit/src/lib.rs:12)
   - [programs/modules/mod-country-cap/src/lib.rs](/root/ERC3436/programs/modules/mod-country-cap/src/lib.rs:10)

## 9. Remaining Risks

- The unresolved Token-2022 gap remains a production blocker.
- Recovery is still not a true forced asset migration until real token balances are moved at the SPL layer.
- Governance misconfiguration remains a real operational risk because this is a permissioned system with strong owner powers.
- Module-support-account provisioning should be explicitly operationalized before any stateful compliance modules are used in production.

## 10. Mainnet Readiness Assessment

Readiness: not ready for mainnet under the current architecture claims.

Why:

- The protocol is not yet enforcing compliance at the real token-ledger layer.
- The current implementation is still best understood as a FRACKS control-plane plus verification/compliance engine, not the final Token-2022-enforced asset layer described in the doc.

What is ready:

- deterministic PDA orchestration
- identity and claim validation flow
- trusted-issuer and claim-topic enforcement
- stateful compliance post-hooks for the currently wired module set
- local integration testing baseline

## 11. Governance Recommendations

- Treat IRS owner and identity-agent keys as high-trust regulated-operator roles.
- Use multisig control for factory, token owner, compliance owner, and IRS owner roles.
- Require operational runbooks for binding modules and provisioning helper PDAs.
- Freeze deployment to production until Token-2022 integration is complete and tested.

## 12. Scalability Review

Compute and transaction observations:

- IRP verification scales linearly with required topics and supplied claim-related remaining accounts.
- Compliance aggregation scales linearly with bound modules and, for some modules, with helper support-account fanout.
- Factory deployment remains transaction-size sensitive because trusted issuer entries and compliance modules increase CPI and remaining-account load.
- The current remaining-account model is workable for moderate registry sizes but needs disciplined client assembly for larger deployments.

Mainnet practicality:

- small to medium issuer/regulatory configurations look feasible
- large module stacks and heavy claim/account packing will need careful transaction budgeting
- absence of real Token-2022 integration means the most important scalability questions around SPL-level hook execution are still unresolved

## 13. Future Hardening Recommendations

1. Complete Token-2022 mint creation and transfer-hook wiring in the token and factory layers.
2. Move transfer, mint, burn, forced transfer, and recovery to real SPL Token-2022 CPI flows.
3. Add end-to-end tests that assert actual token-account balances, not only FRACKS state transitions.
4. Add negative tests for missing stateful helper accounts and codify the provisioning workflow.
5. Decide whether IRS should continue allowing arbitrary FID remaps or whether wallet-linked FID policy should be enforced more tightly.
6. Consider typed module registries or owner-side module admission checks to reduce governance misbinding risk.

## Verification Performed

On 2026-05-07, the following verification completed locally:

- `anchor build`
- `anchor test --skip-build`

Result:

- full Anchor suite passed with `20 passing`

## Final Conclusion

FRACKS is substantially improved and the on-chain verification/compliance stack is now much harder to spoof or desynchronize than in earlier audit passes. The daily-limit and country-cap state maintenance issue is fixed, the factory flow is coherent, and the full local integration suite is green.

The remaining blocker is not a small bug. It is the still-open architectural gap between the current FRACKS control-plane implementation and the protocol document’s promised Token-2022-enforced asset layer. Until that layer exists, FRACKS should not be represented as fully main-doc-complete or production-ready for regulated mainnet issuance.
