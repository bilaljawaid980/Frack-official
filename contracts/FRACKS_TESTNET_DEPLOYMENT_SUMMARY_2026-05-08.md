# FRACKS Testnet Deployment Summary

Date: 2026-05-08

## Summary Verdict

- Tests: green
- Governance custody: green
- Factory upgrade execution through Squads: not yet complete

## Final Program Set

| Program | Program ID |
| --- | --- |
| `fracks_factory` | `6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe` |
| `fracks_token` | `Gr9Y5q2aHtQEpYHgqme3hctqQ2sNRGF1ZVx9cQvMDjBn` |
| `fracks_token_hook` | `CQwdsA97gSiPMUzNXjS22AUu6HmvzMK2XZVqhswYEHLi` |
| `fracks_fid` | `7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH` |
| `fracks_irp` | `6dDKwtRbGkHJhU9LztpDkBC3fUdM46WeKJdrASFikce6` |
| `fracks_irs` | `CsrdR7QK3ma6hxU46Cp4DZHAdbGPWPiwmGjhKsR9VzdS` |
| `fracks_tir` | `Am5W7oEe8NCU4jdLP8qyUT3gjUPCDsvTSxGhdCQp1ETS` |
| `fracks_ctr` | `B15EFQKwnfbNHXHhPVvVcw18PaBeTDsRLNRno3QS8Yna` |
| `fracks_compliance` | `9XYxZzDfU17BBpN1qhdu7RDCCrV6uebDgi5xse7Jbz5d` |
| `mod_country_cap` | `Cv1HA7nHX8vxZvyCKXjk3gYPkqhfHFXxEsyxSXyRT3Ci` |
| `mod_country_restrict` | `BCGKsDTyncA4EbHzxGVmEi3pheotJiaxCwYvHGxERiZ7` |
| `mod_daily_limit` | `FYJ1K8cWUsDmbxNpgaBaEmm3RpvvfpxBBWg2MLm4x8Sq` |
| `mod_lockup` | `6XqxWPwZQrfTo2ZJeT7wBhJaXd1eKjB2kx5ZrP1CLwa9` |
| `mod_max_balance` | `9BjLakhcX1ms34VjRwUgMZQAgdbsMM8C1gSPqrJTyCpH` |
| `mod_max_investors` | `4KVbq2esECUHZZdsBiDMM3mxYt8K7rNJUdotG6uZJfRQ` |
| `mod_max_transfer` | `Ee6RXC46Nb4Bo2BTQcXBHfuxLZdzbKtPmb3sGf2Egiqh` |
| `mod_supply_cap` | `EkgX6pGFCFT7FuNWuBAAMePy43iU9oETLDota4nTA3x8` |

## Governance State

- multisig: `8jLbfuXMGrzS9zzMnwwdfaJrDXyHWeBTvtnaJgaFedmm`
- vault PDA: `CftzQNMAZhuf3KBw8eR5DtPfaRLdakcBxqRt9paAJe9z`
- threshold: `2-of-3`
- verified final upgrade authority for all programs: `Cftz...`

## Signatures Collected In This Session

- buffer write:
  - `wSLGYozdsiQKp4SRj1WaLhjGk4ERqn2H3zaMwMNiq41M5ShxM`
- authority transfers:
  - `4AQVH4eazQeKbk8WCsvRjUopvLfmdU1GAQ9KtPYVfTPTAXooJ`
  - `3Xrn54FTtw5LaMHcqbKi57DQ6esBbBA7FnF612RLH2mz99bAr`
  - `4rVsZZ3joGWjmUKk5fUFzRkk9sTzEG653TguYpaPLjoEjqJgz`
  - `61mJ5dxBjtLwg7dchMz1Q7j4fMXsYW1LmZLNpeJRmMLSb18rw`
  - `3RYF7cDk9yATRA19RpYyNKLeGc6WQLg756YiUaZAmr78SYLXt`
  - `KZ5ZB37YnMYxpGpcCtrWQrAjSSth8dWyuCx5CMmE4eLrqccUv`
  - `EhcdQT9ZgcP99VkRV5vBLQ1VeP63RFvBJbw7PaJZSbcjG1zxc`
  - `3DQfF8oA8moLLZcY8ZtXtHXWnrMXdrax2dPjYPAbtxsDWesEj`
  - `2xiuENb2RgmbLEehHkuhAAbuMZsHjibq3xhaNf4tM5bWBRLvr`

## Release Blocker

Factory upgrade proposal initiation through local Squads CLI failed due account data serialization/deserialization mismatch. No factory upgrade execution signature was produced in this session.
