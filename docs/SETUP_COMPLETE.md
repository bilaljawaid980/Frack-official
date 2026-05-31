# ✅ TREX Platform Setup Complete

## What You Have

✅ **7 Contract Code IDs** (from DEPLOYED_CODEIDS.pdf)
✅ **Instantiation Scripts** (fully automated)
✅ **Wallets Setup** (7 required roles)
✅ **Identity System** (OnchainID + KYC/AML)
✅ **Token Factory** (create unlimited tokens)
✅ **Complete Documentation** (4 guides + reference)

---

## 🚀 To Instantiate Your Platform (5 Minutes)

### Windows PowerShell:
```powershell
cd C:\Users\User\Desktop\contract\3643
.\instantiate.ps1
```

### Or WSL:
```bash
cd /mnt/c/Users/User/Desktop/contract/3643
chmod +x scripts/instantiate_all.sh
./scripts/instantiate_all.sh
```

**Output:** `scripts/instantiation_config.env` with all addresses & wallets

---

## 📋 Files Created for You

### Automation Scripts
- **`scripts/instantiate_all.sh`** — Main instantiation script (creates wallets + contracts + identities)
- **`instantiate.ps1`** — PowerShell wrapper (runs instantiation from Windows)

### Documentation
- **`INSTANTIATION_QUICK_REF.md`** ← **START HERE** (1-page cheat sheet)
- **`docs/INSTANTIATION_GUIDE.md`** — Complete guide (all options explained)
- **`docs/INSTANTIATION_QUICK_START.md`** — WSL-focused guide
- **`DEPLOYED_CODES_REFERENCE.md`** — Contract reference (from PDF)
- **`docs/DEMO_DEPLOYMENT.md`** — Demo scenario

### Configuration
- **`scripts/instantiation_config.env`** — Generated after script runs (saves all addresses)

---

## 📊 Architecture (What Gets Instantiated)

```
Your TREX Platform
├── 6 Core Contracts
│   ├── Claim Topics Registry (Code 1596)
│   ├── Trusted Issuers Registry (Code 1597)
│   ├── Identity Registry (Code 1594)
│   ├── Compliance Contract (Code 1598)
│   └── Factory (Code 1660)
│
├── 7 Wallets (auto-created)
│   ├── Platform Owner
│   ├── KYC Issuer
│   ├── Investor 1, 2, 3
│   └── Fund RealEstate, Fund Stocks
│
└── 5 Identity Contracts (OnchainID)
    └── One per wallet (with KYC/AML claims)
```

---

## ⚡ Quick Commands

### 1. Instantiate Everything
```powershell
.\instantiate.ps1
```

### 2. Load Configuration (after instantiation)
```bash
source scripts/instantiation_config.env
```

### 3. Create First Token
```bash
source scripts/instantiation_config.env

ASSET_MSG='{"create_token":{"reference_id":"PROP-001","name":"Miami Property","symbol":"MIAMIPT","decimals":6,"description":"Real estate token","legal_owner":"'$FUND_REALESTATE'","metadata":"{\"type\":\"real-estate\",\"value\":2500000}","initial_supply":"10000000000","initial_holder":"'$FUND_REALESTATE'"}}'

zigchaind tx wasm execute $FACTORY_ADDR "$ASSET_MSG" \
  --from fund_realestate \
  --node $RPC --chain-id $CHAIN_ID \
  --gas auto --gas-adjustment 1.5 --gas-prices 0.025uzig \
  --keyring-backend test -y
```

### 4. Verify KYC (check it worked)
```bash
source scripts/instantiation_config.env

zigchaind query wasm contract-state smart $INV1_ONCHAIN_ADDR \
  '{"has_valid_claim":{"topic":1}}' --node $RPC
```

---

## 📚 Which Guide to Read?

- **Quick (2 min):** [INSTANTIATION_QUICK_REF.md](INSTANTIATION_QUICK_REF.md) ← START HERE
- **Complete (10 min):** [docs/INSTANTIATION_GUIDE.md](docs/INSTANTIATION_GUIDE.md)
- **WSL Details (10 min):** [docs/INSTANTIATION_QUICK_START.md](docs/INSTANTIATION_QUICK_START.md)
- **Contract Reference:** [DEPLOYED_CODES_REFERENCE.md](DEPLOYED_CODES_REFERENCE.md)
- **Demo Scenario:** [docs/DEMO_DEPLOYMENT.md](docs/DEMO_DEPLOYMENT.md)

---

## ✅ Next Steps

1. **Run instantiation script** → Creates platform
2. **Load config** → `source scripts/instantiation_config.env`
3. **Create asset tokens** → Via factory
4. **Mint to funds** → Initial supply
5. **Transfer between investors** → With compliance checks

---

## 🎯 Your Platform Supports

- ✅ Multiple asset tokens (via factory)
- ✅ Identity verification (KYC/AML claims)
- ✅ Compliance enforcement (transfer validation)
- ✅ Batch transfers
- ✅ Frozen accounts
- ✅ Country restrictions
- ✅ Wallet recovery
- ✅ Force transfers (by controller)

---

## 📞 Need Help?

All scripts have error handling. If something fails:
1. Check that wallets have funds (100+ uzig each)
2. Verify zigchaind is installed: `zigchaind version`
3. Check network connectivity: `ping public-zigchain-testnet-rpc.numia.xyz`
4. Read error message — usually tells you what's wrong

---

**Status:** ✅ Ready to instantiate  
**Time:** ~5 minutes to complete  
**Platform:** Windows + WSL  

**Get started:**
```powershell
cd C:\Users\User\Desktop\contract\3643
.\instantiate.ps1
```

Then follow the output instructions. Your platform will be live! 🚀
