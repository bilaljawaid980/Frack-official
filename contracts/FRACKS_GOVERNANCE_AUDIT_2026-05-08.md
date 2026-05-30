# FRACKS Governance And Upgrade-Authority Audit

Date: 2026-05-08  
Scope: governance, multisig readiness, upgrade authority, factory/deployment flow

## 1. Current Governance Status

- Source-of-truth architecture states that all shared FRACKS programs should be governed by a FRACKS protocol multisig.
- Codebase reality before this change:
  - protocol program upgrade authority was not enforced in code and relied on external deployment operations
  - `FactoryState.owner` used a one-step transfer and had no acceptance step
  - deployment flow initialized the factory under the deployer wallet unless a separate manual handoff occurred
  - token ownership already used a two-step handoff
  - registry/compliance/token-suite components were deployable under any signer, including a multisig signer, but several of those ownership models still assume the final owner signs directly at deploy time
- Network verification on 2026-05-08 against `https://api.testnet.solana.com`:
  - every configured testnet FRACKS core and module program currently has upgrade authority `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`
  - this includes:
    - `fracks_factory`
    - `fracks_token`
    - `fracks_token_hook`
    - `fracks_fid`
    - `fracks_irp`
    - `fracks_irs`
    - `fracks_tir`
    - `fracks_ctr`
    - `fracks_compliance`
    - all listed compliance module programs

## 2. Existing Risks

- High: all shared program upgrades on testnet are still controlled by a single wallet, not a governance multisig.
- High: the factory governance control plane previously used one-step owner replacement, which allowed accidental or malicious irreversible reassignment.
- High: deployment tooling previously defaulted to deployer ownership with no built-in governance handoff path.
- Medium: issuer-level token suites can be deployed under a multisig signer today, but post-deploy migration of the full suite is incomplete because some state programs do not support a clean suite-wide authority migration.
- Medium: `IRS` authority is structurally coupled to PDA derivation with seeds `[b"irs_state", owner]`, which makes retroactive authority migration dangerous without a dedicated data migration plan.
- Medium: `IRP` verification depends on `IRS.owner == IRP.owner`; careless partial ownership changes can desynchronize registry authorization.

## 3. What Was Missing

- Safe two-step ownership transfer for the protocol-owned factory state.
- A deployment-script path that explicitly stages governance ownership instead of silently leaving ownership on the deployer.
- Operational tooling to audit live upgrade authorities and generate transfer commands for all configured programs.
- A regression test proving factory governance transfer works.

## 4. What Was Implemented

- Added two-step factory ownership handoff:
  - `transfer_factory_ownership(new_owner)` now stages `pending_owner`
  - `accept_factory_ownership()` finalizes the transfer from the pending owner signer
- Added factory-state validation against default/null pending owner.
- Updated deployment migration flow:
  - supports `FRACKS_FACTORY_OWNER` or `FRACKS_PROTOCOL_MULTISIG`
  - if deployer and governance differ, deployment now stages governance transfer immediately after initialization
  - logs pending-owner status for existing factory state
- Added governance operations scripts:
  - `scripts/governance/audit_upgrade_authorities.js`
  - `scripts/governance/plan_upgrade_authority_transfer.js`
- Added CLI wrapper:
  - `scripts/cli/fracks_factory/accept_factory_ownership.js`
- Added automated coverage for the new two-step factory transfer flow.

## 5. Upgrade Authority Mapping

Verified on 2026-05-08 from Solana testnet:

- Current upgrade authority for every configured FRACKS core and module program: `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`
- This is not governance-grade for production.
- Required target state:
  - all shared core programs -> FRACKS protocol multisig
  - all shared compliance module programs -> FRACKS protocol multisig

## 6. Protocol-Level Governance Readiness

- After this patch, factory ownership handoff is production-safe.
- Upgrade-authority governance is operationally ready but not yet executed on testnet/mainnet.
- Protocol-level readiness is therefore:
  - code readiness: improved
  - operational readiness: pending multisig migration
  - current live readiness: not complete until upgrade authority transfer is executed

## 7. Issuer-Level Governance Readiness

- Supported today:
  - Squads multisig signer
  - SPL Governance execution account, if it can act as the transaction signer path
  - PDA-style governance signer where the governance system provides the signature/CPI execution
- Compatible surfaces:
  - `OwnerState` in `fracks_token`
  - token `AgentRole`
  - `TIR`, `CTR`, `ComplianceState`, and factory deployment when the final issuer/governance signer deploys directly
- Important limitation:
  - `IRS` migration is not cleanly transferable after deployment because the PDA seed includes the owner pubkey
  - `IRP` governance is coupled to `IRS` ownership for verification consistency
- Safe issuer pattern:
  - deploy a new token suite directly under the final issuer multisig from day one
  - do not deploy under an EOA first if the intended steady-state owner is a multisig

## 8. Mainnet Readiness Assessment

- Not mainnet ready if upgrade authority remains on a single deployer wallet.
- Conditionally mainnet ready after:
  - all core and module upgrade authorities are transferred to the FRACKS protocol multisig
  - factory ownership is accepted by governance
  - issuers deploy new suites directly under their final multisig owners

## 9. Remaining Risks

- `IRS` authority migration remains a structural limitation.
- `IRP` and `IRS` can still be desynchronized by unsafe manual operational changes.
- Several issuer-owned registry/compliance components still rely on direct-owner deployment rather than a universal suite-level migration framework.
- Existing deployments initialized under an EOA are not automatically remediated by this patch.

## 10. Recommended Operational Policies

- Never launch shared programs to production with a single-wallet upgrade authority.
- Use the new audit script before every release and after every authority change.
- Require documented governance approval for every upgrade, buffer deployment, and authority transfer.
- Treat factory ownership and upgrade authority as separate control planes; both must be governed.
- For regulated issuers, require deployment directly from the final issuer multisig or governance executor.

## 11. Recommended Multisig Setup

- Protocol upgrade authority:
  - Squads v4 multisig
  - isolated from day-to-day operator wallets
  - hardware-backed keys
- Issuer owner:
  - issuer-specific Squads multisig or equivalent governance executor
  - separate from protocol upgrade authority

## 12. Recommended Thresholds

- Protocol multisig:
  - minimum `3-of-5`
  - preferred `4-of-7` for mainnet
- Issuer multisig:
  - minimum `2-of-3` for lower-risk deployments
  - preferred `3-of-5` for high-value regulated assets

## 13. Emergency Recovery Recommendations

- Pre-authorize an emergency protocol-upgrade process with a stricter threshold than routine ops if possible.
- Keep an offline runbook for:
  - `solana program write-buffer`
  - `solana program deploy`
  - `solana program set-upgrade-authority`
- Require post-incident audit of:
  - shared program upgrade authority
  - factory owner and pending owner
  - issuer multisig ownership of new deployments

## 14. Files Changed

- `programs/fracks-factory/src/lib.rs`
- `migrations/deploy.ts`
- `tests/factory.ts`
- `scripts/cli/fracks_factory/accept_factory_ownership.js`
- `scripts/governance/audit_upgrade_authorities.js`
- `scripts/governance/plan_upgrade_authority_transfer.js`

## 15. Functions Changed

- `fracks_factory::initialize_factory`
- `fracks_factory::transfer_factory_ownership`
- `fracks_factory::accept_factory_ownership` added
- `deploy()` in `migrations/deploy.ts`

## 16. Breaking Changes

- On-chain `FactoryState` layout changed by adding `pending_owner`.
- This is a state-layout change for the factory program.
- Existing deployed `factory_state` accounts require migration or controlled reinitialization before upgrading the live factory program in place.

## 17. Migration Requirement

- Yes, for any already-initialized live `FactoryState`.
- No migration was added for `FactoryState`; operational rollout must account for the new account size/layout.
- Existing issuer token suites are not automatically migrated.

## 18. Current Deployments Affected

- Existing shared programs: affected only when the upgraded factory program is deployed.
- Existing `factory_state` PDA: affected by the new layout and needs a migration plan.
- Existing token suites:
  - not directly modified by this patch
  - still subject to the `IRS`/`IRP` authority-migration limitation if they were originally deployed under a single wallet

## 19. Validation

- `anchor build` completed successfully.
- `anchor test --skip-build --skip-lint` completed successfully.
- Result: `30 passing`
