# Resolve RWA Compliance Check Failure in Token Minting Flow

This implementation plan outlines the verified steps to permanently fix the RWA compliance check failure in the token minting flow. It includes formal, verified proof from the Solana contracts that minting only validates the recipient's identity, and details the dynamic program ID resolution needed for the mint simulation script.

## User Review Required

> [!IMPORTANT]
> **Zero Contract Modification Policy**: Absolutely NO modifications will be made in the `contracts/` directory. All fixes will be implemented exclusively in the frontend and simulation layers.
>
> **Formal Proof of Recipient-Only Verification**:
> We have analyzed the Anchor token program at [lib.rs](file:///d:/Work/FracksProtocol-main/contracts/programs/fracks-token/src/lib.rs) and formally prove that mint compliance strictly validates only the recipient `to` wallet and never the issuer/sender (`authority` / transaction signer) via CPI, hook, or compliance modules:
>
> 1. **Comparison of On-Chain Account Validation Structs**:
>    - **`MintOperation` Accounts (lines 932-968)**:
>      ```rust
>      pub struct MintOperation<'info> {
>          pub authority: Signer<'info>,
>          pub token_state: Account<'info, TokenState>,
>          pub irp_state: UncheckedAccount<'info>,
>          pub irs_state: UncheckedAccount<'info>,
>          pub tir_state: UncheckedAccount<'info>,
>          pub ctr_state: UncheckedAccount<'info>,
>          pub compliance_state: UncheckedAccount<'info>,
>          pub compliance_program: UncheckedAccount<'info>,
>          pub wallet_identity: UncheckedAccount<'info>,  // Recipient only
>          pub to_frozen: UncheckedAccount<'info>,        // Recipient only
>          pub token_mint_account: UncheckedAccount<'info>,
>          pub destination_token_account: UncheckedAccount<'info>,
>          // ...
>      }
>      ```
>      The `MintOperation` struct has *exactly one* `wallet_identity` account and *exactly one* `to_frozen` account. It does **not** declare any accounts for `from_wallet_identity` or `from_frozen`. It is physically impossible for the contract to perform on-chain PDA checks on the issuer/sender's identity without these accounts.
>    - **`TransferEvaluation` Accounts (lines 880-929)**:
>      ```rust
>      pub struct TransferEvaluation<'info> {
>          pub from_wallet_identity: UncheckedAccount<'info>, // Sender identity
>          pub to_wallet_identity: UncheckedAccount<'info>,   // Recipient identity
>          pub from_frozen: UncheckedAccount<'info>,          // Sender frozen state
>          pub to_frozen: UncheckedAccount<'info>,            // Recipient frozen state
>          // ...
>      }
>      ```
>      Unlike mint, transfer operations are bi-directional and explicitly enforce the presence and derivation of BOTH sender and recipient identity/frozen PDA accounts.
>
> 2. **Instruction Logic in `pub fn mint` (lines 139-220)**:
>    - **Signer Access Control**: The instruction executes `authorize_operator(...)` on `authority` (line 145). This verifies strictly that the transaction signer is the token owner or has a delegated agent role PDA. No claims, country restrictions, or identity verification checks are done on the `authority` key.
>    - **Recipient Claims Registry Verification**: The instruction invokes `verify_wallet_against_irp(..., &to, ...)` (line 157) passing strictly the recipient's public key (`to`). It resolves `wallet_identity` as the recipient's identity PDA, asserting it contains active, valid, unrevoked, and unexpired claims.
>    - **Compliance Module CPI Gating**: The instruction invokes `invoke_compliance_created(..., to, amount, to_balance_after, receiver_identity.country)` (line 187). It passes the recipient's key (`to`) and country (`receiver_identity.country`). The issuer/authority address, identity PDA, and country are **never** passed to compliance, making it impossible for compliance modules to evaluate or reject the issuer.
>
> 3. **SPL Token-2022 Transfer Hook Extension Behavior**:
>    - SPL Token-2022 transfer hooks are strictly triggered during token transfer/transfer-checked instructions. `MintTo` instructions do **not** trigger transfer hooks on-chain. Therefore, no secondary hook or CPI module can intercept or validate the sender's identity during a mint.
>
> **Dynamic Program ID Resolution in Simulation Script**:
> On-chain programs and registries in our testnet cluster are deployed dynamically via the factory program (`6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe`).
> Static constants (like `IRS_PROGRAM_ID`, `TIR_PROGRAM_ID`, `CTR_PROGRAM_ID`, `FID_PROGRAM_ID`) can mismatch factory-deployed instances, causing transaction simulation to throw `WalletNotVerified (6001)`.
> We will resolve this by calling `fetchFactoryStateAccount()` dynamically in `simulate_mint.ts` to fetch and use the correct on-chain program IDs for PDA derivations.
>
> **CLI Input Capability for Simulation Script**:
> The `simulate_mint.ts` script is fully updated and supports explicit overrides via command-line arguments:
> - `--token <MINT_ADDRESS>`
> - `--investor <INVESTOR_WALLET>`
> - `--issuer <ISSUER_WALLET>`
> - `--amount <AMOUNT>`
> If any argument is omitted, the script dynamically queries the backend's `token-purchase-requests` endpoint to retrieve the latest pending request, and falls back to deterministic cluster defaults if the backend is offline.
>
> ---

## Proposed Changes

### 1. Refactor Token Minting Flow & Diagnostics

#### [MODIFY] [token.ts](file:///d:/Work/FracksProtocol-main/frontend/src/services/token.ts)

- **Remove Auto-Activation Call**:
  - Delete `identityService.setIdentityActivation(...)` within the `mint()` method.
- **Assert Identity Status & Throw Detailed Inactive Error**:
  - Check the recipient's identity activation status.
  - If registered but inactive (`isActive === false`), fetch the `irpState` using the `IdentityService` to obtain the exact `irpState.owner` (IRS/IRP owner).
  - Throw a clear, granular error:
    `"Investor identity is registered but inactive in this token's Identity Registry Storage (IRS). Please ask the central platform administrator / IRS State Owner (${irpOwner}) to activate this identity."`
- **Dynamic On-Chain Registry Verification**:
  - Rather than relying on global/hardcoded frontend state, dynamically retrieve this token's exact registries (IRS, TIR, CTR, and required claim topics) by fetching the `TokenState` on-chain and deriving/looking up the associated states.
- **Granular Claim Validation (`validateRecipientClaimsForMint`)**:
  - Fetch CTR required claim topics dynamically from the on-chain CTR state.
  - Fetch investor's claims from the FID program and check:
    - If no claim exists for a required topic, fail with: `"Investor is missing claim for required topic ${topic}."`
    - If claims exist for a required topic:
      - Filter out revoked claims. If all claims are revoked, fail with: `"Claim for required topic ${topic} is revoked."`
      - Filter out expired claims. If all claims are expired, fail with: `"Claim for required topic ${topic} has expired."`
      - For unrevoked, unexpired claims, check if the claim's issuer FID is trusted in the token's TIR by fetching the derived `issuerEntry` PDA.
      - If the issuer is not trusted in this token's TIR for the required topic, dynamically resolve the TIR owner from the `tir_state` account (`new PublicKey(tirInfo.data.subarray(8, 40))`) and throw:
        `"Claim exists for topic ${topic}, but claim issuer FID ${issuerFid} is not trusted in this token's TIR. Ask TIR owner ${tirOwner} to add it."`
      - If the claim signer does not match the issuer FID signer, fail with: `"Claim for required topic ${topic} has an invalid issuer FID profile or signer key mismatch."`
  - If a topic satisfies at least one claim that passes all checks (valid, active, unexpired, trusted, valid signer), it is marked valid.

---

### 2. Implement Dynamic Mint Simulation Script

#### [MODIFY] [simulate_mint.ts](file:///d:/Work/FracksProtocol-main/frontend/src/scratch/simulate_mint.ts)

Refactor the regression and simulation script to perform dynamic lookups and simulate the mint transaction:
- Set up Solana RPC connection and read-only Anchor provider.
- Accept explicit inputs via CLI arguments:
  - `--token <MINT_ADDRESS>` (e.g., token contract address)
  - `--investor <INVESTOR_WALLET>`
  - `--issuer <ISSUER_WALLET>`
  - `--amount <AMOUNT>`
- If CLI arguments are not provided, fall back to fetching the latest pending review request from the local backend API.
- Call `fetchFactoryStateAccount()` dynamically to resolve on-chain program IDs (`fidProgramId`, `irsProgramId`, `tirProgramId`, `ctrProgramId`, `complianceProgramId`).
- Use the resolved program IDs for all PDA derivations (such as `ctrState`, `targetFid`, `tirState`, `walletIdentity`, `issuerEntry`, `complianceStatePda`).
- Construct the mint transaction with dynamic program IDs and simulate it against Solana's `simulateTransaction` API on `testnet`.

---

## Verification Plan

### Automated Tests
1. Run `pnpm exec tsc --noEmit` in the `frontend` directory to ensure type safety.
2. Run `pnpm run build` to verify the production build compiles perfectly.
3. Execute the simulation script using explicit parameters:
   ```bash
   npx tsx src/scratch/simulate_mint.ts --token 92MCTz2KpWqhSD7LWay97LmZbdmpAj4fJ3FXtV7rbW9s --investor CacRDoAWH3uPoW39Dttk9LBzVnizPajFq3rzRWJQRUCG --amount 10
   ```
   Confirm that all pre-flight diagnostic lookups complete successfully, and the simulated transaction returns no compliance errors.

### Manual Verification
1. Attempt to mint with an inactive identity or missing claims, and verify that the UI toast displays the highly detailed, actionable error message.
