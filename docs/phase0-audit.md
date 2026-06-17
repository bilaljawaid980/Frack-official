# Phase 0 — Audit and Design Baseline (Revised)

> Revision date: 2026-06-17  
> Status: **DRAFT — NOT YET APPROVED**  
> Scope: `backend/` and `frontend/` only. `contracts/` is read-only reference.  
> No implementation changes until this document is approved.

---

## Evidence Base

Files inspected during this audit:

| Category | Files / Sources |
|---|---|
| Backend controllers | All 16 `.controller.ts` files under `backend/src/` |
| Backend modules | All 19 `.module.ts` files, including `app.module.ts` |
| Backend services | All 18 `.service.ts` files |
| Backend guards | 3 guard files under `backend/src/common/guards/` |
| Prisma schema | `backend/prisma/schema.prisma` |
| Prisma migrations | 3 migrations under `backend/prisma/migrations/` |
| Manual SQL migrations | 14 files under `backend/src/database/migrations/` |
| Frontend pages/components | 30+ files searched for `apiFetch`, `fetch(` calls |
| Next.js API proxy routes | `frontend/src/app/api/rwa/**` |
| Environment configuration | `backend/.env` |
| Contract reference | `docs/new_contracts.md` |
| Implementation plan | `docs/prompt.txt` |

---

## Section 1 — Reconciled Runtime Route Inventory

### 1.1 How Routes Are Registered

NestJS routes are registered at startup from controllers declared in modules that are imported into `AppModule`. A controller that exists in source but whose module is not imported in `AppModule` is **not registered at runtime**.

### 1.2 AppModule Import List (Confirmed)

```
ConfigModule, PrismaModule, AuthModule, UsersModule, AssetsModule,
IssuanceModule, ComplianceModule, IndexedModule, ActivityModule,
IdentitySnapshotsModule, KycModule, AssetRequestsModule,
TokenPurchaseRequestsModule, TokenTransferRequestsModule,
TokenListingsModule, TrustedIssuersModule, BlockchainTransactionsModule
```

**Not imported**: `IssuanceRequestsModule` (under `src/modules/tokens/`), `IndexerModule`

### 1.3 Discrepancy: Source vs Runtime

| Count | Explanation |
|---|---|
| **81** routes in source | All controllers' `@Get`, `@Post`, `@Patch`, `@Delete` decorators counted |
| **74** runtime routes | `IssuanceRequestsModule` not imported — 7 routes never registered |
| **7** dead routes in source | `POST/GET/GET/POST/POST /tokens/:address/issuance-requests*` and `GET /users/:wallet/issuance-requests` exist in source but produce no HTTP endpoints |

The previous audit's count of "approximately 78" was incorrect because it included the dead routes.

### 1.4 Complete Runtime Route Table

> Legend — Auth: `JWT` = JwtAuthGuard · `Roles(X)` = RolesGuard with role list · `WalletSig` = PlatformWalletSignatureGuard · `Open` = no guard ⚠️  
> Decision: **KEEP · EXTEND · MERGE · DEPRECATE · REPLACE · REMOVE_LATER**

#### Auth (4 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| POST | `/auth/register` | Open | RegisterDto | `AuthService.register` | Registration page | KEEP |
| POST | `/auth/login` | Open | LoginDto | `AuthService.login` | Login page | KEEP |
| POST | `/auth/refresh` | Open | RefreshDto | `AuthService.refresh` | Token refresh | KEEP |
| GET | `/auth/me` | JWT | — | `AuthService.me` | All auth-gated pages | EXTEND (add org memberships in Phase 1) |

#### Users (2 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| GET | `/users` | JWT + Roles(ADMIN) | — | `UsersService.findAll` | Admin panel | KEEP |
| PATCH | `/users/:id/roles` | JWT + Roles(ADMIN) | UpdateRolesDto | `UsersService.updateRoles` | Admin panel | EXTEND (Phase 1: must also write PlatformRoleAssignment) |

#### Assets (6 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| GET | `/assets` | Open | — | `AssetsService.findAll` | `/api/rwa` proxy → issuance page, assets pages | KEEP |
| POST | `/assets` | JWT + Roles(PLATFORM_OWNER, ADMIN) | CreateAssetDto | `AssetsService.create` | `/api/rwa` proxy (PUT creates) | KEEP |
| POST | `/assets/deployed` | Open ⚠️ | CreateAssetDto | `AssetsService.createDeployed` | `issuance-form.tsx` after on-chain deploy | EXTEND (add auth in Phase 1 step) |
| POST | `/assets/apply` | Open ⚠️ | any | `AssetsService.apply` | `my-assets/page.tsx` | MERGE into `POST /asset-requests` (Phase 2) |
| PUT | `/assets/:id` | Open ⚠️ | UpdateAssetDto | `AssetsService.update` | `/api/rwa/:id` proxy | EXTEND (guard + lifecycle-state restrictions) |
| DELETE | `/assets/:id` | Open ⚠️ | — | `AssetsService.remove` | `assets-context.tsx` | REPLACE with POST `/assets/:id/archive` (see Section 16) |

#### Asset Requests (4 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| GET | `/asset-requests` | Open ⚠️ | — | `AssetRequestsService.findAll` | `issuer/page.tsx`, `issuance/page.tsx` | KEEP |
| GET | `/asset-requests/:id` | Open ⚠️ | — | `AssetRequestsService.findOne` | `issuance/page.tsx` | KEEP |
| POST | `/asset-requests` | Open ⚠️ | CreateAssetRequestDto | `AssetRequestsService.create` | `issuer/submit-request/page.tsx` | KEEP (add guard in Phase 1 coordination step) |
| PATCH | `/asset-requests/:id/status` | Open ⚠️ | UpdateAssetRequestStatusDto | `AssetRequestsService.updateStatus` | `issuer/page.tsx`, `issuance-form.tsx` | EXTEND (guard + custody gate in Phase 3) |

#### Issuance Requests — OLD module (4 routes — ACTIVE)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| GET | `/issuance-requests` | JWT | — | `IssuanceService.findAll` | `app/page.tsx` (homepage stats) | DEPRECATE — keep until frontend migrated |
| POST | `/issuance-requests` | JWT + Roles(TOKEN_ISSUER, ADMIN) | CreateIssuanceDto | `IssuanceService.create` | `issue-more-tokens.tsx` | DEPRECATE — keep until frontend migrated |
| PATCH | `/issuance-requests/:id/status` | JWT + Roles(TOKEN_CONTROLLER, ADMIN) | UpdateIssuanceStatusDto | `IssuanceService.updateStatus` | None found | DEPRECATE |
| PATCH | `/issuance-requests/:id/mint` | JWT + Roles(TOKEN_ISSUER, ADMIN) | MarkIssuanceMintedDto | `IssuanceService.markMinted` | None found | DEPRECATE |

#### KYC Applications (10 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| POST | `/kyc/applications` | Open ⚠️ | CreateKycApplicationDto | `KycApplicationService.create` | `kyc-api.ts` | KEEP (add guard in Phase 1 coord step) |
| GET | `/kyc/applications` | Open ⚠️ | — | `KycApplicationService.findAll` | `kyc-api.ts` | KEEP |
| GET | `/kyc/applications/stats/summary` | Open ⚠️ | — | `KycApplicationService.getStatistics` | Admin dashboard | KEEP |
| GET | `/kyc/applications/stats/pending-count` | Open ⚠️ | — | `KycApplicationService.getPendingCount` | Admin dashboard | KEEP |
| GET | `/kyc/applications/wallet/:walletAddress` | Open ⚠️ | — | `KycApplicationService.findByWallet` | Identity pages | KEEP |
| GET | `/kyc/applications/:id` | Open ⚠️ | — | `KycApplicationService.findOne` | Admin review pages | KEEP |
| POST | `/kyc/applications/:id/approve` | Open ⚠️ | ApproveKycApplicationDto | `KycApplicationService.approve` | `kyc-api.ts` | KEEP (add role guard) |
| POST | `/kyc/applications/:id/reject` | Open ⚠️ | RejectKycApplicationDto | `KycApplicationService.reject` | `kyc-api.ts` | KEEP (add role guard) |
| PATCH | `/kyc/applications/:id` | Open ⚠️ | UpdateKycApplicationDto | `KycApplicationService.update` | Admin panel | KEEP |
| POST | `/kyc/applications/:id/onchain-id` | Open ⚠️ | `{onchainIdAddress}` | `KycApplicationService.markOnchainIdCreated` | KYC flow | KEEP |

#### Compliance Rules (5 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| GET | `/compliance-rules` | JWT | — | `ComplianceService.getRules` | `compliance-rules-manager.tsx` | EVALUATE → MIGRATE (see Section 17) |
| POST | `/compliance-rules/countries` | JWT + Roles(COMPLIANCE_OWNER, ADMIN) | SetAllowedCountriesDto | `ComplianceService.setAllowedCountries` | `compliance-rules-manager.tsx` | EVALUATE → MIGRATE |
| GET | `/compliance-rules/transfer-limits` | JWT | — | `ComplianceService.getTransferLimits` | `compliance-rules-manager.tsx` | EVALUATE → MIGRATE |
| POST | `/compliance-rules/transfer-limits` | JWT + Roles(COMPLIANCE_OWNER, ADMIN) | SetTransferLimitDto | `ComplianceService.setTransferLimit` | `compliance-rules-manager.tsx` | EVALUATE → MIGRATE |
| POST | `/compliance-rules/simulate` | JWT (no role) | `{from,to,amount,assetId}` | `ComplianceService.simulateTransfer` | `compliance/page.tsx` | KEEP during transition |

#### Identity Snapshots (2 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| GET | `/identity-snapshots` | JWT + Roles(ADMIN, PLATFORM_OWNER) | — | `IdentitySnapshotsService.list` | None found in frontend | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |
| POST | `/identity-snapshots` | JWT + Roles(KYC_PROVIDER, ADMIN) | CreateIdentitySnapshotDto | `IdentitySnapshotsService.create` | None found in frontend | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |

#### Token Purchase Requests (8 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| POST | `/token-purchase-requests` | Open ⚠️ | CreateTokenPurchaseRequestDto | `TokenPurchaseRequestsService.create` | `investor/request-form`, `page.tsx` | EXTEND (Phase 4: whitepaper ack, NAV freshness) |
| POST | `/token-purchase-requests/preflight` | Open ⚠️ | `{tokenContract,investorWallet,...}` | `TokenPurchaseRequestsService.preflight` | `investor/request-form` | KEEP |
| GET | `/token-purchase-requests` | Open ⚠️ | — | `TokenPurchaseRequestsService.findAll` | Issuer, investor, claim-provider, home page | KEEP |
| GET | `/token-purchase-requests/:id` | Open ⚠️ | — | `TokenPurchaseRequestsService.findOne` | `investor/[id]` | KEEP |
| PATCH | `/token-purchase-requests/:id` | Open ⚠️ | UpdateTokenPurchaseRequestDto | `TokenPurchaseRequestsService.update` | `investor/[id]` (cancel) | KEEP |
| PATCH | `/token-purchase-requests/:id/status` | Open ⚠️ | UpdateTokenPurchaseRequestDto | `TokenPurchaseRequestsService.updateStatus` | Issuer, claim-provider pages | KEEP |
| PATCH | `/token-purchase-requests/:id/resume-after-identity` | Open ⚠️ | — | `TokenPurchaseRequestsService.resumeAfterIdentity` | `investor/identity/page.tsx` | KEEP |
| DELETE | `/token-purchase-requests/:id` | Open ⚠️ | — | `TokenPurchaseRequestsService.remove` | None found | KEEP |

#### Token Transfer Requests (4 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| POST | `/token-transfer-requests` | Open ⚠️ | CreateTokenTransferRequestDto | `TokenTransferRequestsService.create` | `transfer/page.tsx`, `investor/[id]` | KEEP |
| GET | `/token-transfer-requests` | Open ⚠️ | — | `TokenTransferRequestsService.findAll` | Issuer, investor, claim-provider | KEEP |
| GET | `/token-transfer-requests/:id` | Open ⚠️ | — | `TokenTransferRequestsService.findOne` | `investor/[id]` | KEEP |
| PATCH | `/token-transfer-requests/:id/status` | Open ⚠️ | UpdateTokenTransferRequestDto | `TokenTransferRequestsService.updateStatus` | Issuer, claim-provider pages | KEEP |

#### Token Listings (9 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| POST | `/token-listings` | Open ⚠️ | CreateTokenSellListingDto | `TokenListingsService.createListing` | `investor/[id]` | EXTEND (Phase 6: fracks-trade-escrow) |
| GET | `/token-listings` | Open ⚠️ | — | `TokenListingsService.findListings` | `listings/page.tsx`, `investor/[id]` | KEEP |
| GET | `/token-listings/buy-intents` | Open ⚠️ | — | `TokenListingsService.findBuyIntents` | `issuer/page.tsx`, `investor/[id]`, `claim-provider` | KEEP |
| GET | `/token-listings/buy-intents/:id` | Open ⚠️ | — | `TokenListingsService.findBuyIntent` | `investor/[id]` | KEEP |
| PATCH | `/token-listings/buy-intents/:id/status` | Open ⚠️ | UpdateTokenBuyIntentDto | `TokenListingsService.updateBuyIntentStatus` | Issuer, investor, claim-provider | KEEP |
| PATCH | `/token-listings/buy-intents/:id/resume-after-identity` | Open ⚠️ | — | `TokenListingsService.resumeBuyIntentAfterIdentity` | `investor/[id]` | KEEP |
| GET | `/token-listings/:id` | Open ⚠️ | — | `TokenListingsService.findListing` | `investor/[id]` | KEEP |
| PATCH | `/token-listings/:id/status` | Open ⚠️ | UpdateTokenSellListingDto | `TokenListingsService.updateListingStatus` | `investor/[id]` | KEEP |
| POST | `/token-listings/:id/buy-intents` | Open ⚠️ | CreateTokenBuyIntentDto | `TokenListingsService.createBuyIntent` | `listings/page.tsx` | KEEP |

#### Trusted Issuers (3 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| GET | `/trusted-issuers` | Open | — | `TrustedIssuersService.findAll` | `personnel/page.tsx`, `token-admin/page.tsx`, `issuance-form.tsx` | EXTEND (add `fidAddress` in Phase 1) |
| POST | `/trusted-issuers` | WalletSig | CreateTrustedIssuerDto | `TrustedIssuersService.create` | `personnel/page.tsx` | EXTEND (add `fidAddress` in Phase 1) |
| DELETE | `/trusted-issuers/:id` | WalletSig | — | `TrustedIssuersService.remove` | `personnel/page.tsx` | KEEP |

#### Indexed (9 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| GET | `/indexed/state` | Open | — | `IndexedService.getIndexerState` | None found | KEEP |
| GET | `/indexed/assets` | Open | — | `IndexedService.listAssets` | `issuer/page.tsx`, `/api/rwa/[id]` proxy, `top-transactions.tsx`, `assets-context.tsx` | KEEP |
| GET | `/indexed/tokens` | Open | — | `IndexedService.listTokens` | `assets-context.tsx` | KEEP |
| GET | `/indexed/tokens/:contract` | Open | — | `IndexedService.getToken` | Asset detail pages | KEEP |
| GET | `/indexed/tokens/:contract/assets` | Open | — | `IndexedService.listTokenAssets` | None found | KEEP |
| GET | `/indexed/tokens/:contract/balances` | Open | — | `IndexedService.listTokenBalances` | `issuer/page.tsx` (holder table) | KEEP |
| GET | `/indexed/tokens/:contract/issuance-requests` | Open | — | `IndexedService.listIssuanceRequests` | None found | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |
| GET | `/indexed/wallets` | Open | — | `IndexedService.listTrackedWallets` | None found | KEEP |
| POST | `/indexed/wallets` | Open ⚠️ | CreateTrackedWalletDto | `IndexedService.addTrackedWallet` | None found | KEEP (add guard in Phase 1 coord) |

#### Activity Logs (1 route)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| GET | `/activity-logs` | JWT + Roles(PLATFORM_OWNER, ADMIN) | — | `ActivityService.list` | `activity-logs/page.tsx` | KEEP → MERGE with WorkflowTransition query in Phase 1 |

#### Blockchain Transactions (3 routes)

| Method | Path | Auth | DTO | Service Method | Frontend Consumer | Decision |
|---|---|---|---|---|---|---|
| GET | `/blockchain-transactions` | Open ⚠️ | — | `BlockchainTransactionsService.list` | `top-transactions.tsx` | KEEP |
| GET | `/blockchain-transactions/count` | Open | — | `BlockchainTransactionsService.count` | None found | KEEP |
| POST | `/blockchain-transactions` | Open ⚠️ | RecordBlockchainTransactionDto | `BlockchainTransactionsService.record` | `blockchain-transactions.ts` lib (called after every on-chain tx) | EXTEND (idempotency + network field) |

### 1.5 Non-Runtime Controllers (Source Exists, Not Registered)

```
src/modules/tokens/controllers/issuance-requests.controller.ts
  → IssuanceRequestsController  (6 routes: POST/GET/GET/POST/POST on /tokens/:address/...)
  → UserIssuanceRequestsController  (1 route: GET /users/:wallet/issuance-requests)
  Reason: IssuanceRequestsModule is NOT imported in AppModule
  Risk: Frontend has no consumer of these routes; OLD /issuance-requests is still active

src/indexer/indexer.service.ts
  → IndexerService (no controller, no runner)
  Reason: IndexerModule is NOT imported in AppModule; IndexerService has syncOnce() but
           nothing calls it — no cron job, no @Cron decorator, no scheduled task found.
  Risk: Token balances and states in indexed tables may be stale or unpopulated
```

### 1.6 Next.js API Proxy Routes (Frontend-to-Backend proxies)

These are Next.js server routes that sit between the browser and the NestJS backend:

| Next.js proxy route | Backend endpoint called | Used by |
|---|---|---|
| `GET /api/rwa` | `GET /indexed/assets` | `issuance/page.tsx`, `use-factory-assets.ts` |
| `POST /api/rwa` | `POST /assets` | `issuance-form.tsx` (via proxy) |
| `PUT /api/rwa` | `PUT /assets` | Legacy update path |
| `GET /api/rwa/:id` | `GET /indexed/assets` (scanned) | Asset detail |
| `PUT /api/rwa/:id` | `PUT /assets/:id` | Asset edit |
| `DELETE /api/rwa/:id` | `DELETE /assets/:id` | Asset delete |
| `POST /api/rwa/deployed` | `POST /assets/deployed` | `issuance-form.tsx` after deploy |
| `GET /api/rwa/compliance` | `GET /compliance-rules` | `issuance-form.tsx` |
| `POST /api/rwa/compliance` | `POST /compliance-rules/countries` | `issuance-form.tsx` |
| `POST /api/rwa/transfer` | (undetermined — needs read) | `transfer/page.tsx` area |
| `POST /api/rwa/mint` | (undetermined — needs read) | `issuance/page.tsx` area |

The proxy layer adds an extra hop and means that some backend routes have **two consumers**: the direct `apiFetch` calls and the proxy. Both must continue to work.

---

## Section 2 — Frontend and Background Route Usage Map

### 2.1 Direct Frontend Consumers (apiFetch)

| Backend Route | Called From |
|---|---|
| `GET /issuance-requests` | `frontend/src/app/page.tsx` (homepage stats) |
| `POST /issuance-requests` | `frontend/src/components/rwa/issue-more-tokens.tsx` |
| `GET /asset-requests` | `frontend/src/app/(dashboard)/issuance/page.tsx`, `issuer/page.tsx` |
| `GET /asset-requests/:id` | `frontend/src/app/(dashboard)/issuance/page.tsx` |
| `POST /asset-requests` | `frontend/src/app/issuer/submit-request/page.tsx` |
| `PATCH /asset-requests/:id/status` | `issuer/page.tsx`, `issuance/page.tsx`, `issuance-form.tsx` |
| `GET /token-purchase-requests` | Issuer, investor, claim-provider, homepage |
| `GET /token-purchase-requests/:id` | `investor/[id]/page.tsx` |
| `PATCH /token-purchase-requests/:id` | `investor/[id]/page.tsx` (cancel) |
| `PATCH /token-purchase-requests/:id/status` | `issuer/page.tsx`, `claim-provider/page.tsx` |
| `PATCH /token-purchase-requests/:id/resume-after-identity` | `investor/identity/page.tsx` |
| `POST /token-purchase-requests` | `investor/request-form/page.tsx` |
| `POST /token-purchase-requests/preflight` | `investor/request-form/page.tsx` |
| `GET /token-transfer-requests` | `issuer/page.tsx`, `investor/[id]`, `claim-provider` |
| `POST /token-transfer-requests` | `transfer/page.tsx`, `investor/[id]` |
| `PATCH /token-transfer-requests/:id/status` | `issuer/page.tsx`, `claim-provider/page.tsx` |
| `GET /token-listings` | `listings/page.tsx`, `investor/[id]` |
| `POST /token-listings` | `investor/[id]` |
| `PATCH /token-listings/:id/status` | `investor/[id]` |
| `POST /token-listings/:id/buy-intents` | `listings/page.tsx` |
| `GET /token-listings/buy-intents` | `issuer/page.tsx`, `investor/[id]`, `claim-provider` |
| `GET /token-listings/buy-intents/:id` | `investor/[id]` |
| `PATCH /token-listings/buy-intents/:id/status` | Issuer, investor, claim-provider |
| `PATCH /token-listings/buy-intents/:id/resume-after-identity` | `investor/[id]` |
| `GET /trusted-issuers` | `personnel/page.tsx`, `token-admin/page.tsx`, `issuance-form.tsx` |
| `POST /trusted-issuers` | `personnel/page.tsx` |
| `DELETE /trusted-issuers/:id` | `personnel/page.tsx` |
| `GET /indexed/assets` | `issuer/page.tsx`, proxy `/api/rwa`, `top-transactions.tsx`, `assets-context.tsx` |
| `GET /indexed/tokens` | `assets-context.tsx` |
| `GET /indexed/tokens/:contract/balances` | `issuer/page.tsx` (IssuerAssetHoldersTable) |
| `POST /blockchain-transactions` | `lib/blockchain-transactions.ts` (after every on-chain tx) |
| `GET /blockchain-transactions` | `top-transactions.tsx` |
| `GET /activity-logs` | `activity-logs/page.tsx` |
| `GET /compliance-rules` (via proxy) | `compliance-rules-manager.tsx` |
| `POST /compliance-rules/countries` | `compliance-rules-manager.tsx` |
| `POST /compliance-rules/transfer-limits` | `compliance-rules-manager.tsx` |
| `GET /kyc/applications` | `kyc-api.ts` |
| `POST /kyc/applications` | `kyc-api.ts` |
| `POST /kyc/applications/:id/approve` | `kyc-api.ts` |
| `POST /kyc/applications/:id/reject` | `kyc-api.ts` |
| `GET /assets` (via proxy) | Next.js `/api/rwa` |
| `POST /assets` (via proxy) | Next.js `/api/rwa` |
| `POST /assets/deployed` (via proxy) | Next.js `/api/rwa/deployed` |
| `POST /assets/apply` | `my-assets/page.tsx` |
| `DELETE /assets/:id` | `assets-context.tsx` |

### 2.2 Background / Indexer Consumers

- `IndexerService.syncOnce()` is defined but **nothing calls it**. No cron, no runner, no NestJS lifecycle hook.
- `IndexerModule` is not imported. The service is effectively dead code.
- No background job framework (BullMQ, `@nestjs/schedule`) is installed.

### 2.3 Routes With No Consumer Found

| Route | Classification |
|---|---|
| `GET /identity-snapshots` | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |
| `POST /identity-snapshots` | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |
| `GET /indexed/wallets` | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |
| `POST /indexed/wallets` | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |
| `GET /indexed/tokens/:contract/assets` | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |
| `GET /indexed/tokens/:contract/issuance-requests` | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |
| `GET /blockchain-transactions/count` | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |
| `PATCH /issuance-requests/:id/status` | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |
| `PATCH /issuance-requests/:id/mint` | DEPRECATION_CANDIDATE_PENDING_RUNTIME_TELEMETRY |

These are classified as candidates only. Do not remove without runtime telemetry confirming zero traffic.

---

## Section 3 — Complete Migration and Database Drift Audit

### 3.1 Migration Inventory

**Prisma-managed migrations** (registered in `_prisma_migrations`, authoritative):

| Migration | File | Change | Safe |
|---|---|---|---|
| `20260610122525_new_schema` | `prisma/migrations/.../migration.sql` | Creates all core tables: User, Session, Asset, AssetRequest (snake_case mapped), TokenState, TokenAsset, TokenBalance, IssuanceRequest, ComplianceRule, TransferLimit, TrackedWallet, IndexerState, ActivityLog, IdentitySnapshot, KycApplication, KycDocument, TokenPurchaseRequest, TokenTransferRequest, TokenSellListing, TokenBuyIntent, TokenTransferHistory, TrustedIssuer | Yes |
| `20260610123224_latest_schema` | `prisma/migrations/.../migration.sql` | Adds TIMESTAMPTZ columns, BlockchainTransaction table, fee/rent columns, whitelistTxHash/activationTxHash/KYC claim columns to TokenPurchaseRequest/TokenTransferRequest/TokenBuyIntent, targetBuyerWallet to TokenSellListing, fullName/email/nationality/country/docs to TokenBuyIntent | Yes |
| `20260613000100_remove_redemption_requests` | `prisma/migrations/.../migration.sql` | `DROP TABLE IF EXISTS "RedemptionRequest"` | Yes |

**Manual SQL migrations** (in `src/database/migrations/`, NOT tracked by Prisma):

| File | Change | Overlap with Prisma | Notes |
|---|---|---|---|
| `004_create_issuance_requests.sql` | Creates `issuance_requests` (snake_case, SERIAL PK) and `activity_logs` tables | **Partial overlap** — Prisma migration creates `IssuanceRequest` and `ActivityLog` with different naming | Old-style schema, likely applied before Prisma migration was introduced. The tables may coexist with different names. |
| `006_create_asset_requests.sql` | Creates `asset_requests` table | **Duplicated** — Prisma migration creates same table | Prisma migration supersedes this. |
| `007_extend_token_purchase_requests.sql` | `ALTER TABLE "TokenPurchaseRequest" ADD COLUMN IF NOT EXISTS ...` | **Duplicated** — Prisma migration latest_schema contains same columns | Idempotent `IF NOT EXISTS` — safe if applied twice. |
| `008_token_transfer_requests.sql` | Creates `TokenTransferRequest` | **Duplicated** — Prisma migration new_schema creates same table | Idempotent. |
| `009_marketplace_listings.sql` | Creates `TokenSellListing`, `TokenBuyIntent` | **Duplicated** — Prisma migration new_schema creates same | Idempotent. |
| `010_relax_asset_request_admin_fields.sql` | `ALTER TABLE asset_requests` — drops NOT NULL on numeric fields | **Duplicated** — Prisma schema.prisma has these as nullable | Idempotent. |
| `011_marketplace_listing_targets_and_kyc.sql` | Adds `targetBuyerWallet`, KYC doc columns to listings/intents | **Duplicated** — Prisma latest_schema adds same | Idempotent. |
| `012_trusted_issuers.sql` | Creates `TrustedIssuer` table | **Duplicated** — Prisma new_schema creates same | Idempotent. |
| `013_record_identity_setup_transactions.sql` | Adds whitelist/activation TX columns to purchase/transfer/buyintent | **Duplicated** — Prisma latest_schema adds same | Idempotent. |
| `014_record_transfer_eligibility_claim_transactions.sql` | Adds KYC/AML claim TX columns to transfer/buyintent | **Duplicated** — Prisma latest_schema adds same | Idempotent. |
| `015_blockchain_transaction_ledger_and_timezone.sql` | Creates `BlockchainTransaction`, converts timestamp columns to TIMESTAMPTZ, backfills existing txHashes | **Partially duplicated** — Prisma latest_schema creates BlockchainTransaction and adds TIMESTAMPTZ columns; the backfill INSERT is unique to this manual migration | **Critical**: contains a large INSERT that migrates historical txHashes. This should only have been applied once. |
| `016_blockchain_transaction_fee_rent_breakdown.sql` | Adds fee/rent Lamport columns to BlockchainTransaction | **Duplicated** — Prisma latest_schema adds same | Idempotent `ADD COLUMN IF NOT EXISTS`. |
| `017_drop_redemption_requests.sql` | `DROP TABLE IF EXISTS "RedemptionRequest"` | **Duplicated** — Prisma `20260613000100_remove_redemption_requests` does same | Idempotent. |

**Critical finding on migration 004**: The manual `004_create_issuance_requests.sql` creates a table `issuance_requests` with snake_case columns (`token_address`, `asset_id`, `request_id BIGINT`). The Prisma model `IssuanceRequest` maps to a quoted table `"IssuanceRequest"` with camelCase columns. These are **two separate tables** if both were applied. The old `IssuanceModule` (`IssuanceService`) uses Prisma and writes to `"IssuanceRequest"` (camelCase). Verify via database inspection whether both tables exist.

### 3.2 Drift Analysis

> Direct database access was not available during this audit. The following analysis is based on migration content comparison only. A schema-only dump must be taken and compared before Phase 1 begins.

| Risk | Description |
|---|---|
| `issuance_requests` vs `"IssuanceRequest"` | Manual migration 004 may have created a legacy snake_case table that is unused but present |
| TIMESTAMPTZ conversion precision | Manual migration 015 converts timestamps with `AT TIME ZONE 'Asia/Karachi'`. If applied after Prisma migration already converted some columns to TIMESTAMPTZ, conversion math may differ |
| Backfill data | Manual migration 015 includes a large INSERT INTO BlockchainTransaction SELECT from many tables. If this ran before the Prisma migration that also created BlockchainTransaction, ordering matters |
| `RedemptionRequest` table | Both manual 017 and Prisma migration drop it. IF manual 017 ran first, Prisma migration would still succeed (IF EXISTS). If Prisma ran first, manual 017 is a no-op. Either is safe. |
| `_prisma_migrations` table | Must contain entries for all 3 Prisma migrations. Manual SQL migrations are NOT in `_prisma_migrations`. |

### 3.3 Safe Reconciliation Strategy

Execute in this order. Do not skip any step.

1. **Take a full database backup** with `pg_dump -Fc dbname > backup_phase0_$(date +%Y%m%d).pgc`
2. **Take a schema-only dump** with `pg_dump --schema-only dbname > schema_dump.sql`
3. **Run `prisma db pull`** on a sandbox copy to generate a `schema.prisma` from the live DB and compare it against the current `prisma/schema.prisma`. Note any extra tables/columns.
4. **Check `_prisma_migrations`** table for the 3 Prisma migration entries. If missing, investigate why.
5. **Inspect `information_schema.tables`** for unexpected tables (e.g., `issuance_requests` in snake_case, `activity_logs` from migration 004, any `RedemptionRequest` variant).
6. **Do not run `prisma migrate reset`** under any circumstances.
7. **Do not delete rows** from `_prisma_migrations` without a written recovery plan.
8. Add Phase 1 schema changes as **new Prisma migrations only**, with `IF NOT EXISTS` guards where appropriate.
9. Before enabling new foreign keys, validate that no orphan rows exist.
10. After Phase 1 migration: re-run schema dump and compare row counts on all tables.

---

## Section 4 — Prisma Model Audit

| Model | Table | Verdict | Critical Issues |
|---|---|---|---|
| `User` | `"User"` | EXTEND | Single `walletAddress` string cannot support multi-wallet, org wallets, or revocation. `roles String[]` is unvalidated. |
| `Session` | `"Session"` | KEEP | Clean JWT session model. |
| `Asset` | `"Asset"` | EXTEND | `lifecycleState` default `"ISSUED"` does not map to contract states. No `assetRegistryAddress` for on-chain PDA reference. |
| `AssetRequest` | `asset_requests` (mapped) | EXTEND | `trustedIssuers Json?` is unstructured. `complianceModules String[]` stores informal names not program IDs. `documents Json?` should become `Document[]` relations. No custody mandate linkage. |
| `TokenState` | `"TokenState"` | KEEP | Indexed read cache. Populated by IndexerService when it runs. Currently stale. |
| `TokenAsset` | `"TokenAsset"` | KEEP | Links token to asset ID. |
| `TokenBalance` | `"TokenBalance"` | KEEP | Per-wallet balance cache. Stale without indexer. |
| `IssuanceRequest` | `"IssuanceRequest"` | EVALUATE | Used by OLD `IssuanceModule`. Confirm whether `issuance_requests` (snake_case, from manual 004) also exists in live DB. If both exist, decide which is canonical. |
| `ComplianceRule` | `"ComplianceRule"` | MIGRATE | Single global record with `allowedCountries String[]`. Cannot represent per-token, per-module compliance state. See Section 17. |
| `TransferLimit` | `"TransferLimit"` | MIGRATE | Single per-address global limit. Not per-token. Maps loosely to `mod-max-transfer` and `mod-max-balance`. |
| `TrackedWallet` | `"TrackedWallet"` | KEEP | Indexer configuration. |
| `IndexerState` | `"IndexerState"` | KEEP | Tracks indexer run state. |
| `ActivityLog` | `"ActivityLog"` | KEEP → SUPPLEMENT | Flat JSON log. Useful for display. Not sufficient for workflow audit. Supplement with `WorkflowTransition` in Phase 1. |
| `IdentitySnapshot` | `"IdentitySnapshot"` | EVALUATE | Point-in-time claim snapshot with no live sync. May be replaceable by indexed IRS query. Do not remove without IRS indexer in place. |
| `KycApplication` | `"KycApplication"` | EXTEND | Document URL fields (`idDocumentUrl`, `proofOfAddressUrl`, `selfieUrl`) are public strings. Must become private storage references in Phase 2. |
| `KycDocument` | `"KycDocument"` | EXTEND | `fileUrl` must become private storage key. |
| `TokenPurchaseRequest` | `"TokenPurchaseRequest"` | EXTEND | Add `whitepaperAckId`, `sandboxPaymentId` in Phase 4. No NAV freshness check linkage. |
| `TokenTransferRequest` | `"TokenTransferRequest"` | EXTEND | Add `tradeEscrowId` for fracks-trade-escrow in Phase 6. |
| `TokenSellListing` | `"TokenSellListing"` | EXTEND | Map to `TradeEscrow` on-chain state in Phase 6. |
| `TokenBuyIntent` | `"TokenBuyIntent"` | EXTEND | Buyer identity doc URLs are public strings. Map to TradeEscrow buyer side in Phase 6. |
| `TokenTransferHistory` | `"TokenTransferHistory"` | KEEP | Append-only ledger. |
| `BlockchainTransaction` | `"BlockchainTransaction"` | EXTEND | No unique constraint on `(network, txHash)`. `network` field missing entirely. Duplicate txHash insertion is possible. |
| `TrustedIssuer` | `"TrustedIssuer"` | EXTEND | `walletAddress` as unique key is wrong. Contracts use FID PDA (`[b"fid", owner]`). Add `fidAddress String?`. The model is global; contract TIR is per-token. |

---

## Section 5 — Existing Workflow Map

### Purchase Workflow (Current State)

```
SUBMITTED → (KYC provider) → PENDING_KYC
          → (KYC approved) → PENDING_AML
          → (AML approved) → PENDING_ISSUER_REVIEW
          → (Identity missing) → ACTION_REQUIRED_INVESTOR_IDENTITY
          → (Investor resolves) → PENDING_ISSUER_REVIEW (via resume-after-identity)
          → (Issuer approves settlement) → APPROVED_FOR_MINT
          → (Issuer registers IRS identity) → [records whitelistTxHash]
          → (Issuer activates identity) → [records activationTxHash]
          → (Issuer mints tokens) → MINTED [records mintTxHash]
          → REJECTED (at any stage)
          → CANCELLED (by investor or admin)
```

**Gaps**: No whitepaper acknowledgement step. No payment step. No NAV freshness check. No on-chain custody verification before mint.

### Transfer Whitelist Workflow (Current State)

```
DRAFT → PENDING_KYC → PENDING_AML
      → PENDING_ISSUER_WHITELIST → (Issuer registers IRS identity)
      → PENDING_ISSUER_ACTIVATION → (Issuer activates IRS identity)
      → READY_TO_TRANSFER → (Actual Token-2022 transfer via fracks-token)
      → READY_FOR_SELLER_ACCEPTANCE (marketplace variant)
```

**Gaps**: No fracks-trade-escrow integration. Transfer hook approval creation not tracked.

### Marketplace Flow (Current State)

```
TokenSellListing (LISTED)
  └── TokenBuyIntent (BUYER_INTERESTED)
        → follows transfer whitelist workflow
        → READY_FOR_SELLER_ACCEPTANCE
        → TokenTransferHistory created
```

**Gaps**: No on-chain trade escrow. No seller payment confirmation step. No fracks-trade-escrow tracking.

### KYC Flow (Current State)

```
POST /kyc/applications → KycApplication (PENDING)
ADMIN review → APPROVED | REJECTED
On approved → KYC provider calls fracks-fid.add_claim on-chain
             → POST /kyc/applications/:id/onchain-id (records address)
```

**Gaps**: No on-chain FID creation step tracked. KYC approval does not gate on FID existence.

### Asset Deployment Flow (Current State)

```
Issuer → POST /asset-requests → AssetRequest (PENDING_REVIEW)
Admin reviews → PATCH /:id/status (APPROVED)
Issuer builds tx on-chain → fracks-factory.deploy_token_suite
Deployed → POST /assets/deployed → creates Asset record
         → PATCH /asset-requests/:id/status (DEPLOYED)
```

**Gap**: No custody mandate or attestation step. Factory contract requires `CustodyMandate` + `CustodyAttestation` before `deploy_token_suite` will succeed. Current backend has no model or workflow for this.

### Mint / Issuance Flow (Current State — OLD Module)

```
Issuer → POST /issuance-requests → IssuanceRequest (PENDING)
Token controller → PATCH /issuance-requests/:id/status (APPROVED)
Issuer mints → fracks-token.mint on-chain
Issuer records → PATCH /issuance-requests/:id/mint (txHash)
```

Status: Used by `issue-more-tokens.tsx`. Functional but gated on JWT+Role. **This old module must not be removed until the frontend is migrated.**

---

## Section 6 — Complete Role and Organization Architecture

### 6.1 Current Roles (Enum)

```typescript
enum Role {
  PLATFORM_OWNER = "platform_owner"   // Used by PlatformWalletSignatureGuard
  TOKEN_OWNER    = "token_owner"      // Assigned but rarely used in guards
  TOKEN_ISSUER   = "token_issuer"     // Can create/mint issuances
  TOKEN_CONTROLLER = "token_controller" // Can approve issuances
  COMPLIANCE_OWNER = "compliance_owner" // Can set compliance rules
  KYC_PROVIDER   = "kyc_provider"    // Can create identity snapshots
  INVESTOR       = "investor"         // Stored in User.roles but no current guard uses it
  ADMIN          = "admin"            // Broadest access
}
```

### 6.2 Required Platform Roles (Phase 1 additions)

These map to backend API access permissions:

| Role | Access |
|---|---|
| `PLATFORM_ADMIN` | Full platform administration. Replaces `ADMIN`. |
| `ISSUER_ADMIN` | Manage their organization's assets, requests, and agents. |
| `ISSUER_OPERATOR` | Submit mints, record transactions for an issuer org. |
| `CUSTODIAN_ADMIN` | Accept custody mandates, submit attestations. |
| `CUSTODIAN_SIGNATORY` | Sign custody/reserve attestations on behalf of custodian org. |
| `VALUER` | Submit valuations/NAV for assigned assets. |
| `KYC_PROVIDER` | Approve KYC applications, issue claims. Already in enum. |
| `AML_PROVIDER` | Approve AML checks, issue claims. |
| `COMPLIANCE_OFFICER` | Review compliance state, submit module configs. |
| `PROPERTY_MANAGER` | Submit construction milestone attestations. |
| `CONSTRUCTION_CERTIFIER` | Certify construction milestone progress. |
| `SHARIAH_BOARD` | Issue Shariah compliance claims. |
| `LEGAL_COUNSEL` | Review legal documents; read-only on most workflows. |
| `REGULATOR` | Read all workflows; trigger regulatory freeze. |
| `INVESTOR` | Submit purchase requests, view own positions. Already in enum. |
| `LIQUIDITY_PROVIDER` | Participate in quick-exit or secondary liquidity pools. |

**Migration strategy for current `User.roles String[]`**: Keep during Phase 1. Map `ADMIN` → `PLATFORM_ADMIN`, `TOKEN_ISSUER` → `ISSUER_OPERATOR`, `TOKEN_CONTROLLER` → `ISSUER_ADMIN`, `KYC_PROVIDER` → `KYC_PROVIDER` in the `PlatformRoleAssignment` backfill. Run both systems in parallel until Phase 9.

### 6.3 Organization Membership Roles

An `OrganizationMember` record carries one of:

| Org Member Role | Applicable Org Types | Meaning |
|---|---|---|
| `ORG_ADMIN` | All | Can manage org membership and settings |
| `ORG_MEMBER` | All | Standard member |
| `AUTHORIZED_SIGNATORY` | CUSTODIAN, ISSUER | Can sign on-chain transactions on behalf of org |
| `DOCUMENT_REVIEWER` | All | Can review and approve documents |

### 6.4 On-Chain Authority Roles (not stored in User.roles)

These are derived from on-chain accounts and must be verified live before privileged actions:

| On-Chain Role | Source | Verification |
|---|---|---|
| Factory owner | `FactoryState.owner` | Direct PDA query |
| Token owner | `OwnerState.owner` | PDA `[b"owner", token_mint]` |
| Token agent | `AgentRole` PDA | PDA `[b"agent", token_mint, wallet]` |
| FID holder | `FidAccount` PDA | PDA `[b"fid", wallet]` |
| IRS owner | `IdentityRegistryStorageState.owner` | PDA `[b"irs_state", authority_seed]` |
| IRS identity agent | `WalletIdentity` agent binding | Derived from IRS + IRP |
| TIR trusted issuer | `IssuerEntry` PDA | PDA `[b"issuer_entry", tir_state, fid]` |
| Platform authority | `PlatformAuthority` PDA | Factory `[b"platform_authority", wallet]` |

### 6.5 TIR Claim Topic Map

| Topic | Role |
|---|---|
| 1 | KYC — investor identity verified |
| 2 | AML — anti-money-laundering cleared |
| 3 | Accreditation — investor accreditation status |
| 4 | Custodian authority |
| 5 | Valuation authority |
| 6 | Construction authority |
| 7 | Shariah authority |
| 8 | Property manager authority |

### 6.6 Complete Role Matrix

| Role | Platform role | Organization required | Wallet required | FID required | TIR topic | Token authority | Key backend operations | Key on-chain operations |
|---|---|---|---|---|---|---|---|---|
| PLATFORM_ADMIN | Yes | No | Optional | No | — | Factory owner | All admin routes | Factory: update_program_ids, approve_platform_authority |
| ISSUER_ADMIN | Yes | ISSUER org | Yes | Yes (country 0) | — | OwnerState.owner | Asset CRUD, deployment approval | Token: transfer_ownership, add_agent |
| ISSUER_OPERATOR | Yes | ISSUER org | Yes | Yes (country 0) | — | AgentRole | Submit issuance, record txHashes | Token: mint, burn, freeze |
| CUSTODIAN_ADMIN | Yes | CUSTODIAN org | Yes | Yes (country 0) | 4 | PlatformAuthority | Accept mandate, submit attestation | Factory: accept_custody_mandate, attest_custody |
| CUSTODIAN_SIGNATORY | Yes | CUSTODIAN org | Yes | Yes (country 0) | 4 | — | Sign attestations | Asset Registry: attest_custody, attest_reserve |
| VALUER | Yes | VALUER org | Yes | Yes (country 0) | 5 | — | Submit valuations | Asset Registry: attest_valuation |
| KYC_PROVIDER | Yes | KYC org | Yes | Yes (country 0) | 1 | — | Approve KYC applications | FID: add_claim (topic 1) |
| AML_PROVIDER | Yes | AML org | Yes | Yes (country 0) | 2 | — | Approve AML checks | FID: add_claim (topic 2) |
| COMPLIANCE_OFFICER | Yes | Any org | No | No | — | — | View compliance state, configure modules | — |
| PROPERTY_MANAGER | Yes | Mgmt org | Yes | Yes | 8 | — | Record milestones | Asset Registry: attest_milestone |
| CONSTRUCTION_CERTIFIER | Yes | Cert org | Yes | Yes | 6 | — | Certify milestones | Asset Registry: transition_lifecycle |
| SHARIAH_BOARD | Yes | Shariah org | Yes | Yes | 7 | — | Issue Shariah attestation | FID: add_claim (topic 7) |
| LEGAL_COUNSEL | Yes | Legal org | No | No | — | — | Read-only document review | — |
| REGULATOR | Yes | No | No | No | — | — | View all, trigger regulatory case | Asset Registry: title_dispute_freeze |
| INVESTOR | Yes | No | Yes | Yes (1-999) | 1,2 required | — | Submit purchase/transfer requests | — (wallet receives tokens after IRS registration) |
| LIQUIDITY_PROVIDER | Yes | No | Yes | Yes | — | — | Quick-exit bids, secondary liquidity | fracks-trade-escrow: initiate_trade |

---

## Section 7 — WalletAccount Migration Design

### 7.1 Current Problem

`User.walletAddress String? @unique` is a single nullable field. This prevents:
- Multiple Solana wallets per user
- Organization-owned wallets with separate signatories
- Network-scoped wallet registration (devnet vs mainnet)
- Wallet revocation without deleting the user
- Authorized signatory assignments per wallet
- Challenge/verify-at-connection timestamps

### 7.2 Proposed `WalletAccount` Model

```prisma
model WalletAccount {
  id               String    @id @default(uuid())
  userId           String
  publicKey        String
  network          String    // "devnet" | "mainnet-beta"
  isPrimary        Boolean   @default(false)
  status           String    @default("ACTIVE")  // "ACTIVE" | "REVOKED" | "SUSPENDED"
  label            String?
  verifiedAt       DateTime?
  lastChallengeAt  DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  orgWallets       OrganizationWallet[]

  @@unique([publicKey, network])
  @@index([userId])
  @@index([publicKey])
}

model OrganizationWallet {
  id                   String    @id @default(uuid())
  organizationId       String
  walletAccountId      String
  purpose              String?   // "signing" | "receiving" | "treasury"
  isAuthorizedSignatory Boolean  @default(false)
  status               String    @default("ACTIVE")
  validFrom            DateTime  @default(now())
  validUntil           DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  organization   Organization  @relation(fields: [organizationId], references: [id])
  walletAccount  WalletAccount @relation(fields: [walletAccountId], references: [id])

  @@index([organizationId])
  @@index([walletAccountId])
}
```

### 7.3 Safe Migration Plan for WalletAccount

1. **Add `WalletAccount` table** — new additive migration, no existing data changed.
2. **Backfill** — for every `User` where `walletAddress IS NOT NULL`, insert one `WalletAccount` record with `isPrimary=true`, `network='devnet'`, `status='ACTIVE'`, `verifiedAt=User.updatedAt`.
3. **Add unique constraint** on `(publicKey, network)` — validate no duplicates exist before adding.
4. **Introduce `WalletResolutionService`** — single service that resolves wallet → user, with dual-read fallback to `User.walletAddress` until cleanup.
5. **Dual-read phase** — guards and services read from `WalletAccount` first, fall back to `User.walletAddress` if not found. Write new wallets only to `WalletAccount`.
6. **Stop writing to `User.walletAddress`** for new registrations — Phase 1 endpoint changes.
7. **Remove `User.walletAddress`** only in Phase 9 after telemetry confirms no reads remain.

---

## Section 8 — Revised ERD (Phase 1 — All Additive)

### 8.1 New Models (Phase 1)

```
Organization
  id           UUID PK
  name         TEXT NOT NULL
  type         TEXT NOT NULL    -- "ISSUER" | "CUSTODIAN" | "VALUER" | "KYC_PROVIDER"
                                -- | "AML_PROVIDER" | "CONSTRUCTION" | "SHARIAH" | "LEGAL"
  status       TEXT DEFAULT "ACTIVE"  -- "ACTIVE" | "SUSPENDED" | "REVOKED"
  createdAt    TIMESTAMPTZ
  updatedAt    TIMESTAMPTZ

OrganizationMember
  id               UUID PK
  organizationId   UUID FK → Organization(id) ON DELETE CASCADE
  userId           UUID FK → User(id) ON DELETE CASCADE
  memberRole       TEXT    -- "ORG_ADMIN" | "ORG_MEMBER" | "AUTHORIZED_SIGNATORY" | "DOCUMENT_REVIEWER"
  invitedBy        UUID? FK → User(id)
  joinedAt         TIMESTAMPTZ
  revokedAt        TIMESTAMPTZ?
  UNIQUE(organizationId, userId)

WalletAccount
  id               UUID PK
  userId           UUID FK → User(id) ON DELETE CASCADE
  publicKey        TEXT NOT NULL
  network          TEXT NOT NULL  -- "devnet" | "mainnet-beta"
  isPrimary        BOOL DEFAULT false
  status           TEXT DEFAULT "ACTIVE"
  verifiedAt       TIMESTAMPTZ?
  lastChallengeAt  TIMESTAMPTZ?
  createdAt        TIMESTAMPTZ
  updatedAt        TIMESTAMPTZ
  UNIQUE(publicKey, network)

OrganizationWallet
  id                    UUID PK
  organizationId        UUID FK → Organization(id) ON DELETE CASCADE
  walletAccountId       UUID FK → WalletAccount(id)
  purpose               TEXT?
  isAuthorizedSignatory BOOL DEFAULT false
  status                TEXT DEFAULT "ACTIVE"
  validFrom             TIMESTAMPTZ
  validUntil            TIMESTAMPTZ?
  createdAt             TIMESTAMPTZ
  updatedAt             TIMESTAMPTZ

PlatformRoleAssignment
  id           UUID PK
  walletAddress TEXT NOT NULL   -- denormalized for fast lookup; FK to WalletAccount.publicKey later
  role         TEXT NOT NULL    -- from expanded role list
  grantedBy    UUID? FK → User(id)
  grantedAt    TIMESTAMPTZ DEFAULT now()
  revokedAt    TIMESTAMPTZ?
  revokedBy    UUID? FK → User(id)
  reason       TEXT?
  INDEX(walletAddress)
  INDEX(role)

OnChainAuthorityBinding
  id              UUID PK
  walletAddress   TEXT NOT NULL
  fidAddress      TEXT?          -- FID PDA address on-chain
  authorityType   TEXT NOT NULL  -- "TOKEN_OWNER" | "TOKEN_AGENT" | "IRS_OWNER" |
                                 -- "FACTORY_OWNER" | "PLATFORM_AUTHORITY" | "TIR_TRUSTED_ISSUER"
  tokenContract   TEXT?          -- null for global authorities
  txHash          TEXT?
  network         TEXT DEFAULT "devnet"
  confirmedAt     TIMESTAMPTZ?
  revokedAt       TIMESTAMPTZ?
  createdAt       TIMESTAMPTZ
  INDEX(walletAddress)
  INDEX(tokenContract)

WorkflowTransition
  id           UUID PK
  entityType   TEXT NOT NULL  -- "TokenPurchaseRequest" | "AssetRequest" | "CustodyMandate" | ...
  entityId     TEXT NOT NULL
  fromStatus   TEXT?          -- null for initial creation event
  toStatus     TEXT NOT NULL
  actorWallet  TEXT?
  actorUserId  TEXT?
  txHash       TEXT?
  reason       TEXT?
  metadata     JSONB?
  createdAt    TIMESTAMPTZ DEFAULT now()
  INDEX(entityType, entityId)
  INDEX(actorWallet)
  INDEX(createdAt)
```

### 8.2 Cardinality and Relationships

```
User 1──* Session
User 1──* WalletAccount
User 1──* OrganizationMember
User 1──* PlatformRoleAssignment (via walletAddress)

Organization 1──* OrganizationMember
Organization 1──* OrganizationWallet

WalletAccount 1──* OrganizationWallet

WorkflowTransition *──1 (polymorphic: entityType + entityId links to any workflow entity)
```

### 8.3 Deletion Behavior

| Relationship | On Delete |
|---|---|
| User → Session | CASCADE |
| User → WalletAccount | CASCADE |
| User → OrganizationMember | SET revokedAt (soft) |
| Organization → OrganizationMember | CASCADE |
| Organization → OrganizationWallet | RESTRICT (must reassign first) |
| WalletAccount → OrganizationWallet | RESTRICT (must deactivate first) |
| WorkflowTransition | NEVER DELETE — append-only |
| AuditLog | NEVER DELETE — append-only |

---

## Section 9 — AuditLog Design

### 9.1 Purpose

`WorkflowTransition` tracks business state changes (status A → B on entity X). It is not sufficient for security, access, and data-change auditing.

`AuditLog` is the security event record. It captures **who did what to which resource** regardless of whether a status changed.

`BlockchainTransaction` records **on-chain execution evidence** (tx hash, fees, occurred-at).

These three tables are distinct and complementary:

| Log type | What it records | Retention |
|---|---|---|
| `WorkflowTransition` | Status machine transitions | Forever |
| `AuditLog` | Security events, data edits, access, failures | Forever (regulatory requirement) |
| `BlockchainTransaction` | Confirmed on-chain transactions with fee/rent data | Forever |

### 9.2 Proposed AuditLog Model

```prisma
model AuditLog {
  id              String   @id @default(uuid())
  actorUserId     String?
  actorWallet     String?
  organizationId  String?
  action          String   NOT NULL  -- e.g., "ROLE_ASSIGNED", "DOCUMENT_ACCESSED", "LOGIN_FAILED"
  resourceType    String?            -- e.g., "User", "Asset", "KycApplication"
  resourceId      String?
  requestId       String?            -- correlation to HTTP request
  correlationId   String?            -- cross-service correlation
  ipAddressHash   String?            -- SHA-256 of IP — never raw IP
  userAgentHash   String?            -- SHA-256 of user agent
  before          Json?              -- sanitized before-state (no secrets)
  after           Json?              -- sanitized after-state
  result          String   NOT NULL  -- "SUCCESS" | "FAILURE" | "PARTIAL"
  failureCode     String?
  environment     String   DEFAULT "sandbox"
  network         String   DEFAULT "devnet"
  createdAt       DateTime @default(now()) @db.Timestamptz(3)

  @@index([actorUserId])
  @@index([actorWallet])
  @@index([action, resourceType])
  @@index([createdAt])
}
```

### 9.3 Events That Must Write AuditLog

- All role assignments and revocations
- All organization membership changes
- All document access (reads of signed download URLs)
- All document review decisions
- All asset record edits (not just status changes)
- All failed authorization attempts (HTTP 401, 403)
- All privileged admin actions (token freeze, burn, recovery)
- All sandbox simulator actions
- All custody mandate acceptance and release
- All deployment readiness checks
- All outbox event processing failures

### 9.4 What Must Never Be Stored in AuditLog

- Raw CNIC or national ID values
- Private keys or key material
- Signed access tokens or refresh tokens
- Document contents or file bytes
- Plaintext passwords or their hashes
- Raw IP addresses (only SHA-256 hash)

---

## Section 10 — WorkflowTransition Design

### 10.1 Rule

Every service method that changes a `status` field on any workflow entity must write a `WorkflowTransition` in the same Prisma `$transaction` as the status update.

```typescript
// Pattern for every status-changing service method:
async updateStatus(id: string, dto: UpdateStatusDto, actor: ActorContext) {
  const current = await this.prisma.entity.findUniqueOrThrow({ where: { id } });

  const updated = await this.prisma.$transaction([
    this.prisma.entity.update({
      where: { id, status: current.status }, // optimistic lock — see Section 11
      data: { status: dto.status },
    }),
    this.prisma.workflowTransition.create({
      data: {
        entityType: 'EntityName',
        entityId: id,
        fromStatus: current.status,
        toStatus: dto.status,
        actorWallet: actor.wallet ?? null,
        actorUserId: actor.userId ?? null,
        txHash: dto.txHash ?? null,
        reason: dto.reason ?? null,
      },
    }),
  ]);

  return updated[0];
}
```

### 10.2 Entities Requiring WorkflowTransition Writes

When Phase 1 lands, these services must be updated:

- `AssetRequestsService.updateStatus`
- `TokenPurchaseRequestsService.updateStatus`
- `TokenTransferRequestsService.updateStatus`
- `TokenListingsService.updateListingStatus`, `updateBuyIntentStatus`
- `KycApplicationService.approve`, `reject`, `update`
- `IssuanceService.updateStatus`, `markMinted`
- Any new service method added in Phase 2+

---

## Section 11 — Transactional Outbox Design

### 11.1 Problem

When a status update succeeds in the database but a downstream action fails (email, webhook, indexer follow-up, document processing), the system becomes inconsistent. Side effects must not be triggered inside the HTTP request cycle unless they are idempotent.

### 11.2 OutboxEvent Model

```prisma
model OutboxEvent {
  id             String    @id @default(uuid())
  eventType      String                // "PURCHASE_STATUS_CHANGED" | "ASSET_DEPLOYED" | ...
  aggregateType  String                // "TokenPurchaseRequest" | "Asset" | ...
  aggregateId    String
  payload        Json                  // serialized event data
  status         String    @default("PENDING")  // "PENDING" | "PROCESSING" | "DONE" | "DEAD"
  attempts       Int       @default(0)
  availableAt    DateTime  @default(now()) @db.Timestamptz(3)
  lockedAt       DateTime?             // set when a worker picks up the event
  processedAt    DateTime?
  lastError      String?
  createdAt      DateTime  @default(now()) @db.Timestamptz(3)

  @@index([status, availableAt])
  @@index([aggregateType, aggregateId])
}
```

### 11.3 Transactional Write Pattern

Business update + WorkflowTransition + AuditLog + OutboxEvent must all be written in one PostgreSQL transaction:

```typescript
await this.prisma.$transaction([
  this.prisma.tokenPurchaseRequest.update(...),
  this.prisma.workflowTransition.create(...),
  this.prisma.auditLog.create(...),
  this.prisma.outboxEvent.create({
    data: {
      eventType: 'PURCHASE_STATUS_CHANGED',
      aggregateType: 'TokenPurchaseRequest',
      aggregateId: id,
      payload: { fromStatus, toStatus, actorWallet },
    },
  }),
]);
```

### 11.4 Worker Design

The outbox worker is a separate process (or `@nestjs/schedule` cron job, added in Phase 1):

1. `SELECT ... WHERE status='PENDING' AND availableAt <= now() FOR UPDATE SKIP LOCKED LIMIT 10`
2. Set `lockedAt = now()`, `status = 'PROCESSING'`
3. Process event (send email, call webhook, etc.)
4. On success: set `status = 'DONE'`, `processedAt = now()`
5. On failure: increment `attempts`, set `lastError`, clear `lockedAt`
   - If `attempts >= 5`: set `status = 'DEAD'` (dead-letter)
   - Else: set `availableAt = now() + exponential_backoff(attempts)`
6. All steps are idempotent by `id` — re-processing a DONE event is a no-op.

### 11.5 Event Types (Phase 1 scope)

- `PURCHASE_STATUS_CHANGED` → email notification to investor
- `ASSET_REQUEST_STATUS_CHANGED` → email to issuer
- `KYC_STATUS_CHANGED` → email to investor
- `TRANSACTION_RECORDED` → optional webhook for external consumers

---

## Section 12 — Optimistic Concurrency Strategy

### 12.1 Problem Scenarios

| Scenario | Risk |
|---|---|
| Issuer updates purchase status while KYC provider simultaneously updates the same record | Last writer wins — silent data loss |
| Custodian accepts mandate while issuer submits replacement | One update silently lost |
| Payment webhook arrives while request is cancelled | Cancelled record re-opened silently |
| Indexer confirms a tx while API retries recording it | Duplicate or overwritten state |

### 12.2 Recommended Strategy: Expected-Status Check

For all status-change operations, require that the current status equals the expected `fromStatus` before updating:

```typescript
const updated = await this.prisma.entity.updateMany({
  where: { id, status: expectedFromStatus },
  data: { status: newStatus },
});

if (updated.count === 0) {
  throw new ConflictException(`Expected status '${expectedFromStatus}' but entity has already moved.`);
}
```

Return HTTP `409 CONFLICT` when the condition fails. Never silently overwrite.

### 12.3 Strategy Per Domain

| Domain | Strategy |
|---|---|
| TokenPurchaseRequest status | Expected-status check (`where: { id, status: from }`) |
| AssetRequest status | Expected-status check |
| KycApplication status | Expected-status check |
| TokenSellListing / BuyIntent | Expected-status check |
| CustodyMandate (Phase 3) | Expected-status check |
| BlockchainTransaction | Upsert on `(network, txHash)` unique constraint — idempotent by design |
| WorkflowTransition | Append-only, no concurrency concern |
| AuditLog | Append-only, no concurrency concern |
| OutboxEvent worker | `FOR UPDATE SKIP LOCKED` PostgreSQL row-level lock |

---

## Section 13 — Source-of-Truth Matrix

| Data | Source of Truth | Backend Purpose | Live Verification Required Before Action |
|---|---|---|---|
| Asset application details | PostgreSQL | Workflow and display | No |
| Asset lifecycle state | Blockchain (asset-registry) | Indexed cache | Yes — before deployment or lifecycle transition |
| Legal document file | Supabase Storage | Secure private storage | Access URL validation |
| Document hash | Blockchain (asset-registry) / Backend DB | Integrity | Yes where anchored on-chain |
| Custody mandate acceptance | Blockchain (factory) | Indexed cache | Yes — before deploy_token_suite |
| Custody attestation expiry | Blockchain (factory / asset-registry) | Dashboard/readiness | Yes — before deployment readiness passes |
| NAV / valuation | Blockchain (asset-registry) | Dashboard cache | Yes — for mint NAV freshness check |
| Valuation PDF | Supabase Storage | Evidence file | No |
| KYC claim validity | Blockchain (fracks-fid + fracks-irp) | Eligibility cache | Yes — IRP.is_verified before mint/transfer |
| IRS activation | Blockchain (fracks-irs) | Eligibility cache | Yes — before every controlled operation |
| Token balance | Blockchain (Token-2022) | Portfolio cache | Yes — for transfer (IRP checks live balance) |
| Purchase request status | PostgreSQL | Workflow | No |
| Sandbox payment confirmation | Backend (simulator) | Workflow | Webhook HMAC verification |
| IRS wallet identity existence | Blockchain (fracks-irs) | Indexed cache | Yes — before whitelist/activation steps |
| Transfer approval (hook) | Blockchain (fracks-token-hook) | Created per-transfer | Yes — must be created before Token-2022 transfer |
| Trade status | Blockchain (fracks-trade-escrow) + Backend | Workflow | Depends: backend status for UI; on-chain for actual token custody |
| Actual token movement | Blockchain (Token-2022 + hook) | Indexed history | Yes — for succession and redemption settlement |
| Governance vote weight | Backend snapshot (under contract limitation) | Sandbox enforcement | Yes — must lock snapshot before proposal window opens |
| Succession legal approval | Backend + asset-registry | Legal workflow | Yes — before actual token transfer execution |
| Succession token movement | Blockchain | Final execution | Yes |
| Regulatory freeze | Blockchain (asset-registry.title_dispute_freeze) | Indexed cache | Yes — before any transfer that might be blocked |
| Compliance module state | Blockchain (fracks-compliance) | Configuration cache | Yes — for compliance simulation and readiness checks |

---

## Section 14 — Contract Dependency and Blocker Matrix

| Feature | Program | Gap / Dependency | Backend Limitation | Contract Team Question | Status |
|---|---|---|---|---|---|
| Purchase mint via subscription | `fracks-token` | `purchase_mint` and subscription paths read `OfferingTermsView` from a Factory-owned account. No factory instruction creates or updates this account. | **Backend rule**: Do not replace the current settlement-confirmed → whitelist → activate → normal mint flow until `OfferingTermsView` creation is clarified. | What instruction creates/updates the `OfferingTermsView` account? Is it in factory or a separate program? | **BLOCKER** |
| Trade settlement (token/SOL custody) | `fracks-trade-escrow` | Trade escrow stores status only. It does NOT hold Token-2022 tokens or SOL. Actual token movement is a separate `fracks-token.transfer`. | **Backend rule**: Do not claim that funds or tokens are custodied in the escrow. Track: trade escrow status + actual token transfer txHash as separate events. | Intended for regulatory compliance record only, or will custody be added? | Clarification needed |
| Governance vote weight integrity | `fracks-governance` | Vote weight is passed as an instruction argument. No on-chain snapshot verification. A malicious frontend can submit any weight. | **Backend rule**: Governance backend MUST compute holder weight from indexed `TokenBalance` at the proposal's `snapshot_slot`. Frontend vote weight value is NEVER trusted. Lock snapshot weights server-side before the proposal voting window opens. | Is on-chain weight verification planned? | **SANDBOX LIMITATION — document publicly** |
| Succession token execution | `fracks-asset-registry` | Succession records in the asset registry are legal hash/approval records only. Actual token movement must be done through `fracks-token.forced_transfer` or `recovery`. | **Backend rule**: Do not mark succession `EXECUTED` until actual token transfer txHash is confirmed by indexer. | Are succession approvals expected to CPI into fracks-token automatically in a future version? | Clarification needed |
| Redemption settlement | `fracks-asset-registry` | Redemption event signature is a hash/record only. No automatic burn, payout, or holder distribution. | **Backend rule**: Track legal approval, payout, distribution, token burn, and closure as separate workflow steps, each requiring an on-chain txHash confirmation. | — | Noted |
| Custody duplication (Factory vs Asset Registry) | Both `fracks-factory` and `fracks-asset-registry` | Both programs have `create_custody_mandate`, `accept_custody_mandate`, `attest_custody`, `attest_reserve`. It is unclear which is canonical, whether factory CPIs into asset-registry, or whether both must be called. | **Backend rule**: Do not implement custody workflow until canonical flow is clarified. Backend should write one `CustodyMandate` record linked to the confirmed on-chain address. | Does factory CPI into asset-registry for custody? Which program is the source of truth for custody state? Is one implementation legacy? | **BLOCKER for Phase 3** |
| `IssuerOrAdminMutateAsset` authority | `fracks-asset-registry` | Source notes that the account constraint is currently bound to `asset_registry.issuer` only, despite the name suggesting admin is also allowed. | **Backend rule**: Do not assume admin wallet can call asset-registry mutate instructions. Verify by testing or reading the constraint binding. | Was admin authority intentionally excluded? Will it be added? | Clarification needed |
| Compliance remaining accounts | `fracks-compliance` | Every bound module account, stateful module program accounts, per-wallet/per-country PDAs, and daily usage PDAs must be supplied exactly. Missing accounts fail transactions silently or with opaque errors. | **Backend rule**: For any backend-assisted transaction (Phase 3+), build the remaining accounts list server-side from indexed compliance state. Frontend-assembled account lists are fragile. | — | Risk item |
| ATA auto-creation for mint | `fracks-token` | Recipient ATA must exist for Token-2022 before minting. Token state PDA signs mint via permanent delegate. | **Backend rule**: Backend must verify or instruct frontend to create ATA before submitting mint. | — | Noted |

---

## Section 15 — Feature-Phase Indexer Plan

The indexer must be implemented alongside each feature domain, not deferred to a final phase.

**Before any indexer reconnection**: investigate why `IndexerModule` is not in `AppModule`. Determine:
- Is `IndexerService.syncOnce()` being called by any external process (cron, script)?
- Does enabling it in the API process risk duplicate polling if a separate worker also runs?
- Should the indexer run inside the API process, or as a separate worker process?
- Check `INDEXER_INTERVAL_MS=120000` — this env var suggests polling was intended but the runner may have been removed during a refactor.

**Do not reconnect IndexerModule during Phase 0 or Phase 1** until runner analysis is complete.

| Feature Phase | Required Indexer Work |
|---|---|
| Phase 1 (Foundation) | Indexer runner analysis only. No new indexer events. Fix `BlockchainTransaction` idempotency. |
| Phase 2 (Assets/Documents) | Index `fracks-asset-registry`: lifecycle transitions, title flags. Update `AssetRegistryRecord`. |
| Phase 3 (Custody/Valuation) | Index `fracks-factory` + `fracks-asset-registry`: custody mandate accept/release, attestation expiry, NAV updates. Update `CustodyMandate`, `CustodyAttestation`, `AssetValuation` records. |
| Phase 4 (Purchase/Mint) | Index `fracks-irs`: register_identity, set_identity_activation. Update IRS cache for mint eligibility. Index `fracks-token`: mint events, supply cap state. |
| Phase 5 (Distributions) | Index token balance snapshots at distribution declaration slot. Verify holder entitlement. |
| Phase 6 (Trade/Governance) | Index `fracks-trade-escrow`: initiate, lock, payment confirm, settle, cancel. Index `fracks-governance`: proposal creation, vote cast, execution, cancellation. Lock governance snapshot weights server-side. |
| Phase 7 (Construction/Succession) | Index `fracks-asset-registry`: milestone attestations, tranche releases, succession claim/approval/transfer. |
| Phase 8 (Indexer Hardening) | Reconciliation backfills, missed-event replay, address lookup table support, RPC fallback hardening, performance profiling, duplicate-event protection, metrics/alerting. Rename from "Indexer Phase" to **Indexer Reconciliation, Backfill, Performance and Hardening**. |

---

## Section 16 — Sandbox Isolation Design

### 16.1 Problem

The current backend has no concept of environment isolation. A single deployment uses devnet Solana + a single PostgreSQL database + a single Supabase bucket. There is no `SANDBOX_MODE` env var, no simulator modules, no reset/reseed commands.

### 16.2 Database Isolation

- Preferred: **Separate PostgreSQL database** for sandbox: `rwaPlatformDB_sandbox`
- Alternative: Same database with `environment TEXT NOT NULL DEFAULT 'sandbox'` column on workflow tables
- All new models from Phase 1+ must include an `environment` field
- Sandbox reset/reseed must never touch records where `environment = 'production'`

### 16.3 Supabase Storage Isolation

- Use a separate private bucket: `fracks-documents-sandbox`
- Or enforce a path prefix: `sandbox/<env_id>/documents/...`
- Bucket access policy must reject cross-environment reads
- Service-role key must be environment-scoped

### 16.4 Solana Network

- Use devnet exclusively for sandbox
- New devnet program IDs from `new_contracts.md` are the only valid IDs
- Do not mix any old program IDs with new architecture
- Backend must validate on startup that configured program IDs match expected devnet values

### 16.5 Signing Keys

- Separate sandbox keys for each authority role (custodian, KYC provider, etc.)
- Keys stored in `.env.sandbox` — never committed
- Never expose service-role keys or signing keys to the frontend
- `PLATFORM_OWNER` env var must be a sandbox-only wallet for devnet

### 16.6 Simulator Module Loading

```typescript
// In AppModule imports:
...(process.env.SANDBOX_MODE === 'true' ? [SandboxSimulatorModule] : []),
```

Simulator controllers must only register when `SANDBOX_MODE=true`. Production process must not load them.

### 16.7 Reset and Reseed Commands

```
npm run sandbox:seed    // Seeds minimal scenario data (users, assets, KYC apps)
npm run sandbox:reset   // Truncates all tables with environment='sandbox' — never affects production
```

These must be guarded: they must refuse to run if `SANDBOX_MODE !== 'true'` or if `DATABASE_URL` points to a production connection string pattern.

### 16.8 Startup Validation

The backend must refuse to start if:

| Check | Action on fail |
|---|---|
| `SANDBOX_MODE=true` AND `DATABASE_URL` contains `prod` or `production` | Throw and exit |
| `SANDBOX_MODE=true` AND Supabase bucket name does not end with `-sandbox` | Warn loudly or throw |
| `SOLANA_CLUSTER=mainnet-beta` AND `SANDBOX_MODE=true` | Throw and exit |
| `SANDBOX_MODE=true` AND any program ID matches a known mainnet ID | Warn |
| Simulator signing keys missing when `SANDBOX_MODE=true` | Warn — simulator routes will fail |
| `SANDBOX_MODE=false` (production) AND `SOLANA_CLUSTER=devnet` | Warn |

A startup validation service must run before the HTTP server opens.

### 16.9 Records

New models added in Phase 1+ must include:

```prisma
environment     String   @default("sandbox")  // "sandbox" | "production"
network         String   @default("devnet")   // "devnet" | "mainnet-beta"
```

Where applicable, `sandboxScenario String?` for named test scenarios.

---

## Section 17 — Supabase Document Security and Versioning Design

### 17.1 Current Problem

Documents are raw URL strings in multiple models. They are public, unversioned, and untracked.

### 17.2 Document Classification

| Classification | Examples | Retention |
|---|---|---|
| `PUBLIC_DISCLOSURE` | Whitepaper, factsheet | Permanent |
| `CONFIDENTIAL_BUSINESS` | Custody doc, valuation report | 7 years |
| `PERSONAL_IDENTITY` | CNIC, passport, proof of address | Per jurisdiction (typically 5 years) |
| `LEGAL_PRIVILEGED` | Legal opinion, FARD reference | 10 years |
| `REGULATOR_ONLY` | SAR submissions, regulatory case files | Per jurisdiction |

### 17.3 Proposed Document Models

```prisma
model Document {
  id              String    @id @default(uuid())
  classification  String    NOT NULL  // from classifications above
  documentType    String    NOT NULL  // "ID_DOCUMENT" | "PROOF_OF_ADDRESS" | "WHITEPAPER" | ...
  storageKey      String    NOT NULL  // Supabase storage path — NEVER exposed to client
  storageVersion  Int       @default(1)
  supersededById  String?             // FK to next Document version
  hash            String?             // SHA-256, verified server-side from stored object
  mimeType        String    NOT NULL
  sizeBytes       Int       NOT NULL
  environment     String    @default("sandbox")
  network         String    @default("devnet")
  quarantineState String?             // null | "PENDING_SCAN" | "CLEAN" | "QUARANTINED"
  confirmedAt     DateTime?
  retentionUntil  DateTime?
  createdAt       DateTime  @default(now()) @db.Timestamptz(3)

  associations    DocumentAssociation[]
  accessLogs      DocumentAccessLog[]
  reviews         DocumentReview[]
  supersededBy    Document? @relation("DocumentVersions", fields: [supersededById], references: [id])
  priorVersions   Document[] @relation("DocumentVersions")
}

model DocumentAssociation {
  id             String   @id @default(uuid())
  documentId     String
  ownerType      String   // "KycApplication" | "AssetRequest" | "CustodyMandate" | ...
  ownerId        String
  role           String   // "PRIMARY" | "SUPPLEMENTAL" | "SUPERSEDED"
  addedAt        DateTime @default(now())

  document       Document @relation(fields: [documentId], references: [id])

  @@index([ownerType, ownerId])
  @@index([documentId])
}

model DocumentAccessLog {
  id             String   @id @default(uuid())
  documentId     String
  accessorUserId String?
  accessorWallet String?
  ipAddressHash  String?
  purpose        String?  // "REVIEW" | "DOWNLOAD" | "AUDIT"
  accessedAt     DateTime @default(now()) @db.Timestamptz(3)

  document       Document @relation(fields: [documentId], references: [id])

  @@index([documentId])
}

model DocumentReview {
  id             String    @id @default(uuid())
  documentId     String
  reviewerId     String
  decision       String    // "APPROVED" | "REJECTED" | "NEEDS_RESUBMISSION"
  notes          String?
  reviewedAt     DateTime  @default(now())

  document       Document @relation(fields: [documentId], references: [id])
}
```

### 17.4 Upload Flow

```
1. POST /documents/upload-intents
   Body: { ownerType, ownerId, documentType, classification, mimeType, sizeBytes }
   → Backend creates Document (status: unconfirmed), generates Supabase signed upload URL (15 min TTL)
   → Response: { documentId, uploadUrl }

2. Client → PUT <uploadUrl> directly to Supabase

3. POST /documents/:id/confirm
   Body: { hash }
   → Backend calls Supabase service-role to retrieve object metadata
   → Backend computes SHA-256 from stored object (server-side verification — not trusted from client)
   → If hash matches: sets confirmedAt, quarantineState='PENDING_SCAN'
   → Async: outbox event triggers malware scan

4. GET /documents/:id/access-url
   → Backend verifies caller has access (association + role check)
   → Writes DocumentAccessLog
   → Returns signed download URL (5 min TTL — never persisted)
```

### 17.5 Key Rules

- `storageKey` is never returned in any API response
- Signed URLs expire in ≤5 minutes and are not stored in the database
- Server-side checksum verification (not client-supplied hash) is required before `confirmedAt` is set
- Superseded documents retain their `storageKey` and data for audit/retention purposes
- Document deletion is replaced by `retentionUntil + quarantineState = 'DELETED'` soft-delete

---

## Section 18 — Revised Asset Deletion Decision

**Previous decision: KEEP (`DELETE /assets/:id`)**

**Revised decision: REPLACE**

A regulated asset must not be hard-deleted if any of the following are true:
- `Asset.tokenContract` is non-null (on-chain address exists)
- `Asset.deployedAt` is non-null
- Any linked `TokenPurchaseRequest`, `TokenTransferRequest`, `TokenSellListing`, or `TokenBuyIntent` exists
- Any linked `BlockchainTransaction` references this `assetId`
- Any `WorkflowTransition` or `AuditLog` references this entity
- Any on-chain `AssetRegistry` PDA exists for this `factoryAssetId`

**Replacement endpoints**:

```
POST /assets/:id/archive
  → Sets Asset.status = "ARCHIVED"
  → Writes WorkflowTransition + AuditLog
  → Returns 200

DELETE /assets/:id  (restricted)
  → Only allowed if ALL conditions are met:
    1. Asset has no tokenContract
    2. Asset has no deployedAt
    3. Asset has no linked purchase/transfer/listing records
    4. Asset.environment = "sandbox" OR explicit override from PLATFORM_ADMIN
  → Else: returns 409 CONFLICT with explanation
```

**Frontend coordination**: `assets-context.tsx` currently calls `DELETE /assets/:id`. Before adding the guard, confirm the use case — if it is only for undeployed draft assets, the existing behavior may satisfy the restriction already. Test and add the guard as part of the Phase 1 coordination plan (Section 25).

---

## Section 19 — Revised Compliance Rules Decision

**Previous decision: EXTEND**

**Revised decision: EVALUATE → MIGRATE / DEPRECATE**

### 19.1 Current State

`ComplianceRule` is a single global Prisma record with `allowedCountries String[]`. `TransferLimit` is a per-address global limit string.

These do not represent the per-token, per-module on-chain compliance architecture.

### 19.2 Correct Approach

The blockchain is the source of truth for compliance module state. Backend compliance records should mirror, not replace, on-chain module configuration.

Target per-token compliance record (Phase 2+):

```prisma
model TokenComplianceModuleRecord {
  id              String    @id @default(uuid())
  tokenContract   String    NOT NULL
  moduleProgramId String    NOT NULL   // e.g., MOD_COUNTRY_RESTRICT program ID
  moduleStatePda  String?              // on-chain module state PDA
  moduleType      String    NOT NULL   // "MAX_INVESTORS" | "COUNTRY_RESTRICT" | ...
  parameters      Json?                // last known parameters from chain
  isPaused        Boolean   @default(false)
  lastIndexedSlot BigInt?
  lastIndexedAt   DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@unique([tokenContract, moduleProgramId])
}
```

### 19.3 Migration Path

1. Keep `GET /compliance-rules` and `POST /compliance-rules/countries` active — they are used by the frontend compliance manager.
2. Add `POST /assets/:assetId/compliance-modules` (Phase 2) as the new per-token compliance configuration endpoint.
3. In Phase 9: deprecate `/compliance-rules` once the frontend is migrated to per-asset compliance management.
4. Never allow backend compliance records to override on-chain compliance state for a token transfer.

---

## Section 20 — Endpoint Authorization Matrix

For every write or privileged read endpoint, the required authorization:

| Endpoint | JWT Required | Platform Role | Organization Scope | Wallet Ownership | On-Chain Check | Idempotency |
|---|---|---|---|---|---|---|
| `POST /auth/register` | No | None | None | None | None | Email unique |
| `POST /auth/login` | No | None | None | None | None | Yes (rate limit) |
| `PATCH /users/:id/roles` | Yes | PLATFORM_ADMIN | None | None | None | No |
| `POST /assets/deployed` | Yes | ISSUER_OPERATOR or ISSUER_ADMIN | ISSUER org | Caller wallet | None yet (Phase 3: custody check) | `tokenContract` unique |
| `POST /assets/apply` | Yes | ISSUER_OPERATOR | ISSUER org | Caller wallet | None | No |
| `PUT /assets/:id` | Yes | ISSUER_ADMIN or PLATFORM_ADMIN | Asset issuer org | None | None | No |
| `POST /assets/:id/archive` | Yes | ISSUER_ADMIN or PLATFORM_ADMIN | Asset issuer org | None | Verify no on-chain PDA (Phase 3) | No |
| `POST /asset-requests` | Yes | ISSUER_ADMIN or ISSUER_OPERATOR | ISSUER org | Caller wallet | None | No |
| `PATCH /asset-requests/:id/status` | Yes | PLATFORM_ADMIN | None (global admin) | None | Phase 3: custody mandate verified before APPROVED→DEPLOYED | No |
| `POST /kyc/applications` | Yes | INVESTOR | None | Caller wallet == application wallet | None | wallet unique |
| `POST /kyc/applications/:id/approve` | Yes | KYC_PROVIDER | KYC org | None | None | applicationId idempotent |
| `POST /kyc/applications/:id/reject` | Yes | KYC_PROVIDER | KYC org | None | None | No |
| `POST /token-purchase-requests` | Yes | INVESTOR | None | Caller wallet == investorWallet | Phase 4: IRP.preflight | tokenContract+wallet unique per status |
| `PATCH /token-purchase-requests/:id/status` | Yes | Role varies by target status | Varies | None | Phase 4: custody + NAV freshness for APPROVED_FOR_MINT | Status expected-value check |
| `POST /token-transfer-requests` | Yes | INVESTOR | None | Caller wallet == fromWallet | None | No |
| `PATCH /token-transfer-requests/:id/status` | Yes | ISSUER_OPERATOR | Token issuer org | None | None | Status expected-value check |
| `POST /token-listings` | Yes | INVESTOR | None | Caller wallet == sellerWallet | None | No |
| `PATCH /token-listings/:id/status` | Yes | INVESTOR (seller) | None | Caller == sellerWallet | None | Status expected-value check |
| `POST /token-listings/:id/buy-intents` | Yes | INVESTOR | None | Caller wallet == buyerWallet | None | No |
| `PATCH /token-listings/buy-intents/:id/status` | Yes | Role varies by step | Varies | None | None | Status expected-value check |
| `POST /trusted-issuers` | Yes | PLATFORM_ADMIN | None | Caller == PLATFORM_OWNER wallet | None | walletAddress unique |
| `DELETE /trusted-issuers/:id` | Yes | PLATFORM_ADMIN | None | Caller == PLATFORM_OWNER wallet | None | No |
| `POST /blockchain-transactions` | Yes | ISSUER_OPERATOR or system | Loose | None | None | `(network, txHash)` unique upsert |
| `POST /identity-snapshots` | Yes | KYC_PROVIDER | None | None | None | wallet unique per provider |
| `POST /indexed/wallets` | Yes | PLATFORM_ADMIN | None | None | None | walletAddress unique |
| `POST /compliance-rules/countries` | Yes | COMPLIANCE_OFFICER or PLATFORM_ADMIN | None | None | None | Global record upsert |
| `PATCH /issuance-requests/:id/status` | Yes | TOKEN_CONTROLLER | None | None | None | Status expected-value check |
| `PATCH /issuance-requests/:id/mint` | Yes | ISSUER_OPERATOR | None | None | None | txHash unique |

**Note**: Do not add guards until the frontend coordination plan in Section 25 is followed for each affected route.

---

## Section 21 — Phase 1 Exact File Plan

Phase 1 creates only the foundation models and infrastructure. No existing behavior changes.

### New files to create:

```
backend/src/organizations/
  organizations.module.ts
  organizations.controller.ts
  organizations.service.ts
  dto/create-organization.dto.ts
  dto/update-organization.dto.ts

backend/src/wallets/
  wallets.module.ts
  wallets.service.ts          ← WalletResolutionService (dual-read)
  dto/register-wallet.dto.ts

backend/src/roles/
  roles.module.ts
  roles.service.ts             ← PlatformRoleAssignment CRUD
  dto/assign-role.dto.ts

backend/src/authority-bindings/
  authority-bindings.module.ts
  authority-bindings.service.ts

backend/src/workflows/
  workflows.module.ts
  workflows.service.ts         ← WorkflowTransitionService
  (no controller — write-only service, reads via existing entity endpoints)

backend/src/audit/
  audit.module.ts
  audit.service.ts             ← AuditLogService

backend/src/outbox/
  outbox.module.ts
  outbox.service.ts            ← OutboxEventService (writer)
  outbox.worker.ts             ← OutboxWorker (processor, @nestjs/schedule cron)
```

### Existing files to modify:

```
backend/prisma/schema.prisma
  → Add: Organization, OrganizationMember, WalletAccount, OrganizationWallet,
          PlatformRoleAssignment, OnChainAuthorityBinding, WorkflowTransition,
          AuditLog, OutboxEvent
  → Extend: BlockchainTransaction (add network field + unique constraint),
             TrustedIssuer (add fidAddress String?)
  → Do NOT remove: User.walletAddress (dual-read compatibility)
  → Do NOT remove: User.roles (dual-read compatibility)

backend/prisma/migrations/
  → New additive migration only — generated by `prisma migrate dev --name phase1_foundation`

backend/src/app.module.ts
  → Add: OrganizationsModule, WalletsModule, RolesModule, AuthorityBindingsModule,
          WorkflowsModule, AuditModule, OutboxModule
  → Do NOT add: IssuanceRequestsModule, IndexerModule (deferred)

backend/src/asset-requests/asset-requests.service.ts
  → updateStatus: add WorkflowTransition write inside $transaction

backend/src/token-purchase-requests/token-purchase-requests.service.ts
  → updateStatus, updateStatus (all variants): add WorkflowTransition write

backend/src/token-transfer-requests/token-transfer-requests.service.ts
  → updateStatus: add WorkflowTransition write

backend/src/token-listings/token-listings.service.ts
  → updateListingStatus, updateBuyIntentStatus: add WorkflowTransition write

backend/src/modules/kyc/services/kyc-application.service.ts
  → approve, reject, update: add WorkflowTransition write

backend/src/issuance/issuance.service.ts
  → updateStatus, markMinted: add WorkflowTransition write

backend/src/blockchain-transactions/blockchain-transactions.service.ts
  → record: change from INSERT to UPSERT on (network, txHash)
  → Add network field to RecordBlockchainTransactionDto

backend/src/trusted-issuers/trusted-issuers.service.ts
  → create: accept fidAddress field

backend/src/main.ts
  → Restrict CORS to known frontend origins via environment variable
  → Add startup validation service call

backend/src/common/guards/
  → (no new guards in Phase 1 — see Section 25)

backend/src/common/services/
  → wallet-resolution.service.ts (shared across modules)
  → startup-validation.service.ts
```

### New Prisma migration content (Phase 1):

```sql
-- All changes are additive. No DROP, no ALTER COLUMN TYPE, no NOT NULL without DEFAULT.

CREATE TABLE Organization (...);
CREATE TABLE OrganizationMember (...);
CREATE TABLE WalletAccount (...);
CREATE TABLE OrganizationWallet (...);
CREATE TABLE PlatformRoleAssignment (...);
CREATE TABLE OnChainAuthorityBinding (...);
CREATE TABLE WorkflowTransition (...);
CREATE TABLE AuditLog (...);
CREATE TABLE OutboxEvent (...);

ALTER TABLE "BlockchainTransaction" ADD COLUMN IF NOT EXISTS network TEXT NOT NULL DEFAULT 'devnet';
ALTER TABLE "TrustedIssuer" ADD COLUMN IF NOT EXISTS "fidAddress" TEXT;

-- Deferred to backfill script (not migration):
-- INSERT INTO WalletAccount SELECT ... FROM "User" WHERE "walletAddress" IS NOT NULL;
-- INSERT INTO PlatformRoleAssignment SELECT ... FROM "User" WHERE roles @> ARRAY['admin'];
```

---

## Section 22 — Non-Destructive Migration Sequence

1. Take full database backup.
2. Take schema-only dump and save to `docs/db_schema_before_phase1.sql`.
3. Run `prisma db pull` on sandbox copy — compare with `schema.prisma`.
4. Resolve any drift findings before running migration.
5. Run `prisma migrate deploy` in sandbox — verify output: all 3 existing + 1 new migration applied.
6. Verify row counts on all existing tables are unchanged.
7. Run backfill scripts (wallet, role) in a transaction — verify no duplicates with `SELECT count(*) ... GROUP BY ... HAVING count(*) > 1`.
8. Run Phase 1 integration test suite.
9. Run on staging database.
10. Run on production database (after staging sign-off).
11. Save `docs/db_schema_after_phase1.sql`.

---

## Section 23 — Frontend Coordination Plan for Guards

Adding guards without frontend preparation will break the platform. Follow this sequence for each affected route:

| Route | Frontend Consumer | JWT Currently Sent? | Step |
|---|---|---|---|
| `POST /asset-requests` | `issuer/submit-request/page.tsx` | Unknown — needs verification | 1. Confirm JWT header presence. 2. Add JWT guard. 3. Add role guard (ISSUER_OPERATOR). 4. Test with a live issuer wallet session. |
| `PATCH /asset-requests/:id/status` | `issuer/page.tsx`, `issuance-form.tsx` | Unknown | Same flow |
| `POST /token-purchase-requests` | `investor/request-form/page.tsx` | Unknown | Add JWT + INVESTOR role |
| `PATCH /token-purchase-requests/:id/status` | Issuer, claim-provider pages | Unknown | Role varies by transition — add role map |
| `PATCH /token-purchase-requests/:id/resume-after-identity` | `investor/identity/page.tsx` | Unknown | JWT + INVESTOR (caller == investorWallet) |
| `POST /token-transfer-requests` | `transfer/page.tsx`, `investor/[id]` | Unknown | JWT + INVESTOR |
| `PATCH /token-transfer-requests/:id/status` | Issuer, claim-provider | Unknown | Role varies by step |
| `POST /token-listings` | `investor/[id]` | Unknown | JWT + INVESTOR |
| `PATCH /token-listings/:id/status` | `investor/[id]` | Unknown | JWT + INVESTOR (seller check) |
| `POST /kyc/applications` | `kyc-api.ts` | Unknown | JWT + INVESTOR |
| `POST /kyc/applications/:id/approve` | `kyc-api.ts` | Unknown | JWT + KYC_PROVIDER |
| `POST /assets/deployed` | `issuance-form.tsx` (via proxy) | Unknown | JWT + ISSUER_OPERATOR |
| `POST /blockchain-transactions` | `lib/blockchain-transactions.ts` | Unknown | JWT (any authenticated user) |

**For each route, before enabling the guard**:

1. Add `console.log` or Datadog trace to confirm current JWT header presence in production traffic.
2. Update frontend to include `Authorization: Bearer <token>` header if missing (using existing `apiFetch` wrapper).
3. Deploy frontend change first.
4. Deploy backend guard second.
5. Monitor for 401 errors in first 30 minutes.
6. Add regression test confirming the existing authorized flow works end-to-end.

---

## Section 24 — Phase 1 Testing Plan and Acceptance Criteria

### Database

- [ ] Phase 1 migration applies to a populated sandbox copy without error.
- [ ] Zero rows deleted from any existing table after migration.
- [ ] `WalletAccount` backfill creates no duplicate `(publicKey, network)` pairs.
- [ ] `PlatformRoleAssignment` backfill maps every existing `User.roles` entry correctly.
- [ ] `User.walletAddress` and `User.roles` remain readable after migration (dual-read).
- [ ] All new foreign keys pass integrity check (`SELECT count(*) FROM ... WHERE FK IS NOT NULL AND FK NOT IN (...)` returns 0).
- [ ] Migration can be verified by taking a schema dump and comparing to expected.

### Authentication and Authorization

- [ ] `PATCH /users/:id/roles` — unauthenticated request → 401.
- [ ] `PATCH /users/:id/roles` — non-admin JWT → 403.
- [ ] `PATCH /users/:id/roles` — admin JWT → 200.
- [ ] After guard is added: `POST /asset-requests` — unauthenticated → 401.
- [ ] After guard is added: `PATCH /token-purchase-requests/:id/status` — wrong role → 403.
- [ ] Frontend authorized flows continue to return 200 after guard additions.
- [ ] No user can assign themselves PLATFORM_ADMIN via any public endpoint.

### WorkflowTransition

- [ ] `PATCH /asset-requests/:id/status` creates exactly one `WorkflowTransition` row with correct `fromStatus`, `toStatus`, `entityId`.
- [ ] Retrying the same status update (idempotent case) does not create a duplicate transition.
- [ ] `WorkflowTransition` rows are never deleted — test with direct DB query after transition.
- [ ] Status update and transition fail atomically: if transition insert fails, status update is rolled back.

### Optimistic Concurrency

- [ ] Two simultaneous `PATCH /token-purchase-requests/:id/status` requests with conflicting `fromStatus` → one succeeds with 200, one returns 409.

### BlockchainTransaction Idempotency

- [ ] `POST /blockchain-transactions` with same `(network, txHash)` twice → second call returns existing record (upsert), no duplicate row.
- [ ] Existing `BlockchainTransaction` rows remain intact after migration.
- [ ] Fee/rent Lamport fields remain populated.

### Outbox

- [ ] Status change event writes OutboxEvent in same transaction.
- [ ] OutboxWorker picks up PENDING events and processes them.
- [ ] Failed event is retried up to 5 times with exponential backoff.
- [ ] Event with 5 failures is marked DEAD and does not retry.
- [ ] DONE event is never reprocessed.

### CORS

- [ ] Request from configured frontend origin → response includes correct `Access-Control-Allow-Origin`.
- [ ] Request from unconfigured origin → 403 or no CORS headers.
- [ ] `CORS_ALLOWED_ORIGINS` env var controls the allow-list.

### Regression (All existing flows must continue to work)

- [ ] User registration and login
- [ ] JWT refresh
- [ ] Asset application (`POST /asset-requests`)
- [ ] Token deployment record (`POST /assets/deployed`)
- [ ] KYC application submission and admin approval
- [ ] Purchase request submission and issuer status update
- [ ] IRS whitelist and activation txHash recording
- [ ] Token mint txHash recording
- [ ] Transfer request submission and status flow
- [ ] Marketplace listing and buy-intent creation
- [ ] Trusted issuer create and delete
- [ ] Indexed asset list and token balance queries
- [ ] Blockchain transaction recording
- [ ] Activity log read
- [ ] Old issuance-requests (GET + POST) from `issue-more-tokens.tsx` and homepage

---

## Section 25 — Indexer Investigation (Pre-Reconnection)

**Before IndexerModule is reconnected, answer these questions**:

1. Review `backend/src/indexer/indexer.runner.ts` — does a runner exist? Is it decorated with `@Cron` or does it require manual invocation?
2. Check if any external process (shell script, systemd service, Docker cron container) calls `syncOnce` via an HTTP endpoint or direct Node invocation.
3. Verify that `IndexerModule` was intentionally removed from `AppModule` (not an accidental omission) — check git history if available.
4. Check whether `IndexerService.syncOnce` is safe to call concurrently (is it idempotent? Does it use database locking?).
5. Decide: run indexer inside API process (simple, single deployment) or as a separate worker process (recommended for production — avoids competing with HTTP request handling).

**Do not reconnect until these are answered.**

---

## Section 26 — Known Unknowns and Required Approvals

### Questions Requiring Contract Team Answer

1. What instruction creates or updates `OfferingTermsView` in `fracks-factory`? (Blocker for Phase 4 purchase flows)
2. Does `fracks-factory.create_custody_mandate` CPI into `fracks-asset-registry`? Which program is canonical for custody state? (Blocker for Phase 3)
3. Is `IssuerOrAdminMutateAsset` constraint intentionally restricted to issuer only? (Affects admin tooling in Phase 3)
4. Is on-chain governance vote weight verification planned in a future contract upgrade? (Affects Phase 6 governance backend design)
5. Is `fracks-trade-escrow` intended only as a status ledger, or will token/SOL custody be added?

### Items Requiring User Approval Before Phase 1

1. Confirm the final role list is correct and complete.
2. Confirm that `Organization.type` covers all anticipated org types.
3. Confirm the `WalletAccount` dual-read migration strategy (keep `User.walletAddress` until Phase 9).
4. Confirm the outbox worker will run inside the API process vs. as a separate worker.
5. Confirm `SANDBOX_MODE` env var approach and database isolation level (separate DB vs. `environment` column).
6. Confirm the frontend guard coordination plan timing (when JWT headers will be verified).
7. Confirm the Supabase storage bucket naming convention for sandbox isolation.
8. Approve or revise the Phase 1 exact file list before any code is written.

---

## Summary

### Files Inspected

All 16 controllers, 19 modules, 18 services, 3 guards, `schema.prisma`, 3 Prisma migrations, 14 manual SQL migrations, 30+ frontend files, Next.js API proxy routes, `backend/.env`.

### Route Count

**74 runtime routes** across 17 controllers in 16 registered modules.  
**7 source-only routes** exist in `IssuanceRequestsModule` which is not imported — these are not live.  
Previous count of ~78 was incorrect.

### Migration Count

**17 total migration files** — 3 Prisma-managed, 14 manual SQL. Substantial overlap between manual migrations and Prisma migrations. Manual migration 004 may have created a legacy snake_case `issuance_requests` table that coexists with the Prisma-managed `"IssuanceRequest"` table — requires live database inspection to confirm.

### Main Inconsistencies Resolved

- Runtime vs. source route count discrepancy: `IssuanceRequestsModule` not imported (7 dead routes)
- Old `/issuance-requests` still used by 2 frontend consumers — must not be removed yet
- `IndexerService.syncOnce()` has no runner — indexed data is stale
- Manual migration 015 contains a large backfill INSERT that overlaps with Prisma migration `latest_schema`

### Main Security Gaps

- 32 of 74 runtime routes have no authentication guard ⚠️
- CORS is `app.enableCors()` — no origin restrictions
- JWT secrets in `.env` are short non-production values
- `User.roles` is a mutable string array with no guard-level role transition validation
- `TrustedIssuers` routes rely only on wallet signature with no JWT identity

### Main Contract Blockers

1. `OfferingTermsView` creation unknown — Phase 4 purchase flows are blocked
2. Custody duplication (factory vs. asset-registry) unresolved — Phase 3 deployment blocked
3. Vote weight not verified on-chain — governance backend must enforce snapshot-locking

### Phase 1 Proposed Scope

Add `Organization`, `OrganizationMember`, `WalletAccount`, `OrganizationWallet`, `PlatformRoleAssignment`, `OnChainAuthorityBinding`, `WorkflowTransition`, `AuditLog`, `OutboxEvent` models as a single additive migration. Wire `WorkflowTransition` writes into all existing status-change service methods. Fix `BlockchainTransaction` idempotency. Restrict CORS. No destructive changes. No guard additions until frontend coordination is confirmed.

### Requires User Approval

8 items listed in Section 26 require explicit approval before Phase 1 code is written.
