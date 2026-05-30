# FRACKS Final Audit Report

Date: 2026-05-08  
Phase: Final Pre-Mainnet Stabilization

## 1. Executive Summary

FRACKS is materially stronger at the end of this verification pass than it was at the start of the day. The codebase remains test green, the Token-2022 transfer-hook and compliance path remains intact under adversarial tests, and the live Solana testnet upgrade-authority posture now matches the stated Squads governance target for every configured FRACKS core and module program.

The protocol is not being marked "mainnet perfect." The main remaining release blocker is operational, not architectural: the locally built factory upgrade has not been executed on testnet because the locally available `squads-multisig-cli` failed to serialize the live Squads multisig account when attempting to initiate the program upgrade proposal. That means governance custody is correct, but the latest local factory-program binary is not yet proven through a full governance-executed upgrade on testnet.

## 2. Final Security Assessment

Verdict: conservative green with one operational release blocker.

- No new business-logic vulnerabilities were introduced in this pass.
- Existing Token-2022 hook red-team coverage still passed end to end.
- Compliance-module spoofing, fake compliance state injection, malformed extra-account-metas, and reordered-account attempts are still rejected by tests.
- Governance custody on testnet is now correct for all configured programs.
- The release blocker is the missing governance-executed factory program upgrade, not a discovered token/compliance exploit.

## 3. Governance Assessment

Governance inputs provided by the user:

- Squads multisig: `8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm`
- Squads vault PDA: `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`
- Threshold: `2-of-3`
- Signers:
  - `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`
  - `4kft3w42bJdgfJQFdwd1VxMXGb7cr2akFeA3XqZrxUSN`
  - `GZb3c8AwLUv2HGjHmsP7wThuHxJZbonStW3hweCWppAZ`

Verified on 2026-05-08 against `https://api.testnet.solana.com`:

- `fracks_factory` -> vault PDA
- `fracks_token` -> vault PDA
- `fracks_token_hook` -> vault PDA
- `fracks_fid` -> vault PDA
- `fracks_irp` -> vault PDA
- `fracks_irs` -> vault PDA
- `fracks_tir` -> vault PDA
- `fracks_ctr` -> vault PDA
- `fracks_compliance` -> vault PDA
- all configured compliance module programs -> vault PDA

Important note:

- Earlier in this session, the user-stated governance posture did not fully match live testnet state.
- On 2026-05-08 I verified the mismatch, then transferred the remaining programs from deployer wallet `7LA1...` to the Squads vault PDA.
- After transfer, the full authority audit returned `mismatches: 0`.

## 4. Token-2022 Architecture Review

The Token-2022 architecture remains sound for the audited design:

- FRACKS controller approval is required before Token-2022 transfer-hook execution can succeed.
- Transfer approvals are bound to account identities and pre-transfer balances, which prevents naive replay.
- The transfer-hook path remains coupled to FRACKS compliance and identity verification rather than user-supplied booleans.
- Stateful modules that need support accounts, including daily-limit and country-cap paths, remain covered by tests.

Residual caution:

- Large remaining-account sets still require disciplined client assembly and, for larger paths, split-transaction handling or an audited versioned-transaction client.

## 5. Transfer Hook Security Review

Verified by existing tests:

- direct Token-2022 transfer without approval is rejected
- direct `execute_transfer_hook` misuse is rejected
- malformed extra-account-metas are rejected
- replay of stale approvals is rejected
- fake compliance-state injection is rejected
- fake compliance-module PDA injection is rejected
- cross-mint approval misuse is rejected
- reordered controller remaining accounts do not break canonical resolution

Assessment:

- no new bypass was found
- no new signer-trust issue was found
- no new remaining-account integrity issue was found

## 6. Compliance Engine Review

The compliance engine continues to enforce the intended model:

- module list comes from `ComplianceState`
- remaining accounts are resolved against expected bound modules
- module-program ownership and module-type checks remain in place
- hook-authority enforcement remains in place for state-mutating module callbacks

Daily-limit and country-cap observations:

- current tests still prove the support-account flow works through the canonical hook path
- no new arithmetic or hook-ordering issue was identified in this pass

## 7. Factory Architecture Review

Repo-side factory status:

- local code includes two-step factory ownership handoff
- local deployment script supports governance staging via `FRACKS_FACTORY_OWNER` or `FRACKS_PROTOCOL_MULTISIG`
- local CLI surface now includes `accept_factory_ownership`

Live testnet status:

- testnet factory program authority is now on the Squads vault PDA
- the live testnet factory binary has not yet been upgraded through Squads to the latest local factory build
- `factory_state` PDA was not found on testnet during this pass

Consequence:

- governance custody of the factory program is correct
- governance-controlled deployment flow cannot be fully proven on testnet until the factory program upgrade is executed through Squads and the intended `factory_state` is initialized under the desired release procedure

## 8. Upgrade Authority Mapping

All program IDs below were verified on 2026-05-08:

| Program | Program ID | Upgrade Authority |
| --- | --- | --- |
| `fracks_factory` | `6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `fracks_token` | `Gr9Y5q2aHtQEpYHgqme3hctqQ2sNRGF1ZVx9cQvMDjBn` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `fracks_token_hook` | `CQwdsA97gSiPMUzNXjS22AUu6HmvzMK2XZVqhswYEHLi` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `fracks_fid` | `7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `fracks_irp` | `6dDKwtRbGkHJhU9LztpDkBC3fUdM46WeKJdrASFikce6` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `fracks_irs` | `CsrdR7QK3ma6hxU46Cp4DZHAdbGPWPiwmGjhKsR9VzdS` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `fracks_tir` | `Am5W7oEe8NCU4jdLP8qyUT3gjUPCDsvTSxGhdCQp1ETS` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `fracks_ctr` | `B15EFQKwnfbNHXHhPVvVcw18PaBeTDsRLNRno3QS8Yna` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `fracks_compliance` | `9XYxZzDfU17BBpN1qhdu7RDCCrV6uebDgi5xse7Jbz5d` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `mod_country_cap` | `Cv1HA7nHX8vxZvyCKXjk3gYPkqhfHFXxEsyxSXyRT3Ci` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `mod_country_restrict` | `BCGKsDTyncA4EbHzxGVmEi3pheotJiaxCwYvHGxERiZ7` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `mod_daily_limit` | `FYJ1K8cWUsDmbxNpgaBaEmm3RpvvfpxBBWg2MLm4x8Sq` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `mod_lockup` | `6XqxWPwZQrfTo2ZJeT7wBhJaXd1eKjB2kx5ZrP1CLwa9` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `mod_max_balance` | `9BjLakhcX1ms34VjRwUgMZQAgdbsMM8C1gSPqrJTyCpH` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `mod_max_investors` | `4KVbq2esECUHZZdsBiDMM3mxYt8K7rNJUdotG6uZJfRQ` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `mod_max_transfer` | `Ee6RXC46Nb4Bo2BTQcXBHfuxLZdzbKtPmb3sGf2Egiqh` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |
| `mod_supply_cap` | `EkgX6pGFCFT7FuNWuBAAMePy43iU9oETLDota4nTA3x8` | `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z` |

## 9. Deployment Architecture

Current deployment reality:

- core and module programs are already deployed on testnet
- governance custody is now correct on testnet
- only the factory program has a known local on-chain code delta in this workspace
- a fresh factory-program buffer was written to testnet:
  - buffer address: `AghYNVsNAuHTMQJEYYPUs7rfNqGiUeaPe5uq7uxoMh42`
  - buffer write signature: `wSLGYozdsiQKp4SRj1WaLhjGk4ERqn2H3zaMwMNiq41M5ShxM`

What did not complete:

- the governance proposal to upgrade `fracks_factory` through Squads did not complete from this environment
- `squads-multisig-cli` failed with:
  - `Transaction simulation failed: Error processing Instruction 1: Failed to serialize or deserialize account data`

Assessment:

- this looks like a release-tooling compatibility issue between the local Squads CLI and the on-chain Squads program/account format
- it is not evidence of a FRACKS protocol bug

## 10. Verification And Testing

Completed on 2026-05-08:

- `anchor build` -> success
- `anchor test --skip-build --skip-lint` -> success
- result -> `30 passing`
- CLI schema/operator checks:
  - `node scripts/cli/fracks_factory/deploy_token_suite.js --print-schema`
  - `node scripts/cli/fracks_factory/accept_factory_ownership.js --print-schema`
  - `node scripts/cli/list.js`
- additional live governance validation:
  - full authority audit against testnet with expected authority set to the Squads vault PDA

Tooling issue fixed during this pass:

- `scripts/cli/manifest.json` was regenerated so `accept_factory_ownership` is now exposed by CLI discovery output

## 11. Remaining Risks

- The latest local factory-program binary is not yet executed on testnet through the real Squads upgrade path.
- `IRS` ownership remains structurally tied to PDA seeds `[b"irs_state", owner]`; retroactive migration remains sensitive.
- A direct `solana account` lookup for the vault PDA returned `AccountNotFound`. Inference:
  - the vault address is being used as a derived signer address rather than a conventional funded account.
  - that is consistent with Squads PDA-style governance, but it should still be validated with the exact Squads version and runbook used for production.
- The local Squads CLI should not be assumed production-ready for this multisig without version matching and one successful upgrade dry run.

## 12. Mainnet Readiness Assessment

Status: near-ready but not release-complete.

Green:

- core protocol tests
- hook-path red-team tests
- compliance-path validation
- live testnet upgrade-authority custody

Not yet green:

- governance-executed factory upgrade on testnet using the same multisig tooling/process intended for production
- final testnet proof of the upgraded factory governance flow end to end

## 13. Operational Recommendations

- Treat the Squads CLI compatibility issue as the immediate release-engineering blocker.
- Resolve it with the exact Squads version that matches multisig `8jLb...Fedmm`.
- After tool alignment:
  - reuse buffer `AghYNV...Mh42` if still desired
  - create the program-upgrade proposal
  - collect second approval
  - execute the upgrade
  - initialize factory state only after the intended factory binary is live

## 14. Emergency Governance Recommendations

- Keep at least one signer operationally isolated from the release workstation.
- Require independent review before any future program upgrade proposal execution.
- Keep an offline record of:
  - buffer address
  - program id
  - artifact hash
  - deployment signature
  - proposal index
  - approval signatures
  - execution signature

## 15. Upgrade Policy Recommendations

- Never bypass the Squads governance path once authority is on the vault PDA.
- For any program upgrade:
  - write buffer
  - record binary hash
  - create governance proposal
  - require threshold approvals
  - execute via governance
  - verify authority remains unchanged after execution

## 16. Multisig Operational Recommendations

- Maintain signer inventory out of band and verify signer devices quarterly.
- Keep a tested fallback path for the exact Squads program version deployed on the target cluster.
- Run at least one non-production governance transaction on the same multisig tooling stack before mainnet launch.

## 17. Files Changed In This Stabilization Pass

- `programs/fracks-factory/src/lib.rs`
- `migrations/deploy.ts`
- `tests/factory.ts`
- `scripts/cli/fracks_factory/accept_factory_ownership.js`
- `scripts/governance/audit_upgrade_authorities.js`
- `scripts/governance/plan_upgrade_authority_transfer.js`
- `scripts/cli/manifest.json`

## 18. Conservative Final Verdict

FRACKS is testnet-governed and test green. It is not yet fully mainnet green because the final factory-program governance upgrade has not been executed successfully through the intended Squads release path.
