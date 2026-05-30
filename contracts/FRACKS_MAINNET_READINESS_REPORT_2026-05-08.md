# FRACKS Mainnet Readiness Report

Date: 2026-05-08

## Executive Summary

FRACKS is closer to mainnet readiness than it was before this pass, but a conservative mainnet green signal is still not appropriate today.

What is green:

- test suite
- Token-2022 hook path
- compliance-path red-team coverage
- live testnet upgrade-authority governance custody

What is not yet green:

- one successful governed testnet upgrade using the exact Squads operator path intended for production

## Final Security Assessment

- no new protocol-level token/compliance vulnerability found
- live authority custody now matches protocol governance target
- no direct bypass was found in transfer-hook/compliance tests

## Remaining Risks

- second-governance-signer availability for the staged factory upgrade
- factory-program live testnet upgrade still pending final governed execution
- `IRS` ownership/derivation coupling still requires careful migration policy

## Mainnet Gate

Mainnet should remain blocked until all items below are complete:

- collect a second approval on proposal `3jUe3dcJnu2z2F1VP9TUutvFrnQHsfShRs1WfpKVF5gB`
- execute vault transaction `2nVwSoxecJR6CBqjfANjTp5D8i79FmZiHvBoLq4CH3jJ`
- verify post-upgrade program behavior and authority retention
- record final release artifact hashes and governance signatures

## Cold Wallet Requirements

- production signers should be hardware-backed
- signing devices should not live on the build workstation
- signer custody should be independently documented

## Hardware Wallet Recommendations

- dedicated hardware wallets per production signer
- no reuse of dev/test key material for mainnet governance

## Multisig Operational Procedures

- require two signer approvals for all production upgrades
- maintain change ticket or release record for every proposal
- require post-execution verification before announcing completion

## Upgrade Policy

- no direct hot-wallet upgrade authority on mainnet
- no undocumented emergency upgrade
- every upgrade must include:
  - build hash
  - buffer address
  - proposal index
  - approval record
  - execution signature
  - post-upgrade verification

## Emergency Procedures

- define compromised-signer runbook
- define failed-upgrade rollback/containment procedure
- define communication path for release incidents

## Conservative Final Verdict

FRACKS is not blocked by a newly discovered protocol exploit. The Squads execution-path bug has been diagnosed and worked around, and a valid governed factory-upgrade proposal plus first approval now exist on testnet. Mainnet remains blocked until a second signer approves and the governed upgrade is actually executed and re-verified end to end.
