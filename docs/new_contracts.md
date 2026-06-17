# FRACKS New Contract Architecture Notes

This document summarizes the updated contract architecture under `contracts/`. The contracts folder is treated as read-only for integration work unless explicitly approved.

The updated workspace contains 20 Anchor programs. The workspace compile-check passed on WSL with `cargo test --workspace --no-run` and produced test executables for all programs.

## Architecture Summary

The platform has moved from a token/compliance-only model to a full RWA lifecycle model. The new architecture covers custody-gated deployment, legal asset attestations, identity and claim verification, modular compliance, Token-2022 transfer-hook enforcement, purchase/subscription minting, trade status tracking, and governance records.

Core programs:

| Program | Purpose |
| --- | --- |
| `fracks-factory` | Deploys token suites and now enforces custody prerequisites before deployment. |
| `fracks-token` | Main controlled Token-2022 token program: mint, purchase, transfer, burn, freeze, recovery, pause. |
| `fracks-token-hook` | Token-2022 Transfer Hook program that enforces post-transfer compliance mutation. |
| `fracks-fid` | Creates FIDs and stores claims issued to FIDs. |
| `fracks-irs` | Identity Registry Storage: wallet to FID/country mapping and activation state. |
| `fracks-irp` | Identity Registry Proxy: verifies wallet identity and required claims. |
| `fracks-tir` | Trusted Issuer Registry: issuer FIDs trusted for specific claim topics. |
| `fracks-ctr` | Claim Topics Registry: required topics for a token. |
| `fracks-compliance` | Binds compliance modules and dispatches checks/mutations. |
| `fracks-asset-registry` | New legal/RWA asset lifecycle registry. |
| `fracks-trade-escrow` | New secondary trade status ledger. |
| `fracks-governance` | New proposal/vote record ledger. |

Compliance modules:

| Module | Purpose |
| --- | --- |
| `mod-max-investors` | Limits unique holders and tracks holder count. |
| `mod-country-restrict` | Allows only configured country codes. |
| `mod-max-balance` | Caps receiver wallet balance. |
| `mod-max-transfer` | Caps single transfer/mint amount. |
| `mod-lockup` | Blocks movement before a timestamp. |
| `mod-daily-limit` | Tracks per-wallet daily transfer volume. |
| `mod-supply-cap` | Tracks total minted supply against max supply. |
| `mod-country-cap` | Tracks holder count per country against country caps. |

## Devnet Program IDs

| Program | Devnet ID |
| --- | --- |
| `fracks_asset_registry` | `3xoAnJ9DqMxj22XfeUYQdwAy6dbKXHHeXxcLBxAY2Pdx` |
| `fracks_governance` | `4zh7CCxi31GZ48kX2owTUfYvJam18N6rjGS6q7qRgdMP` |
| `fracks_trade_escrow` | `8W8ghNUHsMkeLZjwi6dNk99ij5kbxPSXGGuDnpxv5h44` |
| `fracks_factory` | `FtrzQ1hhjL7vbEPAxLBeLgrmomanSVj9UpV6LLJ5TYFS` |
| `fracks_token` | `6Naj8HsuNdUJQyyzmPssm1mZRDF7F5VMQ91n9QyMoyGj` |
| `fracks_token_hook` | `9JrgWtW4UrQoC3tVQRxWBBEQPjDJ2QFDzAVAvSzGtPJ5` |
| `fracks_fid` | `Fb2roXDWjEaZwWJvxAWJTCRsK4Hy4V64MuCwoGXWMUtW` |
| `fracks_irp` | `HQqgbvfmSzY1yEyhVbyhYqSsbVrRmjUnPmm2nE4ZwRvZ` |
| `fracks_irs` | `CnAZUQ9jFm2eLGA8d8ek1gpLwGc6xZqvnbyJ9s7swbWc` |
| `fracks_tir` | `9bgANehpsEDdgyo5DwpY36wmnPdpCihSiAP9TLoBBf4L` |
| `fracks_ctr` | `8MuWrtbZ1zPzrDhSKPjDd78SMQAMtBuprPnc1Zam1Gig` |
| `fracks_compliance` | `HnJiNrmDeVFZksgEXaQwyVqHXQLRcyqXEksbYhkiPFFV` |
| `mod_max_investors` | `2zfQv7RxmL5BAgXXFagZXBNby4Q41YGH6hnSJAcsXQeU` |
| `mod_country_restrict` | `4ChDAU375yPJXZLG5XqtbbKdirAr3xHU5vnhppUjgu2d` |
| `mod_max_balance` | `HEjNS1GC9nffSdXbi6aQ9WNQBNFyJQBGUshyrSeLpE9j` |
| `mod_max_transfer` | `4gJbGvgnBhJ91gByKNo7eEVmCbsUkK5opyeo3M1VEJsy` |
| `mod_lockup` | `EvDVqTUjs3ZsAUfPQdyVskYCzoPTbWybF5tcBtWYfAuz` |
| `mod_daily_limit` | `5dfHskP5MijaDY2gYsE44CPAuomt1vWgbPdGi62cquoT` |
| `mod_supply_cap` | `6tfb66btx776wdsPS5EHDTwWnvPSLJQje7gFQ4EDGxGc` |
| `mod_country_cap` | `EcLffdKdSsCpNczazKsSeRw7FCN6vVjKAEMH5CZGBndr` |

## End-to-End Deployment Model

The updated deployment is custody-first. Admin approval alone is no longer enough for a complete token suite deployment.

Expected flow:

1. Initialize factory.
2. Issuer creates issuer FID.
3. Custodian and other authorities create FIDs.
4. Platform approves custodian/role authority where required.
5. Create custody mandate for an `asset_id`.
6. Custodian accepts custody mandate.
7. Custodian submits custody attestation and optional reserve attestation.
8. Factory deploys token suite only after custody gate passes.
9. Factory initializes token, CTR, TIR, IRS, IRP, compliance state, and hook extra account metas.
10. Factory transfers suite ownership from admin to issuer.
11. Issuer/agent performs token operations.
12. Investors need active IRS identity and required claims before receiving tokens.

## `fracks-factory`

Factory is now the orchestrator for suite deployment and the first custody gate.

Main instructions:

- `initialize_factory`
- `update_program_ids`
- `transfer_factory_ownership`
- `create_token_mint`
- `approve_platform_authority`
- `revoke_platform_authority`
- `create_custody_mandate`
- `accept_custody_mandate`
- `attest_custody`
- `attest_reserve`
- `release_custody_mandate`
- `sign_redemption_event`
- `deploy_token_suite`

Important state:

- `FactoryState`
- `TokenDeployment`
- `PlatformAuthority`
- `CustodyMandate`
- `CustodyAttestation`
- `RedemptionSignature`

Deployment behavior:

- Validates all derived token-suite PDAs.
- Rejects shared IRS deployments in the current model.
- Rejects if the IRS already exists for this token suite.
- Requires custody mandate to be active and accepted.
- Requires custody attestation to match asset id, mandate, custodian, and custodian FID.
- Requires custody attestation to be non-expired.
- Initializes token, token metadata, CTR, TIR, IRS, IRP, compliance, and hook extra account metas.
- Adds required claim topics and trusted issuers.
- Binds compliance modules.
- Transfers ownership of token, CTR, TIR, IRP, IRS, and compliance from admin to issuer.

Token-2022 mint creation:

- Uses Token-2022.
- Enables Transfer Hook.
- Enables Permanent Delegate with token state PDA.
- Enables Metadata Pointer.
- Token state PDA is mint authority.

## `fracks-asset-registry`

This is the new asset-level legal/RWA lifecycle ledger. It tracks the real-world asset state, legal references, custody, valuation, reserve attestations, title flags, construction milestones, succession records, and redemption event hashes.

Main instructions:

- `initialize_asset_registry`
- `attest_custody`
- `attest_reserve`
- `attest_valuation`
- `accept_custody_mandate`
- `release_custody_mandate`
- `sign_redemption_event`
- `attest_milestone`
- `release_escrow_tranche`
- `distribute_apartment_tokens`
- `set_title_flags`
- `title_dispute_freeze`
- `lift_dispute_freeze`
- `create_succession_claim`
- `approve_succession`
- `execute_succession_transfer`
- `transition_lifecycle`
- `declare_total_loss`

Important state:

- `AssetRegistry`
- `SuccessionClaim`

Important fields:

- asset id and token mint
- issuer and issuer FID
- FARD reference
- SPV SECP registration reference
- province
- whitepaper/legal/insurance/beneficial-owner hashes
- custodian FID
- custody document and attestation hashes
- custody expiry
- NAV, NAV date, NAV validity
- valuer FID
- reserve ratio and reserve attestation hash
- lifecycle state
- title dispute and encumbrance flags
- mandate status
- construction milestone data
- escrow released total
- apartment distribution hash
- redemption event hash

Lifecycle states:

- `PendingCustody`
- `Active`
- `Paused`
- `Matured`
- `Redeemed`
- `TotalLoss`
- `LandOnly`
- `DevelopmentInitiated`
- `UnderConstruction`
- `Milestone1` through `Milestone5`
- `ConstructionComplete`
- `ApartmentDistribution`

Role topics:

- `4`: Custodian authority
- `5`: Valuation authority
- `6`: Construction authority
- `7`: Shariah authority
- `8`: Property manager authority

Important behavior:

- Custodian FID cannot equal issuer FID.
- Custody, reserve, valuation, and construction attestations require the actor FID to be trusted in TIR for the required topic.
- `IssuerOrAdminMutateAsset` is currently constrained to `asset_registry.issuer`; despite the name, admin is not separately accepted by that account constraint.
- Succession and redemption records are hashes/events only. Actual token movement or burn must still be done through token instructions.

## `fracks-token`

This is the main controlled token program for Token-2022 assets.

Main instructions:

- `initialize_token`
- `initialize_mint_metadata`
- `transfer`
- `mint`
- `purchase_mint`
- `deposit_subscription`
- `settle_subscription_mint`
- `burn`
- `forced_transfer`
- `recovery`
- `finalize_recovery`
- `pause`
- `unpause`
- `set_identity_registry`
- `set_compliance`
- `add_agent`
- `remove_agent`
- `transfer_ownership`
- `freeze_wallet`
- `unfreeze_wallet`
- `freeze_partial`
- `unfreeze_partial`

Important state:

- `TokenState`
- `OwnerState`
- `AgentRole`
- `SubscriptionEscrow`
- `FrozenWallet`
- `PartialFreeze`

Authority model:

- `OwnerState.owner` is the issuer after factory deployment transfers ownership.
- Agents are stored in `AgentRole` PDAs.
- Most controlled actions use `authorize_operator`, which accepts either owner or active agent.

Mint behavior:

- Authority must be owner or active agent.
- Token cannot be paused.
- Recipient wallet cannot be frozen.
- Recipient must pass IRP identity verification.
- Destination token account must match token mint and recipient owner.
- Compliance is evaluated before mint.
- Compliance `created` hook runs before mint to update stateful modules.
- Token state PDA signs mint through Token-2022 authority.

Purchase/subscription behavior:

- `purchase_mint` transfers SOL from buyer to issuer and mints tokens to buyer.
- `deposit_subscription` transfers SOL into a subscription escrow PDA.
- `settle_subscription_mint` sends escrow SOL to issuer and mints tokens to investor.
- These paths still require identity and compliance before minting.

Important gap:

- `purchase_mint` and subscription flows read `OfferingTermsView` from a Factory-owned account.
- I did not find a factory instruction that creates or updates an offering terms account.
- Unless another component creates this Factory-owned account, those purchase/subscription paths are incomplete.

Burn behavior:

- Owner or active agent can burn investor tokens.
- Source wallet identity is required.
- Compliance `destroyed` hook updates stateful modules such as supply cap and holder count.

Freeze behavior:

- `freeze_wallet` creates a `FrozenWallet` PDA.
- `unfreeze_wallet` closes the `FrozenWallet` PDA and returns rent to authority.
- `freeze_partial` creates or updates a `PartialFreeze` PDA.
- `unfreeze_partial` reduces frozen amount and closes the PDA if the amount reaches zero.

Recovery behavior:

- Operator transfers from lost wallet to new wallet through permanent delegate flow.
- New wallet must pass identity/compliance checks.
- `finalize_recovery` updates IRS identity to the new wallet and removes lost wallet identity.

## `fracks-token-hook`

This is the Token-2022 Transfer Hook program. It prevents transfer bypasses and runs post-transfer compliance mutation.

Main instructions:

- `initialize_extra_account_metas`
- `refresh_extra_account_metas`
- `approve_transfer`
- `execute_transfer_hook`

Important state:

- `TransferApproval`

Behavior:

- Token controller creates a transfer approval before a Token-2022 transfer.
- Token-2022 invokes the hook during transfer.
- Hook verifies transfer approval, source/destination accounts, actual post-transfer balances, and compliance state.
- Hook invokes compliance `transferred` after actual transfer effects.
- Recovery approvals are consumed but not finalized until `finalize_recovery`.

Extra account metas include FRACKS token program, token state PDA, transfer approval PDA, compliance state, compliance program, module accounts, and module-specific accounts.

## Identity Stack

The identity stack is stricter now. A wallet receiving tokens must generally have:

1. A non-issuer FID.
2. IRS wallet identity registered to that FID and country.
3. IRS identity activated.
4. Claims for every required CTR topic.
5. Claims issued by FIDs trusted in the token TIR for those topics.

### `fracks-fid`

Main instructions:

- `create_fid`
- `set_management_key`
- `set_signer_key`
- `update_fid_profile`
- `add_claim`
- `revoke_claim`
- `remove_claim`

Important state:

- `FidAccount`
- `ClaimAccount`
- `ClaimTopicIndex`

Behavior:

- FID PDA is `[b"fid", owner]`.
- Investor FIDs require country `1..999`.
- Issuer FIDs use country `0`.
- Claims are indexed by target FID, issuer FID, and topic.
- Only one active claim exists for each target FID + issuer FID + topic tuple.

### `fracks-irs`

Main instructions:

- `initialize_irs`
- `bind_registry`
- `unbind_registry`
- `transfer_ownership`
- `register_identity`
- `submit_onboarding_application`
- `review_onboarding_application`
- `cancel_onboarding_application`
- `set_identity_activation`
- `update_identity`
- `update_country`
- `remove_identity`
- `remove_own_identity`

Important state:

- `IdentityRegistryStorageState`
- `WalletIdentity`
- `OnboardingApplication`

Behavior:

- Wallet identity PDA is `[b"wallet_identity", irs_state, wallet]`.
- Registering identity validates that the FID belongs to the wallet, is not an issuer FID, and matches country.
- Identity starts inactive.
- `set_identity_activation` is required before IRP verification succeeds.
- IRS owner can bootstrap. Otherwise authority must be an identity agent in a bound IRP registry.

### `fracks-irp`

Main instructions:

- `initialize_registry`
- `add_identity_agent`
- `remove_identity_agent`
- `update_irs_reference`
- `update_tir_reference`
- `update_ctr_reference`
- `transfer_registry_ownership`
- `is_verified`
- `verification_status`

Verification checks:

- IRS, TIR, and CTR accounts must match the IRP registry references.
- IRS owner must match IRP owner.
- TIR and CTR token mint must match IRP token mint.
- IRS must be bound to the IRP registry.
- Wallet identity must exist at canonical PDA.
- Wallet identity must be active.
- Every topic in CTR must have a valid claim.
- Claim must not be revoked or expired.
- Claim issuer FID must be active in TIR and allowed for the topic.
- Claim issuer FID must be derived from the claim signer key.

### `fracks-tir`

Main instructions:

- `initialize_tir`
- `add_trusted_issuer`
- `update_issuer_topics`
- `deactivate_issuer`
- `reactivate_issuer`
- `remove_trusted_issuer`
- `transfer_ownership`
- `is_trusted_for_topic`

Issuer entry PDA:

- `[b"issuer_entry", tir_state, issuer_fid]`

Behavior:

- Stores trusted issuer FIDs for a token.
- Each issuer has allowed claim topics and active/inactive status.

### `fracks-ctr`

Main instructions:

- `initialize_ctr`
- `add_claim_topic`
- `remove_claim_topic`
- `transfer_ownership`

Behavior:

- Stores required claim topics for a token.
- IRP requires valid claims for every topic in this list.

## `fracks-compliance`

Main instructions:

- `initialize_compliance`
- `bind_module`
- `unbind_module`
- `set_modules_paused`
- `transfer_ownership`
- `call_module_function`
- `can_transfer`
- `transferred`
- `created`
- `destroyed`

Important state:

- `ComplianceState`

Behavior:

- Up to 15 modules can be bound.
- `modules_paused` bypasses module checks.
- `can_transfer` checks configured rules.
- `created` runs on mint/purchase/settlement mint.
- `transferred` runs after Token-2022 transfer via hook.
- `destroyed` runs on burn.
- Stateful modules require compliance state PDA as `hook_authority`.

Account requirements:

- Every bound module account must be supplied.
- Stateful module mutations also require module program accounts.
- Daily limit requires wallet usage PDA.
- Country cap requires country count PDA; transfers may need both from-country and to-country count PDAs.

## Compliance Module Details

`mod-max-investors`:

- PDA: `[b"mod_max_investors", token_mint]`
- Tracks `holder_count` against `max_investors`.
- Increments when receiver enters from zero.
- Decrements when sender exits to zero.

`mod-supply-cap`:

- PDA: `[b"mod_supply_cap", token_mint]`
- Tracks `total_supply` against `max_supply`.
- `created` increments supply.
- `destroyed` decrements supply.

`mod-country-cap`:

- Module PDA: `[b"mod_country_cap", token_mint]`
- Count PDA: `[b"country_count", module_state, country]`
- Tracks investor counts by country.

`mod-daily-limit`:

- Module PDA: `[b"mod_daily_limit", token_mint]`
- Usage PDA: `[b"daily_usage", module_state, wallet]`
- Tracks wallet volume in a 86,400 second window.

`mod-country-restrict`:

- PDA: `[b"mod_country", token_mint]`
- Requires sender and receiver countries to be allowed.
- For mint, receiver country must be allowed.

`mod-max-balance`:

- PDA: `[b"mod_max_balance", token_mint]`
- Receiver balance after operation must be below cap.

`mod-max-transfer`:

- PDA: `[b"mod_max_transfer", token_mint]`
- Amount must be below cap.

`mod-lockup`:

- PDA: `[b"mod_lockup", token_mint]`
- Blocks before `lockup_end`.

## `fracks-trade-escrow`

This is a secondary trade status ledger. It does not itself transfer Token-2022 tokens or SOL.

Main instructions:

- `grant_institution_role`
- `revoke_institution_role`
- `initiate_trade`
- `lock_tokens`
- `confirm_buyer_payment`
- `settle_trade`
- `cancel_trade`

Important state:

- `InstitutionRole`
- `TradeEscrow`

Trade statuses:

- `Initiated`
- `TokensLocked`
- `PaymentConfirmed`
- `Settled`
- `Cancelled`

Behavior:

- Seller initiates trade.
- Seller marks tokens locked.
- Buyer or seller can confirm payment depending on buyer setting.
- Buyer or seller can settle after payment confirmation.
- Buyer or seller can cancel while initiated or locked.
- Token movement must be performed separately through `fracks-token` transfer paths.

## `fracks-governance`

This is a proposal and voting ledger tied to a token mint.

Main instructions:

- `initialize_governance`
- `create_proposal`
- `cast_vote`
- `execute_proposal`
- `cancel_proposal`

Important state:

- `GovernanceState`
- `Proposal`
- `VoteRecord`

Proposal types:

- `Ordinary`
- `SaleOrMajorDecision`
- `CustodianReplacement`
- `Emergency`

Behavior:

- Proposal stores description hash, type, threshold, quorum, snapshot slot, voting window, vote counts, and status.
- Vote record PDA prevents duplicate votes by the same voter for the same proposal.
- Execution requires voting window to be closed, quorum to be met, and yes votes to meet threshold over yes/no votes.

Important risk:

- Vote weight is passed as an instruction argument.
- The contract does not verify token balance snapshots on-chain.
- Backend/indexer/frontend must enforce reliable snapshot weights.

## Important PDA Families

| Area | Seed |
| --- | --- |
| Factory state | `[b"factory_state"]` |
| Token state | `[b"token_state", token_mint]` |
| Token owner state | `[b"owner", token_mint]` |
| Agent role | `[b"agent", token_mint, agent]` |
| Frozen wallet | `[b"frozen", token_mint, wallet]` |
| Partial freeze | `[b"partial_freeze", token_mint, wallet]` |
| Subscription escrow | `[b"subscription", token_mint, investor]` |
| FID | `[b"fid", owner]` |
| Claim | `[b"claim", fid, claim_id]` |
| Claim topic index | `[b"claim_topic_index", target_fid, issuer_fid, topic]` |
| IRS state | `[b"irs_state", authority_seed]` |
| Wallet identity | `[b"wallet_identity", irs_state, wallet]` |
| Onboarding application | `[b"onboarding_application", irs_state, wallet]` |
| IRP state | `[b"irp_state", token_mint]` |
| TIR state | `[b"tir_state", token_mint]` |
| Issuer entry | `[b"issuer_entry", tir_state, issuer_fid]` |
| CTR state | `[b"ctr_state", token_mint]` |
| Compliance state | `[b"compliance_state", token_mint]` |
| Transfer approval | `[b"transfer_approval", source_token_account, destination_token_account, token_state]` |
| Asset registry | `[b"asset_registry", asset_id]` |
| Succession claim | `[b"succession", deceased_wallet]` |
| Governance state | `[b"gov", token_mint]` |
| Proposal | `[b"proposal", governance_state, proposal_id]` |
| Vote record | `[b"vote", proposal, voter]` |
| Institution role | `[b"institution", token_mint, institution_wallet]` |
| Trade escrow | `[b"trade_escrow", trade_id]` |
| Max investors module | `[b"mod_max_investors", token_mint]` |
| Country restrict module | `[b"mod_country", token_mint]` |
| Max balance module | `[b"mod_max_balance", token_mint]` |
| Max transfer module | `[b"mod_max_transfer", token_mint]` |
| Lockup module | `[b"mod_lockup", token_mint]` |
| Daily limit module | `[b"mod_daily_limit", token_mint]` |
| Daily usage | `[b"daily_usage", module_state, wallet]` |
| Supply cap module | `[b"mod_supply_cap", token_mint]` |
| Country cap module | `[b"mod_country_cap", token_mint]` |
| Country investor count | `[b"country_count", module_state, country]` |

## Backend and Frontend Integration Notes

Minting requires resolving:

- token state
- owner state or agent role
- IRP, IRS, TIR, CTR
- recipient wallet identity
- required claim accounts
- trusted issuer entry accounts
- compliance state
- bound module accounts
- module program accounts for stateful modules
- country count and daily usage PDAs where needed
- recipient ATA

Transfers require:

- pre-transfer `fracks-token.transfer` or controlled transfer instruction to create hook approval
- Token-2022 transfer with transfer-hook extra accounts
- compliance remaining accounts for hook-side `transferred` mutation

Deployment requires:

- Token-2022 mint with extensions
- custody mandate and attestation before `deploy_token_suite`
- trusted issuer entry PDAs in remaining accounts first
- compliance module accounts after trusted issuer accounts
- hook extra account metas initialized from bound modules

Asset lifecycle UI should separate:

- legal/asset registry events
- custody/reserve/NAV/title/milestone/succession events
- actual token balance and transfer events

## Gaps and Risks To Track

1. `OfferingTermsView` is consumed by `fracks-token`, but no factory instruction was found that creates or updates offering terms.
2. `fracks-trade-escrow` records trade status only; it does not transfer tokens or SOL.
3. `fracks-governance` does not verify vote weights on-chain.
4. Asset registry redemption signatures are hash records only; token burn/redemption settlement is separate.
5. Asset registry succession records are legal hash records only; token movement must happen separately.
6. `IssuerOrAdminMutateAsset` currently only accepts `asset_registry.issuer` by constraint.
7. Stateful compliance modules require exact remaining accounts. Missing module program accounts or per-wallet/per-country PDAs will fail transactions.
8. Deployment, mint, and transfer transactions can become large. Versioned transactions and address lookup tables should be expected.
