# FRACKS — Real Estate Tokenization: Sandbox Implementation Plan

Version 1.0 — June 13 2026 Prepared for internal team use before next regulator engagement Status: Planning — team to implement

---

## Context

Pakistani regulators asked how FRACKS handles 11 specific real estate tokenization scenarios. We answered all 11 and identified 8 additional gaps they did not raise. Before the next regulatory meeting we need a working sandbox on Solana testnet that demonstrates every answer live.

**Scope of this document:**

- Full agent/role ecosystem (who does what on the platform)  
- Custodian onboarding module (no physical custody — platform-managed custodian registration)  
- What gets built in the protocol (Solana programs)  
- What gets built in the frontend (Next.js)  
- What gets simulated as sandbox mocks (fake NADRA, bank, PLRA, etc.)  
- Four implementation phases with clear scope per phase

**What already exists on testnet and must NOT be changed:**

| Program | Used For |
| :---- | :---- |
| `fracks_fid`, `fracks_irp`, `fracks_irs` | All investor \+ agent identity |
| `fracks_tir`, `fracks_ctr` | Trusted issuers \+ claim topics — all roles live here |
| `fracks_token` | Token minting, transfer, freeze, recovery, pause |
| `fracks_compliance` \+ 8 modules | All transfer compliance rules |
| `fracks_factory` | Token suite deployment |
| NestJS backend, Prisma, PostgreSQL | All sandbox services extend this |
| Next.js frontend | All new UI extends this |

---

## Part 1: Agent and Role Ecosystem

Every participant in a FRACKS real estate tokenization has a defined role. Some roles are enforced on-chain (the protocol itself checks), others are platform-level (backend checks), and some are off-chain (document-level only).

### 1.1 Full Agent Table

| Agent | On-Chain Role | Platform Role | What They Do |
| :---- | :---- | :---- | :---- |
| **Platform Admin** | Owner of FactoryState \+ Squads upgrade authority | Super-admin in backend | Protocol upgrades, emergency controls, add/remove global claim issuers |
| **Regulator** (PVARA / SECP / SBP) | Emergency multi-sig key — can invoke `pause()`, `forced_transfer()`, `freeze_wallet()` | Read-only regulatory dashboard | Oversight, emergency freeze, access to full audit trail |
| **Issuer** | OwnerState PDA per token (`["owner", token_mint]`) | Issuer account in backend, verified via business KYC | Lists property, deploys token suite via factory, mints tokens, declares distributions, configures compliance modules |
| **Custodian** | FID with claim topic `CUSTODIAN_AUTHORITY` registered in TIR | Custodian account in backend, onboarded via custodian module | Holds physical title documents \+ SPV management authority. Signs proof-of-custody attestations on-chain. No physical custody of assets — custody of the legal/document layer |
| **Valuer** | FID with claim topic `VALUATION_AUTHORITY` registered in TIR | Valuer account in backend | Signs `attest_valuation()` transactions on-chain. SECP-approved. Periodic and event-triggered revaluation |
| **KYC Provider / Claim Issuer** | FID registered in TIR with allowed claim topics (KYC=1, AML=2, Accreditation=3) | KYC provider account | Issues signed claims to investor FIDs after off-chain identity verification. Revokes claims on expiry or compliance event |
| **Property Manager** | Agent PDA (`["agent", token_mint, agent_pubkey]`) — for declaring distributions | Property manager account in backend | Day-to-day property operations: tenant management, rent collection, maintenance. Declares rental distributions on the platform |
| **Compliance Officer (MLRO)** | Platform-level role (backend gated) — can approve `recover()` and succession transfers | Compliance officer account | Reviews STRs, approves wallet recovery requests, approves succession claims, EDD decisions |
| **Investor / Token Holder** | Holds tokens, has FID with required claims | Investor account | Buys tokens, receives rental income, votes on governance proposals, sells on secondary market |
| **Institutional Liquidity Provider (PLF)** | Wallet with `InstitutionRole` (elevated `mod_max_balance` cap, set by token Owner) | Institution account in backend | Provides Quick Exit liquidity. Buys tokens at NAV-2%, holds inventory, sells on secondary market |
| **Construction Certifier** | FID with claim topic `CONSTRUCTION_AUTHORITY` registered in TIR | Certifier account in backend | Signs `attest_milestone()` transactions for under-construction properties. Licensed structural engineering firm |
| **Shariah Board** | FID with claim topic `SHARIAH_AUTHORITY` registered in TIR | Shariah board account | Signs Shariah certification for Islamic instruments. AAOIFI-recognized board |
| **Legal Counsel** | Off-chain only — no on-chain role | Registered in backend as document verifier | Produces legal opinion on property title. Opinion hash stored in Asset Registry. No signing authority on-chain |

### 1.2 How Roles Are Assigned On-Chain

All roles except platform admin and regulator flow through `fracks_tir` (Trusted Issuers Registry):

Each role \= a claim topic ID

Each agent \= a FID registered in TIR with allowed\_topics for their role(s)

Claim Topics:

  1 \= KYC (investor identity)

  2 \= AML (investor AML clearance)

  3 \= ACCREDITATION (investor eligibility)

  4 \= CUSTODIAN\_AUTHORITY

  5 \= VALUATION\_AUTHORITY

  6 \= CONSTRUCTION\_AUTHORITY

  7 \= SHARIAH\_AUTHORITY

  8 \= PROPERTY\_MANAGER\_AUTHORITY

When a Valuer wants to submit a valuation, the protocol checks: does the signer hold a FID registered in TIR with `allowed_topics` containing topic `5`? If yes, the valuation is accepted. If no, it is rejected. Same pattern for all roles.

This means adding a new agent type to the protocol requires only:

1. Define a new claim topic ID  
2. Register the agent's FID in TIR with that topic  
3. Gate the relevant instruction to check for that topic

No code changes needed for adding new agent types — the TIR architecture handles it.

---

## Part 2: Custodian Module

### 2.1 What Custodian Means Here

FRACKS will not physically hold or manage properties. Instead, a licensed third-party custodian takes responsibility for:

- Holding the physical title documents (Fard, Sale Deed, Mutation record) in a secure environment  
- Managing or co-managing the SPV that legally owns the property  
- Attesting on-chain that the property exists, is in their custody, and matches the token's declared state  
- Signing off on redemption events (when the property is sold or tokens are redeemed)

The custodian is the link between the physical asset world and the on-chain token world. Without a custodian attestation, a property cannot be tokenized.

### 2.2 Custodian Onboarding Flow (Mirrors Issuer Onboarding)

**Step 1 — Business registration verification:**

- Company name, SECP company registration number  
- Business license / relevant regulatory approvals  
- Proof of insurance (for document custody)  
- Named authorized signatories (individuals who will sign transactions)  
- UBO disclosure (full beneficial ownership chain)

**Step 2 — Signatory KYC:**

- Each authorized signatory completes full KYC (CNIC \+ NADRA Verisys \+ liveness)  
- FRACKS FID created for each signatory  
- A custodian entity FID is created representing the organization

**Step 3 — Custodian registration in TIR:**

- Custodian entity FID is registered in the global TIR with `allowed_topics = [4]` (CUSTODIAN\_AUTHORITY)  
- Platform Admin countersigns — custodian cannot self-register

**Step 4 — Custodian mandate setup:**

- For each property they will custody, the Issuer links the custodian FID to that property's Asset Registry PDA (`custodian_fid` field)  
- The custodian receives a notification and must accept the mandate on-chain (`accept_custody_mandate(asset_id)`)

**Step 5 — Custodian portal access:**

- Custodian gets access to their dashboard showing all properties under their mandate  
- Can submit attestations, view token activity, receive alerts

### 2.3 What Custodian Can Do On-Chain

| Instruction | Who Can Call | What It Does |
| :---- | :---- | :---- |
| `attest_custody(asset_id, document_hash, attestation_sig)` | Custodian FID | On-chain record that the custodian confirms physical possession of title documents. Required before tokenization can proceed. |
| `attest_reserve(asset_id, reserve_ratio, attestation_sig)` | Custodian FID | Periodic confirmation that the underlying asset is still intact and matches the token supply (100% reserve per VAA s.53) |
| `accept_custody_mandate(asset_id)` | Custodian FID | Custodian formally accepts responsibility for a new property |
| `release_custody_mandate(asset_id, reason)` | Custodian FID (with 30-day notice) OR Platform Admin (emergency) | Custodian exits a property mandate — triggers alert to issuer and platform admin to appoint replacement |
| `sign_redemption_event(asset_id, redemption_id)` | Custodian FID | Custodian countersigns a redemption instruction (property sale proceeds → token holders) |

### 2.4 Custodian Portal (Frontend)

| Page | What It Shows / Does |
| :---- | :---- |
| Dashboard | All properties under mandate: address, token supply, last attestation date, status |
| Pending mandates | Properties assigned to this custodian awaiting acceptance |
| Attestation panel | Submit custody attestation or periodic reserve attestation for a property. Upload document hash. Sign and submit on-chain. |
| Document vault | List of all document hashes submitted for each property (immutable audit trail) |
| Redemption queue | Pending redemption events requiring custodian sign-off |
| Mandate history | Full history of accepted, active, and released mandates |

### 2.5 Rules Around Custodian

- **Mandatory before tokenization:** `attest_custody()` must be called and confirmed before `deploy_token_suite()` can proceed. The factory instruction checks for the custodian attestation PDA.  
- **Periodic attestation required:** Asset Registry has a `custody_attestation_expiry` field. If it lapses, token transfers are blocked (`ERR_CUSTODY_LAPSED`). Default: 90-day validity window.  
- **Cannot be self-issued:** The issuer cannot also be the custodian for the same property. Protocol enforces: `custodian_fid != issuer_fid`.  
- **Replacement process:** If a custodian exits, the token is paused until a replacement custodian accepts the mandate. Token holders are notified.  
- **One custodian per property (at launch):** Multiple custodians (for large portfolios or international properties) is a Phase 4 consideration.

---

## Part 3: Implementation Phases

---

### Phase 1 — Core Property Lifecycle (Sandbox MVP)

**What the regulator sees:** A property gets listed and verified. An investor signs up, verifies their identity, pays, receives tokens. Rental income arrives. Custodian attests the property exists.

**Regulator points answered:** 1, 4, 6, 7, 8, 11 \+ Custodian module

---

#### Protocol Changes (Smart Contract)

| \# | Change | Detail |
| :---- | :---- | :---- |
| P1-01 | New program: `fracks_asset_registry` | Core property metadata PDA per token. Fields: `fard_ref`, `spv_secp_reg`, `province`, `whitepaper_hash`, `legal_opinion_hash`, `custodian_fid`, `custody_attestation_date`, `custody_attestation_expiry`, `valuer_fid`, `current_nav`, `nav_date`, `nav_validity_days`, `lifecycle_state`, `title_dispute_flag`, `encumbrance_flag`, `insurance_policy_hash`, `beneficial_owner_hash` |
| P1-02 | New instruction: `attest_custody(asset_id, doc_hash, sig)` | Custodian signs physical title document hash on-chain. Prerequisite for tokenization. |
| P1-03 | New instruction: `attest_valuation(asset_id, nav, methodology_hash, sig)` | Valuer signs NAV update on-chain. |
| P1-04 | Modify `deploy_token_suite()` in factory | Add check: custody attestation PDA must exist before deployment succeeds |
| P1-05 | Stale NAV pre-check in `fracks_token.transfer()` | If `current_nav` is older than `nav_validity_days` AND transfer size \> threshold, return `ERR_STALE_VALUATION` |
| P1-06 | Custody lapse check in `fracks_token.transfer()` | If `custody_attestation_expiry` has passed, return `ERR_CUSTODY_LAPSED` |
| P1-07 | New claim topics 4-8 in `fracks_ctr` config | CUSTODIAN (4), VALUATION (5), CONSTRUCTION (6), SHARIAH (7), PROPERTY\_MANAGER (8) |
| P1-08 | New instruction: `accept_custody_mandate(asset_id)` | Custodian formally accepts a property |
| P1-09 | New instruction: `attest_reserve(asset_id, ratio, sig)` | Periodic reserve attestation by custodian |
| P1-10 | Yield Engine (basic): `declare_distribution(asset_id, gross, net, record_slot)`, `claim_distribution(asset_id, dist_id)` | Issuer/property manager declares rental income. Holders claim their share. |

---

#### Frontend Changes

| \# | Page / Component | Detail |
| :---- | :---- | :---- |
| F1-01 | Issuer onboarding portal | Company KYC, document upload (Fard, deed, SPV reg, legal opinion), property details form, submit for admin review |
| F1-02 | Custodian onboarding portal | Business KYC, signatory CNIC verification, mandate acceptance flow — mirrors issuer onboarding |
| F1-03 | Custodian dashboard | All mandated properties, attestation status, submit attestation button, document vault |
| F1-04 | Property listing page | Whitepaper display, current NAV \+ date \+ staleness indicator, custodian name \+ attestation status, valuer name, mandatory acknowledgment checkbox before purchase |
| F1-05 | Primary purchase flow | Select amount → payment initiated → status tracker (pending → bank confirmed → tokens in wallet) |
| F1-06 | Investor portfolio | Holdings per property, NAV, unrealized gain/loss, rental income received to date |
| F1-07 | Rental income view (investor) | Per-distribution breakdown: gross, deductions, net received, TDS certificate download |
| F1-08 | Distribution declaration panel (property manager / issuer) | Input gross rental, deductions, net amount → submit → triggers on-chain distribution event |
| F1-09 | Valuer portal | List of properties assigned, submit valuation attestation (NAV \+ methodology document \+ on-chain signature) |

---

#### Sandbox Simulations (All in NestJS as separate modules)

| \# | Mock Service | What It Simulates | How |
| :---- | :---- | :---- | :---- |
| S1-01 | **NADRA Simulator** | NADRA Verisys identity verification | PostgreSQL table of 30 test identities (CNIC, name, DOB, address, status). `POST /sandbox/nadra/verify` returns identity or error |
| S1-02 | **Bank Payment Simulator** | Bank payment processing \+ on-the-spot account creation | `POST /sandbox/bank/create-account` creates virtual account. `POST /sandbox/bank/initiate-payment` creates payment record, waits 5 seconds (configurable), sends webhook to backend confirming payment cleared |
| S1-03 | **Valuer Simulator** | SECP-approved valuer signing valuations | NestJS module with a test ed25519 keypair (FID pre-registered in TIR). `POST /sandbox/valuer/attest` signs and submits `attest_valuation()` to testnet |
| S1-04 | **PLRA / Property Registry Simulator** | Punjab land registry Fard lookup | PostgreSQL table of 10 test properties (Fard number, owner CNIC, address, area, status, encumbrance flag). `GET /sandbox/plra/fard/:number` returns property data |
| S1-05 | **Custodian Simulator** | Licensed custodian attestation signing | Test custodian FID pre-registered in TIR. `POST /sandbox/custodian/attest` signs and submits `attest_custody()` and `attest_reserve()` to testnet |

---

### Phase 2 — Governance \+ Secondary Market \+ Quick Exit

**What the regulator sees:** Minority protections in action. A voting proposal is created, holders vote, it executes. Two investors trade tokens on secondary market. A holder exits fast via Quick Exit and receives payment within minutes.

**Regulator points answered:** 2, 9, 10

---

#### Protocol Changes

| \# | Change | Detail |
| :---- | :---- | :---- |
| P2-01 | New program: `fracks_governance` | `GovernanceState` PDA per token (`["gov", token_mint]`): stores quorum config, thresholds per proposal type. `Proposal` PDA (`["proposal", gov_pubkey, proposal_id]`): description\_hash, type, threshold, quorum, end\_slot, yes\_votes, no\_votes, status. `VoteRecord` PDA (`["vote", proposal_id, voter]`): choice, weight (from balance snapshot) |
| P2-02 | Instructions in `fracks_governance` | `create_proposal()`, `cast_vote()`, `execute_proposal()`, `cancel_proposal()` |
| P2-03 | Balance snapshot at proposal creation | `snapshot_balances(proposal_id)` — captures holder balances at creation slot to prevent vote manipulation |
| P2-04 | Trade Escrow PDA | `["trade_escrow", trade_id]`. Instructions: `initiate_trade(token_amount, price_per_token)`, `lock_tokens(trade_id)`, `confirm_buyer_payment(trade_id)`, `settle_trade(trade_id)`, `cancel_trade(trade_id)` |
| P2-05 | Institution role | Owner can call `grant_institution_role(wallet)` — sets an elevated `mod_max_balance` exception for that wallet. Used for PLF institution. |
| P2-06 | `release_custody_mandate()` instruction | Custodian can exit a mandate. Triggers `pause()` on the token until replacement custodian accepts. |

---

#### Frontend Changes

| \# | Page / Component | Detail |
| :---- | :---- | :---- |
| F2-01 | Governance portal | Active proposals list (description, type, threshold, vote tally bar, time remaining). Create proposal button (holders ≥1% stake). Cast vote (yes/no/abstain). Proposal history. |
| F2-02 | Holder distribution chart | On each property page: pie/bar chart of top holders by %, showing which governance thresholds they individually can or cannot reach |
| F2-03 | Secondary market | Browse sell orders per property. Buy flow: locks tokens in trade escrow → initiates bank payment → auto-settles on payment confirmation. List your own tokens for sale. |
| F2-04 | Quick Exit UI | "Sell Fast" button on portfolio. Shows: current NAV × 98% \= your proceeds. Enter quantity. Confirm. Status bar: requested → institution buying → fiat on the way → complete |
| F2-05 | NAV widget (global component) | Shown on every property page and trade screen. Current NAV, last updated, days until staleness. Green (fresh) / yellow (aging) / red (stale — trades blocked) |
| F2-06 | Custodian mandate management | Custodian can view and release mandates (with 30-day notice). Release triggers platform alert and token pause notification to holders. |

---

#### Sandbox Simulations

| \# | Mock Service | What It Simulates | How |
| :---- | :---- | :---- | :---- |
| S2-01 | **PLF Institution Simulator** | Institutional credit line partner for Quick Exit | Test institution FID with elevated balance cap. Credit line balance in DB (configurable, e.g. PKR 50M test). On Quick Exit request: checks balance, submits `settle_trade()`, sends mock fiat payment webhook to seller. Reduces credit line balance. Shows "credit line exhausted" when empty. |
| S2-02 | **Secondary Market Test Wallets** | Active secondary market liquidity | 8 pre-seeded test investor wallets with test token balances. Pre-listed sell orders at various prices. Used to demonstrate secondary market depth and DvP settlement. |

---

### Phase 3 — Hard Scenarios

**What the regulator sees:** Under-construction property with milestone-based value progression. The inheritance/succession scenario. A court-ordered dispute freeze. A total loss event (property destroyed, insurance triggered).

**Regulator points answered:** 3 (rental edge cases), 5 \+ Gaps 1 (succession), 4 (dispute), 5 (force majeure)

---

#### Protocol Changes

| \# | Change | Detail |
| :---- | :---- | :---- |
| P3-01 | Milestone attestation instruction | `attest_milestone(asset_id, milestone_id, cert_hash, certifier_sig)` in `fracks_asset_registry`. Transitions lifecycle state. Updates NAV. Requires Construction Certifier FID (topic 6). |
| P3-02 | Escrow release instruction | `release_escrow_tranche(asset_id, milestone_id, amount, developer_wallet)` — only callable after `attest_milestone()` for that milestone. Releases developer payment from escrow. |
| P3-03 | Parent-to-child token conversion | `distribute_apartment_tokens(parent_asset_id, [child_asset_ids], [share_ratios])` — burns parent tokens proportionally, distributes child tokens to each holder pro-rata. Called on building completion. |
| P3-04 | Lifecycle states added to Asset Registry | `LAND_ONLY`, `DEVELOPMENT_INITIATED`, `UNDER_CONSTRUCTION`, `MILESTONE_1..N`, `CONSTRUCTION_COMPLETE`, `APARTMENT_DISTRIBUTION`, `ACTIVE`, `PAUSED`, `MATURED`, `REDEEMED`, `TOTAL_LOSS` |
| P3-05 | Succession PDA | `["succession", wallet_pubkey]`. Fields: `death_cert_hash`, `wirasat_hash`, `court_ref`, `status (PENDING / APPROVED / EXECUTED)`. Instructions: `create_succession_claim()`, `approve_succession()` (multi-sig: compliance officer \+ admin), `execute_succession_transfer([heir_wallets], [ratios])` |
| P3-06 | `SUCCESSION_PENDING` wallet flag | Set by compliance officer. Blocks outbound transfers from the wallet. Routes inbound distribution amounts to succession escrow PDA. |
| P3-07 | `title_dispute_freeze(asset_id, court_order_hash)` | Callable by regulator wallet or platform admin. Sets `title_dispute_flag = true` in Asset Registry. All transfers blocked with `ERR_TITLE_DISPUTED`. |
| P3-08 | `lift_dispute_freeze(asset_id)` | Callable by regulator or admin. Clears `title_dispute_flag`. Resumes transfers. |
| P3-09 | `declare_total_loss(asset_id, insurance_claim_hash)` | Transitions asset to `TOTAL_LOSS`. Blocks new transfers. Triggers final distribution then bulk burn. |
| P3-10 | `attest_milestone()` extended for reserve releases | Each milestone attestation also confirms % completion — escrow contract only releases the proportional tranche |

---

#### Frontend Changes

| \# | Page / Component | Detail |
| :---- | :---- | :---- |
| F3-01 | Under-construction property page | Milestone progress bar (foundation → structure → exterior → handover). NAV per milestone. Escrow balance. Developer identity (FID-verified). Construction certifier identity. |
| F3-02 | Milestone submission (issuer/certifier) | Upload completion certificate. Certifier signs on-chain. Triggers escrow release. UI shows funds released to developer after each milestone. |
| F3-03 | Apartment token distribution (investor) | At completion: shows parent token holders their allocation across apartment child tokens. Confirm to receive. Burn parent \+ receive child tokens in one flow. |
| F3-04 | Succession claim portal | For deceased holder's family: submit death certificate (CNIC of deceased), court Wirasat Nama reference. Status tracker: submitted → document review → compliance officer approval → tokens transferred to heirs. |
| F3-05 | Heir onboarding flow | Heirs who don't have FRACKS accounts are guided through KYC \+ FID creation before tokens can transfer to them. |
| F3-06 | Regulatory control panel | Admin/PVARA-facing. Shows all live tokens, flagged properties, active freezes, succession claims. Buttons: freeze property, lift freeze, force pause, emergency forced transfer. Full transaction history export. |
| F3-07 | Total loss workflow (admin) | Declare total loss → upload insurance claim reference → trigger final distribution → confirm bulk burn. Investor-facing: notification of total loss, claim your share of insurance proceeds. |

---

#### Sandbox Simulations

| \# | Mock Service | What It Simulates | How |
| :---- | :---- | :---- | :---- |
| S3-01 | **Construction Certifier Simulator** | Licensed structural engineer signing milestone certificates | Test certifier FID registered in TIR (topic 6). `POST /sandbox/certifier/certify-milestone` signs and submits `attest_milestone()` to testnet |
| S3-02 | **Court / Succession Simulator** | Pakistani civil court Wirasat Nama records | PostgreSQL table of test succession orders: deceased CNIC, court reference, list of heirs \+ Shariah shares. `GET /sandbox/court/wirasat/:reference` returns succession order. Platform calls this to verify family's claim. |
| S3-03 | **Insurance Simulator** | Property insurance claim processing | Test policies table linked to asset IDs. `GET /sandbox/insurance/policy/:asset_id` returns policy. On `declare_total_loss()`: after configurable delay, sends "claim approved" webhook with payout amount. Triggers final distribution in backend. |
| S3-04 | **Shariah Board Simulator** | Islamic instrument certification | Test Shariah board FID registered in TIR (topic 7). `POST /sandbox/shariah/certify` signs Shariah certification attestation and uploads hash to Asset Registry. |

---

### Phase 4 — Production (Post-Sandbox, Post-Regulator Approval)

**Goal:** Replace every simulation with a real integration. Only proceed after regulatory approval and a clean security audit.

| Sandbox Mock | Real Integration | Dependency |
| :---- | :---- | :---- |
| NADRA Simulator | NADRA Verisys API | MOU with NADRA required |
| Bank Payment Simulator | HBL / UBL / Meezan BaaS API | Bank partnership agreement |
| PLRA Simulator | PLRA digital Fard API (Punjab) | MOU with Punjab government. Other provinces: certified document flow. |
| Valuer Simulator | SECP-registered valuer firm API integration | Valuer partnership agreements |
| Custodian Simulator | Real licensed custodian (document management firm or bank custody arm) | Custodian partnership \+ insurance |
| PLF Institution Simulator | Licensed NBFC or bank credit line agreement | Institution partnership \+ SBP/SECP approval |
| Construction Certifier Simulator | Licensed engineering firm integration | Firm partnership |
| Court/Succession Simulator | Platform compliance officer manual workflow (no court API exists) | Internal process \+ legal team |
| Insurance Simulator | Licensed property insurer partnership | Insurance partnership |

**Also in Phase 4:**

- Full security audit by Tier-1 Solana firm before mainnet  
- PVARA sandbox licence application (Phase 1-3 demo is the evidence)  
- Full SPL Token-2022 transfer hook parity (replace `fracks_token` control-plane with native hook path)  
- NRP investor RDA bank integration (Non-Resident Pakistanis via SBP Roshan Digital Account)  
- FBR capital gains reporting integration

---

## Part 4: What Each Phase Proves to Regulators

| Phase | Regulator Questions Answered | Additional Gaps Covered |
| :---- | :---- | :---- |
| Phase 1 | Q1 (ownership verification), Q4 (whitepaper), Q6 (bank payment), Q7 (platform payment), Q8 (valuation), Q11 (digital existence) | Custodian accountability |
| Phase 2 | Q2 (majority/minority rights), Q9 (Quick Exit escrow), Q10 (voting rights) | Institutional liquidity, DvP settlement |
| Phase 3 | Q3 (rental distribution edge cases), Q5 (under-construction) | Shariah inheritance, disputed title, force majeure |
| Phase 4 | All — production-grade | NRP investors, FBR CGT reporting |

---

## Part 5: Open Questions Before Development Starts

| \# | Question | Must Resolve Before | Who |
| :---- | :---- | :---- | :---- |
| OQ-01 | What SECP/PVARA registration does the custodian entity need? Can any licensed document management firm be a custodian or does PVARA need to approve them? | Phase 1 | Legal team |
| OQ-02 | Does the Compliance Officer role need to be a licensed individual (ACAMS/ICA certified)? Or is it the same as the named MLRO? | Phase 1 | Legal team |
| OQ-03 | What is the minimum SECP-approved valuation frequency for real estate? 6-monthly or annual? | Phase 1 | SECP engagement |
| OQ-04 | PLRA API access — is it available via a developer API or only through an MOU? | Phase 1 sandbox | Government engagement |
| OQ-05 | Which bank partner for sandbox simulation? Need their sandbox/test API credentials | Phase 1 sandbox | Business team |
| OQ-06 | For under-construction properties: does the construction escrow need to be held by an SBP-licensed entity or can it be a smart contract escrow? | Phase 3 | SBP / Legal |
| OQ-07 | Is there a court document API for Wirasat Nama records in Pakistan? | Phase 3 | Legal research |
| OQ-08 | Does PVARA require the institutional PLF partner to be separately licensed? | Phase 2 | PVARA engagement |

---

## Part 6: Summary Change List by Category

### Protocol (Solana Programs) — Full List

| ID | Change | Phase |
| :---- | :---- | :---- |
| P1-01 | New program `fracks_asset_registry` with full property metadata PDA | 1 |
| P1-02 | `attest_custody()` instruction | 1 |
| P1-03 | `attest_valuation()` instruction | 1 |
| P1-04 | Factory `deploy_token_suite()` — add custody attestation prerequisite check | 1 |
| P1-05 | `fracks_token.transfer()` — add stale NAV pre-check | 1 |
| P1-06 | `fracks_token.transfer()` — add custody lapse pre-check | 1 |
| P1-07 | New claim topics 4-8 in TIR configuration | 1 |
| P1-08 | `accept_custody_mandate()` instruction | 1 |
| P1-09 | `attest_reserve()` instruction | 1 |
| P1-10 | Yield Engine basic: `declare_distribution()`, `claim_distribution()` | 1 |
| P2-01 | New program `fracks_governance` with GovernanceState, Proposal, VoteRecord PDAs | 2 |
| P2-02 | Governance instructions: `create_proposal()`, `cast_vote()`, `execute_proposal()`, `cancel_proposal()` | 2 |
| P2-03 | `snapshot_balances(proposal_id)` at proposal creation | 2 |
| P2-04 | Trade Escrow PDA \+ instructions: `initiate_trade()`, `lock_tokens()`, `confirm_buyer_payment()`, `settle_trade()`, `cancel_trade()` | 2 |
| P2-05 | `grant_institution_role()` — elevated `mod_max_balance` for PLF wallet | 2 |
| P2-06 | `release_custody_mandate()` instruction \+ auto-pause trigger | 2 |
| P3-01 | `attest_milestone()` instruction in asset registry | 3 |
| P3-02 | `release_escrow_tranche()` instruction | 3 |
| P3-03 | `distribute_apartment_tokens()` — parent-to-child conversion | 3 |
| P3-04 | Extended lifecycle states in Asset Registry | 3 |
| P3-05 | Succession PDA \+ `create_succession_claim()`, `approve_succession()`, `execute_succession_transfer()` | 3 |
| P3-06 | `SUCCESSION_PENDING` wallet flag \+ inbound escrow routing | 3 |
| P3-07 | `title_dispute_freeze()` instruction | 3 |
| P3-08 | `lift_dispute_freeze()` instruction | 3 |
| P3-09 | `declare_total_loss()` instruction | 3 |

### Frontend (Next.js) — Full List

| ID | Page / Component | Phase |
| :---- | :---- | :---- |
| F1-01 | Issuer onboarding portal | 1 |
| F1-02 | Custodian onboarding portal | 1 |
| F1-03 | Custodian dashboard \+ attestation panel | 1 |
| F1-04 | Property listing page with whitepaper \+ acknowledgment | 1 |
| F1-05 | Primary purchase flow with payment status tracker | 1 |
| F1-06 | Investor portfolio page | 1 |
| F1-07 | Rental income view (investor) \+ TDS certificate download | 1 |
| F1-08 | Distribution declaration panel (property manager) | 1 |
| F1-09 | Valuer portal | 1 |
| F2-01 | Governance portal (proposals, voting, history) | 2 |
| F2-02 | Holder distribution chart per property | 2 |
| F2-03 | Secondary market (browse, buy, list for sale, DvP escrow) | 2 |
| F2-04 | Quick Exit UI | 2 |
| F2-05 | NAV staleness widget (global component) | 2 |
| F2-06 | Custodian mandate release flow | 2 |
| F3-01 | Under-construction property page with milestone tracker | 3 |
| F3-02 | Milestone submission portal (certifier/issuer) | 3 |
| F3-03 | Apartment token distribution flow | 3 |
| F3-04 | Succession claim portal | 3 |
| F3-05 | Heir onboarding flow | 3 |
| F3-06 | Regulatory control panel (admin/PVARA) | 3 |
| F3-07 | Total loss workflow | 3 |

### Sandbox Simulations — Full List

| ID | Service | Phase |
| :---- | :---- | :---- |
| S1-01 | NADRA Simulator | 1 |
| S1-02 | Bank Payment Simulator (payments \+ on-the-spot account creation) | 1 |
| S1-03 | Valuer Simulator | 1 |
| S1-04 | PLRA Property Registry Simulator | 1 |
| S1-05 | Custodian Simulator | 1 |
| S2-01 | PLF Institution Simulator (Quick Exit credit line) | 2 |
| S2-02 | Secondary Market Test Wallets | 2 |
| S3-01 | Construction Certifier Simulator | 3 |
| S3-02 | Court / Succession / Wirasat Simulator | 3 |
| S3-03 | Insurance Simulator | 3 |
| S3-04 | Shariah Board Simulator | 3 |

---

*Document maintained by: FRACKS Technical Team* *Next update: After Phase 1 development kickoff*  
