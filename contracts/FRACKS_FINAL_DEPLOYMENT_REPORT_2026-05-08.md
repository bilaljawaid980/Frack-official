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
| `mod_country_cap` | `HgJQy5kxbmVGHJs68U1axyWsyWTqkPme8YEhv1QU72sW` | `3Xrn54FTtw5LaMHcqbKi57DQ6esBbBA7FnF612RLH2mz99bAr` |
| `mod_country_restrict` | `6JcKpK45GvhwaPRZoEfLFCNos2eCxCr3N3tGzzaC1ECQ` | `4rVsZZ3joGWjmUKk5fUFzRkk9sTzEG653TguYpaPLjoEjqJgz` |
| `mod_daily_limit` | `EmCSJJLnshcnC7jLHmcHKN3XbMjnHY9mZDMYF1Xppig9` | `61mJ5dxBjtLwg7dchMz1Q7j4fMXsYW1LmZLNpeJRmMLSb18rw` |
| `mod_lockup` | `GqsAXZggWEwVF9EFHHXiAKiKBkcrpzQp3SK7NPZWAfR5` | `3RYF7cDk9yATRA19RpYyNKLeGc6WQLg756YiUaZAmr78SYLXt` |
| `mod_max_balance` | `8r9euzP3dFg8d3sA6fh3Ur73cMbvEAbj5UbigHVEXimZ` | `KZ5ZB37YnMYxpGpcCtrWQrAjSSth8dWyuCx5CMmE4eLrqccUv` |
| `mod_max_investors` | `FMSVzD74EbSiTj2XHi8xsqcp6pigdxHL7MGHxtRLYte7` | `EhcdQT9ZgcP99VkRV5vBLQ1VeP63RFvBJbw7PaJZSbcjG1zxc` |
| `mod_max_transfer` | `8EiBd6256x7CfFE1vqGLGBqviiCs64ubZzTVmDwjnQAw` | `3DQfF8oA8moLLZcY8ZtXtHXWnrMXdrax2dPjYPAbtxsDWesEj` |
| `mod_supply_cap` | `EGJvV5cBN7et6Pdthyj6z7xuN8FN2u1wtGQsUjR69Rxb` | `2xiuENb2RgmbLEehHkuhAAbuMZsHjibq3xhaNf4tM5bWBRLvr` |

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
  --program-to-upgrade-id 3Vd81SWhR97nafQjsb43NGuP2L3RiCVcyzprXJ2yFs5M \
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

- Factory program: https://explorer.solana.com/address/3Vd81SWhR97nafQjsb43NGuP2L3RiCVcyzprXJ2yFs5M?cluster=testnet
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
