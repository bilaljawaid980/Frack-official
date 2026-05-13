# TREX Platform Instantiation — Quick Reference

**Goal:** Instantiate 6 core contracts + 7 wallets on ZigChain testnet  
**Time:** ~5 minutes  
**Platform:** Windows (PowerShell) + WSL

---

## 🎯 One Command

```powershell
cd C:\Users\User\Desktop\contract\3643
.\instantiate.ps1
```

**That's it.** The script:
1. ✅ Creates 7 wallets
2. ✅ Instantiates 6 contracts in order
3. ✅ Creates 5 identity contracts
4. ✅ Issues KYC claims
5. ✅ Saves addresses to `scripts/instantiation_config.env`

---

## 📋 What Gets Created

### Wallets (7 total)
| Name | Purpose |
|------|---------|
| `platform_owner` | Platform admin |
| `kyc_issuer` | KYC/AML issuer |
| `investor1` | Token holder |
| `investor2` | Token holder |
| `investor3` | Token holder |
| `fund_realestate` | Real estate fund |
| `fund_stocks` | Stock fund |

### Core Contracts (6 total)
| Name | Code ID | Purpose |
|------|---------|---------|
| Claim Topics Registry | 1596 | Defines KYC/AML requirements |
| Trusted Issuers Registry | 1597 | Whitelists KYC providers |
| Identity Registry | 1594 | Maps wallets → identities |
| Compliance | 1598 | Enforces transfer rules |
| Factory | 1660 | Creates security tokens |
| OnchainID (×5) | 1594 | Identity contracts for wallets |

---

## ✅ Verify It Worked

After script completes:

```bash
# Load saved config
source scripts/instantiation_config.env

# Check a wallet has KYC
zigchaind query wasm contract-state smart $INV1_ONCHAIN_ADDR \
  '{"has_valid_claim":{"topic":1}}' --node $RPC

# Should return: {"valid": true}
```

---

## 💰 Create Your First Token

```bash
# Load config
source scripts/instantiation_config.env

# Create real-estate token
ASSET_MSG='{
  "create_token": {
    "reference_id": "PROP-001",
    "name": "Miami Property",
    "symbol": "MIAMIPT",
    "decimals": 6,
    "description": "Tokenized real estate",
    "legal_owner": "'$FUND_REALESTATE'",
    "metadata": "{\"type\":\"real-estate\",\"value\":2500000}",
    "initial_supply": "10000000000",
    "initial_holder": "'$FUND_REALESTATE'"
  }
}'

zigchaind tx wasm execute $FACTORY_ADDR "$ASSET_MSG" \
  --from fund_realestate \
  --node $RPC --chain-id $CHAIN_ID \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --keyring-backend test -y
```

---

## 🔄 Transfer Tokens Between Investors

```bash
# Load config
source scripts/instantiation_config.env

# Investor 1 → Investor 2 (100 tokens)
TRANSFER_MSG='{
  "transfer": {
    "recipient": "'$INVESTOR2'",
    "amount": "100000000"
  }
}'

# TOKEN_ADDR = address from create_token response
zigchaind tx wasm execute $TOKEN_ADDR "$TRANSFER_MSG" \
  --from investor1 \
  --node $RPC --chain-id $CHAIN_ID \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --keyring-backend test -y
```

Automatically checks:
- ✅ Both parties have valid KYC
- ✅ Transfer complies with limits
- ✅ No frozen accounts

---

## ⚠️ If Wallets Have Zero Balance

```bash
# Fund from existing account (if you have one):
zigchaind tx bank send <funded_account> <recipient> 200uzig \
  --from <funded_account> \
  --node https://public-zigchain-testnet-rpc.numia.xyz:443 \
  --chain-id zig-test-2 \
  --gas auto --gas-adjustment 1.5 \
  --keyring-backend test -y
```

Or request from ZigChain testnet faucet.

---

## 📖 Full Guides

- [INSTANTIATION_GUIDE.md](docs/INSTANTIATION_GUIDE.md) — Complete walkthrough
- [INSTANTIATION_QUICK_START.md](docs/INSTANTIATION_QUICK_START.md) — WSL-focused guide
- [DEPLOYED_CODES_REFERENCE.md](DEPLOYED_CODES_REFERENCE.md) — Contract details
- [DEMO_DEPLOYMENT.md](docs/DEMO_DEPLOYMENT.md) — Demo scenario

---

## 🛠️ Troubleshooting

| Error | Fix |
|-------|-----|
| `zigchaind not found` | Install zigchaind or check PATH |
| `jq not found` | Run `sudo apt install -y jq` in WSL |
| `Failed to get address` | Check TX manually: `zigchaind query tx <TXHASH> --node $RPC -o json \| jq '.events'` |
| `Insufficient funds` | Fund wallets from faucet |
| `tx failed: code 11` | Increase gas: `--gas-adjustment 2.0` |

---

## 📊 Platform Architecture

```
Platform Owner
    ↓
    ├→ Claim Topics Registry (KYC, AML topics)
    ├→ Trusted Issuers Registry (Issuer whitelist)
    ├→ Identity Registry (Wallet → OnchainID mapping)
    ├→ Compliance Contract (Transfer validation)
    └→ Factory (Token creation)
            ↓
            └→ Create Tokens (PROP-001, STOCKS-001, etc.)
                    ↓
                    ├→ Investor 1 (KYC verified)
                    ├→ Investor 2 (KYC verified)
                    └→ Investor 3 (KYC verified)
```

---

**Status:** ✅ Ready to instantiate  
**Next Step:** Run `.\instantiate.ps1` in PowerShell
