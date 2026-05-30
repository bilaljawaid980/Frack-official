# FRACKS Final Governance Report

Date: 2026-05-08

## Governance Topology

- Multisig address: `8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm`
- Vault PDA: `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`
- Threshold: `2-of-3`
- Signers:
  - `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`
  - `4kft3w42bJdgfJQFdwd1VxMXGb7cr2akFeA3XqZrxUSN`
  - `GZb3c8AwLUv2HGjHmsP7wThuHxJZbonStW3hweCWppAZ`

## What Was Verified

- `squads-multisig-cli display-vault --multisig-address 8jLb...Fedmm --vault-index 0`
  returned vault PDA `Cftz...AJe9z`
- testnet upgrade-authority audit returned `mismatches: 0`
- every configured FRACKS core and module program now points at the vault PDA as upgrade authority

## Governance Safety Assessment

Strengths:

- upgrade custody is no longer on a single deployer wallet
- all configured shared programs use a common governance authority
- threshold `2-of-3` is acceptable for testnet and operationally manageable

Weaknesses and caveats:

- this session did not prove a successful program upgrade executed through the current local Squads CLI
- direct CLI creation of the program-upgrade proposal failed with account deserialization error
- governance custody is therefore correct, but governance execution tooling remains a release dependency

## Upgrade Flow Safety

Current intended safe flow:

1. Build artifact locally.
2. Write buffer to chain.
3. Create Squads proposal targeting the governed program.
4. Collect threshold approvals.
5. Execute vault transaction.
6. Verify program authority remains on the vault PDA.
7. Record artifact hash, proposal index, signatures, and explorer links.

Why this is safer:

- no single signer can unilaterally upgrade
- release artifacts can be reviewed before execution
- execution leaves a distinct governance trail

## Governance Assumptions

- The Squads vault PDA can serve as upgrade authority without being a normal funded account.
  - This is an inference from successful authority assignment and `display-vault` output.
  - It should still be validated against the exact Squads version and on-chain program used in production.
- One signer key was available locally and could perform authority transfers while it was still the current upgrade authority.
- Once authority is on the vault PDA, future upgrades must use the Squads execution path.

## Governance Findings

Finding G-01: live authority posture was partially inconsistent with stated posture at the start of this session.

- Severity: Medium operational
- Status: Closed on 2026-05-08
- Detail:
  - `fracks_fid` and all module programs still pointed to deployer wallet `7LA1...`
  - transferred during this session to `Cftz...`

Finding G-02: local Squads CLI could not initiate the factory upgrade proposal.

- Severity: Medium release blocker
- Status: Open
- Detail:
  - buffer write succeeded
  - proposal initiation failed during transaction simulation with account serialization/deserialization error
- Impact:
  - no testnet proof yet that the current local factory binary can be upgraded through the exact production governance path

## Recommended Governance Actions

- Resolve the Squads CLI and on-chain account-format compatibility issue.
- Run one successful governed upgrade on testnet before declaring mainnet green.
- Maintain an operator runbook for:
  - writing buffers
  - creating proposals
  - approving proposals
  - executing proposals
  - verifying post-upgrade authority state

## Conservative Governance Verdict

Governance custody is green. Governance execution is not fully green until a governed program upgrade succeeds through the intended Squads operator stack.
