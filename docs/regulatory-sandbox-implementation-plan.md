# FRACKS Regulatory Sandbox Implementation Plan

This file captures the requested contract/frontend changes before implementation.

## Authority Model To Preserve

- Platform admin deploys/configures platform infrastructure and token suites.
- Issuer wallet becomes final owner of the deployed token suite.
- Issuer owner can mint directly and may optionally delegate agents.
- SPL Token-2022 mint authority remains the FRACKS PDA, not a wallet.
- Investor cannot self-issue claims, self-whitelist, or bypass compliance.

## Role Topics

- `1`: KYC provider
- `2`: AML provider
- `3`: Accreditation provider
- `4`: Custodian authority
- `5`: Valuation authority
- `6`: Construction authority
- `7`: Shariah authority
- `8`: Property manager authority

Role-gated protocol actions should validate deterministic PDA accounts, signer authority, and the relevant on-chain role state.

## Custodian Sandbox Scope

The custodian module proves the regulated asset is linked to an authorized custodian before tokenization. It does not model physical custody of real estate; it models mandate acceptance, document custody attestation, reserve attestation, release, and redemption signing.

Required on-chain instructions:

- `create_custody_mandate(asset_id, issuer_fid, custodian_wallet, custodian_fid)`
- `accept_custody_mandate(asset_id)`
- `attest_custody(asset_id, document_hash, attestation_hash, validity_seconds)`
- `attest_reserve(asset_id, reserve_ratio_bps, attestation_hash, validity_seconds)`
- `release_custody_mandate(asset_id, reason_hash)`
- `sign_redemption_event(asset_id, redemption_id, attestation_hash)`

Deployment gate:

- `deploy_token_suite` must require an active accepted custody mandate.
- The mandate custodian and issuer FIDs must be different.
- The latest custody attestation must be active and unexpired.
- If custody lapses, deployment must fail with a readable error.

## Investor Request Cancellation

Investor onboarding applications must be cancellable by:

- the applicant wallet; or
- the token suite issuer/IRS owner.

The latest contract already contains IRS cancellation/removal instructions; frontend must expose them clearly and refresh state after cancellation.

## Frontend Scope

- Add custodian dashboard with pending mandates, attestation panel, document vault placeholder, redemption queue, and mandate history.
- Add issuer off-chain compliance/custody setup page.
- Make issuer deploy flow require custodian mandate and attestation details.
- Auto-fill approved issuer/application fields where available.
- Improve readable errors for authority, duplicate claim, missing identity, invalid token account, lapsed custody, and wrong wallet/provider.
- Expose cancel/delete application controls for investor and issuer.

## Test/Deploy Scope

- Run Anchor build/tests after contract changes.
- Run frontend build/lint where available.
- Deploy updated programs to devnet.
- Recover SOL from stale program buffers only, never close live program accounts.
