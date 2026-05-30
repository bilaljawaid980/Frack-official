# Contract Issues To Fix / Confirm

This document records contract-level issues found while integrating the Solana RWA contracts with the frontend. The frontend/backend can work around some of these, but the clean solution requires contract changes or a confirmed deployed IDL.

## 1. Factory Uses One `issuer` Argument For Too Many Ownership Roles

**Current behavior**

During token deployment, the platform admin calls `deploy_token_suite(args)`. The frontend passes the issuer wallet as:

```ts
args.issuer = issuerWallet
```

In `contracts/programs/fracks-factory/src/lib.rs`, `args.issuer` is used for two different meanings:

- Deployment identity:

```rust
seeds = [b"deployment", args.issuer.as_ref(), args.salt.as_ref()]
deployment.issuer = args.issuer;
```

- Final owner of all suite accounts:

```rust
fracks_token::cpi::transfer_ownership(..., args.issuer)?;
fracks_ctr::cpi::transfer_ownership(..., args.issuer)?;
fracks_tir::cpi::transfer_ownership(..., args.issuer)?;
fracks_irp::cpi::transfer_registry_ownership(..., args.issuer)?;
fracks_irs::cpi::transfer_ownership(..., args.issuer)?;
fracks_compliance::cpi::transfer_ownership(..., args.issuer)?;
```

**Why this is wrong for the intended platform flow**

The issuer should become the **token owner** only. The platform admin/governance should keep control of compliance infrastructure:

- TIR owner: platform admin
- IRS owner: platform admin
- IRP owner: platform admin
- CTR owner: platform admin
- Compliance owner: platform admin
- Token owner: issuer wallet

The issuer should not automatically control trusted KYC/AML providers or compliance registries.

**Required contract solution**

Split ownership fields in `DeployTokenSuiteArgs`.

Recommended minimum:

```rust
pub struct DeployTokenSuiteArgs {
    pub token_owner: Pubkey,
    pub registry_owner: Pubkey,
    pub token_mint: Pubkey,
    ...
}
```

Then transfer ownership like:

```rust
fracks_token::cpi::transfer_ownership(..., args.token_owner)?;
fracks_ctr::cpi::transfer_ownership(..., args.registry_owner)?;
fracks_tir::cpi::transfer_ownership(..., args.registry_owner)?;
fracks_irp::cpi::transfer_registry_ownership(..., args.registry_owner)?;
fracks_irs::cpi::transfer_ownership(..., args.registry_owner)?;
fracks_compliance::cpi::transfer_ownership(..., args.registry_owner)?;
```

Even better:

```rust
pub token_owner: Pubkey,
pub tir_owner: Pubkey,
pub irs_owner: Pubkey,
pub irp_owner: Pubkey,
pub ctr_owner: Pubkey,
pub compliance_owner: Pubkey,
```

This gives the platform explicit governance control.

**Frontend workaround if contract is not changed**

Deploy with:

```ts
args.issuer = platformAdmin
```

Then immediately call only:

```rust
fracks_token::transfer_ownership(issuerWallet)
```

Tradeoff: `TokenDeployment.issuer` will equal the platform admin, not the business issuer. The backend `Asset.issuerWallet` must be treated as the source of truth for business issuer.

## 2. Token Creation Does Not Accept Mint Cap / Total Token Count / Change Mint Cap

**Current behavior**

The frontend issuance form asks for:

- `totalSupply`
- token economics
- initial price

But the local factory args do not include mint cap or total token count:

```rust
pub struct DeployTokenSuiteArgs {
    pub issuer: Pubkey,
    pub token_mint: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
    pub decimals: u8,
    pub isin: String,
    pub claim_topics: Vec<u64>,
    pub trusted_issuers: Vec<TrustedIssuerInput>,
    pub compliance_modules: Vec<Pubkey>,
    pub shared_irs: Option<Pubkey>,
    pub salt: [u8; 32],
}
```

`fracks-token::initialize_token` also does not store a mint cap, max supply, or mutable cap flag.

There is a separate `mod-supply-cap` program:

```rust
pub fn initialize_module(ctx, token_mint: Pubkey, max_supply: u64)
```

But the factory only accepts `compliance_modules: Vec<Pubkey>` / module state PDAs. It does not accept module config, so it cannot initialize `mod-supply-cap` with the requested `totalSupply` during token creation.

`mod-supply-cap` also has no instruction to update `max_supply`, so there is no on-chain `canChangeMintCap` behavior.

**Required contract solution**

Add explicit supply terms to deployment.

Recommended:

```rust
pub struct DeployTokenSuiteArgs {
    ...
    pub mint_cap: u64,
    pub can_change_mint_cap: bool,
}
```

Then either:

1. Store this directly in token state and enforce it in mint.
2. Or initialize `mod-supply-cap` from the factory with:

```rust
initialize_module(token_mint, args.mint_cap)
```

If cap changes are allowed, add a controlled instruction:

```rust
pub fn update_mint_cap(ctx, new_cap: u64) -> Result<()>
```

Rules should be explicit:

- Only governance/compliance owner can update cap.
- If `can_change_mint_cap == false`, updates must fail.
- New cap must not be lower than already minted supply.

## 3. Deployed Factory IDL / Local IDL Mismatch

We previously hit:

```text
InstructionDidNotDeserialize (102)
Instruction arguments are invalid or the IDL is mismatched with the on-chain program.
```

The deployed factory at the time required fields/accounts that were not represented by the frontend/local IDL:

- `offering_terms` PDA account
- `price_per_token`
- `price_decimals`
- `payment_mint`

The local `DeployTokenSuiteArgs` shown above does not contain these fields.

**Required contract/devops solution**

Confirm the source code and IDL that exactly match the deployed factory program ID.

The frontend must not guess ABI variants. The contracts team should provide:

- Deployed program IDs
- Matching IDL JSON files
- Factory state layout
- Required account order
- Required deploy args order

If offering terms are intended, add them to the local contract source and keep the IDL in sync.

## 4. Factory Dependency Program IDs Must Come From On-Chain Factory State

We saw failures like:

```text
An account is owned by an unexpected program.
```

Root cause: the frontend was deriving token/IRP/IRS/TIR/CTR/compliance PDAs using stale `.env` program IDs, while the selected factory state pointed to different dependency program IDs.

**Required contract/devops solution**

The factory should remain the source of truth for dependency program IDs. The frontend should derive deployment accounts from:

```rust
factory_state.token_program_id
factory_state.fid_program_id
factory_state.irp_program_id
factory_state.irs_program_id
factory_state.tir_program_id
factory_state.ctr_program_id
factory_state.compliance_program_id
```

If dependency IDs can be changed, the contract should emit an event when they are updated.

## 5. Trusted KYC/AML Providers Are Token-Scoped, Not Global

`fracks-tir` has:

```rust
initialize_tir(token_mint)
add_trusted_issuer(issuer_fid, topics, label)
update_issuer_topics(new_topics)
deactivate_issuer()
reactivate_issuer()
remove_trusted_issuer()
```

The trusted issuer entry PDA is derived from:

```rust
["issuer_entry", tir_state, issuer_fid]
```

So trust is scoped to a token's TIR, not global.

**Expected behavior**

- KYC = topic `1`
- AML = topic `2`
- Provider must have FID with `is_issuer = true`
- Provider must be trusted in that token's TIR for the required topic

**Potential platform enhancement**

If the platform wants global providers, this should be an off-chain directory or a new global provider registry contract. Even with a global directory, each token still needs a token-scoped TIR entry unless the TIR/IRP verification logic is changed.

## 6. Duplicate Claim Topic Issuer Error Is Expected But Needs Better Flow Support

We hit:

```text
DuplicateClaimTopicIssuer
An active claim already exists for this issuer/topic/investor tuple.
```

This is expected from `fracks-fid`: it prevents duplicate active claims for the same:

```text
issuer FID + topic + investor FID
```

**Required behavior**

Before a provider issues KYC/AML claim:

- Check if the investor already has an active claim from that same provider FID for the same topic.
- If yes, do not call `add_claim`; forward the purchase request to the next workflow step.
- If no, call `add_claim`.

This is frontend/backend workflow, but the contract behavior is correct.

## 7. Investor Must Have FID And Wallet Identity Before Claims/Minting

We hit mint/claim errors that were initially misleading in the frontend, including:

```text
The token account is not a valid Token-2022 account.
```

The real issue in one flow was that the investor did not have the required identity/wallet identity for the token's IRS.

**Required behavior**

Investor purchase flow should block or pause before provider review if:

- investor has no FID
- investor wallet is not registered/active in the token's IRS

Recommended status:

```text
ACTION_REQUIRED_INVESTOR_IDENTITY
```

Then resume KYC/AML review after identity registration.

## 8. RPC Rate Limiting Broke Indexer

We hit:

```text
429 Too Many Requests
```

This is not a contract bug, but it affects contract indexing.

**Required backend/indexer behavior**

- Support multiple RPC URLs.
- Rotate/fallback on 429.
- Backoff instead of crashing the indexer.
- Avoid fetching the same accounts repeatedly in tight loops.
