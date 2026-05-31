# FRACKS CLI Scripts Guide

Date: 2026-05-06

## What is included

The repo now has a dedicated CLI wrapper for every contract instruction generated from the current built IDLs.

- `103` instruction scripts under [scripts/cli](/root/ERC3436/scripts/cli)
- one wrapper per function, grouped by program
- live schema support from the IDLs with `--print-schema`
- PDA helper script: [scripts/cli/derive-pda.js](/root/ERC3436/scripts/cli/derive-pda.js)
- command inventory: [FRACKS_CLI_COMMAND_REFERENCE.md](/root/ERC3436/FRACKS_CLI_COMMAND_REFERENCE.md)
- manual test matrix: [FRACKS_CLI_TEST_CASES.md](/root/ERC3436/FRACKS_CLI_TEST_CASES.md)

## Prerequisites

Build the programs and IDLs first:

```bash
anchor build
```

Export the wallet and RPC you want the scripts to use:

```bash
export ANCHOR_WALLET=/root/.config/solana/id.json
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
```

If you want a local validator:

```bash
solana-test-validator -r
```

You can also override both on any command:

```bash
node scripts/cli/fracks_fid/create_fid.js --wallet-path /path/to/keypair.json --provider-url https://api.devnet.solana.com ...
```

## Main helper commands

List every generated wrapper:

```bash
npm run cli:list
```

Print the exact schema for one instruction:

```bash
node scripts/cli/fracks_token/initialize_token.js --print-schema
```

Derive a PDA:

```bash
node scripts/cli/derive-pda.js fid --wallet <WALLET_PUBKEY>
node scripts/cli/derive-pda.js token-state --mint <TOKEN_MINT>
node scripts/cli/derive-pda.js compliance-state --mint <TOKEN_MINT>
```

Re-generate wrappers after any IDL change:

```bash
npm run cli:generate
npm run cli:reference
node scripts/cli/build-test-cases.js
```

## How the wrappers behave

- Write instructions default to `rpc` mode and print a JSON object with the transaction signature.
- Read instructions with return values default to `view` mode and print the returned boolean.
- Each invocation signs with exactly one local keypair: the active `--wallet-path` or `ANCHOR_WALLET`.
- Common signer accounts such as `owner`, `issuer`, `issuer_owner`, `agent`, `authority`, and `pending_owner` default to the active `ANCHOR_WALLET` public key if you omit the flag.
- Constant accounts such as `system_program` and `instructions_sysvar` are auto-filled.
- FRACKS program accounts such as `--compliance_program` or `--tir_program` are auto-filled from the local built IDLs when the account name maps cleanly to a FRACKS program.

## Special cases

`fracks_fid/add_claim` is special. The contract requires an Ed25519 verification instruction in the same transaction. The CLI wrapper handles that automatically:

- it fetches the issuer FID account
- reads the current `signer_key`
- rebuilds the claim message from the CLI args
- prepends the Ed25519 verification instruction before sending `add_claim`

You still need to pass a real detached Ed25519 signature in `--signature`.

Some instructions also need dynamic remaining accounts:

- `fracks_token/transfer.js`
- `fracks_token/mint.js`
- `fracks_token/burn.js`
- `fracks_token/forced_transfer.js`
- `fracks_token/recovery.js`
- `fracks_compliance/can_transfer.js`
- `fracks_compliance/transferred.js`
- `fracks_compliance/created.js`
- `fracks_compliance/destroyed.js`
- `fracks_factory/deploy_token_suite.js`

For those, pass either:

```bash
--remaining-accounts-file path/to/file.json
```

or:

```bash
--remaining-accounts '[{"pubkey":"...","isSigner":false,"isWritable":true}]'
```

Starter examples are in [scripts/cli/examples](/root/ERC3436/scripts/cli/examples).

## Recommended execution sequence

Use this sequence when you want to stand up and test a token suite manually from the CLI.

### 1. FID layer

Create an issuer FID:

```bash
ISSUER_KEYPAIR=/path/to/issuer.json
ISSUER_WALLET=$(solana-keygen pubkey "$ISSUER_KEYPAIR")
ISSUER_FID=$(node scripts/cli/derive-pda.js fid --wallet "$ISSUER_WALLET" | jq -r .pubkey)

node scripts/cli/fracks_fid/create_fid.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --fid "$ISSUER_FID" \
  --is_issuer true \
  --country 0
```

Create an investor FID:

```bash
INVESTOR_KEYPAIR=/path/to/investor.json
INVESTOR_WALLET=$(solana-keygen pubkey "$INVESTOR_KEYPAIR")
INVESTOR_FID=$(node scripts/cli/derive-pda.js fid --wallet "$INVESTOR_WALLET" | jq -r .pubkey)

node scripts/cli/fracks_fid/create_fid.js \
  --wallet-path "$INVESTOR_KEYPAIR" \
  --fid "$INVESTOR_FID" \
  --is_issuer false \
  --country 840
```

Optional issuer signer rotation:

```bash
node scripts/cli/fracks_fid/set_signer_key.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --fid "$ISSUER_FID" \
  --new_key <ED25519_PUBLIC_KEY_BASE58>
```

Issue a claim:

```bash
CLAIM=$(node scripts/cli/derive-pda.js claim --fid "$INVESTOR_FID" --claim_id 0 | jq -r .pubkey)

node scripts/cli/fracks_fid/add_claim.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --issuer_fid "$ISSUER_FID" \
  --target_fid "$INVESTOR_FID" \
  --claim "$CLAIM" \
  --topic 1 \
  --data_hash 0x<64_HEX_CHARS_FOR_32_BYTES> \
  --signature 0x<128_HEX_CHARS_FOR_64_BYTES> \
  --expires_at 1999999999
```

### 2. Registry storage layer

Create IRS:

```bash
IRS_STATE=$(node scripts/cli/derive-pda.js irs-state --owner "$ISSUER_WALLET" | jq -r .pubkey)

node scripts/cli/fracks_irs/initialize_irs.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --irs_state "$IRS_STATE"
```

### 3. TIR and CTR layer

```bash
TOKEN_MINT=<TOKEN_MINT_PUBKEY>
TIR_STATE=$(node scripts/cli/derive-pda.js tir-state --mint "$TOKEN_MINT" | jq -r .pubkey)
CTR_STATE=$(node scripts/cli/derive-pda.js ctr-state --mint "$TOKEN_MINT" | jq -r .pubkey)
ISSUER_ENTRY=$(node scripts/cli/derive-pda.js issuer-entry --tir "$TIR_STATE" --issuer_fid "$ISSUER_FID" | jq -r .pubkey)

node scripts/cli/fracks_tir/initialize_tir.js --wallet-path "$ISSUER_KEYPAIR" --tir_state "$TIR_STATE" --token_mint "$TOKEN_MINT"
node scripts/cli/fracks_ctr/initialize_ctr.js --wallet-path "$ISSUER_KEYPAIR" --ctr_state "$CTR_STATE" --token_mint "$TOKEN_MINT"

node scripts/cli/fracks_ctr/add_claim_topic.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --ctr_state "$CTR_STATE" \
  --topic_id 1

node scripts/cli/fracks_tir/add_trusted_issuer.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --tir_state "$TIR_STATE" \
  --issuer_entry "$ISSUER_ENTRY" \
  --issuer_fid "$ISSUER_FID" \
  --topics '[1]' \
  --label "Primary Issuer"
```

### 4. IRP layer

Initialize the IRP registry, bind it to the IRS, and register at least one identity agent.

```bash
IRP_STATE=$(node scripts/cli/derive-pda.js irp-state --mint "$TOKEN_MINT" | jq -r .pubkey)

node scripts/cli/fracks_irp/initialize_registry.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --registry_state "$IRP_STATE" \
  --token_mint "$TOKEN_MINT" \
  --irs "$IRS_STATE" \
  --tir "$TIR_STATE" \
  --ctr "$CTR_STATE"

node scripts/cli/fracks_irs/bind_registry.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --irs_state "$IRS_STATE" \
  --irp_pubkey "$IRP_STATE"

node scripts/cli/fracks_irp/add_identity_agent.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --registry_state "$IRP_STATE" \
  --agent "$ISSUER_WALLET"
```

### 5. IRS identity registration

Recommended flow: call these as an identity agent with `--authority` plus the bound `--registry_state`.

Register investor identity:

```bash
WALLET_IDENTITY=$(node scripts/cli/derive-pda.js wallet-identity --irs "$IRS_STATE" --wallet "$INVESTOR_WALLET" | jq -r .pubkey)

node scripts/cli/fracks_irs/register_identity.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --authority "$ISSUER_WALLET" \
  --irs_state "$IRS_STATE" \
  --registry_state "$IRP_STATE" \
  --wallet_identity "$WALLET_IDENTITY" \
  --wallet "$INVESTOR_WALLET" \
  --fid "$INVESTOR_FID" \
  --country 840
```

Check verification:

```bash
node scripts/cli/fracks_irp/is_verified.js \
  --registry_state "$IRP_STATE" \
  --irs_state "$IRS_STATE" \
  --tir_state "$TIR_STATE" \
  --ctr_state "$CTR_STATE" \
  --wallet_identity "$WALLET_IDENTITY" \
  --wallet "$INVESTOR_WALLET"
```

### 6. Compliance and modules

```bash
COMPLIANCE_STATE=$(node scripts/cli/derive-pda.js compliance-state --mint "$TOKEN_MINT" | jq -r .pubkey)
MAX_TRANSFER_MODULE=$(node scripts/cli/derive-pda.js mod-max-transfer --mint "$TOKEN_MINT" | jq -r .pubkey)

node scripts/cli/fracks_compliance/initialize_compliance.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --compliance_state "$COMPLIANCE_STATE" \
  --token_mint "$TOKEN_MINT"

node scripts/cli/mod_max_transfer/initialize_module.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --module_state "$MAX_TRANSFER_MODULE" \
  --token_mint "$TOKEN_MINT" \
  --max_amount 1000

node scripts/cli/fracks_compliance/bind_module.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --compliance_state "$COMPLIANCE_STATE" \
  --module_pubkey "$MAX_TRANSFER_MODULE"
```

### 7. Token layer

```bash
TOKEN_STATE=$(node scripts/cli/derive-pda.js token-state --mint "$TOKEN_MINT" | jq -r .pubkey)
OWNER_STATE=$(node scripts/cli/derive-pda.js owner-state --mint "$TOKEN_MINT" | jq -r .pubkey)
AGENT_ROLE=$(node scripts/cli/derive-pda.js agent-role --mint "$TOKEN_MINT" --agent "$ISSUER_WALLET" | jq -r .pubkey)
INVESTOR_FROZEN=$(node scripts/cli/derive-pda.js frozen-wallet --mint "$TOKEN_MINT" --wallet "$INVESTOR_WALLET" | jq -r .pubkey)
COMPLIANCE_PROGRAM=9XYxZzDfU17BBpN1qhdu7RDCCrV6uebDgi5xse7Jbz5d
IRS_PROGRAM=CsrdR7QK3ma6hxU46Cp4DZHAdbGPWPiwmGjhKsR9VzdS

node scripts/cli/fracks_token/initialize_token.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --token_state "$TOKEN_STATE" \
  --owner_state "$OWNER_STATE" \
  --token_mint "$TOKEN_MINT" \
  --name "FRACKS Example" \
  --symbol "FRX" \
  --decimals 6 \
  --isin "US0000000000" \
  --identity_registry "$IRP_STATE" \
  --compliance "$COMPLIANCE_STATE"

node scripts/cli/fracks_token/add_agent.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --token_state "$TOKEN_STATE" \
  --owner_state "$OWNER_STATE" \
  --agent_role "$AGENT_ROLE" \
  --agent "$ISSUER_WALLET"
```

Mint:

```bash
node scripts/cli/fracks_token/mint.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --agent "$ISSUER_WALLET" \
  --token_state "$TOKEN_STATE" \
  --agent_role "$AGENT_ROLE" \
  --irp_state "$IRP_STATE" \
  --irs_state "$IRS_STATE" \
  --tir_state "$TIR_STATE" \
  --ctr_state "$CTR_STATE" \
  --compliance_state "$COMPLIANCE_STATE" \
  --compliance_program "$COMPLIANCE_PROGRAM" \
  --wallet_identity "$WALLET_IDENTITY" \
  --to_frozen "$INVESTOR_FROZEN" \
  --to "$INVESTOR_WALLET" \
  --amount 100 \
  --to_balance_after 100
```

Recovery:

```bash
NEW_WALLET=<NEW_WALLET_PUBKEY>
NEW_WALLET_IDENTITY=$(node scripts/cli/derive-pda.js wallet-identity --irs "$IRS_STATE" --wallet "$NEW_WALLET" | jq -r .pubkey)
NEW_WALLET_FROZEN=$(node scripts/cli/derive-pda.js frozen-wallet --mint "$TOKEN_MINT" --wallet "$NEW_WALLET" | jq -r .pubkey)

node scripts/cli/fracks_irs/register_identity.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --authority "$ISSUER_WALLET" \
  --irs_state "$IRS_STATE" \
  --registry_state "$IRP_STATE" \
  --wallet_identity "$NEW_WALLET_IDENTITY" \
  --wallet "$NEW_WALLET" \
  --fid "$INVESTOR_FID" \
  --country 840

node scripts/cli/fracks_token/recovery.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --agent "$ISSUER_WALLET" \
  --token_state "$TOKEN_STATE" \
  --agent_role "$AGENT_ROLE" \
  --irp_state "$IRP_STATE" \
  --irs_state "$IRS_STATE" \
  --tir_state "$TIR_STATE" \
  --ctr_state "$CTR_STATE" \
  --new_wallet_identity "$NEW_WALLET_IDENTITY" \
  --lost_wallet_identity "$WALLET_IDENTITY" \
  --new_wallet_frozen "$NEW_WALLET_FROZEN" \
  --irs_program "$IRS_PROGRAM" \
  --lost_wallet "$INVESTOR_WALLET" \
  --new_wallet "$NEW_WALLET" \
  --amount 100
```

### 8. Factory layer

Use the factory only after you are comfortable with the lower-level flows.

Generate the factory args file from the starter template:

```bash
cp scripts/cli/examples/factory/deploy-token-suite.args.json /tmp/deploy-token-suite.args.json
```

Then run:

```bash
TRUSTED_ISSUER_FID=<trusted-issuer-fid-pda>
FACTORY_STATE=$(node scripts/cli/derive-pda.js factory-state | jq -r .pubkey)
DEPLOYMENT=$(node scripts/cli/derive-pda.js deployment --issuer "$ISSUER_WALLET" --salt 0000000000000000000000000000000000000000000000000000000000000001 | jq -r .pubkey)
TOKEN_STATE=$(node scripts/cli/derive-pda.js token-state --mint "$TOKEN_MINT" | jq -r .pubkey)
OWNER_STATE=$(node scripts/cli/derive-pda.js owner-state --mint "$TOKEN_MINT" | jq -r .pubkey)
TIR_STATE=$(node scripts/cli/derive-pda.js tir-state --mint "$TOKEN_MINT" | jq -r .pubkey)
CTR_STATE=$(node scripts/cli/derive-pda.js ctr-state --mint "$TOKEN_MINT" | jq -r .pubkey)
IRP_STATE=$(node scripts/cli/derive-pda.js irp-state --mint "$TOKEN_MINT" | jq -r .pubkey)
COMPLIANCE_STATE=$(node scripts/cli/derive-pda.js compliance-state --mint "$TOKEN_MINT" | jq -r .pubkey)
ISSUER_ENTRY=$(node scripts/cli/derive-pda.js issuer-entry --tir "$TIR_STATE" --issuer_fid "$TRUSTED_ISSUER_FID" | jq -r .pubkey)

cat > /tmp/deploy-token-suite.remaining.json <<JSON
[
  {
    "pubkey": "$ISSUER_ENTRY",
    "isWritable": true,
    "isSigner": false
  }
]
JSON

node scripts/cli/fracks_factory/initialize_factory.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --factory_state "$FACTORY_STATE"

node scripts/cli/fracks_factory/deploy_token_suite.js \
  --wallet-path "$ISSUER_KEYPAIR" \
  --factory_state "$FACTORY_STATE" \
  --deployment "$DEPLOYMENT" \
  --token_state "$TOKEN_STATE" \
  --owner_state "$OWNER_STATE" \
  --irs_state "$IRS_STATE" \
  --tir_state "$TIR_STATE" \
  --ctr_state "$CTR_STATE" \
  --irp_state "$IRP_STATE" \
  --compliance_state "$COMPLIANCE_STATE" \
  --remaining-accounts-file /tmp/deploy-token-suite.remaining.json \
  --args @/tmp/deploy-token-suite.args.json
```

Factory orchestration notes:

- `deployment` must be derived from `[b"deployment", issuer, salt]`.
- `token_state`, `owner_state`, `tir_state`, `ctr_state`, `irp_state`, and `compliance_state` should be fresh PDAs at deploy time.
- `shared_irs` may be `null` or an already initialized IRS PDA. If you pass `shared_irs`, it must already exist.
- Trusted issuer entry PDAs are passed through remaining accounts in the same order as `trusted_issuers` inside `--args`.
- The CLI accepts struct JSON in either `snake_case` or `camelCase`, but the repo examples use `snake_case`.

## Parameter formatting rules

- `pubkey` values must be base58 strings.
- `bool` values accept `true`, `false`, `1`, `0`, `yes`, `no`.
- `u64` and `i64` values can be passed as decimal strings.
- `vec` values can be JSON arrays like `'[1,2,3]'`.
- fixed byte arrays such as `[u8;32]` and `[u8;64]` can be JSON arrays or a hex string like `0xdeadbeef...`.
- struct args such as `--args` or `--program_ids` can be passed as inline JSON or as `@/absolute/or/relative/file.json`.

## Docs to use together

- [FRACKS_CLI_COMMAND_REFERENCE.md](/root/ERC3436/FRACKS_CLI_COMMAND_REFERENCE.md)
- [FRACKS_CLI_TEST_CASES.md](/root/ERC3436/FRACKS_CLI_TEST_CASES.md)
- [FRACKS_TESTING_GUIDE.md](/root/ERC3436/FRACKS_TESTING_GUIDE.md)
