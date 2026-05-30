# FRACKS Project Flow

This document describes how the current FRACKS project is wired end to end: frontend, backend, database, Supabase document storage, and Solana/Anchor contract interactions.

## High-Level Architecture

```text
Browser / Wallet
  |
  | Next.js pages and client services
  v
Frontend app: frontend/
  |
  | 1. Off-chain workflow/API calls
  v
NestJS backend: backend/
  |
  | Prisma
  v
PostgreSQL

Browser / Wallet
  |
  | 2. Wallet-signed on-chain transactions
  v
Solana devnet programs: contracts/programs/*
  |
  | Token-2022 mint and transfer-hook callbacks
  v
SPL Token-2022

Frontend Next API routes
  |
  | Server-only file proxy/upload/signing helpers
  v
Supabase Storage / provider signing key
```

The important design split is:

- The backend is the off-chain workflow and database layer. It stores users, assets, tokenization requests, purchase requests, transfer requests, marketplace listings, KYC applications, trusted issuers, and indexed chain state.
- The frontend does most wallet-authorized contract writes directly through Anchor clients. Token deployment, identity creation, claim issuance, minting, transfers, freezes, compliance config, and agent updates are signed by the connected wallet.
- Next.js API routes are used as frontend-local server endpoints for private Supabase storage access, provider claim signing, and some backend proxy routes.

## Runtime Configuration

Frontend config is mainly in [frontend/.env.local](../frontend/.env.local):

- `NEXT_PUBLIC_BACKEND_URL`: browser-facing backend URL, currently expected to be `http://localhost:4082` for local dev.
- `BACKEND_URL`: server-side Next route backend URL.
- `NEXT_PUBLIC_SOLANA_NETWORK`: expected `devnet`.
- `NEXT_PUBLIC_RPC_URL` / `NEXT_PUBLIC_SOLANA_RPC_URL`: Solana RPC endpoint.
- `NEXT_PUBLIC_*_PROGRAM_ID`: devnet program IDs consumed by frontend clients.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: server-side only values for Next API routes that upload/download private legal documents. Do not expose the service-role key as `NEXT_PUBLIC_*`.

Backend config is mainly in [backend/.env](../backend/.env):

- `PORT`: backend port, currently `4082`.
- `DATABASE_URL`: PostgreSQL connection string.
- Optional indexer/RPC settings are read by `backend/src/indexer`.

## Current Devnet Program IDs

These are the active devnet programs the frontend defaults to in [frontend/src/lib/constants.ts](../frontend/src/lib/constants.ts):

| Component | Program ID |
| --- | --- |
| Factory | `FtrzQ1hhjL7vbEPAxLBeLgrmomanSVj9UpV6LLJ5TYFS` |
| Token | `6Naj8HsuNdUJQyyzmPssm1mZRDF7F5VMQ91n9QyMoyGj` |
| Token hook | `9JrgWtW4UrQoC3tVQRxWBBEQPjDJ2QFDzAVAvSzGtPJ5` |
| FID | `Fb2roXDWjEaZwWJvxAWJTCRsK4Hy4V64MuCwoGXWMUtW` |
| IRP | `HQqgbvfmSzY1yEyhVbyhYqSsbVrRmjUnPmm2nE4ZwRvZ` |
| IRS | `CnAZUQ9jFm2eLGA8d8ek1gpLwGc6xZqvnbyJ9s7swbWc` |
| TIR | `9bgANehpsEDdgyo5DwpY36wmnPdpCihSiAP9TLoBBf4L` |
| CTR | `8MuWrtbZ1zPzrDhSKPjDd78SMQAMtBuprPnc1Zam1Gig` |
| Compliance | `HnJiNrmDeVFZksgEXaQwyVqHXQLRcyqXEksbYhkiPFFV` |
| Max investors module | `2zfQv7RxmL5BAgXXFagZXBNby4Q41YGH6hnSJAcsXQeU` |
| Country restrict module | `4ChDAU375yPJXZLG5XqtbbKdirAr3xHU5vnhppUjgu2d` |
| Max balance module | `HEjNS1GC9nffSdXbi6aQ9WNQBNFyJQBGUshyrSeLpE9j` |
| Max transfer module | `4gJbGvgnBhJ91gByKNo7eEVmCbsUkK5opyeo3M1VEJsy` |
| Lockup module | `EvDVqTUjs3ZsAUfPQdyVskYCzoPTbWybF5tcBtWYfAuz` |
| Daily limit module | `5dfHskP5MijaDY2gYsE44CPAuomt1vWgbPdGi62cquoT` |
| Supply cap module | `6tfb66btx776wdsPS5EHDTwWnvPSLJQje7gFQ4EDGxGc` |
| Country cap module | `EcLffdKdSsCpNczazKsSeRw7FCN6vVjKAEMH5CZGBndr` |

## Frontend Layout

Primary app routes live in [frontend/src/app](../frontend/src/app):

| Route area | Purpose |
| --- | --- |
| `(auth)/login`, `(auth)/register` | Email/wallet authentication against backend `/auth/*`. |
| `(dashboard)/issuance` | Platform admin review of issuer asset tokenization requests and token deployment. |
| `(dashboard)/assets`, `assets/[id]` | Asset browsing and token detail views. |
| `(dashboard)/token-admin` | Trusted issuer/provider admin and token admin state. |
| `(dashboard)/compliance` | Compliance state and module management. |
| `(dashboard)/transfer` | Direct transfer preflight and transfer execution. |
| `(dashboard)/listings` | Marketplace listings and buy intents. |
| `issuer/submit-request` | Issuer submits asset tokenization request and legal documents. |
| `issuer` | Issuer reviews purchase/transfer queues and mints approved requests. |
| `issuer/identity` | Issuer FID creation. |
| `investor/request-form` | Investor token purchase request form. |
| `investor/[id]` | Investor dashboard: requests, holdings, transfers, listings. |
| `investor/identity` | Investor FID/identity actions. |
| `kyc-provider` | KYC/AML provider review and claim issuance flow. |
| `admin/identities` | Admin identity onboarding/whitelisting utilities. |

Important frontend service files:

| File | Responsibility |
| --- | --- |
| [frontend/src/lib/backend.ts](../frontend/src/lib/backend.ts) | `apiFetch`, JWT token storage, backend URL resolution. |
| [frontend/src/lib/constants.ts](../frontend/src/lib/constants.ts) | RPC URLs, program IDs, PDA seed constants, compliance module metadata. |
| [frontend/src/lib/solana/index.ts](../frontend/src/lib/solana/index.ts) | PDA/account decoders and lower-level Solana account fetch helpers. |
| [frontend/src/services/factory.ts](../frontend/src/services/factory.ts) | Token-2022 mint creation and full suite deployment through `fracks_factory`. |
| [frontend/src/services/token.ts](../frontend/src/services/token.ts) | Token state reads, mint, burn, freeze, pause, agent management, mint preflight. |
| [frontend/src/services/identity.ts](../frontend/src/services/identity.ts) | FID, wallet identity, onboarding, identity activation, claim issuance. |
| [frontend/src/services/transfer.ts](../frontend/src/services/transfer.ts) | Transfer preflight, transfer-hook account construction, simulation, execution. |
| [frontend/src/services/compliance.ts](../frontend/src/services/compliance.ts) | Compliance/module state reads and module configuration. |
| [frontend/src/lib/claim-signer.ts](../frontend/src/lib/claim-signer.ts) | Claim signing using wallet or backend provider signer route. |
| [frontend/src/lib/document-download.ts](../frontend/src/lib/document-download.ts) | Single/multi document downloads, including zip flow. |

## Backend Layout

Backend is a NestJS API in [backend/src](../backend/src). `main.ts` enables CORS and global DTO validation. `app.module.ts` imports all modules.

Primary backend modules:

| Module | Endpoints | Purpose |
| --- | --- | --- |
| `auth` | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/me` | User auth, JWT/session handling. |
| `users` | `/users`, `/users/:id/roles` | User and role management. |
| `asset-requests` | `/asset-requests` | Off-chain issuer tokenization request queue. |
| `assets` | `/assets`, `/assets/deployed`, `/assets/apply` | Asset records and deployed asset upsert. |
| `token-purchase-requests` | `/token-purchase-requests` | Investor request-to-mint workflow state. |
| `token-transfer-requests` | `/token-transfer-requests` | Off-chain transfer onboarding/workflow state. |
| `token-listings` | `/token-listings`, `/token-listings/:id/buy-intents` | Marketplace sell listings and buy intents. |
| `trusted-issuers` | `/trusted-issuers` | Off-chain provider registry used by admin UI. |
| `kyc/applications` | `/kyc/applications` | Generic KYC applications and role approval. |
| `identity-snapshots` | `/identity-snapshots` | Off-chain identity/compliance snapshots. |
| `indexed` | `/indexed/*` | Read API backed by indexed on-chain state in DB. |
| `compliance-rules` | `/compliance-rules/*` | Older/off-chain compliance rule helpers. |
| `activity-logs` | `/activity-logs` | Activity history. |

Main Prisma models in [backend/prisma/schema.prisma](../backend/prisma/schema.prisma):

- `User`, `Session`
- `Asset`, `AssetRequest`
- `TokenState`, `TokenAsset`, `TokenBalance`
- `TokenPurchaseRequest`, `TokenTransferRequest`
- `TokenSellListing`, `TokenBuyIntent`, `TokenTransferHistory`
- `KycApplication`, `KycDocument`
- `TrustedIssuer`
- `ComplianceRule`, `TransferLimit`
- `TrackedWallet`, `IndexerState`, `ActivityLog`, `IdentitySnapshot`

## Next.js API Routes

These routes run inside the frontend server process and are not the Nest backend:

| Route | Purpose |
| --- | --- |
| `/api/legal-docs/upload` | Uploads private legal docs into Supabase bucket `legal-docs` using `SUPABASE_SERVICE_ROLE_KEY`. |
| `/api/legal-docs/file` | Downloads/proxies private legal docs from Supabase after path validation. |
| `/api/provider/sign-claim` | Signs canonical claim messages with `PROVIDER_CLAIM_SIGNER_SECRET` for provider workflows. |
| `/api/rwa/*` | Proxy routes to backend for older RWA asset/mint/transfer/compliance paths. Newer wallet flows mostly use direct services. |
| `/api/theme` | Theme persistence helper. |

## Contract Layout

Solana programs live in [contracts/programs](../contracts/programs):

| Program | Main responsibility |
| --- | --- |
| `fracks-factory` | Stores active suite program IDs and deploys per-token suite PDAs. |
| `fracks-token` | Token owner/agent control, mint, burn, forced transfer, recovery, freeze/pause, compliance enforcement before mint/transfer. |
| `fracks-token-hook` | Token-2022 transfer hook, extra-account-metas setup, transfer approval validation. |
| `fracks-fid` | FID account, issuer/investor profile, signer key, claims, claim revocation/removal. |
| `fracks-irp` | Identity registry pointer for a token, links IRS/TIR/CTR. |
| `fracks-irs` | Wallet identity registry storage, onboarding application, wallet identity registration/activation. |
| `fracks-tir` | Trusted issuer registry and topic authorization per token. |
| `fracks-ctr` | Required claim topics per token. |
| `fracks-compliance` | Bound compliance modules and dispatches `can_transfer`, `transferred`, `created`, `destroyed`. |
| `modules/*` | Individual compliance rules: country, caps, limits, lockup, max balances/transfers/investors. |

Important PDA seeds:

| PDA | Seeds |
| --- | --- |
| Factory state | `["factory_state"]` |
| Deployment | `["deployment", issuer, salt]` |
| Token state | `["token_state", token_mint]` |
| Owner state | `["owner", token_mint]` |
| Agent role | `["agent", token_mint, agent]` |
| Frozen wallet | `["frozen", token_mint, wallet]` |
| Partial freeze | `["partial_freeze", token_mint, wallet]` |
| FID | `["fid", wallet]` |
| Claim | `["claim", fid, claim_id]` |
| IRP state | `["irp_state", token_mint]` |
| IRS state | `["irs_state", token_mint]` |
| Wallet identity | `["wallet_identity", irs_state, wallet]` |
| TIR state | `["tir_state", token_mint]` |
| Issuer entry | `["issuer_entry", tir_state, issuer_fid]` |
| CTR state | `["ctr_state", token_mint]` |
| Compliance state | `["compliance_state", token_mint]` |
| Extra account metas | `["extra-account-metas", token_mint]` |
| Daily usage | `["daily_usage", module_state, wallet]` |
| Country count | `["country_count", module_state, country_u16_le]` |

## End-to-End Flow: Issuer Tokenization Request

```text
Issuer wallet
  |
  v
/issuer/submit-request
  |
  | Upload docs via /api/legal-docs/upload
  v
Supabase private bucket: legal-docs
  |
  | Submit request via apiFetch("/asset-requests")
  v
Backend AssetRequest row: PENDING_REVIEW
```

Details:

1. Issuer opens `/issuer/submit-request`.
2. `IssuanceForm` collects asset details and legal documents.
3. Page uploads files to `/api/legal-docs/upload`.
4. The Next route stores files in Supabase using server-side service-role credentials.
5. The returned document metadata is stored in backend `AssetRequest.documents`.
6. Backend `AssetRequestsService.create` creates a `PENDING_REVIEW` row.
7. No Solana transaction happens during this issuer request submission.

## End-to-End Flow: Platform Admin Deploys Token

```text
Platform admin dashboard
  |
  v
/(dashboard)/issuance
  |
  | Reads AssetRequest rows from backend
  | Downloads/reviews legal docs through /api/legal-docs/file
  v
IssuanceForm in admin deployment mode
  |
  | Wallet-signed deployment via FactoryService.deployTokenSuite
  v
Solana:
  1. Create Token-2022 mint
  2. Initialize compliance module PDAs
  3. factory.deploy_token_suite
  4. Initialize token/identity/compliance/hook accounts
  5. Transfer suite ownership to issuer
  |
  v
Backend:
  - /assets/deployed upserts Asset
  - /asset-requests/:id/status marks DEPLOYED
```

On-chain deployment responsibilities:

1. `FactoryService.deployTokenSuite` derives all token-specific PDAs.
2. It creates a Token-2022 mint with metadata pointer, transfer hook, and permanent delegate extensions.
3. It initializes selected compliance module accounts before factory deployment if they do not exist.
4. It sets hook authority on stateful modules that need compliance CPI mutations.
5. It builds an address lookup table because deployment touches many accounts.
6. It calls `fracks_factory::deploy_token_suite`.
7. Factory initializes:
   - `fracks_token::initialize_token`
   - token metadata
   - `fracks_ctr::initialize_ctr` and claim topics
   - `fracks_tir::initialize_tir` and trusted issuer entries
   - `fracks_irs::initialize_irs`
   - `fracks_irp::initialize_registry`
   - `fracks_compliance::initialize_compliance` and module binding
   - `fracks_token_hook::initialize_extra_account_metas`
8. Ownership of the suite is transferred from platform admin to the issuer where the flow requires issuer ownership.
9. Frontend records the deployed asset in backend DB and marks the asset request deployed.

## End-to-End Flow: Investor Requests Tokens

```text
Investor wallet
  |
  v
/investor/request-form
  |
  | Read token metadata, claim topics, allowed countries, live providers
  | Check investor FID exists and country is allowed
  v
Backend /token-purchase-requests
  |
  v
Status:
  ACTION_REQUIRED_INVESTOR_IDENTITY
  or PENDING_KYC
  or PENDING_AML
  or PENDING_ISSUER_REVIEW
```

Details:

1. Investor opens `/investor/request-form`.
2. Frontend reads token details and compliance module state from chain.
3. Frontend checks investor FID via `IdentityService.fetchFid`.
4. If no investor FID exists, the form is blocked and the UI offers FID creation.
5. Frontend checks token country rules against the investor country.
6. The request is submitted to backend `/token-purchase-requests`.
7. Backend `TokenPurchaseRequestsService` prevents duplicate open requests and assigns initial status:
   - `ACTION_REQUIRED_INVESTOR_IDENTITY` when `investorFidRegistered === false`
   - `PENDING_KYC` when topic `1` is required and a KYC provider is configured
   - `PENDING_AML` when topic `2` is required and an AML provider is configured
   - `PENDING_ISSUER_REVIEW` otherwise

## End-to-End Flow: Provider Reviews KYC/AML and Issues Claims

```text
KYC/AML provider page
  |
  | Read pending requests from backend
  v
/kyc-provider
  |
  | Build claim message in frontend
  | Sign with wallet or /api/provider/sign-claim
  v
fracks_fid::add_claim
  |
  v
Backend request status update:
  PENDING_AML or PENDING_ISSUER_REVIEW
```

Details:

1. Provider opens `/kyc-provider`.
2. Page loads purchase or transfer requests filtered by `kycProvider` or `amlProvider`.
3. Provider approves a request.
4. Frontend builds a canonical claim payload for the target investor FID and topic.
5. Signature can come from:
   - connected provider wallet, or
   - `/api/provider/sign-claim`, which uses server-side `PROVIDER_CLAIM_SIGNER_SECRET`.
6. Frontend calls `IdentityService.issueClaim`, which creates a claim in `fracks_fid`.
7. Backend request status is advanced:
   - KYC approval can move to `PENDING_AML`
   - AML approval can move to `PENDING_ISSUER_REVIEW`

On-chain claim validation later uses:

- target FID claim account
- claim topic index
- issuer FID
- TIR issuer entry
- issuer signer key matching the claim signer
- claim expiry/revocation flags

## End-to-End Flow: Issuer Mints Tokens

```text
Issuer page
  |
  | Load APPROVED_FOR_MINT requests from backend
  v
TokenService.mint
  |
  | Client preflight:
  | - Token-2022 mint valid
  | - destination ATA exists or is created
  | - wallet identity exists and active
  | - required claims exist and are trusted
  | - compliance module accounts are included
  v
fracks_token::mint
  |
  | On-chain checks:
  | - caller is owner/agent
  | - recipient identity valid
  | - compliance modules pass
  | - compliance created hook updates module state
  | - Token-2022 MintToChecked
  v
Backend /token-purchase-requests/:id/status -> MINTED
```

Details:

1. Issuer opens `/issuer`.
2. Page loads approved purchase requests from backend.
3. Issuer clicks mint.
4. Frontend calls `TokenService.mint`.
5. `TokenService.mint` creates the recipient Token-2022 ATA if missing.
6. `verifyRecipientMintPreflight` resolves the token's IRP/IRS/TIR/CTR/compliance state and validates claims.
7. `getMintRemainingAccounts` appends claim accounts, compliance module accounts, module program accounts, and country-count accounts where needed.
8. `fracks_token::mint` checks:
   - authority agent role
   - owner state
   - token state
   - recipient wallet identity
   - frozen wallet state
   - compliance rules
9. `fracks_compliance::created` is invoked to update stateful modules such as max investors, supply cap, and country cap.
10. Token-2022 `MintToChecked` mints tokens.
11. Frontend updates backend request status to `MINTED` with `mintTxHash`.

## End-to-End Flow: Direct Transfers

```text
Sender wallet
  |
  v
TransferService.preflightTransfer
  |
  | Checks sender and recipient identities/claims/balances
  v
TransferService.executeTransfer
  |
  | 1. fracks_token_hook::approve_transfer
  | 2. Token-2022 transferChecked
  | 3. Token-2022 invokes fracks_token_hook::execute_transfer_hook
  | 4. hook validates approval and compliance
  v
Transfer submitted
```

Details:

1. `TransferService.preflightTransfer` checks:
   - sender source ATA
   - recipient destination ATA
   - sender/recipient wallet identities
   - sender/recipient required claims
   - partial freeze amount
   - source balance
   - transfer simulation
2. `TransferService.executeTransfer` prepares support accounts and submits two phases:
   - approval instruction to `fracks_token_hook`
   - Token-2022 `transferChecked`
3. Token-2022 invokes the configured transfer hook.
4. Hook consumes extra-account-metas, verifies the approval PDA, and calls compliance logic.
5. Compliance `transferred` hooks can mutate daily usage, holder count, and country cap counts.

## End-to-End Flow: Transfer Request / Marketplace

Transfer requests and marketplace listings combine backend workflow state with the same on-chain transfer path.

Transfer request statuses include:

- `ACTION_REQUIRED_RECIPIENT_FID`
- `PENDING_KYC`
- `PENDING_AML`
- `PENDING_ISSUER_WHITELIST`
- `PENDING_ISSUER_ACTIVATION`
- `READY_TO_TRANSFER`
- `TRANSFER_SIMULATION_FAILED`
- `TRANSFERRED`

Marketplace sell listing flow:

1. Seller creates listing through `/token-listings`.
2. Buyer creates buy intent through `/token-listings/:id/buy-intents`.
3. Frontend preflights buyer/seller eligibility using chain reads.
4. Provider/issuer workflows may be required for buyer identity/claims.
5. Seller accepts once buyer is eligible.
6. Transfer executes through `TransferService.executeTransfer`.
7. Backend updates buy intent/listing status and records `TokenTransferHistory`.

## Indexer Flow

```text
IndexerService.syncOnce
  |
  | Scan factory TokenDeployment accounts
  v
Asset table upsert
  |
  | For each token:
  | - read Token-2022 mint supply
  | - read owner state
  | - discover wallets
  | - read balances
  v
TokenState / TokenBalance / Asset records
  |
  v
/indexed/* read endpoints
```

The backend indexer is not the transaction authority. It only mirrors chain state into PostgreSQL so frontend pages can load faster and query aggregated state.

## Compliance Model

Compliance is enforced twice:

1. Frontend preflight, for better UX and clearer errors.
2. On-chain programs, for real enforcement.

Compliance modules:

| Module | Enforces |
| --- | --- |
| Country restrict | Recipient/sender countries must be allowed. Mint checks recipient country. |
| Max balance | Recipient balance after operation must stay below max. |
| Max transfer | Single mint/transfer amount cap. |
| Lockup | Prevents operation before lockup end. |
| Daily limit | Sender daily transfer cap. Mint is excluded. |
| Supply cap | Total minted supply cap. Updated on mint/burn. |
| Max investors | Holder-count cap. Updated when a wallet enters/leaves holder set. |
| Country cap | Holder-count cap per country. |

`fracks_token` enforces compliance during mint and token-controlled operations. `fracks_token_hook` enforces compliance during Token-2022 transfers.

## Document Storage Flow

Legal documents are private Supabase objects:

```text
Issuer/admin browser
  |
  | POST /api/legal-docs/upload
  v
Next server route
  |
  | SUPABASE_SERVICE_ROLE_KEY
  v
Supabase bucket: legal-docs
  |
  | document metadata stored in backend AssetRequest.documents
  v
Admin review page
  |
  | GET /api/legal-docs/file?bucket=legal-docs&path=...
  v
Download or inline preview
```

The frontend stores only document metadata and a proxy URL. The private bucket is accessed by server-side Next routes, not directly by public browser credentials.

## Auth and Roles

The backend auth module issues access/refresh tokens. `frontend/src/lib/backend.ts` stores them in local storage and sends `Authorization: Bearer ...` on `apiFetch` calls.

Role-related concepts:

- `User.roles` stores approved roles.
- `User.requestedRole` and `roleStatus` track pending/approved role requests.
- KYC application approval can move a requested role into `roles`.
- Some admin operations use wallet signature headers through `PlatformWalletSignatureGuard`.
- Contract authority is separate from backend roles. On-chain writes still require the connected wallet to be the owner, issuer, provider, or agent expected by the program.

## Key Failure Boundaries

When debugging, identify which layer failed:

| Symptom | Likely layer |
| --- | --- |
| HTTP `400/403/500` from `localhost:4082` | Nest backend or database validation. |
| `"Supabase server storage is not configured"` | Next API route env missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`. |
| Wallet popup simulation failure | Solana transaction or missing/wrong remaining accounts. |
| Backend request status changed but token not minted | Off-chain workflow succeeded, on-chain mint failed or was not submitted. |
| Indexed data stale | Backend indexer has not synced or RPC failed. |
| Country/claim/compliance mismatch | Compare frontend preflight logs with on-chain compliance module state. |

## Local Development Startup

Typical local setup:

```powershell
# backend
cd backend
pnpm install
pnpm run build
pnpm start:dev

# frontend
cd frontend
pnpm install
pnpm run dev
```

Expected URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4082`
- Solana: devnet RPC from frontend env
- PostgreSQL: from backend `DATABASE_URL`

After changing `.env.local` or `.env`, restart the corresponding dev server. Next.js and Nest do not reliably reload every env change into already-running server code.
