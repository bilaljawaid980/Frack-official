# FRACKS Final Deployment Report

Date: 2026-05-08  
Cluster: Solana testnet  
Primary operator wallet used in this session: `7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E`

## Summary

This session completed final testnet authority normalization and release validation. It did not complete a governance-executed factory program upgrade because the local Squads CLI failed when initiating the proposal transaction.

## Build And Test Results

- `anchor build` -> success
- `anchor test --skip-build --skip-lint` -> success
- passing tests -> `30`

## Live Governance Corrections Executed

The following upgrade-authority transfers were executed on 2026-05-08 from deployer wallet `7LA1...` to Squads vault PDA `Cftz...` using:

```bash
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z \
  --skip-new-upgrade-authority-signer-check \
  --url https://api.testnet.solana.com
```

| Program | Program ID | Transfer Signature |
| --- | --- | --- |
| `fracks_fid` | `7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH` | `4AQVH4eazQeKbk8WCsvRjUopvLfmdU1GAQ9KtPYVfTPTAXooJ` |
| `mod_country_cap` | `Cv1HA7nHX8vxZvyCKXjk3gYPkqhfHFXxEsyxSXyRT3Ci` | `3Xrn54FTtw5LaMHcqbKi57DQ6esBbBA7FnF612RLH2mz99bAr` |
| `mod_country_restrict` | `BCGKsDTyncA4EbHzxGVmEi3pheotJiaxCwYvHGxERiZ7` | `4rVsZZ3joGWjmUKk5fUFzRkk9sTzEG653TguYpaPLjoEjqJgz` |
| `mod_daily_limit` | `FYJ1K8cWUsDmbxNpgaBaEmm3RpvvfpxBBWg2MLm4x8Sq` | `61mJ5dxBjtLwg7dchMz1Q7j4fMXsYW1LmZLNpeJRmMLSb18rw` |
| `mod_lockup` | `6XqxWPwZQrfTo2ZJeT7wBhJaXd1eKjB2kx5ZrP1CLwa9` | `3RYF7cDk9yATRA19RpYyNKLeGc6WQLg756YiUaZAmr78SYLXt` |
| `mod_max_balance` | `9BjLakhcX1ms34VjRwUgMZQAgdbsMM8C1gSPqrJTyCpH` | `KZ5ZB37YnMYxpGpcCtrWQrAjSSth8dWyuCx5CMmE4eLrqccUv` |
| `mod_max_investors` | `4KVbq2esECUHZZdsBiDMM3mxYt8K7rNJUdotG6uZJfRQ` | `EhcdQT9ZgcP99VkRV5vBLQ1VeP63RFvBJbw7PaJZSbcjG1zxc` |
| `mod_max_transfer` | `Ee6RXC46Nb4Bo2BTQcXBHfuxLZdzbKtPmb3sGf2Egiqh` | `3DQfF8oA8moLLZcY8ZtXtHXWnrMXdrax2dPjYPAbtxsDWesEj` |
| `mod_supply_cap` | `EkgX6pGFCFT7FuNWuBAAMePy43iU9oETLDota4nTA3x8` | `2xiuENb2RgmbLEehHkuhAAbuMZsHjibq3xhaNf4tM5bWBRLvr` |

## Buffer Deployment Performed

Local factory upgrade artifact written to testnet buffer:

- program artifact: `target/deploy/fracks_factory.so`
- buffer address: `AghYNVsNAuHTMQJEYYPUs7rfNqGiUeaPe5uq7uxoMh42`
- write-buffer signature: `wSLGYozdsiQKp4SRj1WaLhjGk4ERqn2H3zaMwMNiq41M5ShxM`

## Governance Upgrade Attempt

Attempted command:

```bash
squads-multisig-cli initiate-program-upgrade \
  --rpc-url https://api.testnet.solana.com \
  --buffer-address AghYNVsNAuHTMQJEYYPUs7rfNqGiUeaPe5uq7uxoMh42 \
  --keypair ~/.config/solana/id.json \
  --multisig-pubkey 8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm \
  --vault-index 0 \
  --program-to-upgrade-id 6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe \
  --spill-address 7LA1ZMrc4j19sCSnXFmmiLvjo6KVWENwv9aS4oXYKq2E
```

Result:

- proposal initiation failed
- CLI error:
  - `Transaction simulation failed: Error processing Instruction 1: Failed to serialize or deserialize account data`

Assessment:

- release staging buffer exists
- governance execution path from this local CLI is not currently working
- no factory program upgrade was executed

## Current Testnet Program State

All configured FRACKS core and module programs now verify with upgrade authority:

- `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`

## Explorer Links

Program explorer base:

- `https://explorer.solana.com/address/<PROGRAM_ID>?cluster=testnet`

Key links:

- Factory program: https://explorer.solana.com/address/6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe?cluster=testnet
- Token program: https://explorer.solana.com/address/Gr9Y5q2aHtQEpYHgqme3hctqQ2sNRGF1ZVx9cQvMDjBn?cluster=testnet
- Token hook program: https://explorer.solana.com/address/CQwdsA97gSiPMUzNXjS22AUu6HmvzMK2XZVqhswYEHLi?cluster=testnet
- Governance multisig: https://explorer.solana.com/address/8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm?cluster=testnet
- Buffer account: https://explorer.solana.com/address/AghYNVsNAuHTMQJEYYPUs7rfNqGiUeaPe5uq7uxoMh42?cluster=testnet

Example transaction links:

- Buffer write: https://explorer.solana.com/tx/wSLGYozdsiQKp4SRj1WaLhjGk4ERqn2H3zaMwMNiq41M5ShxM?cluster=testnet
- `fracks_fid` authority transfer: https://explorer.solana.com/tx/4AQVH4eazQeKbk8WCsvRjUopvLfmdU1GAQ9KtPYVfTPTAXooJ?cluster=testnet

## Deployment Verdict

- governance authority remediation: complete
- local artifact buffer staging: complete
- governance-executed factory upgrade: not complete
- final release status: partially staged, pending Squads-compatible proposal/execution path
