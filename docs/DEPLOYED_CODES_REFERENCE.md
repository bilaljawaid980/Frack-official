# Deployed Contract Codes Reference

**Complete reference of deployed contract code IDs with instantiation instructions**

---

## Overview

This document lists all deployed smart contract code IDs for the CW3643 (TREX) ecosystem on ZigChain testnet, their purposes, and verified instantiation procedures.

---

## 1. OnchainID Contract

**Code ID:** `1594`  
**Creator:** `zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92` (DEPLOYER)  
**Purpose:** Decentralized identity container that stores verifiable claims (KYC, AML, etc.) for individual wallets

### What It Does
- Stores identity claims issued by trusted entities
- Validates claim issuers against Trusted Issuers Registry (TIR)
- Supports claim expiration and revocation
- Links to TIR for issuer authorization checks

### When to Use
- Creating a new identity for any wallet that needs to hold security tokens
- Required for both investors and fund managers
- Each wallet needs its own OnchainID contract

### Instantiation Message

```json
{
  "owner": "zig1walletaddress",
  "trusted_issuers": "zig1g7rx34vu76ckdupyclf7s0nq0rrtje6elrj5s6jl8htndm4xhc0sffnsrw"
}
```

**Field Descriptions:**
- `owner` (required): The wallet address that owns this identity
- `trusted_issuers` (optional but recommended): TIR contract address for claim validation

### Verified Instantiation Command

```bash
zigchaind tx wasm instantiate 1594 \
  '{
    "owner": "zig1pvucnrgua60k4kdzzawcq4qnx0pgq4zu7zdzdd",
    "trusted_issuers": "zig1g7rx34vu76ckdupyclf7s0nq0rrtje6elrj5s6jl8htndm4xhc0sffnsrw"
  }' \
  --from zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 \
  --label "wallet-identity" \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --no-admin -y
```

**After Creation:**
1. Extract contract address from transaction
2. Register in Identity Registry
3. Add required claims (KYC topic 1, AML topic 2)

**Example Deployed Instance:**  
`zig1qvvmr8erexnlr3qcfs8tqthh2une2ufzfsg57vlerg2xwm54vs7qeu6kcd` (rsfund wallet identity)

---

## 2. CW3643 Token Contract

**Code ID:** `1595`  
**Creator:** `zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92` (DEPLOYER)  
**Purpose:** Security token implementing TREX standard with compliance enforcement

### What It Does
- Manages tokenized RWA (Real World Assets)
- Enforces transfer restrictions based on identity verification
- Validates compliance rules before allowing transfers
- Supports pause, freeze, force transfer for regulatory compliance
- Implements CW20 token standard with security extensions

### When to Use
- Created automatically by TREX Factory when creating new assets
- **Not instantiated manually** - use Factory's `create_token` instead

### Instantiation Message (via Factory)

Factory handles instantiation automatically. Use Factory's `create_token` execute message:

```json
{
  "create_token": {
    "reference_id": "PROP-001",
    "name": "Property Token 001",
    "symbol": "PROP001",
    "decimals": 6,
    "description": "Real estate property in Miami",
    "legal_owner": "zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92",
    "metadata": "{\"type\":\"real-estate\",\"location\":\"Miami\",\"value\":500000}",
    "initial_supply": "1000000000",
    "initial_holder": "zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6"
  }
}
```

### Verified Creation Command (via Factory)

```bash
zigchaind tx wasm execute zig1j8xs2n3ukeeaggr5dm49twth2mqnqey74k7wxe420rf0t45ksd7sag704c \
  '{
    "create_token": {
      "reference_id": "PROP-002",
      "name": "Property Token 002",
      "symbol": "PROP002",
      "decimals": 6,
      "description": "Commercial real estate",
      "legal_owner": "zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92",
      "metadata": "{\"type\":\"real-estate\",\"value\":500000}",
      "initial_supply": "1000000000",
      "initial_holder": "zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6"
    }
  }' \
  --from zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 -y
```

**Example Deployed Instance:**  
`zig1a8r4me7t36xvxtq0mt5fd54zta2pqmlv90kmcu7xmdxrygmpnyyqmuta32` (Property Token 001)

**Default Configuration (from Factory):**
- Identity Registry: `zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy`
- Compliance Contract: `zig1mch49ad7hrtn0y3aq6958tfckrju0l2lq66hvfh74lsjmeu56xusjkehgp`
- Owner: `zig1m2n9paum8xx8hyg4v6gz60fmr9f4sdz7d2mg8j`
- Issuer: `zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6`
- Controller: `zig19cjkl38hr04k6xnvfyh37kka9ad289yey7xaxj`

---

## 3. Claim Topics Registry Contract

**Code ID:** `1596`  
**Creator:** `zig19rl4cm2hmr8afy4kldpxz3fka4jguq0aa2g0aa`  
**Purpose:** Defines which claim topics are required for compliance

### What It Does
- Stores list of required claim topics (e.g., [1, 2] for KYC and AML)
- Used by Identity Registry to validate identities have all required claims
- Centralized configuration for compliance requirements

### When to Use
- Already deployed and configured as part of ecosystem
- Rarely needs to be re-instantiated
- Modify topics using `set_required_topics` execute message

### Instantiation Message

```json
{
  "owner": "zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92",
  "required_topics": [1, 2]
}
```

**Field Descriptions:**
- `owner` (required): Address that can update required topics
- `required_topics` (required): Array of topic IDs required for verification

### Verified Instantiation Command

```bash
zigchaind tx wasm instantiate 1596 \
  '{
    "owner": "zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92",
    "required_topics": [1, 2]
  }' \
  --from zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 \
  --label "claim-topics-registry" \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --admin zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 -y
```

**Deployed Instance:**  
`zig1z47k5f09afk7sr46rg7zkzj70xhsvu9eu95hmsjsf5c9rfvvqh0sejrlvh`

**Current Configuration:**
- Owner: DEPLOYER
- Required Topics: [1, 2] (KYC and AML)

---

## 4. Trusted Issuers Registry Contract

**Code ID:** `1597`  
**Creator:** `zig1sewps82xyc7neay2nkfn8q7uw6erj330etrmj8`  
**Purpose:** Whitelist of trusted entities authorized to issue specific claim types

### What It Does
- Maintains list of trusted claim issuers
- Maps each issuer to topics they're authorized for
- OnchainID contracts query TIR to validate claim issuers
- Prevents unauthorized entities from issuing claims

### When to Use
- Already deployed and configured
- Add issuers using `add_issuer` execute message
- One TIR serves all identities in the ecosystem

### Instantiation Message

```json
{
  "owner": "zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6"
}
```

**Field Descriptions:**
- `owner` (required): Address that can manage issuer list (typically KYC provider)

### Verified Instantiation Command

```bash
zigchaind tx wasm instantiate 1597 \
  '{"owner": "zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6"}' \
  --from zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 \
  --label "trusted-issuers-registry" \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --admin zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 -y
```

**After Creation:**
Add authorized issuers:

```bash
zigchaind tx wasm execute <TIR_ADDRESS> \
  '{
    "add_issuer": {
      "issuer": "zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6",
      "topics": [1, 2]
    }
  }' \
  --from zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 -y
```

**Deployed Instance:**  
`zig1g7rx34vu76ckdupyclf7s0nq0rrtje6elrj5s6jl8htndm4xhc0sffnsrw`

**Current Configuration:**
- Owner: ISSUER
- Authorized Issuers:
  - `zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6` → Topics [1, 2]

---

## 5. Compliance Contract

**Code ID:** `1598`  
**Creator:** `zig19rl4cm2hmr8afy4kldpxz3fka4jguq0aa2g0aa`  
**Purpose:** Enforces transfer restrictions and compliance rules

### What It Does
- Validates transfers meet compliance requirements
- Checks identity verification via Identity Registry
- Enforces per-address limits
- Supports country restrictions
- Can integrate compliance modules for custom rules

### When to Use
- Already deployed and configured
- Shared by all tokens created by Factory
- Configure rules using execute messages

### Instantiation Message

```json
{
  "owner": "zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6",
  "identity_registry": "zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy"
}
```

**Field Descriptions:**
- `owner` (required): Address that can configure compliance rules
- `identity_registry` (optional): IR contract to check identity verification

### Verified Instantiation Command

```bash
zigchaind tx wasm instantiate 1598 \
  '{
    "owner": "zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6",
    "identity_registry": "zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy"
  }' \
  --from zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 \
  --label "compliance-contract" \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --admin zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 -y
```

**Deployed Instance:**  
`zig1mch49ad7hrtn0y3aq6958tfckrju0l2lq66hvfh74lsjmeu56xusjkehgp`

**Current Configuration:**
- Owner: ISSUER
- Identity Registry: Linked
- Allowed Countries: None (unrestricted)
- Modules: 0

---

## 6. Identity Registry Contract

**Code ID:** Uses OnchainID code (1594) for identity contracts  
**Purpose:** Central registry linking wallets to their OnchainID contracts

### What It Does
- Maps wallet addresses to OnchainID contract addresses
- Stores country information
- Validates identities have required claims (via CTR)
- Queried by Compliance Contract to verify identities

### When to Use
- Already deployed as part of ecosystem
- Register identities using `register_identity` execute message

### Instantiation Message

```json
{
  "owner": "zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92",
  "trusted_issuers": null,
  "claim_topics": "zig1z47k5f09afk7sr46rg7zkzj70xhsvu9eu95hmsjsf5c9rfvvqh0sejrlvh"
}
```

**Field Descriptions:**
- `owner` (required): Address that can register/unregister identities
- `trusted_issuers` (optional): TIR address (can be null)
- `claim_topics` (optional): CTR address for required topics

### Verified Instantiation Command

```bash
zigchaind tx wasm instantiate 1594 \
  '{
    "owner": "zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92",
    "trusted_issuers": null,
    "claim_topics": "zig1z47k5f09afk7sr46rg7zkzj70xhsvu9eu95hmsjsf5c9rfvvqh0sejrlvh"
  }' \
  --from zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 \
  --label "identity-registry" \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --admin zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 -y
```

**Deployed Instance:**  
`zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy`

**Current Configuration:**
- Owner: DEPLOYER
- Claim Topics Registry: Linked
- Trusted Issuers: null (TIR validation done at OnchainID level)

---

## 7. TREX Factory Contract

**Code ID:** `1660`  
**Creator:** `zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92` (DEPLOYER)  
**Purpose:** Factory for creating security tokens with shared compliance infrastructure

### What It Does
- Creates new CW3643 token contracts for RWA assets
- Maintains registry of all created tokens
- Configures tokens with shared IR and Compliance contracts
- Sets default roles (owner, issuer, controller)
- Tracks assets by reference ID and contract address

### When to Use
- Central entry point for creating new security tokens
- **Use this instead of directly instantiating token contracts**

### Instantiation Message

```json
{
  "token_code_id": 1595,
  "identity_registry": "zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy",
  "compliance": "zig1mch49ad7hrtn0y3aq6958tfckrju0l2lq66hvfh74lsjmeu56xusjkehgp",
  "default_owner": "zig1m2n9paum8xx8hyg4v6gz60fmr9f4sdz7d2mg8j",
  "default_issuer": "zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6",
  "default_controller": "zig19cjkl38hr04k6xnvfyh37kka9ad289yey7xaxj"
}
```

**Field Descriptions:**
- `token_code_id` (required): Code ID of CW3643 token contract (1595)
- `identity_registry` (required): IR contract address
- `compliance` (required): Compliance contract address
- `default_owner` (required): Default owner for new tokens
- `default_issuer` (required): Default issuer (can mint tokens)
- `default_controller` (required): Default controller (can freeze/force transfer)

### Verified Instantiation Command

```bash
zigchaind tx wasm instantiate 1660 \
  '{
    "token_code_id": 1595,
    "identity_registry": "zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy",
    "compliance": "zig1mch49ad7hrtn0y3aq6958tfckrju0l2lq66hvfh74lsjmeu56xusjkehgp",
    "default_owner": "zig1m2n9paum8xx8hyg4v6gz60fmr9f4sdz7d2mg8j",
    "default_issuer": "zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6",
    "default_controller": "zig19cjkl38hr04k6xnvfyh37kka9ad289yey7xaxj"
  }' \
  --from zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 \
  --label "trex-factory" \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --admin zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 -y
```

**Deployed Instance:**  
`zig1j8xs2n3ukeeaggr5dm49twth2mqnqey74k7wxe420rf0t45ksd7sag704c`

**Current Configuration:**
- Admin: DEPLOYER
- Token Code: 1595
- All compliance infrastructure linked
- Default roles configured

---

## Deployment Flow

### Complete Ecosystem Setup (Correct Order)

```bash
# 1. Deploy Claim Topics Registry (CTR)
zigchaind tx wasm instantiate 1596 \
  '{"owner":"zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92","required_topics":[1,2]}' \
  --from zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 \
  --label "ctr" --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --admin zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 -y

# Extract CTR address: zig1z47k5f09afk7sr46rg7zkzj70xhsvu9eu95hmsjsf5c9rfvvqh0sejrlvh

# 2. Deploy Trusted Issuers Registry (TIR)
zigchaind tx wasm instantiate 1597 \
  '{"owner":"zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6"}' \
  --from zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 \
  --label "tir" --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --admin zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 -y

# Extract TIR address: zig1g7rx34vu76ckdupyclf7s0nq0rrtje6elrj5s6jl8htndm4xhc0sffnsrw

# 3. Add issuers to TIR
zigchaind tx wasm execute zig1g7rx34vu76ckdupyclf7s0nq0rrtje6elrj5s6jl8htndm4xhc0sffnsrw \
  '{"add_issuer":{"issuer":"zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6","topics":[1,2]}}' \
  --from zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 -y

# 4. Deploy Identity Registry (IR)
zigchaind tx wasm instantiate 1594 \
  '{
    "owner":"zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92",
    "trusted_issuers":null,
    "claim_topics":"zig1z47k5f09afk7sr46rg7zkzj70xhsvu9eu95hmsjsf5c9rfvvqh0sejrlvh"
  }' \
  --from zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 \
  --label "identity-registry" --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --admin zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 -y

# Extract IR address: zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy

# 5. Deploy Compliance Contract
zigchaind tx wasm instantiate 1598 \
  '{
    "owner":"zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6",
    "identity_registry":"zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy"
  }' \
  --from zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 \
  --label "compliance" --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --admin zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 -y

# Extract Compliance address: zig1mch49ad7hrtn0y3aq6958tfckrju0l2lq66hvfh74lsjmeu56xusjkehgp

# 6. Deploy TREX Factory
zigchaind tx wasm instantiate 1660 \
  '{
    "token_code_id":1595,
    "identity_registry":"zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy",
    "compliance":"zig1mch49ad7hrtn0y3aq6958tfckrju0l2lq66hvfh74lsjmeu56xusjkehgp",
    "default_owner":"zig1m2n9paum8xx8hyg4v6gz60fmr9f4sdz7d2mg8j",
    "default_issuer":"zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6",
    "default_controller":"zig19cjkl38hr04k6xnvfyh37kka9ad289yey7xaxj"
  }' \
  --from zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 \
  --label "trex-factory" --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --admin zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 -y

# Extract Factory address: zig1j8xs2n3ukeeaggr5dm49twth2mqnqey74k7wxe420rf0t45ksd7sag704c
```

---

## User Onboarding Flow

### Creating a Verified Identity

```bash
# 1. Create OnchainID contract
zigchaind tx wasm instantiate 1594 \
  '{
    "owner":"zig1pvucnrgua60k4kdzzawcq4qnx0pgq4zu7zdzdd",
    "trusted_issuers":"zig1g7rx34vu76ckdupyclf7s0nq0rrtje6elrj5s6jl8htndm4xhc0sffnsrw"
  }' \
  --from zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 \
  --label "user-identity" --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 --no-admin -y

# Extract OnchainID address from transaction

# 2. Register in Identity Registry
zigchaind tx wasm execute zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy \
  '{
    "register_identity":{
      "wallet":"zig1pvucnrgua60k4kdzzawcq4qnx0pgq4zu7zdzdd",
      "identity_addr":"<ONCHAINID_ADDRESS>",
      "country":"US"
    }
  }' \
  --from zig1ug335mpcdn2vpk8p08v4k9z7cqtdg0jj4tqr92 \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 -y

# 3. Add KYC claim (topic 1)
zigchaind tx wasm execute <ONCHAINID_ADDRESS> \
  '{
    "add_claim":{
      "topic":1,
      "issuer":"zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6",
      "data":"kyc_verified",
      "expires_at":null
    }
  }' \
  --from zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 -y

# 4. Add AML claim (topic 2)
zigchaind tx wasm execute <ONCHAINID_ADDRESS> \
  '{
    "add_claim":{
      "topic":2,
      "issuer":"zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6",
      "data":"aml_cleared",
      "expires_at":null
    }
  }' \
  --from zig1staghsausa8tee05uelp8cjklv2qpuke5gmna6 \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 -y
```

---

## Summary Table

| Contract | Code ID | Purpose | Deployed Address |
|----------|---------|---------|------------------|
| **OnchainID** | 1594 | Identity claims storage | Multiple (one per wallet) |
| **CW3643 Token** | 1595 | Security token | Created by Factory |
| **Claim Topics Registry** | 1596 | Required topics config | `zig1z47k5f09afk7sr46rg7zkzj70xhsvu9eu95hmsjsf5c9rfvvqh0sejrlvh` |
| **Trusted Issuers Registry** | 1597 | Issuer whitelist | `zig1g7rx34vu76ckdupyclf7s0nq0rrtje6elrj5s6jl8htndm4xhc0sffnsrw` |
| **Compliance Contract** | 1598 | Transfer validation | `zig1mch49ad7hrtn0y3aq6958tfckrju0l2lq66hvfh74lsjmeu56xusjkehgp` |
| **Identity Registry** | 1594 | Wallet→OnchainID mapping | `zig1k9tgxhx5u7ckk7fwsqnezpsavk6sxsnt2yzrslg00etng4pj7skqhdl9uy` |
| **TREX Factory** | 1660 | Token creation factory | `zig1j8xs2n3ukeeaggr5dm49twth2mqnqey74k7wxe420rf0t45ksd7sag704c` |

---

## Common Mistakes

### ❌ Creating OnchainID without `trusted_issuers`
```json
// WRONG - Claims will be unauthorized
{"owner": "zig1address"}
```

```json
// CORRECT - Links to TIR for validation
{
  "owner": "zig1address",
  "trusted_issuers": "zig1g7rx34vu76ckdupyclf7s0nq0rrtje6elrj5s6jl8htndm4xhc0sffnsrw"
}
```

### ❌ Using wrong field name for TIR
```json
// WRONG - Field doesn't exist
{"owner": "zig1address", "tir_address": "zig1..."}
```

```json
// CORRECT - Field is `trusted_issuers`
{"owner": "zig1address", "trusted_issuers": "zig1..."}
```

### ❌ Instantiating token directly instead of using Factory
```bash
# WRONG - Manual instantiation bypasses Factory registry
zigchaind tx wasm instantiate 1595 '...'
```

```bash
# CORRECT - Use Factory's create_token
zigchaind tx wasm execute <FACTORY> '{"create_token":{...}}'
```

---

## Verification Commands

After each instantiation, verify using appropriate query:

```bash
# Verify OnchainID has TIR
zigchaind query wasm contract-state smart <ONCHAINID> '{"get_tir_address":{}}'

# Verify TIR has issuers
zigchaind query wasm contract-state smart <TIR> '{"all_issuers":{}}'

# Verify IR configuration
zigchaind query wasm contract-state smart <IR> '{"config":{}}'

# Verify Factory configuration
zigchaind query wasm contract-state smart <FACTORY> '{"config":{}}'

# Verify identity registered
zigchaind query wasm contract-state smart <IR> '{"identity":{"wallet":"zig1..."}}'

# Verify identity verified
zigchaind query wasm contract-state smart <IR> '{"is_verified":{"wallet":"zig1..."}}'
```

---

**Document Version:** 1.0  
**Last Updated:** December 26, 2025  
**Testnet:** zig-test-2  
**All commands verified:** ✅
