# Contract Issues To Fix / Confirm

This document records only contract-level issues found while integrating the Solana RWA contracts.

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

## 2. Token Creation Does Not Accept Mint Cap / Total Token Count / Change Mint Cap

**Current behavior**

The factory deployment args do not include mint cap or total token count:

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

## 3. Deployed Factory Source / IDL Mismatch

The deployed factory behavior appears to include fields/accounts that are not represented in the local factory source shown here:

- `offering_terms` PDA account
- `price_per_token`
- `price_decimals`
- `payment_mint`

The local `DeployTokenSuiteArgs` shown above does not contain these fields.

**Required contract solution**

The repository contract source and generated IDL must match the deployed program exactly.

If offering terms are intended, add them to the contract source:

```rust
pub struct DeployTokenSuiteArgs {
    ...
    pub price_per_token: u64,
    pub price_decimals: u8,
    pub payment_mint: Option<Pubkey>,
    pub salt: [u8; 32],
}
```

And include the required `offering_terms` account in the factory account context.

## 4. Trusted KYC/AML Providers Are Token-Scoped, Not Global

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

**Potential contract enhancement**

If global trusted providers are required on-chain, add a separate global provider registry contract or extend TIR/IRP verification to support both:

- global trusted providers
- token-specific trusted providers

Until then, every token needs its own TIR issuer entry.

## 5. Duplicate Claim Topic Issuer Behavior Needs An Update Path

We hit:

```text
DuplicateClaimTopicIssuer
An active claim already exists for this issuer/topic/investor tuple.
```

This is expected from `fracks-fid`: it prevents duplicate active claims for the same:

```text
issuer FID + topic + investor FID
```

**Potential contract enhancement**

Consider adding an explicit claim replacement/update instruction if the same issuer needs to refresh claim data or expiry:

```rust
pub fn replace_claim(
    ctx: Context<ReplaceClaim>,
    topic: u64,
    data_hash: [u8; 32],
    signature: [u8; 64],
    expires_at: i64,
) -> Result<()>
```

Alternative: add an `update_claim` instruction that mutates the active claim for the same issuer/topic/investor tuple.

## 6. Missing Contract-Level Error Clarity For Identity/Wallet Verification

Some failed mint/transfer flows surface generic or misleading errors when the investor does not have the required FID or active wallet identity in the token's IRS.

**Required contract improvement**

Return explicit errors for these cases:

- Missing investor FID
- Investor FID is issuer-type when investor-type is required
- Missing wallet identity account in IRS
- Wallet identity exists but is inactive
- Required trusted claim topic is missing

This makes integration safer and avoids interpreting unrelated downstream errors.
