# FRACKS Protocol Context — Full Project Conversation Summary

This file is a consolidated working context for the FRACKS Protocol work discussed in this chat. It is intended to help a new AI agent or developer understand what the platform is, what was already implemented, what issues were debugged, what architectural decisions were made, and what the current next steps are.

---

## 1. Project Overview

FRACKS is a Solana-based regulated real-estate tokenization platform for real-world assets (RWAs). It uses Anchor smart contracts, SPL Token-2022, a Next.js frontend, a NestJS backend, Prisma, PostgreSQL, and Supabase Storage for legal documents.

The goal is not simply to create a token mint. FRACKS represents a full regulated RWA workflow:

```text
Legal property documents
→ issuer submission
→ platform/admin review
→ independent custodian verification
→ custody attestation
→ token-suite deployment
→ independent valuation/NAV attestation
→ investor purchase eligibility
→ KYC/AML
→ IRS whitelist and activation
→ minting
→ transfer compliance
→ distributions, governance, marketplace, quick exit, succession, disputes and total-loss later
```

The project is currently being built as a regulatory sandbox on Solana devnet/testnet-style infrastructure, with simulated services for regulators and partners. The sandbox plan covers property verification, custody, valuation, investor onboarding, payment simulation, distributions, governance, secondary market, Quick Exit, construction milestones, succession, insurance/total loss and regulatory controls.

---

## 2. Core Stack

### Frontend

- Next.js
- TypeScript
- Solana wallet adapter
- Token-2022 frontend transaction builders
- Existing routes include issuer, investor, KYC provider, custodian, valuer, issuance/admin-like flows, marketplace and asset detail pages.

### Backend

- NestJS
- Prisma
- PostgreSQL
- Transaction ledger
- Workflow transitions
- Audit logs
- Outbox foundation
- Organizations, wallet accounts, roles, authority bindings
- API modules for assets, asset requests, issuance, purchase requests, transfer requests, trusted issuers, blockchain transactions, platform custodians, asset documents, valuations, etc.

### Storage

- Supabase Storage is used for legal and valuation documents.
- PostgreSQL stores normalized document metadata and hashes.
- The frontend must never receive Supabase service-role keys.

### Blockchain

- Anchor programs
- SPL Token-2022 with TransferHook, PermanentDelegate and MetadataPointer extensions.
- Important FRACKS programs include:
  - `fracks_factory`
  - `fracks_token`
  - `fracks_token_hook`
  - `fracks_compliance`
  - `fracks_fid`
  - `fracks_irs`
  - `fracks_irp`
  - `fracks_tir`
  - `fracks_ctr`
  - `fracks_asset_registry`
  - governance, trade escrow, and later lifecycle programs depending on phase.

---

## 3. Identity and Compliance Concepts

### FID

FRACKS Identity account. Wallets create their own FID.

For a wallet:

```text
FID PDA = ["fid", wallet]
```

The FID owner must match the wallet for many professional roles.

### Claims

Claims are stored under the FID program. They include:

- topic
- issuer FID
- signer key
- expiry
- revoked flag
- data hash
- signature

Claim validity is not simply “has topic X.” The real validity check is:

```text
claim topic matches required topic
claim is not revoked
claim is not expired
claim issuer FID exists
claim signer key matches issuer FID signer key
issuer FID is trusted in the token’s TIR for that topic
```

### CTR

Claim Topics Registry. Defines which topics a token requires.

Example:

```text
Topic 1 = KYC
Topic 2 = AML
Topic 3 = Accreditation
```

### TIR

Trusted Issuers Registry. Token-specific trusted issuer registry. Each token suite has its own TIR.

The TIR owner can add or update trusted issuer entries. The contract has `has_one = owner`, so only `tir_state.owner` may call `add_trusted_issuer` / `update_issuer_topics`.

### IRS

Identity Registry Storage. Token-specific wallet identity storage. Even if an investor has a valid global FID and valid claims, they must be registered and active in the token’s IRS before mint/transfer.

### IRP

Identity Registry Proxy. Performs combined verification against FID, IRS, CTR and TIR.

---

## 4. Authority Topic Constants

The project currently uses these role topics:

```text
1 = KYC
2 = AML
3 = Accreditation
4 = Custodian authority
5 = Valuation authority
6 = Construction authority
7 = Shariah authority
8 = Property manager authority
```

Important correction:

- Custodian topic 4 is **not** token TIR in the currently verified factory flow. Custodian uses factory-level PlatformAuthority topic 4.
- Valuer topic 5 **is** token-specific TIR trust. Valuer authorization occurs per deployed token.

---

## 5. Historical Debugging and Fixes

### 5.1 Token Owner / IRS / IRP Mismatch

Earlier deployment/minting failed with errors like:

```text
Deployment invariant failed: IRP owner ... does not match IRS owner ...
Token registry ownership is misconfigured. IRP owner ... does not match IRS owner ...
```

Root cause:

- There had been a frontend workaround where platform admin passed issuer as token owner and parts of IRS/IRP ownership forwarding were inconsistent.
- Token suite ownership alignment mattered. IRP/IRS/CTR/TIR/OwnerState must align correctly after deployment.

Resolution direction:

- Remove frontend workaround that incorrectly forwarded ownership.
- Restore intended flow where Platform Admin deploys but Issuer becomes operational token owner.
- Redeploy with aligned owners.

Outcome:

- Deployment/mint eventually worked after redeploy and ownership alignment.

---

### 5.2 KYC Claim Signer Mismatch and Automatic Signer Rotation

Problem:

- Investors had topic 1 claims, but claims were signed with an old KYC provider signer key.
- Contract checks `claim.signer_key == issuer_fid.signer_key`.
- Old claims became invalid after provider signer key changed.

Dangerous frontend behavior found:

1. KYC provider page tried to roll back provider signer key to a stale claim signer.
2. `identity.ts` and `trex-client.ts` silently rotated signer keys if local signer did not match on-chain signer.

Resolution plan:

- No contract changes.
- Remove automatic signer rotation from normal claim issuance.
- Keep signer rotation explicit in Identity Manager only.
- Stale claims should be revoked and reissued, not fixed by mutating the provider signer key.

Important UX rule:

```text
Automatic signer key mutation is wrong for live providers.
Signer rotation must be explicit, warned, and admin-controlled.
```

---

### 5.3 Phantom `signMessage` Failure

Error:

```text
The issuer FID signer key is set to the connected wallet, but wallet message signing did not succeed.
Wallet error: You cannot sign solana transactions using sign message
```

Debug result:

- `signMessage` was called from `IdentityService.issueClaim`.
- It was signing a 32-byte claim digest, not a transaction.
- Direct Phantom APIs also refused the binary 32-byte payload.
- This was a Phantom/runtime limitation in that environment.

Important conclusion:

- The current claim digest was correct.
- Phantom refused `signMessage` for that payload.
- Historical successful claims were likely using an old dev/local backend signer route, not Phantom wallet signing.

Possible paths discussed:

- Use a wallet that supports the required raw `signMessage`.
- Use explicit delegated provider signer mode.
- Create a new provider configured correctly from the beginning.

But the user did not want random rotating signer keys.

---

### 5.4 Delegated Signer Experiment and Deployed FID Behavior

A delegated signer approach was explored.

Key debug finding:

- Stored claim signature verified against the delegated signer.
- But the deployed claim account stored `claim.signer_key` as the provider owner wallet, not delegated signer.
- That meant delegated signing could not work with the deployed `fracks-fid` binary behavior unless contract/deployment was fixed.

User pushed back because old frontend worked with same contracts.

Practical result:

- Reverted to old working wallet-backed/provider-owner signer model for KYC.
- Fixed add_claim ABI drift to deployed 5-argument ABI.
- Added stale-claim cleanup and stricter post-claim validation.

---

### 5.5 Transfer Flow Fixes

The transfer flow originally failed after preflight passed.

Problems found:

1. Transfer preflight could say eligible while transaction builder attached an old invalid claim.
2. For tokens with zero compliance modules, builder skipped base transfer-hook accounts, causing TransferChecked failures.

Fixes:

- Filter attached claim accounts to token-valid trusted signer claims only.
- Always append base transfer-hook accounts even when `compliance.modules` is empty.
- Added investor page transfer UX and stale claim removal card.
- Transfer eventually succeeded.

Product flow decision:

- Instead of Investor A doing all onboarding for Investor B, buyer/Investor B should initiate eligibility/onboarding when they want to buy or receive tokens.
- Future marketplace should let sellers list tokens and buyers complete their own eligibility process.

---

### 5.6 Hook `extra_account_metas` Rent Debugging

Deployment failed with rent/insufficient-funds-style errors around `extra_account_metas`.

Findings:

- Compiled transaction index 12 mapped to `extra_account_metas`, the Token-2022 transfer hook ExtraAccountMetaList PDA.
- Expected size: 2291 bytes.
- Rent: 16,836,240 lamports.
- Standalone `InitializeExtraAccountMetas` simulation succeeded.
- Therefore the hook init was not fundamentally broken.

Conclusion:

- Failures were in full deploy transaction path or account-state sequencing, not hook PDA sizing.

---

### 5.7 Freeze / Unfreeze Rent Explanation

Issuer-side freeze/unfreeze controls were implemented.

Question: Phantom showed SOL deducted on freeze and SOL returned on unfreeze.

Contract conclusion:

- `freeze_wallet` creates a freeze-state PDA.
- PDA size: 113 bytes.
- Rent: 1,677,360 lamports = 0.00167736 SOL.
- `unfreeze_wallet` closes the PDA with `close = authority`, refunding rent to the signer.

Therefore:

```text
Phantom ±0.001677 SOL = rent deposit/refund, not network fee.
```

Additional implementation:

- Transaction recorder now tracks network fee, rent deposit, rent refund and net SOL change.
- Migration `016_blockchain_transaction_fee_rent_breakdown.sql` was added and applied manually because Prisma detected drift.

---

## 6. Burn and Freeze Authority

The contracts support:

- burn
- freeze_wallet
- unfreeze_wallet
- freeze_partial
- unfreeze_partial
- forced_transfer

Authority check:

```text
authorize_operator(...)
```

Authorized actors:

- token-suite owner from OwnerState, usually issuer after deployment
- active token agent added by owner

Investors cannot normally burn or freeze their own tokens.

The issuer can burn investor-held tokens because Token-2022 uses a Permanent Delegate set to the FRACKS token-state PDA. The issuer/agent signs the FRACKS instruction, then the contract uses PDA authority/permanent delegate path to burn from the investor account.

This is a regulated security/RWA-style issuer power, not a normal self-burn.

UI decision:

- Burn/freeze controls belong on the issuer page in holder controls.
- Investor pages should only show status, not controls.

---

## 7. Phase 0 Audit and Phase 1 Backend Foundation

### Phase 0

Completed and eventually approved. It covered:

- backend route audit
- frontend endpoint usage map
- Prisma/migration audit
- current workflow map
- role architecture
- wallet model
- source-of-truth matrix
- contract blockers
- sandbox isolation design
- endpoint authorization matrix
- Phase 1 file and test plan

### Phase 1

Completed:

- Organizations
- Wallet accounts
- Platform roles
- Organization memberships
- Authority bindings
- Workflow transitions
- Audit logs
- Outbox foundation
- Environment/startup validation
- Prisma migration generated/applied

Important rule:

- Build in vertical slices: database + backend + frontend + blockchain integration + testing together.
- This matches the user’s working approach and avoids building unused backend code.

---

## 8. Sandboxing Strategy

Sandboxing has two meanings:

1. Technical sandbox:
   - isolated DB
   - isolated Supabase bucket
   - devnet programs
   - sandbox wallets
   - sandbox-only signing keys
   - `SANDBOX_MODE`
   - reset/seed tooling

2. Regulatory sandbox:
   - live demonstrable workflows with fake/simulated institutions.

The FRACKS sandbox plan includes mock modules:

- NADRA simulator
- PLRA/property registry simulator
- bank payment simulator
- valuer simulator
- custodian simulator
- PLF institution simulator
- secondary market test wallets
- construction certifier simulator
- court/Wirasat simulator
- insurance simulator
- Shariah board simulator

Immediate architecture note:

- Sandbox environment starts now and runs alongside every feature.
- Simulators are added with the related vertical slice.

---

## 9. Custodian Addition — Implemented

### 9.1 Business Meaning

Custodian is a separate organization from Platform Admin and Issuer.

The custodian has:

- own wallet
- own FID
- own organization record
- own authorized signatories/users
- own custodian dashboard

Custodian proves legal/title-document custody of the underlying property. It does not own or mint the token.

---

### 9.2 Authority Model

Important verified correction:

```text
Custodian is NOT authorized through token TIR.
Custodian uses factory-level PlatformAuthority topic 4.
```

Factory checks:

```text
custodian_fid_account PDA = ["fid", custodian_wallet]
custodian_fid_account.owner == custodian_wallet
custodian FID != issuer FID
custodian has PlatformAuthority topic 4
```

The custodian is protocol-level approved, not token-level TIR trusted.

---

### 9.3 Implemented Flow

```text
Custodian connects wallet
→ creates/records FID
→ Admin registers custodian in Personnel → Custodians
→ Admin approves custodian as PlatformAuthority topic 4
→ Issuer selects custodian in asset submission
→ Admin sees selected custodian in issuance form
→ Admin confirms/changes custodian
→ Admin creates custody mandate
→ Custodian accepts mandate
→ Custodian submits custody attestation
→ Deployment readiness passes
→ Token suite deploys
```

---

### 9.4 Backend Implemented

- Platform custodian registry separate from Trusted Issuers.
- `/platform-custodians` APIs.
- Custody mandate APIs.
- Deployment-readiness checks.
- Backend verifies:
  - custodian registered
  - custodian FID exists
  - status APPROVED
  - PlatformAuthority topic 4 exists
- Prisma models/migrations for platform custodians and custody workflow.

---

### 9.5 Frontend Implemented

- Personnel page `Custodians` tab.
- `/custodian` portal.
- Custodian creates/records FID.
- Admin approves custodian as PlatformAuthority topic 4.
- Approved custodian can accept custody mandates and submit attestations.
- Issuer submit-request form allows selecting a valid custodian.
- Custodian selector moved to Step 1 as a clean “Custody setup” panel.
- Submit request metadata stores proposed custodian details.
- `/issuance?requestId=...` Compliance/Custody step shows issuer-selected custodian and allows admin change/final assignment.

---

### 9.6 Deployment Readiness

Deployment requires:

```text
required documents: FARD, LEGAL_OPINION, WHITEPAPER
custodian registered and approved
custodian FID valid
PlatformAuthority topic 4 active
custodian differs from issuer
custody mandate exists
mandate accepted
custody attestation exists and is active
attestation not expired
token not already deployed
```

The token was successfully deployed after implementing this custodian-gated flow.

---

## 10. Normalized Document Model — Implemented

### 10.1 AssetDocument Model

A normalized `AssetDocument` Prisma model and migration were added.

Fields include:

- document type
- visibility: PUBLIC / PRIVATE
- storage bucket/key
- SHA-256 file hash
- file metadata
- soft delete support
- link to AssetRequest
- link to factoryAssetId
- link to deployed asset ID

### 10.2 APIs

Added `AssetDocumentsModule`:

```http
GET    /assets/:assetId/documents
POST   /assets/:assetId/documents
DELETE /assets/:assetId/documents/:documentId
```

### 10.3 Integrated Behavior

- Asset request creation automatically registers uploaded legal docs into `asset_documents`.
- Legal-doc upload now returns a real SHA-256 `fileHash`.
- Issuer submit form includes required document type options.
- Deployment readiness checks:
  - FARD
  - LEGAL_OPINION
  - WHITEPAPER
- Deployed asset persistence links document rows to deployed asset.
- Asset detail page fetches public normalized documents and shows:
  - document name
  - document type
  - SHA-256 hash preview
  - open link

### 10.4 Validation

- `npm.cmd run prisma:generate` passed.
- `npx prisma migrate status` reports DB schema up to date.
- Backend build passed.
- Frontend build passed.
- `prisma:migrate` timed out once, but schema status confirmed DB was up to date.
- No contracts were changed.

---

## 11. Valuer Addition — Substantially Implemented

### 11.1 Business Meaning

Valuer is an independent professional organization/person with:

- own wallet
- own FID
- backend platform approval
- token-specific TIR topic 5 authorization

Valuer submits NAV and methodology/report hash.

---

### 11.2 Authority Model

Important verified correction:

```text
Valuer approval in Personnel = backend approval only.
Trust Topic 5 = token-specific on-chain TIR authorization.
```

Valuer is NOT factory PlatformAuthority like custodian.

The token-specific TIR owner must authorize the valuer for topic 5.

For one specific token, observed:

```text
Connected platform admin wallet:
7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E

Token TIR owner:
HBM2UsKMEs74khHYTJjgoJ1VgCYcBurzxRaQ9T2naqhA
```

Since TIR has `has_one = owner`, only `HBM2...` may trust topic 5 for that token.

Therefore normal flow:

```text
Admin registers/approves valuer globally.
Issuer/token TIR owner assigns approved valuer to their token.
Issuer/token TIR owner clicks Trust Topic 5.
Valuer attests valuation.
```

UI correction required/implemented direction:

- Trust Topic 5 should be in issuer token-management area or only enabled when connected wallet equals live `tir_state.owner`.
- Admin `/issuance` may display state but must not show enabled trust action unless admin is TIR owner.

---

### 11.3 Verified `attest_valuation` Contract Shape

Contract:

```text
fracks-asset-registry
```

Instruction:

```text
attest_valuation
```

Discriminator:

```text
9f85366894cb02b3
[159, 133, 54, 104, 148, 203, 2, 179]
```

Accounts:

```json
[
  { "name": "valuer", "isSigner": true, "isMut": true },
  { "name": "assetRegistry", "isSigner": false, "isMut": true },
  { "name": "valuerFidAccount", "isSigner": false, "isMut": false },
  { "name": "tirState", "isSigner": false, "isMut": false },
  { "name": "valuerIssuerEntry", "isSigner": false, "isMut": false }
]
```

Args:

```json
[
  { "name": "nav", "type": "u64" },
  { "name": "methodologyHash", "type": { "array": ["u8", 32] } },
  { "name": "navValidityDays", "type": "u16" }
]
```

Contract writes to AssetRegistry:

```text
current_nav
nav_date
nav_validity_days
valuer_fid
valuation_methodology_hash
updated_at
```

The contract stores only the latest valuation. Backend must preserve history.

---

### 11.4 Backend Implemented

Added valuation workflow:

- platform valuer registry
- valuer FID recording
- admin approval/suspension/removal
- asset valuer assignments
- TIR topic 5 trust recording
- valuation attestation recording
- valuation-readiness endpoint

Prisma models/migrations:

- `PlatformValuer`
- `AssetValuerAssignment`
- `AssetValuation`
- timestamp-default repair migration for valuation tables

Bug fixed:

- Valuer registration 500 due to raw SQL inserts missing `created_at` and `updated_at`.
- Fixed raw SQL inserts to set timestamps.

Backend build passed.

---

### 11.5 Frontend Implemented

- Personnel → Valuers tab:
  - admin registers valuers
  - approve after FID is recorded
  - suspend/remove
- `/valuer` portal:
  - valuer connects wallet
  - creates/records FID
  - sees assignments
  - accepts assignment
  - submits NAV valuation attestation with report hash and validity days
- `/issuance` Recent Tokens:
  - valuation readiness controls
  - assign approved valuer
  - trust valuer FID in token TIR topic 5
- Investor purchase gating:
  - purchases blocked until valuation readiness confirmed

Frontend build passed before later timestamp fix; backend build passed after timestamp fix.

---

## 12. Asset Registry — Current Critical Fix

### 12.1 The Error

Valuer attestation failed with:

```text
Instruction: AttestValuation
AnchorError caused by account: asset_registry
Error Code: AccountNotInitialized
Error Number: 3012
The program expected this account to be already initialized.
```

Important:

- This was not a Topic 5 trust failure.
- The transaction had already reached `AttestValuation`.
- Anchor rejected `asset_registry` because the account did not exist.

### 12.2 What Asset Registry Is

Asset Registry is the on-chain property record under `fracks-asset-registry`.

It is the real-estate lifecycle ledger. It stores:

- asset ID
- token mint
- issuer
- issuer FID
- Fard reference/hash
- SPV registration
- province
- whitepaper hash
- legal opinion hash
- insurance/beneficial owner hashes
- custodian FID
- custody info
- NAV/current valuation
- valuer FID
- valuation methodology hash
- lifecycle state
- dispute/encumbrance flags
- future construction/succession/total-loss data

Factory deployment does not currently initialize this registry account. It only deploys the token suite and checks factory custody.

### 12.3 PDA

Asset Registry PDA:

```text
["asset_registry", asset_id]
```

Program ID observed:

```text
3xoAnJ9DqMxj22XfeUYQdwAy6dbKXHHeXxcLBxAY2Pdx
```

### 12.4 Owner Meaning

There are two owners:

1. Solana account owner:
   - `fracks_asset_registry` program.

2. Business authority inside account:
   - issuer wallet stored in the registry.

Issuer initializes/mutates registry; valuer only updates valuation fields when authorized.

### 12.5 Fix Implemented

Frontend fix added:

- Asset registry initialization support in `frontend/src/services/valuation.ts`.
- Valuer attestation now uses `assignment.assetRegistryAddress` from backend instead of blindly deriving.
- Error label changed from misleading `Trust Topic 5 preflight failed` to correct `Valuation attestation preflight failed`.
- Added `Init Registry` step in issuer portal valuation panel in `frontend/src/app/issuer/page.tsx`.

Correct flow now:

```text
Issuer initializes Asset Registry first
→ issuer/TIR owner trusts Topic 5
→ valuer attests valuation
```

If Init Registry blocks, upload required deployment docs first:

- FARD
- WHITEPAPER
- LEGAL_OPINION

Frontend build passed after this fix.

### 12.6 What User Must Do Now

1. Connect as issuer wallet.
2. Open issuer portal.
3. Expand deployed asset.
4. In Valuation readiness, click `Init Registry`.
5. Click `Trust Topic 5` if not already recorded.
6. Connect as valuer.
7. Attest valuation again.

### 12.7 Correct Current Flow

```text
Custody completed
→ token deployed
→ issuer initializes Asset Registry
→ issuer/TIR owner trusts valuer for topic 5
→ valuer submits valuation
→ backend verifies valuation
→ asset becomes investment-ready
```

---

## 13. Current Status Snapshot

### Completed / Working

- Phase 0 audit/design.
- Phase 1 backend foundation.
- Custodian registry and portal.
- Custodian FID and PlatformAuthority topic 4.
- Custody mandate.
- Custodian acceptance.
- Custody attestation.
- Custody-gated token deployment.
- Normalized document model.
- Required document checks for deployment.
- Valuer registry.
- Valuer FID recording.
- Valuer approval/suspension/removal.
- Valuer assignments.
- Token-specific topic 5 trust recording.
- Valuer portal.
- NAV attestation submission flow.
- Asset Registry initialization step added.
- Investor purchase gating based on valuation readiness.
- Builds passing at multiple stages.

### Current Immediate Test Target

Run successful end-to-end:

```text
Init Asset Registry
→ Trust Topic 5 with actual TIR owner/issuer
→ Valuer AttestValuation
→ verify Asset Registry fields
→ valuation readiness true
→ investor purchase enabled
```

---

## 14. Important Wallets and Addresses Mentioned

Platform Admin wallet seen in logs:

```text
7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E
```

Issuer / token TIR owner seen for one token:

```text
HBM2UsKMEs74khHYTJjgoJ1VgCYcBurzxRaQ9T2naqhA
```

Asset Registry program ID:

```text
3xoAnJ9DqMxj22XfeUYQdwAy6dbKXHHeXxcLBxAY2Pdx
```

A failing factory asset ID example:

```text
747786698
```

Earlier KYC/provider wallet examples included:

```text
sj6XKyv4RciV6rxDxbiPmA5gg6LFWLwvu8ZHBwaytyK
```

---

## 15. Portal Map

### Existing / Implemented or Partially Implemented

- Platform Admin / Personnel
  - Custodians tab
  - Valuers tab
- Issuer portal
  - submit request
  - deployed asset/token management
  - holder controls
  - valuation readiness panel
- Custodian portal
- Valuer portal
- Investor portal / asset detail / purchase entry
- KYC/AML provider portal
- Marketplace portal/flow

### Still Planned

- Full investor portfolio
- Property manager workspace
- Governance portal
- Secondary market extension
- Quick Exit / liquidity provider portal
- Construction certifier portal
- Succession portal
- Regulator portal
- Legal counsel workspace
- Shariah workspace
- Insurance/total-loss workspace

---

## 16. Next Recommended Major Vertical

After valuation/Asset Registry is successfully tested end-to-end, the next major vertical should be:

```text
Primary Purchase + Bank Payment Sandbox + Mint Orchestration
```

This means:

```text
Investor sees investment-ready asset
→ acknowledges current whitepaper hash/version
→ selects token quantity
→ compliance preflight
→ KYC/AML
→ virtual bank account/payment simulator
→ signed webhook confirms payment
→ issuer registers investor in IRS
→ issuer activates investor
→ investor ATA created if needed
→ issuer mints tokens
→ purchase completed
```

Important product decision previously discussed:

- Prefer KYC/AML before payment in sandbox to avoid accepting money from ineligible investors.
- A payment-before-KYC flow would require refund handling.

### Proposed purchase statuses

```text
DRAFT
COMPLIANCE_PREFLIGHT
WHITEPAPER_ACKNOWLEDGED
KYC_PENDING
AML_PENDING
PAYMENT_ACCOUNT_CREATED
PAYMENT_PENDING
PAYMENT_CONFIRMED
ISSUER_REVIEW
IRS_REGISTRATION_PENDING
IRS_ACTIVATION_PENDING
MINT_PENDING
COMPLETED
FAILED
CANCELLED
REFUND_PENDING
REFUNDED
```

### Bank simulator

Sandbox endpoints suggested:

```http
POST /sandbox/bank/accounts
POST /sandbox/bank/payments
GET  /sandbox/bank/payments/:paymentId
POST /sandbox/bank/payments/:paymentId/actions
```

Actions:

```text
CONFIRM
FAIL
REFUND
```

Payment confirmation must come from signed webhook, not frontend timer.

---

## 17. Later Roadmap

After purchase/payment/mint:

1. Rental distribution
   - declare distribution
   - gross/deductions/net
   - holder entitlement
   - TDS certificate
   - investor income page

2. Governance portal
   - proposals
   - balance snapshot
   - voting
   - execution

3. Secondary market and Quick Exit
   - listings
   - trade workflow
   - token transfer
   - payment
   - institutional liquidity/PLF

4. Custody hardening
   - reserve attestations
   - expiry monitoring
   - renewal
   - mandate release
   - replacement
   - redemption sign-off

5. Construction
   - certifier
   - milestones
   - escrow release
   - apartment conversion

6. Succession and regulatory controls
   - court/Wirasat
   - heirs
   - compliance/admin approvals
   - transfer execution
   - dispute freeze
   - regulator dashboard

7. Insurance and total loss
   - policy
   - claim
   - payout
   - final distribution
   - burn
   - asset closure

---

## 18. Key Rules for Future Agents

1. Do not modify contracts unless explicitly asked.
2. Always inspect deployed IDL/account constraints before assuming authority.
3. Do not confuse backend approval with on-chain authority.
4. Custodian uses factory PlatformAuthority topic 4.
5. Valuer uses token-specific TIR topic 5.
6. Only live `tir_state.owner` can add/update token TIR trusted issuers.
7. Asset Registry must exist before valuation attestation.
8. Factory token deployment does not currently initialize Asset Registry.
9. Valuation is not deployment prerequisite; it is purchase-readiness prerequisite.
10. Custody is deployment prerequisite.
11. Required deployment documents are FARD, LEGAL_OPINION, WHITEPAPER.
12. Use normalized `AssetDocument` hashes for on-chain document/methodology hashes.
13. Do not treat stale backend records as authoritative when blockchain state is authoritative.
14. Record transaction signatures and verify on-chain accounts before marking workflows complete.
15. Preserve historical valuation records in PostgreSQL because Asset Registry stores only latest valuation.
16. Do not use arbitrary wallet input for professional roles; use approved directories/selectors.
17. Build vertical slices end-to-end: DB + backend + frontend + chain + test.
18. Keep UI minimal, professional, and status-driven.
19. Whenever a transaction succeeds on-chain but backend recording fails, show on-chain success and provide resync/idempotent recovery.
20. Always distinguish registry-level, token-level, and backend-only roles in UI labels.

---

## 19. Short Explanation of FRACKS for a New Developer

FRACKS is a regulated real-estate tokenization platform on Solana. It combines legal property documents, independent custody, independent valuation, investor identity, Token-2022 transfer controls, issuer-managed minting, compliance modules, and complete audit history.

A property cannot simply become a token. It must first have required documents, an approved custodian, a custody mandate, mandate acceptance, custody attestation, and only then a token suite can be deployed. After deployment, the issuer initializes the Asset Registry, authorizes an approved valuer in the token-specific TIR for topic 5, and the valuer submits NAV through `attest_valuation`. Only once valuation readiness passes should investors be allowed to purchase.

The central architecture is:

```text
Property/legal layer
→ AssetDocument + Asset Registry

Custody layer
→ Factory PlatformAuthority topic 4 + custody mandates/attestations

Valuation layer
→ token TIR topic 5 + Asset Registry NAV fields

Investor identity layer
→ FID + claims + CTR + TIR + IRS + IRP

Token/compliance layer
→ SPL Token-2022 + Transfer Hook + compliance modules

Backend workflow layer
→ organizations, roles, audit, workflows, transactions, documents, purchase requests
```

---

## 20. Latest Immediate Context

The most recent issue was:

```text
Valuer unable to attest due to AccountNotInitialized on asset_registry.
```

This was fixed by adding issuer-side Asset Registry initialization support and correcting valuer attestation to use the backend-recorded `assetRegistryAddress`.

The user’s current action should be:

```text
Connect issuer wallet
→ issuer portal
→ deployed asset
→ Init Registry
→ Trust Topic 5 if needed
→ connect valuer
→ submit valuation attestation
```

After that passes, the next major implementation vertical should be the primary investor purchase and bank sandbox flow.

