# FRACKS CLI Command Reference

This file is generated from the built IDLs in `target/idl` and reflects the current contract instruction surface.

Every command is a dedicated wrapper script under `scripts/cli/<program>/<instruction>.js`.

Common behavior:
- Write instructions default to `--mode rpc`.
- Read instructions with return values default to `--mode view`.
- Use `--print-schema` on any script to print the exact required args and accounts.
- Use `--provider-url` and `--wallet-path` to override `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET`.
- Use `--remaining-accounts-file <path.json>` for instructions that need dynamic module or hook accounts.

## fracks_compliance

Program address: `9XYxZzDfU17BBpN1qhdu7RDCCrV6uebDgi5xse7Jbz5d`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `bind_module` | `scripts/cli/fracks_compliance/bind_module.js` | `--module_pubkey` | `--owner`, `--compliance_state` | rpc |
| `call_module_function` | `scripts/cli/fracks_compliance/call_module_function.js` | `--data` | `--owner`, `--compliance_state`, `--module_program` | rpc |
| `can_transfer` | `scripts/cli/fracks_compliance/can_transfer.js` | `--_from`, `--_to`, `--amount`, `--_from_balance`, `--to_balance`, `--from_country`, `--to_country` | `--compliance_state` | view (bool) |
| `created` | `scripts/cli/fracks_compliance/created.js` | `--_to`, `--amount`, `--to_balance_after`, `--_to_country` | `--compliance_state` | rpc |
| `destroyed` | `scripts/cli/fracks_compliance/destroyed.js` | `--_from`, `--amount`, `--from_balance_after`, `--_from_country` | `--compliance_state` | rpc |
| `initialize_compliance` | `scripts/cli/fracks_compliance/initialize_compliance.js` | `--token_mint` | `--owner`, `--compliance_state`, `--system_program` | rpc |
| `set_modules_paused` | `scripts/cli/fracks_compliance/set_modules_paused.js` | `--paused` | `--owner`, `--compliance_state` | rpc |
| `transferred` | `scripts/cli/fracks_compliance/transferred.js` | `--_from`, `--_to`, `--amount`, `--from_balance_after`, `--to_balance_after`, `--_from_country`, `--_to_country` | `--compliance_state` | rpc |
| `unbind_module` | `scripts/cli/fracks_compliance/unbind_module.js` | `--module_pubkey` | `--owner`, `--compliance_state` | rpc |

## fracks_ctr

Program address: `B15EFQKwnfbNHXHhPVvVcw18PaBeTDsRLNRno3QS8Yna`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `add_claim_topic` | `scripts/cli/fracks_ctr/add_claim_topic.js` | `--topic_id` | `--owner`, `--ctr_state` | rpc |
| `initialize_ctr` | `scripts/cli/fracks_ctr/initialize_ctr.js` | `--token_mint` | `--owner`, `--ctr_state`, `--system_program` | rpc |
| `remove_claim_topic` | `scripts/cli/fracks_ctr/remove_claim_topic.js` | `--topic_id` | `--owner`, `--ctr_state` | rpc |

## fracks_factory

Program address: `6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `create_token_mint` | `scripts/cli/fracks_factory/create_token_mint.js` | `--decimals` | `--payer`, `--token_state`, `--token_mint_account`, `--hook_program`, `--token_2022_program`, `--system_program` | rpc |
| `deploy_token_suite` | `scripts/cli/fracks_factory/deploy_token_suite.js` | `--args` | `--issuer`, `--factory_state`, `--deployment`, `--token_state`, `--owner_state`, `--irs_state`, `--tir_state`, `--ctr_state`, `--irp_state`, `--compliance_state`, `--token_mint_account`, `--extra_account_metas`, `--token_program`, `--hook_program`, `--irp_program`, `--irs_program`, `--tir_program`, `--ctr_program`, `--compliance_program`, `--system_program` | rpc |
| `initialize_factory` | `scripts/cli/fracks_factory/initialize_factory.js` | none | `--owner`, `--factory_state`, `--token_program`, `--irp_program`, `--irs_program`, `--tir_program`, `--ctr_program`, `--compliance_program`, `--system_program` | rpc |
| `transfer_factory_ownership` | `scripts/cli/fracks_factory/transfer_factory_ownership.js` | `--new_owner` | `--owner`, `--factory_state` | rpc |
| `update_program_ids` | `scripts/cli/fracks_factory/update_program_ids.js` | `--program_ids` | `--owner`, `--factory_state` | rpc |

## fracks_fid

Program address: `7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `add_claim` | `scripts/cli/fracks_fid/add_claim.js` | `--topic`, `--data_hash`, `--signature`, `--expires_at` | `--issuer_owner`, `--issuer_fid`, `--target_fid`, `--claim`, `--instructions_sysvar`, `--system_program` | rpc |
| `create_fid` | `scripts/cli/fracks_fid/create_fid.js` | `--is_issuer`, `--country` | `--owner`, `--fid`, `--system_program` | rpc |
| `remove_claim` | `scripts/cli/fracks_fid/remove_claim.js` | none | `--authority`, `--fid`, `--claim` | rpc |
| `revoke_claim` | `scripts/cli/fracks_fid/revoke_claim.js` | none | `--issuer_owner`, `--issuer_fid`, `--claim` | rpc |
| `set_management_key` | `scripts/cli/fracks_fid/set_management_key.js` | `--new_key` | `--owner`, `--fid` | rpc |
| `set_signer_key` | `scripts/cli/fracks_fid/set_signer_key.js` | `--new_key` | `--authority`, `--fid` | rpc |

## fracks_irp

Program address: `6dDKwtRbGkHJhU9LztpDkBC3fUdM46WeKJdrASFikce6`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `add_identity_agent` | `scripts/cli/fracks_irp/add_identity_agent.js` | `--agent` | `--owner`, `--registry_state` | rpc |
| `initialize_registry` | `scripts/cli/fracks_irp/initialize_registry.js` | `--token_mint`, `--irs`, `--tir`, `--ctr` | `--owner`, `--registry_state`, `--system_program` | rpc |
| `is_verified` | `scripts/cli/fracks_irp/is_verified.js` | `--wallet` | `--registry_state`, `--irs_state`, `--tir_state`, `--ctr_state`, `--wallet_identity` | view (bool) |
| `remove_identity_agent` | `scripts/cli/fracks_irp/remove_identity_agent.js` | `--agent` | `--owner`, `--registry_state` | rpc |
| `transfer_registry_ownership` | `scripts/cli/fracks_irp/transfer_registry_ownership.js` | `--new_owner` | `--owner`, `--registry_state` | rpc |
| `update_ctr_reference` | `scripts/cli/fracks_irp/update_ctr_reference.js` | `--new_ctr` | `--owner`, `--registry_state` | rpc |
| `update_irs_reference` | `scripts/cli/fracks_irp/update_irs_reference.js` | `--new_irs` | `--owner`, `--registry_state` | rpc |
| `update_tir_reference` | `scripts/cli/fracks_irp/update_tir_reference.js` | `--new_tir` | `--owner`, `--registry_state` | rpc |

## fracks_irs

Program address: `CsrdR7QK3ma6hxU46Cp4DZHAdbGPWPiwmGjhKsR9VzdS`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `bind_registry` | `scripts/cli/fracks_irs/bind_registry.js` | `--irp_pubkey` | `--owner`, `--irs_state` | rpc |
| `initialize_irs` | `scripts/cli/fracks_irs/initialize_irs.js` | none | `--owner`, `--irs_state`, `--system_program` | rpc |
| `register_identity` | `scripts/cli/fracks_irs/register_identity.js` | `--wallet`, `--fid`, `--country` | `--authority`, `--irs_state`, `--registry_state`, `--wallet_identity`, `--system_program` | rpc |
| `remove_identity` | `scripts/cli/fracks_irs/remove_identity.js` | none | `--authority`, `--irs_state`, `--registry_state`, `--wallet_identity` | rpc |
| `unbind_registry` | `scripts/cli/fracks_irs/unbind_registry.js` | `--irp_pubkey` | `--owner`, `--irs_state` | rpc |
| `update_country` | `scripts/cli/fracks_irs/update_country.js` | `--new_country` | `--authority`, `--irs_state`, `--registry_state`, `--wallet_identity` | rpc |
| `update_identity` | `scripts/cli/fracks_irs/update_identity.js` | `--new_fid` | `--authority`, `--irs_state`, `--registry_state`, `--wallet_identity` | rpc |

## fracks_tir

Program address: `Am5W7oEe8NCU4jdLP8qyUT3gjUPCDsvTSxGhdCQp1ETS`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `add_trusted_issuer` | `scripts/cli/fracks_tir/add_trusted_issuer.js` | `--issuer_fid`, `--topics`, `--label` | `--owner`, `--tir_state`, `--issuer_entry`, `--system_program` | rpc |
| `deactivate_issuer` | `scripts/cli/fracks_tir/deactivate_issuer.js` | none | `--owner`, `--tir_state`, `--issuer_entry` | rpc |
| `initialize_tir` | `scripts/cli/fracks_tir/initialize_tir.js` | `--token_mint` | `--owner`, `--tir_state`, `--system_program` | rpc |
| `is_trusted_for_topic` | `scripts/cli/fracks_tir/is_trusted_for_topic.js` | `--issuer_fid`, `--topic` | `--tir_state`, `--issuer_entry` | view (bool) |
| `reactivate_issuer` | `scripts/cli/fracks_tir/reactivate_issuer.js` | none | `--owner`, `--tir_state`, `--issuer_entry` | rpc |
| `remove_trusted_issuer` | `scripts/cli/fracks_tir/remove_trusted_issuer.js` | none | `--owner`, `--tir_state`, `--issuer_entry` | rpc |
| `update_issuer_topics` | `scripts/cli/fracks_tir/update_issuer_topics.js` | `--new_topics` | `--owner`, `--tir_state`, `--issuer_entry` | rpc |

## fracks_token

Program address: `Gr9Y5q2aHtQEpYHgqme3hctqQ2sNRGF1ZVx9cQvMDjBn`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `accept_ownership` | `scripts/cli/fracks_token/accept_ownership.js` | none | `--pending_owner`, `--owner_state` | rpc |
| `add_agent` | `scripts/cli/fracks_token/add_agent.js` | `--agent` | `--owner`, `--token_state`, `--owner_state`, `--agent_role`, `--system_program` | rpc |
| `burn` | `scripts/cli/fracks_token/burn.js` | `--from`, `--amount`, `--from_balance_after` | `--agent`, `--token_state`, `--agent_role`, `--compliance_state`, `--compliance_program`, `--irs_state`, `--from_wallet_identity`, `--token_mint_account`, `--source_token_account`, `--token_program` | rpc |
| `finalize_recovery` | `scripts/cli/fracks_token/finalize_recovery.js` | `--lost_wallet`, `--new_wallet`, `--amount` | `--agent`, `--token_state`, `--agent_role`, `--irs_state`, `--irp_state`, `--new_wallet_identity`, `--lost_wallet_identity`, `--transfer_approval`, `--irs_program` | rpc |
| `forced_transfer` | `scripts/cli/fracks_token/forced_transfer.js` | `--from`, `--to`, `--amount`, `--from_balance`, `--to_balance` | `--agent`, `--token_state`, `--agent_role`, `--irp_state`, `--irs_state`, `--tir_state`, `--ctr_state`, `--compliance_state`, `--compliance_program`, `--from_wallet_identity`, `--to_wallet_identity`, `--to_frozen`, `--from_partial_freeze`, `--token_mint_account`, `--source_token_account`, `--destination_token_account`, `--extra_account_metas`, `--controller_program`, `--hook_program`, `--transfer_approval`, `--system_program`, `--token_program` | rpc |
| `freeze_partial` | `scripts/cli/fracks_token/freeze_partial.js` | `--amount` | `--agent`, `--token_state`, `--agent_role`, `--wallet`, `--partial_freeze`, `--system_program` | rpc |
| `freeze_wallet` | `scripts/cli/fracks_token/freeze_wallet.js` | none | `--agent`, `--token_state`, `--agent_role`, `--wallet`, `--frozen_wallet`, `--system_program` | rpc |
| `initialize_token` | `scripts/cli/fracks_token/initialize_token.js` | `--token_mint`, `--name`, `--symbol`, `--decimals`, `--isin`, `--identity_registry`, `--compliance` | `--owner`, `--token_state`, `--owner_state`, `--system_program` | rpc |
| `mint` | `scripts/cli/fracks_token/mint.js` | `--to`, `--amount`, `--to_balance_after` | `--agent`, `--token_state`, `--agent_role`, `--irp_state`, `--irs_state`, `--tir_state`, `--ctr_state`, `--compliance_state`, `--compliance_program`, `--wallet_identity`, `--to_frozen`, `--token_mint_account`, `--destination_token_account`, `--token_program` | rpc |
| `pause` | `scripts/cli/fracks_token/pause.js` | none | `--owner`, `--token_state`, `--owner_state` | rpc |
| `recovery` | `scripts/cli/fracks_token/recovery.js` | `--lost_wallet`, `--new_wallet`, `--amount` | `--agent`, `--token_state`, `--agent_role`, `--irp_state`, `--irs_state`, `--tir_state`, `--ctr_state`, `--new_wallet_identity`, `--lost_wallet_identity`, `--compliance_state`, `--compliance_program`, `--new_wallet_frozen`, `--irs_program`, `--token_mint_account`, `--lost_token_account`, `--new_token_account`, `--extra_account_metas`, `--controller_program`, `--hook_program`, `--transfer_approval`, `--system_program`, `--token_program` | rpc |
| `remove_agent` | `scripts/cli/fracks_token/remove_agent.js` | none | `--owner`, `--token_state`, `--owner_state`, `--agent_role` | rpc |
| `set_compliance` | `scripts/cli/fracks_token/set_compliance.js` | `--new_compliance` | `--owner`, `--token_state`, `--owner_state` | rpc |
| `set_identity_registry` | `scripts/cli/fracks_token/set_identity_registry.js` | `--new_identity_registry` | `--owner`, `--token_state`, `--owner_state` | rpc |
| `transfer` | `scripts/cli/fracks_token/transfer.js` | `--amount`, `--from_balance`, `--to_balance` | `--token_state`, `--source_token_account`, `--token_mint_account`, `--destination_token_account`, `--from_wallet`, `--to_wallet`, `--extra_account_metas`, `--controller_program`, `--hook_program`, `--transfer_approval`, `--system_program`, `--irp_state`, `--irs_state`, `--tir_state`, `--ctr_state`, `--compliance_state`, `--compliance_program`, `--from_wallet_identity`, `--to_wallet_identity`, `--from_frozen`, `--to_frozen`, `--from_partial_freeze`, `--token_program` | rpc |
| `transfer_ownership` | `scripts/cli/fracks_token/transfer_ownership.js` | `--new_owner` | `--owner`, `--token_state`, `--owner_state` | rpc |
| `unfreeze_partial` | `scripts/cli/fracks_token/unfreeze_partial.js` | `--amount` | `--agent`, `--token_state`, `--agent_role`, `--wallet`, `--partial_freeze`, `--system_program` | rpc |
| `unfreeze_wallet` | `scripts/cli/fracks_token/unfreeze_wallet.js` | none | `--agent`, `--token_state`, `--agent_role`, `--frozen_wallet` | rpc |
| `unpause` | `scripts/cli/fracks_token/unpause.js` | none | `--owner`, `--token_state`, `--owner_state` | rpc |

## fracks_token_hook

Program address: `CQwdsA97gSiPMUzNXjS22AUu6HmvzMK2XZVqhswYEHLi`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `approve_transfer` | `scripts/cli/fracks_token_hook/approve_transfer.js` | `--source_wallet`, `--destination_wallet`, `--authority`, `--amount`, `--from_balance`, `--to_balance`, `--from_country`, `--to_country`, `--kind` | `--payer`, `--controller_authority`, `--token_state`, `--token_mint_account`, `--source_token_account`, `--destination_token_account`, `--transfer_approval`, `--authority_seed`, `--system_program` | rpc |
| `execute_transfer_hook` | `scripts/cli/fracks_token_hook/execute_transfer_hook.js` | `--amount` | `--source_token_account`, `--token_mint_account`, `--destination_token_account`, `--authority`, `--extra_account_metas`, `--controller_program`, `--token_state`, `--transfer_approval`, `--compliance_state`, `--compliance_program` | rpc |
| `initialize_extra_account_metas` | `scripts/cli/fracks_token_hook/initialize_extra_account_metas.js` | none | `--payer`, `--token_state`, `--owner_state`, `--compliance_state`, `--token_mint_account`, `--extra_account_metas`, `--system_program` | rpc |

## mod_country_cap

Program address: `Cv1HA7nHX8vxZvyCKXjk3gYPkqhfHFXxEsyxSXyRT3Ci`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_country_cap/can_transfer.js` | `--amount`, `--to_balance`, `--to_country` | `--module_state`, `--country_count` | view (bool) |
| `created` | `scripts/cli/mod_country_cap/created.js` | `--amount`, `--to_balance_after`, `--to_country` | `--authority`, `--module_state`, `--country_count` | rpc |
| `destroyed` | `scripts/cli/mod_country_cap/destroyed.js` | `--amount`, `--from_balance_after`, `--from_country` | `--authority`, `--module_state`, `--country_count` | rpc |
| `initialize_country_count` | `scripts/cli/mod_country_cap/initialize_country_count.js` | `--country` | `--owner`, `--module_state`, `--country_count`, `--system_program` | rpc |
| `initialize_module` | `scripts/cli/mod_country_cap/initialize_module.js` | `--token_mint`, `--country_caps` | `--owner`, `--module_state`, `--system_program` | rpc |
| `set_hook_authority` | `scripts/cli/mod_country_cap/set_hook_authority.js` | `--hook_authority` | `--owner`, `--module_state` | rpc |
| `transferred` | `scripts/cli/mod_country_cap/transferred.js` | `--amount`, `--from_balance_after`, `--to_balance_after`, `--from_country`, `--to_country` | `--authority`, `--module_state`, `--from_country_count`, `--to_country_count` | rpc |

## mod_country_restrict

Program address: `BCGKsDTyncA4EbHzxGVmEi3pheotJiaxCwYvHGxERiZ7`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_country_restrict/can_transfer.js` | `--from_country`, `--to_country` | `--module_state` | view (bool) |
| `created` | `scripts/cli/mod_country_restrict/created.js` | none | `--module_state` | rpc |
| `destroyed` | `scripts/cli/mod_country_restrict/destroyed.js` | none | `--module_state` | rpc |
| `initialize_module` | `scripts/cli/mod_country_restrict/initialize_module.js` | `--token_mint`, `--blocked_countries` | `--owner`, `--module_state`, `--system_program` | rpc |
| `transferred` | `scripts/cli/mod_country_restrict/transferred.js` | none | `--module_state` | rpc |

## mod_daily_limit

Program address: `FYJ1K8cWUsDmbxNpgaBaEmm3RpvvfpxBBWg2MLm4x8Sq`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_daily_limit/can_transfer.js` | `--amount` | `--module_state`, `--wallet_usage` | view (bool) |
| `created` | `scripts/cli/mod_daily_limit/created.js` | none | `--module_state` | rpc |
| `destroyed` | `scripts/cli/mod_daily_limit/destroyed.js` | none | `--module_state` | rpc |
| `initialize_module` | `scripts/cli/mod_daily_limit/initialize_module.js` | `--token_mint`, `--daily_limit` | `--owner`, `--module_state`, `--system_program` | rpc |
| `initialize_wallet_usage` | `scripts/cli/mod_daily_limit/initialize_wallet_usage.js` | `--wallet` | `--owner`, `--module_state`, `--wallet_usage`, `--system_program` | rpc |
| `set_hook_authority` | `scripts/cli/mod_daily_limit/set_hook_authority.js` | `--hook_authority` | `--owner`, `--module_state` | rpc |
| `transferred` | `scripts/cli/mod_daily_limit/transferred.js` | `--wallet`, `--amount` | `--authority`, `--module_state`, `--wallet_usage` | rpc |

## mod_lockup

Program address: `6XqxWPwZQrfTo2ZJeT7wBhJaXd1eKjB2kx5ZrP1CLwa9`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_lockup/can_transfer.js` | none | `--module_state` | view (bool) |
| `created` | `scripts/cli/mod_lockup/created.js` | none | `--module_state` | rpc |
| `destroyed` | `scripts/cli/mod_lockup/destroyed.js` | none | `--module_state` | rpc |
| `initialize_module` | `scripts/cli/mod_lockup/initialize_module.js` | `--token_mint`, `--lockup_end` | `--owner`, `--module_state`, `--system_program` | rpc |
| `transferred` | `scripts/cli/mod_lockup/transferred.js` | none | `--module_state` | rpc |

## mod_max_balance

Program address: `9BjLakhcX1ms34VjRwUgMZQAgdbsMM8C1gSPqrJTyCpH`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_max_balance/can_transfer.js` | `--amount`, `--to_balance` | `--module_state` | view (bool) |
| `created` | `scripts/cli/mod_max_balance/created.js` | none | `--module_state` | rpc |
| `destroyed` | `scripts/cli/mod_max_balance/destroyed.js` | none | `--module_state` | rpc |
| `initialize_module` | `scripts/cli/mod_max_balance/initialize_module.js` | `--token_mint`, `--max_balance` | `--owner`, `--module_state`, `--system_program` | rpc |
| `transferred` | `scripts/cli/mod_max_balance/transferred.js` | none | `--module_state` | rpc |

## mod_max_investors

Program address: `4KVbq2esECUHZZdsBiDMM3mxYt8K7rNJUdotG6uZJfRQ`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_max_investors/can_transfer.js` | `--amount`, `--to_balance` | `--module_state` | view (bool) |
| `created` | `scripts/cli/mod_max_investors/created.js` | `--amount`, `--to_balance_after` | `--authority`, `--module_state` | rpc |
| `destroyed` | `scripts/cli/mod_max_investors/destroyed.js` | `--amount`, `--from_balance_after` | `--authority`, `--module_state` | rpc |
| `initialize_module` | `scripts/cli/mod_max_investors/initialize_module.js` | `--token_mint`, `--max_investors` | `--owner`, `--module_state`, `--system_program` | rpc |
| `set_hook_authority` | `scripts/cli/mod_max_investors/set_hook_authority.js` | `--hook_authority` | `--owner`, `--module_state` | rpc |
| `transferred` | `scripts/cli/mod_max_investors/transferred.js` | `--amount`, `--from_balance_after`, `--to_balance_after` | `--authority`, `--module_state` | rpc |

## mod_max_transfer

Program address: `Ee6RXC46Nb4Bo2BTQcXBHfuxLZdzbKtPmb3sGf2Egiqh`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_max_transfer/can_transfer.js` | `--amount` | `--module_state` | view (bool) |
| `created` | `scripts/cli/mod_max_transfer/created.js` | none | `--module_state` | rpc |
| `destroyed` | `scripts/cli/mod_max_transfer/destroyed.js` | none | `--module_state` | rpc |
| `initialize_module` | `scripts/cli/mod_max_transfer/initialize_module.js` | `--token_mint`, `--max_amount` | `--owner`, `--module_state`, `--system_program` | rpc |
| `transferred` | `scripts/cli/mod_max_transfer/transferred.js` | none | `--module_state` | rpc |

## mod_supply_cap

Program address: `EkgX6pGFCFT7FuNWuBAAMePy43iU9oETLDota4nTA3x8`

| Instruction | Script | Args | Accounts | Default mode |
| --- | --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_supply_cap/can_transfer.js` | none | `--module_state` | view (bool) |
| `created` | `scripts/cli/mod_supply_cap/created.js` | `--amount` | `--authority`, `--module_state` | rpc |
| `destroyed` | `scripts/cli/mod_supply_cap/destroyed.js` | `--amount` | `--authority`, `--module_state` | rpc |
| `initialize_module` | `scripts/cli/mod_supply_cap/initialize_module.js` | `--token_mint`, `--max_supply` | `--owner`, `--module_state`, `--system_program` | rpc |
| `set_hook_authority` | `scripts/cli/mod_supply_cap/set_hook_authority.js` | `--hook_authority` | `--owner`, `--module_state` | rpc |
| `transferred` | `scripts/cli/mod_supply_cap/transferred.js` | none | `--module_state` | rpc |

