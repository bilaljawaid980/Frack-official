# FRACKS CLI Test Cases

This file is the manual test matrix for the generated CLI wrappers.

Use these files together:
- `FRACKS_CLI_SCRIPTS_GUIDE.md` for environment setup and execution order.
- `FRACKS_CLI_COMMAND_REFERENCE.md` for exact script paths, args, and account flags.
- `node <script> --print-schema` when you want the live IDL-backed schema for one instruction.

Conventions:
- A success case means the instruction should return a transaction signature or a boolean `true`/`false` response in view mode, depending on the instruction.
- A negative case means you intentionally break one prerequisite to confirm the contract rejects bad state transitions.

## fracks_compliance

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `bind_module` | `scripts/cli/fracks_compliance/bind_module.js` | Run after both state accounts exist. Expect the referenced module or registry to be recorded. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |
| `call_module_function` | `scripts/cli/fracks_compliance/call_module_function.js` | Run with the schema accounts and valid state prerequisites. Expect a successful transaction. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |
| `can_transfer` | `scripts/cli/fracks_compliance/can_transfer.js` | Evaluate a transfer that satisfies all bound modules. Expect `true`. | Pass a transfer that violates at least one bound module. Expect `false`. |
| `created` | `scripts/cli/fracks_compliance/created.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `destroyed` | `scripts/cli/fracks_compliance/destroyed.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `initialize_compliance` | `scripts/cli/fracks_compliance/initialize_compliance.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `set_modules_paused` | `scripts/cli/fracks_compliance/set_modules_paused.js` | Run after initialization with the new config value. Expect the config field or pause bit to update. | Call it from an unauthorized signer. Expect rejection. |
| `transferred` | `scripts/cli/fracks_compliance/transferred.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `unbind_module` | `scripts/cli/fracks_compliance/unbind_module.js` | Run after the binding exists. Expect the reference to be removed. | Call it from an unauthorized signer or against a missing record. Expect rejection. |

## fracks_ctr

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `add_claim_topic` | `scripts/cli/fracks_ctr/add_claim_topic.js` | Run after the parent state exists. Expect the new member, topic, or agent record to be added. | Retry the same addition or use an unauthorized signer. Expect rejection. |
| `initialize_ctr` | `scripts/cli/fracks_ctr/initialize_ctr.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `remove_claim_topic` | `scripts/cli/fracks_ctr/remove_claim_topic.js` | Run after the target record exists. Expect it to be removed or closed. | Call it from an unauthorized signer or against a missing record. Expect rejection. |

## fracks_factory

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `create_token_mint` | `scripts/cli/fracks_factory/create_token_mint.js` | Create a real Token-2022 mint account with TransferHook and PermanentDelegate extensions before suite deployment. Expect the mint account to initialize. | Reuse an initialized mint or pass a non-signing mint account. Expect rejection. |
| `deploy_token_suite` | `scripts/cli/fracks_factory/deploy_token_suite.js` | After `create_token_mint`, deploy a full token suite with all pre-derived PDAs and optional trusted issuer/module remaining accounts. Expect linked state accounts and extra-account-metas to initialize. | Reuse the same deployment PDA inputs or omit required linked accounts. Expect deployment failure. |
| `initialize_factory` | `scripts/cli/fracks_factory/initialize_factory.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `transfer_factory_ownership` | `scripts/cli/fracks_factory/transfer_factory_ownership.js` | Run after the source state exists. Expect the pending owner or owner field to update according to the instruction. | Use a non-owner or wrong pending owner. Expect rejection. |
| `update_program_ids` | `scripts/cli/fracks_factory/update_program_ids.js` | Run after initialization with a new value. Expect the target field set to the new value. | Call it from an unauthorized signer. Expect rejection. |

## fracks_fid

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `add_claim` | `scripts/cli/fracks_fid/add_claim.js` | Issue a valid signed claim from an issuer FID to a target FID. Expect the claim PDA to be created with `revoked = false`. | Flip one byte in `--signature` and rerun. Expect `InvalidClaimSignature`. |
| `create_fid` | `scripts/cli/fracks_fid/create_fid.js` | Create a new FID for a wallet that does not already own one. Expect the FID PDA to initialize. | Run it a second time for the same wallet/FID PDA. Expect duplicate creation to fail. |
| `remove_claim` | `scripts/cli/fracks_fid/remove_claim.js` | Run after the target record exists. Expect it to be removed or closed. | Call it from an unauthorized signer or against a missing record. Expect rejection. |
| `revoke_claim` | `scripts/cli/fracks_fid/revoke_claim.js` | Run with the schema accounts and valid state prerequisites. Expect a successful transaction. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |
| `set_management_key` | `scripts/cli/fracks_fid/set_management_key.js` | Run after initialization with the new config value. Expect the config field or pause bit to update. | Call it from an unauthorized signer. Expect rejection. |
| `set_signer_key` | `scripts/cli/fracks_fid/set_signer_key.js` | Run after initialization with the new config value. Expect the config field or pause bit to update. | Call it from an unauthorized signer. Expect rejection. |

## fracks_irp

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `add_identity_agent` | `scripts/cli/fracks_irp/add_identity_agent.js` | Run after the parent state exists. Expect the new member, topic, or agent record to be added. | Retry the same addition or use an unauthorized signer. Expect rejection. |
| `initialize_registry` | `scripts/cli/fracks_irp/initialize_registry.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `is_verified` | `scripts/cli/fracks_irp/is_verified.js` | Use a wallet with IRS identity, required CTR topic, and a trusted active issuer claim. Expect `true`. | Remove the identity, revoke the claim, expire the claim, or deactivate the issuer. Expect `false`. |
| `remove_identity_agent` | `scripts/cli/fracks_irp/remove_identity_agent.js` | Run after the target record exists. Expect it to be removed or closed. | Call it from an unauthorized signer or against a missing record. Expect rejection. |
| `transfer_registry_ownership` | `scripts/cli/fracks_irp/transfer_registry_ownership.js` | Run after the source state exists. Expect the pending owner or owner field to update according to the instruction. | Use a non-owner or wrong pending owner. Expect rejection. |
| `update_ctr_reference` | `scripts/cli/fracks_irp/update_ctr_reference.js` | Run after initialization with a new value. Expect the target field set to the new value. | Call it from an unauthorized signer. Expect rejection. |
| `update_irs_reference` | `scripts/cli/fracks_irp/update_irs_reference.js` | Run after initialization with a new value. Expect the target field set to the new value. | Call it from an unauthorized signer. Expect rejection. |
| `update_tir_reference` | `scripts/cli/fracks_irp/update_tir_reference.js` | Run after initialization with a new value. Expect the target field set to the new value. | Call it from an unauthorized signer. Expect rejection. |

## fracks_irs

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `bind_registry` | `scripts/cli/fracks_irs/bind_registry.js` | Run after both state accounts exist. Expect the referenced module or registry to be recorded. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |
| `initialize_irs` | `scripts/cli/fracks_irs/initialize_irs.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `register_identity` | `scripts/cli/fracks_irs/register_identity.js` | Register a wallet to an initialized IRS state. Expect the wallet identity PDA to initialize. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |
| `remove_identity` | `scripts/cli/fracks_irs/remove_identity.js` | Run after the target record exists. Expect it to be removed or closed. | Call it from an unauthorized signer or against a missing record. Expect rejection. |
| `unbind_registry` | `scripts/cli/fracks_irs/unbind_registry.js` | Run after the binding exists. Expect the reference to be removed. | Call it from an unauthorized signer or against a missing record. Expect rejection. |
| `update_country` | `scripts/cli/fracks_irs/update_country.js` | Run after initialization with a new value. Expect the target field set to the new value. | Call it from an unauthorized signer. Expect rejection. |
| `update_identity` | `scripts/cli/fracks_irs/update_identity.js` | Run after initialization with a new value. Expect the target field set to the new value. | Call it from an unauthorized signer. Expect rejection. |

## fracks_tir

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `add_trusted_issuer` | `scripts/cli/fracks_tir/add_trusted_issuer.js` | Run after the parent state exists. Expect the new member, topic, or agent record to be added. | Retry the same addition or use an unauthorized signer. Expect rejection. |
| `deactivate_issuer` | `scripts/cli/fracks_tir/deactivate_issuer.js` | Run with the schema accounts and valid state prerequisites. Expect a successful transaction. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |
| `initialize_tir` | `scripts/cli/fracks_tir/initialize_tir.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `is_trusted_for_topic` | `scripts/cli/fracks_tir/is_trusted_for_topic.js` | Query an active issuer entry that contains the requested topic. Expect `true`. | Query an inactive issuer or missing topic. Expect `false`. |
| `reactivate_issuer` | `scripts/cli/fracks_tir/reactivate_issuer.js` | Run with the schema accounts and valid state prerequisites. Expect a successful transaction. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |
| `remove_trusted_issuer` | `scripts/cli/fracks_tir/remove_trusted_issuer.js` | Run after the target record exists. Expect it to be removed or closed. | Call it from an unauthorized signer or against a missing record. Expect rejection. |
| `update_issuer_topics` | `scripts/cli/fracks_tir/update_issuer_topics.js` | Run after initialization with a new value. Expect the target field set to the new value. | Call it from an unauthorized signer. Expect rejection. |

## fracks_token

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `accept_ownership` | `scripts/cli/fracks_token/accept_ownership.js` | Run as the pending owner. Expect ownership finalization. | Use a non-owner or wrong pending owner. Expect rejection. |
| `add_agent` | `scripts/cli/fracks_token/add_agent.js` | Run after the parent state exists. Expect the new member, topic, or agent record to be added. | Retry the same addition or use an unauthorized signer. Expect rejection. |
| `burn` | `scripts/cli/fracks_token/burn.js` | Burn through an authorized agent from a verified holder. Expect a transaction signature. | Try from an unauthorized agent or with missing identity/compliance context. Expect rejection. |
| `finalize_recovery` | `scripts/cli/fracks_token/finalize_recovery.js` | Run with the schema accounts and valid state prerequisites. Expect a successful transaction. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |
| `forced_transfer` | `scripts/cli/fracks_token/forced_transfer.js` | Move tokens through an authorized agent between compliant wallets. Expect a transaction signature. | Use an unauthorized agent or invalid compliance inputs. Expect rejection. |
| `freeze_partial` | `scripts/cli/fracks_token/freeze_partial.js` | Run as an authorized agent and confirm the target freeze state changes. | Use a non-agent or wrong PDA. Expect rejection. |
| `freeze_wallet` | `scripts/cli/fracks_token/freeze_wallet.js` | Run as an authorized agent and confirm the target freeze state changes. | Use a non-agent or wrong PDA. Expect rejection. |
| `initialize_token` | `scripts/cli/fracks_token/initialize_token.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `mint` | `scripts/cli/fracks_token/mint.js` | Mint through an authorized agent to a verified and compliant wallet. Expect a transaction signature. | Try minting while paused, to a frozen wallet, or to an unverified wallet. Expect rejection. |
| `pause` | `scripts/cli/fracks_token/pause.js` | Run as the owner and confirm the paused state flips. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |
| `recovery` | `scripts/cli/fracks_token/recovery.js` | Recover balances from a lost wallet to a verified replacement wallet through an authorized agent. Expect a transaction signature. | Use an unauthorized agent or an ineligible replacement identity. Expect rejection. |
| `remove_agent` | `scripts/cli/fracks_token/remove_agent.js` | Run after the target record exists. Expect it to be removed or closed. | Call it from an unauthorized signer or against a missing record. Expect rejection. |
| `set_compliance` | `scripts/cli/fracks_token/set_compliance.js` | Run after initialization with the new config value. Expect the config field or pause bit to update. | Call it from an unauthorized signer. Expect rejection. |
| `set_identity_registry` | `scripts/cli/fracks_token/set_identity_registry.js` | Run after initialization with the new config value. Expect the config field or pause bit to update. | Call it from an unauthorized signer. Expect rejection. |
| `transfer` | `scripts/cli/fracks_token/transfer.js` | Approve a compliant Token-2022 transfer with all required IRP/IRS/TIR/CTR/compliance accounts and any module remaining accounts. Expect an approval transaction signature, followed by a canonical Token-2022 transfer-hook movement. | Try a non-compliant transfer, paused token, or frozen wallet path. Expect rejection. |
| `transfer_ownership` | `scripts/cli/fracks_token/transfer_ownership.js` | Run after the source state exists. Expect the pending owner or owner field to update according to the instruction. | Use a non-owner or wrong pending owner. Expect rejection. |
| `unfreeze_partial` | `scripts/cli/fracks_token/unfreeze_partial.js` | Run as an authorized agent and confirm the target freeze state changes. | Use a non-agent or wrong PDA. Expect rejection. |
| `unfreeze_wallet` | `scripts/cli/fracks_token/unfreeze_wallet.js` | Run as an authorized agent and confirm the target freeze state changes. | Use a non-agent or wrong PDA. Expect rejection. |
| `unpause` | `scripts/cli/fracks_token/unpause.js` | Run as the owner and confirm the paused state flips. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |

## fracks_token_hook

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `approve_transfer` | `scripts/cli/fracks_token_hook/approve_transfer.js` | Run with the schema accounts and valid state prerequisites. Expect a successful transaction. | Use the wrong signer, omit a required prerequisite, or pass inconsistent PDAs. Expect rejection. |
| `execute_transfer_hook` | `scripts/cli/fracks_token_hook/execute_transfer_hook.js` | Invoke through the canonical Token-2022 transfer-hook path after controller approval. Expect the hook to finalize verification/compliance bookkeeping. | Call without a matching approval, with spoofed extra accounts, or outside a Token-2022 transfer invocation. Expect rejection. |
| `initialize_extra_account_metas` | `scripts/cli/fracks_token_hook/initialize_extra_account_metas.js` | Initialize the Token-2022 extra-account-metas PDA for a configured FRACKS mint and compliance module set. Expect the TLV account to be created. | Use a non-canonical mint, wrong token state, or incomplete module remaining accounts. Expect rejection. |

## mod_country_cap

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_country_cap/can_transfer.js` | Run in default view mode. Expect a boolean response. | Remove the prerequisite state or pass violating inputs. Expect `false` or simulation failure. |
| `created` | `scripts/cli/mod_country_cap/created.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `destroyed` | `scripts/cli/mod_country_cap/destroyed.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `initialize_country_count` | `scripts/cli/mod_country_cap/initialize_country_count.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `initialize_module` | `scripts/cli/mod_country_cap/initialize_module.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `set_hook_authority` | `scripts/cli/mod_country_cap/set_hook_authority.js` | Run after initialization with the new config value. Expect the config field or pause bit to update. | Call it from an unauthorized signer. Expect rejection. |
| `transferred` | `scripts/cli/mod_country_cap/transferred.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |

## mod_country_restrict

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_country_restrict/can_transfer.js` | Run in default view mode. Expect a boolean response. | Remove the prerequisite state or pass violating inputs. Expect `false` or simulation failure. |
| `created` | `scripts/cli/mod_country_restrict/created.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `destroyed` | `scripts/cli/mod_country_restrict/destroyed.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `initialize_module` | `scripts/cli/mod_country_restrict/initialize_module.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `transferred` | `scripts/cli/mod_country_restrict/transferred.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |

## mod_daily_limit

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_daily_limit/can_transfer.js` | Run in default view mode. Expect a boolean response. | Remove the prerequisite state or pass violating inputs. Expect `false` or simulation failure. |
| `created` | `scripts/cli/mod_daily_limit/created.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `destroyed` | `scripts/cli/mod_daily_limit/destroyed.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `initialize_module` | `scripts/cli/mod_daily_limit/initialize_module.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `initialize_wallet_usage` | `scripts/cli/mod_daily_limit/initialize_wallet_usage.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `set_hook_authority` | `scripts/cli/mod_daily_limit/set_hook_authority.js` | Run after initialization with the new config value. Expect the config field or pause bit to update. | Call it from an unauthorized signer. Expect rejection. |
| `transferred` | `scripts/cli/mod_daily_limit/transferred.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |

## mod_lockup

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_lockup/can_transfer.js` | Run in default view mode. Expect a boolean response. | Remove the prerequisite state or pass violating inputs. Expect `false` or simulation failure. |
| `created` | `scripts/cli/mod_lockup/created.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `destroyed` | `scripts/cli/mod_lockup/destroyed.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `initialize_module` | `scripts/cli/mod_lockup/initialize_module.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `transferred` | `scripts/cli/mod_lockup/transferred.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |

## mod_max_balance

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_max_balance/can_transfer.js` | Run in default view mode. Expect a boolean response. | Remove the prerequisite state or pass violating inputs. Expect `false` or simulation failure. |
| `created` | `scripts/cli/mod_max_balance/created.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `destroyed` | `scripts/cli/mod_max_balance/destroyed.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `initialize_module` | `scripts/cli/mod_max_balance/initialize_module.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `transferred` | `scripts/cli/mod_max_balance/transferred.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |

## mod_max_investors

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_max_investors/can_transfer.js` | Run in default view mode. Expect a boolean response. | Remove the prerequisite state or pass violating inputs. Expect `false` or simulation failure. |
| `created` | `scripts/cli/mod_max_investors/created.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `destroyed` | `scripts/cli/mod_max_investors/destroyed.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `initialize_module` | `scripts/cli/mod_max_investors/initialize_module.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `set_hook_authority` | `scripts/cli/mod_max_investors/set_hook_authority.js` | Run after initialization with the new config value. Expect the config field or pause bit to update. | Call it from an unauthorized signer. Expect rejection. |
| `transferred` | `scripts/cli/mod_max_investors/transferred.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |

## mod_max_transfer

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_max_transfer/can_transfer.js` | Run in default view mode. Expect a boolean response. | Remove the prerequisite state or pass violating inputs. Expect `false` or simulation failure. |
| `created` | `scripts/cli/mod_max_transfer/created.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `destroyed` | `scripts/cli/mod_max_transfer/destroyed.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `initialize_module` | `scripts/cli/mod_max_transfer/initialize_module.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `transferred` | `scripts/cli/mod_max_transfer/transferred.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |

## mod_supply_cap

| Instruction | Script | Success case | Negative case |
| --- | --- | --- | --- |
| `can_transfer` | `scripts/cli/mod_supply_cap/can_transfer.js` | Run in default view mode. Expect a boolean response. | Remove the prerequisite state or pass violating inputs. Expect `false` or simulation failure. |
| `created` | `scripts/cli/mod_supply_cap/created.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `destroyed` | `scripts/cli/mod_supply_cap/destroyed.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |
| `initialize_module` | `scripts/cli/mod_supply_cap/initialize_module.js` | Run against a fresh PDA. Expect the state account to be initialized. | Retry against the same PDA. Expect duplicate initialization to fail. |
| `set_hook_authority` | `scripts/cli/mod_supply_cap/set_hook_authority.js` | Run after initialization with the new config value. Expect the config field or pause bit to update. | Call it from an unauthorized signer. Expect rejection. |
| `transferred` | `scripts/cli/mod_supply_cap/transferred.js` | Invoke the compliance or module hook with valid parent state. Expect the hook bookkeeping to succeed. | Use incomplete remaining accounts or unauthorized owners where required. Expect failure. |

