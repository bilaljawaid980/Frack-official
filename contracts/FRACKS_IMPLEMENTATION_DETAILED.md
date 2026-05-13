# FRACKS Detailed Implementation

Date: 2026-05-06

## What this repo now contains

This workspace implements the FRACKS protocol as an Anchor monorepo with:

- core identity programs
- registry programs
- compliance program
- built-in compliance modules
- token control-plane program
- factory program
- TypeScript SDK surface
- TypeScript integration tests

Primary source files:

- [programs/fracks-fid/src/lib.rs](/root/ERC3436/programs/fracks-fid/src/lib.rs)
- [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs)
- [programs/fracks-tir/src/lib.rs](/root/ERC3436/programs/fracks-tir/src/lib.rs)
- [programs/fracks-ctr/src/lib.rs](/root/ERC3436/programs/fracks-ctr/src/lib.rs)
- [programs/fracks-irp/src/lib.rs](/root/ERC3436/programs/fracks-irp/src/lib.rs)
- [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs)
- [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs)
- [programs/fracks-factory/src/lib.rs](/root/ERC3436/programs/fracks-factory/src/lib.rs)
- [sdk/src](/root/ERC3436/sdk/src)
- [tests](/root/ERC3436/tests)

## Protocol layers

### Phase 1: FID

Implemented in [programs/fracks-fid/src/lib.rs](/root/ERC3436/programs/fracks-fid/src/lib.rs).

What it does:

- creates one FID PDA per wallet
- stores management and signer keys
- supports signer-key rotation
- stores claims under claim PDAs
- validates issuer claim signatures through the Solana instructions sysvar path
- supports claim revocation and deletion

### Phase 2: IRS / TIR / CTR

Implemented in:

- [programs/fracks-irs/src/lib.rs](/root/ERC3436/programs/fracks-irs/src/lib.rs)
- [programs/fracks-tir/src/lib.rs](/root/ERC3436/programs/fracks-tir/src/lib.rs)
- [programs/fracks-ctr/src/lib.rs](/root/ERC3436/programs/fracks-ctr/src/lib.rs)

What they do:

- IRS stores wallet-to-FID registry records
- TIR stores trusted issuer records per token
- CTR stores required claim topics per token
- IRS supports shared-registry binding to multiple IRP instances

### Phase 3: IRP + Compliance

Implemented in:

- [programs/fracks-irp/src/lib.rs](/root/ERC3436/programs/fracks-irp/src/lib.rs)
- [programs/fracks-irp/src/utils.rs](/root/ERC3436/programs/fracks-irp/src/utils.rs)
- [programs/fracks-compliance/src/lib.rs](/root/ERC3436/programs/fracks-compliance/src/lib.rs)
- [programs/modules](/root/ERC3436/programs/modules)

What they do:

- IRP verifies whether a wallet is eligible for a token
- it checks IRS membership, required CTR topics, and trusted issuer paths from TIR
- Compliance binds pluggable module PDAs per token
- built-in modules cover max investors, country restrict, max balance, max transfer, lockup, daily limit, supply cap, and country cap

### Phase 4: Token Program

Implemented in [programs/fracks-token/src/lib.rs](/root/ERC3436/programs/fracks-token/src/lib.rs).

What it currently does:

- stores token control-plane state in `TokenState`
- stores owner state and token-specific agent roles
- supports full wallet freeze and partial freeze
- supports owner pause / unpause
- supports owner registry/compliance reference updates
- supports ownership transfer / accept flow
- supports transfer, mint, burn, forced transfer, and recovery control paths
- derives receiver verification from FRACKS registry state
- derives compliance from on-chain compliance state and module accounts
- invokes compliance post-hooks after successful transfer, mint, burn, and forced transfer

Important implementation note:

- this is still a FRACKS control-plane token program, not full SPL Token-2022 mint / transfer CPI parity yet

### Phase 5: Factory

Implemented in [programs/fracks-factory/src/lib.rs](/root/ERC3436/programs/fracks-factory/src/lib.rs).

What it does:

- initializes factory state
- stores canonical program IDs
- deploys linked token suites at the FRACKS PDA layer
- supports shared IRS reuse
- records deployments in `TokenDeployment`

### Phase 6: SDK

Implemented in [sdk/src](/root/ERC3436/sdk/src).

What it does:

- exposes registry, token, compliance, factory, and FID client surfaces
- ships PDA helpers and factory deployment support for the current repo behavior

## What changed in the latest hardening pass

### Token loophole fix

The token program previously trusted caller-supplied state too much. It now:

- validates verification from real IRP-linked accounts
- validates compliance from real compliance/module accounts
- reads partial-freeze state from stored PDAs
- treats optional freeze placeholders correctly

### Post-hook integration

The token program now calls compliance post-hooks after successful state-changing flows:

- `transfer -> CP.transferred`
- `mint -> CP.created`
- `burn -> CP.destroyed`
- `forced_transfer -> CP.transferred`

### Broader token coverage

The token test suite now covers:

- transfer gating
- partial freeze
- pause behavior
- owner setter flows
- ownership transfer
- full freeze / unfreeze
- burn
- forced transfer
- recovery

## Current verification status

Verified in this repo state:

- `cargo check -p fracks-token`
- `anchor build`
- `anchor test --skip-build`

Latest confirmed runtime result:

- `17 passing`

## Public testnet deployment status

Attempted against Solana testnet using the configured wallet.

Result:

- deployment started successfully
- at least one program was confirmed on-chain
- full workspace deployment stopped because the deployer wallet ran out of SOL before the entire workspace finished

Confirmed public testnet program from this pass:

- `fracks_factory`: `7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH`

Explorer:

- <https://explorer.solana.com/address/7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH?cluster=testnet>

## Remaining architectural gaps

See [FRACKS_AUDIT_PHASES_1_6.md](/root/ERC3436/FRACKS_AUDIT_PHASES_1_6.md) for the current formal audit summary.

The biggest remaining gaps are:

- no full SPL Token-2022 CPI mint / transfer / burn execution yet
- compliance post-hooks are now called, but compliance-side module-state fanout is still not fully implemented
- recovery does not yet remap IRS identity records the way the original docs describe
- IRS mutation authority is still not fully identity-agent based
- batch token ops from the original docs are still not implemented
