use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use anchor_lang::{interface, InstructionData};
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{
        permanent_delegate::PermanentDelegate,
        transfer_hook::{TransferHook, TransferHookAccount},
        BaseStateWithExtensions, StateWithExtensions,
    },
};
use fracks_compliance::instruction as compliance_instruction;
use solana_program::hash::hash;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    pubkey_data::PubkeyData,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("9JrgWtW4UrQoC3tVQRxWBBEQPjDJ2QFDzAVAvSzGtPJ5");

const FRACKS_TOKEN_PROGRAM_ID: Pubkey = pubkey!("6Naj8HsuNdUJQyyzmPssm1mZRDF7F5VMQ91n9QyMoyGj");
const FRACKS_COMPLIANCE_PROGRAM_ID: Pubkey = pubkey!("HnJiNrmDeVFZksgEXaQwyVqHXQLRcyqXEksbYhkiPFFV");
const MOD_MAX_INVESTORS_PROGRAM_ID: Pubkey = pubkey!("2zfQv7RxmL5BAgXXFagZXBNby4Q41YGH6hnSJAcsXQeU");
const MOD_DAILY_LIMIT_PROGRAM_ID: Pubkey = pubkey!("5dfHskP5MijaDY2gYsE44CPAuomt1vWgbPdGi62cquoT");
const MOD_COUNTRY_CAP_PROGRAM_ID: Pubkey = pubkey!("EcLffdKdSsCpNczazKsSeRw7FCN6vVjKAEMH5CZGBndr");
const TRANSFER_APPROVAL_SPACE: usize = 8 + (32 * 6) + (8 * 3) + (2 * 2) + 1 + 1 + 1 + 1;
const BASE_EXTRA_METAS: usize = 5;
const MAX_MODULE_EXTRA_METAS: usize = 4;
const EXTRA_ACCOUNT_META_SIZE: usize = 35;
const EXTRA_ACCOUNT_METAS_SPACE: usize =
    12 + 4 + (EXTRA_ACCOUNT_META_SIZE * (BASE_EXTRA_METAS + (15 * MAX_MODULE_EXTRA_METAS)));
const TOKEN_STATE_COMPLIANCE_OFFSET: u8 = 72;
const OWNER_STATE_OWNER_OFFSET: usize = 8;
const OWNER_STATE_TOKEN_MINT_OFFSET: usize = 40;
const COMPLIANCE_MODULES_OFFSET: u8 = 76;
const TRANSFER_APPROVAL_KIND_FORCED: u8 = 1;
const TRANSFER_APPROVAL_KIND_RECOVERY: u8 = 2;
const TRANSFER_APPROVAL_SOURCE_WALLET_OFFSET: u8 = 136;
const TRANSFER_APPROVAL_FROM_COUNTRY_OFFSET: u8 = 224;
const TRANSFER_APPROVAL_TO_COUNTRY_OFFSET: u8 = 226;

#[program]
pub mod fracks_token_hook {
    use super::*;

    pub fn initialize_extra_account_metas<'info>(
        ctx: Context<'_, '_, '_, 'info, InitializeExtraAccountMetas<'info>>,
    ) -> Result<()> {
        let token_state = read_token_state(&ctx.accounts.token_state)?;
        validate_owner_state(
            &ctx.accounts.owner_state,
            ctx.accounts.payer.key(),
            token_state.token_mint,
        )?;
        validate_compliance_state(
            &ctx.accounts.compliance_state,
            token_state.compliance,
            token_state.token_mint,
        )?;
        require_keys_eq!(
            token_state.token_mint,
            ctx.accounts.token_mint_account.key(),
            FracksTokenHookError::InvalidTokenState
        );
        validate_token_mint_account(
            &ctx.accounts.token_mint_account,
            &ctx.accounts.token_state,
            &token_state,
        )?;

        let mut metas = vec![
            ExtraAccountMeta::new_with_pubkey(&FRACKS_TOKEN_PROGRAM_ID, false, false)
                .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
            ExtraAccountMeta::new_external_pda_with_seeds(
                5,
                &[
                    Seed::Literal {
                        bytes: b"token_state".to_vec(),
                    },
                    Seed::AccountKey { index: 1 },
                ],
                false,
                false,
            )
            .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal {
                        bytes: b"transfer_approval".to_vec(),
                    },
                    Seed::AccountKey { index: 0 },
                    Seed::AccountKey { index: 2 },
                    Seed::AccountKey { index: 3 },
                ],
                false,
                true,
            )
            .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
            ExtraAccountMeta::new_with_pubkey_data(
                &PubkeyData::AccountData {
                    account_index: 6,
                    data_index: TOKEN_STATE_COMPLIANCE_OFFSET,
                },
                false,
                false,
            )
            .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
            ExtraAccountMeta::new_with_pubkey(&FRACKS_COMPLIANCE_PROGRAM_ID, false, false)
                .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
        ];

        require!(
            ctx.remaining_accounts.len() <= 15,
            FracksTokenHookError::TooManyModules
        );
        let module_count = ctx.remaining_accounts.len();
        for index in 0..module_count {
            let module_account = &ctx.remaining_accounts[index];
            require_keys_eq!(
                module_account.key(),
                read_compliance_module_key(&ctx.accounts.compliance_state, index)?,
                FracksTokenHookError::InvalidComplianceModule
            );
            push_module_metas(&mut metas, module_account, index)?;
        }

        let mut data = ctx.accounts.extra_account_metas.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)
            .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?;
        Ok(())
    }

    pub fn refresh_extra_account_metas<'info>(
        ctx: Context<'_, '_, '_, 'info, RefreshExtraAccountMetas<'info>>,
    ) -> Result<()> {
        let token_state = read_token_state(&ctx.accounts.token_state)?;
        validate_compliance_state(
            &ctx.accounts.compliance_state,
            token_state.compliance,
            token_state.token_mint,
        )?;
        require_keys_eq!(
            token_state.token_mint,
            ctx.accounts.token_mint_account.key(),
            FracksTokenHookError::InvalidTokenState
        );
        validate_token_mint_account(
            &ctx.accounts.token_mint_account,
            &ctx.accounts.token_state,
            &token_state,
        )?;
        validate_extra_account_metas_account(
            &ctx.accounts.extra_account_metas,
            &ctx.accounts.token_mint_account,
        )?;

        let mut metas = vec![
            ExtraAccountMeta::new_with_pubkey(&FRACKS_TOKEN_PROGRAM_ID, false, false)
                .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
            ExtraAccountMeta::new_external_pda_with_seeds(
                5,
                &[
                    Seed::Literal {
                        bytes: b"token_state".to_vec(),
                    },
                    Seed::AccountKey { index: 1 },
                ],
                false,
                false,
            )
            .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal {
                        bytes: b"transfer_approval".to_vec(),
                    },
                    Seed::AccountKey { index: 0 },
                    Seed::AccountKey { index: 2 },
                    Seed::AccountKey { index: 3 },
                ],
                false,
                true,
            )
            .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
            ExtraAccountMeta::new_with_pubkey_data(
                &PubkeyData::AccountData {
                    account_index: 6,
                    data_index: TOKEN_STATE_COMPLIANCE_OFFSET,
                },
                false,
                false,
            )
            .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
            ExtraAccountMeta::new_with_pubkey(&FRACKS_COMPLIANCE_PROGRAM_ID, false, false)
                .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
        ];

        require!(
            ctx.remaining_accounts.len() <= 15,
            FracksTokenHookError::TooManyModules
        );
        for index in 0..ctx.remaining_accounts.len() {
            let module_account = &ctx.remaining_accounts[index];
            require_keys_eq!(
                module_account.key(),
                read_compliance_module_key(&ctx.accounts.compliance_state, index)?,
                FracksTokenHookError::InvalidComplianceModule
            );
            push_module_metas(&mut metas, module_account, index)?;
        }

        let mut data = ctx.accounts.extra_account_metas.try_borrow_mut_data()?;
        ExtraAccountMetaList::update::<ExecuteInstruction>(&mut data, &metas)
            .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?;
        Ok(())
    }

    pub fn approve_transfer(
        ctx: Context<ApproveTransfer>,
        source_wallet: Pubkey,
        destination_wallet: Pubkey,
        authority: Pubkey,
        amount: u64,
        from_balance: u64,
        to_balance: u64,
        from_country: u16,
        to_country: u16,
        kind: u8,
    ) -> Result<()> {
        let token_state = read_token_state(&ctx.accounts.token_state)?;
        require_keys_eq!(
            token_state.token_mint,
            ctx.accounts.token_mint_account.key(),
            FracksTokenHookError::InvalidTokenState
        );
        require_keys_eq!(
            ctx.accounts.controller_authority.key(),
            ctx.accounts.token_state.key(),
            FracksTokenHookError::NotController
        );

        let approval = &mut ctx.accounts.transfer_approval;
        approval.token_state = ctx.accounts.token_state.key();
        approval.source_token_account = ctx.accounts.source_token_account.key();
        approval.destination_token_account = ctx.accounts.destination_token_account.key();
        approval.authority = authority;
        approval.source_wallet = source_wallet;
        approval.destination_wallet = destination_wallet;
        approval.amount = amount;
        approval.from_balance = from_balance;
        approval.to_balance = to_balance;
        approval.from_country = from_country;
        approval.to_country = to_country;
        approval.kind = kind;
        approval.consumed = false;
        approval.finalized = false;
        approval.bump = ctx.bumps.transfer_approval;
        Ok(())
    }

    #[interface(spl_transfer_hook_interface::execute)]
    pub fn execute_transfer_hook<'info>(
        ctx: Context<'_, '_, '_, 'info, ExecuteTransferHook<'info>>,
        amount: u64,
    ) -> Result<()> {
        let token_state = read_token_state(&ctx.accounts.token_state)?;
        let source = read_token_account(&ctx.accounts.source_token_account)?;
        let destination = read_token_account(&ctx.accounts.destination_token_account)?;
        validate_token_mint_account(
            &ctx.accounts.token_mint_account,
            &ctx.accounts.token_state,
            &token_state,
        )?;
        validate_transfer_hook_invocation(
            &ctx.accounts.source_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.token_mint_account,
            &ctx.accounts.extra_account_metas,
        )?;
        require_keys_eq!(
            ctx.accounts.controller_program.key(),
            FRACKS_TOKEN_PROGRAM_ID,
            FracksTokenHookError::InvalidTokenState
        );
        require_keys_eq!(
            ctx.accounts.compliance_state.key(),
            token_state.compliance,
            FracksTokenHookError::InvalidCompliance
        );
        validate_transfer_approval(
            &ctx.accounts.transfer_approval,
            ctx.accounts.token_state.key(),
            ctx.accounts.source_token_account.key(),
            ctx.accounts.destination_token_account.key(),
            ctx.accounts.authority.key(),
            amount,
        )?;
        require!(
            source.amount
                == ctx
                    .accounts
                    .transfer_approval
                    .from_balance
                    .checked_sub(amount)
                    .ok_or_else(|| error!(FracksTokenHookError::InsufficientBalance))?,
            FracksTokenHookError::MissingTransferApproval
        );
        require!(
            destination.amount
                == ctx
                    .accounts
                    .transfer_approval
                    .to_balance
                    .checked_add(amount)
                    .ok_or_else(|| error!(FracksTokenHookError::ArithmeticOverflow))?,
            FracksTokenHookError::MissingTransferApproval
        );

        invoke_compliance_transferred(
            &ctx.accounts.compliance_program,
            &ctx.accounts.compliance_state,
            ctx.remaining_accounts,
            ctx.accounts.transfer_approval.source_wallet,
            ctx.accounts.transfer_approval.destination_wallet,
            amount,
            source.amount,
            destination.amount,
            ctx.accounts.transfer_approval.from_country,
            ctx.accounts.transfer_approval.to_country,
        )?;

        ctx.accounts.transfer_approval.consumed = true;
        ctx.accounts.transfer_approval.finalized =
            ctx.accounts.transfer_approval.kind != TRANSFER_APPROVAL_KIND_RECOVERY;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetas<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Validated against the FRACKS token controller account layout.
    pub token_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the FRACKS token owner account layout.
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Validated against token_state.compliance.
    pub compliance_state: UncheckedAccount<'info>,
    /// CHECK: Token-2022 mint validated in instruction.
    pub token_mint_account: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = EXTRA_ACCOUNT_METAS_SPACE,
        seeds = [b"extra-account-metas", token_mint_account.key().as_ref()],
        bump
    )]
    /// CHECK: TLV extra-account-metas validation account initialized by this instruction.
    pub extra_account_metas: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefreshExtraAccountMetas<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Validated against the FRACKS token controller account layout.
    pub token_state: UncheckedAccount<'info>,
    /// CHECK: Validated against token_state.compliance.
    pub compliance_state: UncheckedAccount<'info>,
    /// CHECK: Token-2022 mint validated in instruction.
    pub token_mint_account: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"extra-account-metas", token_mint_account.key().as_ref()],
        bump
    )]
    /// CHECK: Canonical transfer-hook validation PDA refreshed from compliance state.
    pub extra_account_metas: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ApproveTransfer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Must be the FRACKS token_state PDA and signer from the controller program.
    pub controller_authority: Signer<'info>,
    /// CHECK: Validated against the FRACKS token controller account layout.
    pub token_state: UncheckedAccount<'info>,
    /// CHECK: Token-2022 mint address is checked against token_state.
    pub token_mint_account: UncheckedAccount<'info>,
    /// CHECK: Token-2022 source account.
    pub source_token_account: UncheckedAccount<'info>,
    /// CHECK: Token-2022 destination account.
    pub destination_token_account: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = TRANSFER_APPROVAL_SPACE,
        seeds = [
            b"transfer_approval",
            source_token_account.key().as_ref(),
            destination_token_account.key().as_ref(),
            authority_seed.key().as_ref()
        ],
        bump
    )]
    pub transfer_approval: Account<'info, TransferApproval>,
    /// CHECK: Key-only account used so Anchor can derive the approval PDA from Token-2022 authority.
    pub authority_seed: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteTransferHook<'info> {
    /// CHECK: Token-2022 source token account.
    pub source_token_account: UncheckedAccount<'info>,
    /// CHECK: Token-2022 mint account.
    pub token_mint_account: UncheckedAccount<'info>,
    /// CHECK: Token-2022 destination token account.
    pub destination_token_account: UncheckedAccount<'info>,
    /// CHECK: Transfer authority supplied by Token-2022.
    pub authority: UncheckedAccount<'info>,
    /// CHECK: Transfer-hook validation PDA supplied by Token-2022 clients.
    pub extra_account_metas: UncheckedAccount<'info>,
    /// CHECK: Fixed FRACKS token controller program id used for external PDA resolution.
    pub controller_program: UncheckedAccount<'info>,
    /// CHECK: FRACKS token controller state.
    pub token_state: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [
            b"transfer_approval",
            source_token_account.key().as_ref(),
            destination_token_account.key().as_ref(),
            authority.key().as_ref()
        ],
        bump = transfer_approval.bump
    )]
    pub transfer_approval: Account<'info, TransferApproval>,
    /// CHECK: Resolved from token_state.compliance.
    pub compliance_state: UncheckedAccount<'info>,
    /// CHECK: Canonical FRACKS compliance program.
    pub compliance_program: UncheckedAccount<'info>,
}

#[account]
pub struct TransferApproval {
    pub token_state: Pubkey,
    pub source_token_account: Pubkey,
    pub destination_token_account: Pubkey,
    pub authority: Pubkey,
    pub source_wallet: Pubkey,
    pub destination_wallet: Pubkey,
    pub amount: u64,
    pub from_balance: u64,
    pub to_balance: u64,
    pub from_country: u16,
    pub to_country: u16,
    pub kind: u8,
    pub consumed: bool,
    pub finalized: bool,
    pub bump: u8,
}

struct TokenStateView {
    token_mint: Pubkey,
    compliance: Pubkey,
}

fn read_token_state(account: &AccountInfo) -> Result<TokenStateView> {
    require_keys_eq!(
        *account.owner,
        FRACKS_TOKEN_PROGRAM_ID,
        FracksTokenHookError::InvalidTokenState
    );
    let data = account.try_borrow_data()?;
    require!(data.len() >= 106, FracksTokenHookError::InvalidTokenState);
    require!(
        data[..8] == hash(b"account:TokenState").to_bytes()[..8],
        FracksTokenHookError::InvalidTokenState
    );
    Ok(TokenStateView {
        token_mint: Pubkey::new_from_array(
            data[8..40]
                .try_into()
                .map_err(|_| error!(FracksTokenHookError::InvalidTokenState))?,
        ),
        compliance: Pubkey::new_from_array(
            data[72..104]
                .try_into()
                .map_err(|_| error!(FracksTokenHookError::InvalidTokenState))?,
        ),
    })
}

fn validate_owner_state(
    account: &AccountInfo,
    owner: Pubkey,
    token_mint: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        FRACKS_TOKEN_PROGRAM_ID,
        FracksTokenHookError::InvalidOwnerState
    );
    let data = account.try_borrow_data()?;
    require!(data.len() >= 73, FracksTokenHookError::InvalidOwnerState);
    require!(
        data[..8] == account_discriminator("OwnerState"),
        FracksTokenHookError::InvalidOwnerState
    );
    let stored_owner = Pubkey::new_from_array(
        data[OWNER_STATE_OWNER_OFFSET..OWNER_STATE_OWNER_OFFSET + 32]
            .try_into()
            .map_err(|_| error!(FracksTokenHookError::InvalidOwnerState))?,
    );
    let stored_mint = Pubkey::new_from_array(
        data[OWNER_STATE_TOKEN_MINT_OFFSET..OWNER_STATE_TOKEN_MINT_OFFSET + 32]
            .try_into()
            .map_err(|_| error!(FracksTokenHookError::InvalidOwnerState))?,
    );
    require_keys_eq!(stored_owner, owner, FracksTokenHookError::NotOwner);
    require_keys_eq!(stored_mint, token_mint, FracksTokenHookError::InvalidOwnerState);
    Ok(())
}

fn validate_compliance_state(
    account: &AccountInfo,
    expected_compliance: Pubkey,
    token_mint: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        FRACKS_COMPLIANCE_PROGRAM_ID,
        FracksTokenHookError::InvalidCompliance
    );
    require_keys_eq!(
        account.key(),
        expected_compliance,
        FracksTokenHookError::InvalidCompliance
    );
    let data = account.try_borrow_data()?;
    require!(data.len() >= 76, FracksTokenHookError::InvalidCompliance);
    require!(
        data[..8] == account_discriminator("ComplianceState"),
        FracksTokenHookError::InvalidCompliance
    );
    let stored_mint = Pubkey::new_from_array(
        data[40..72]
            .try_into()
            .map_err(|_| error!(FracksTokenHookError::InvalidCompliance))?,
    );
    require_keys_eq!(stored_mint, token_mint, FracksTokenHookError::InvalidCompliance);
    Ok(())
}

fn read_compliance_module_key(compliance_state: &AccountInfo, index: usize) -> Result<Pubkey> {
    let data = compliance_state.try_borrow_data()?;
    let module_count_bytes = data
        .get(72..76)
        .ok_or_else(|| error!(FracksTokenHookError::InvalidCompliance))?;
    let module_count = u32::from_le_bytes(
        module_count_bytes
            .try_into()
            .map_err(|_| error!(FracksTokenHookError::InvalidCompliance))?,
    ) as usize;
    require!(
        index < module_count && module_count <= 15,
        FracksTokenHookError::InvalidComplianceModule
    );
    let start = COMPLIANCE_MODULES_OFFSET as usize
        + index
            .checked_mul(32)
            .ok_or_else(|| error!(FracksTokenHookError::ArithmeticOverflow))?;
    let end = start
        .checked_add(32)
        .ok_or_else(|| error!(FracksTokenHookError::ArithmeticOverflow))?;
    Ok(Pubkey::new_from_array(
        data.get(start..end)
            .ok_or_else(|| error!(FracksTokenHookError::InvalidComplianceModule))?
            .try_into()
            .map_err(|_| error!(FracksTokenHookError::InvalidComplianceModule))?,
    ))
}

fn push_module_metas(
    metas: &mut Vec<ExtraAccountMeta>,
    module_account: &AccountInfo,
    module_index: usize,
) -> Result<()> {
    let module_meta_index = (5u8)
        .checked_add(
            u8::try_from(metas.len())
                .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
        )
        .ok_or_else(|| error!(FracksTokenHookError::InvalidExtraAccountMetas))?;
    push_compliance_module_meta(metas, module_index)?;

    if is_account_type(module_account, "MaxInvestorsModule")? {
        require_keys_eq!(
            *module_account.owner,
            MOD_MAX_INVESTORS_PROGRAM_ID,
            FracksTokenHookError::InvalidComplianceModule
        );
        push_fixed_meta(metas, &MOD_MAX_INVESTORS_PROGRAM_ID, false, false)?;
        return Ok(());
    }

    if is_account_type(module_account, "DailyTransferLimitModule")? {
        require_keys_eq!(
            *module_account.owner,
            MOD_DAILY_LIMIT_PROGRAM_ID,
            FracksTokenHookError::InvalidComplianceModule
        );
        let program_index = module_meta_index
            .checked_add(1)
            .ok_or_else(|| error!(FracksTokenHookError::InvalidExtraAccountMetas))?;
        push_fixed_meta(metas, &MOD_DAILY_LIMIT_PROGRAM_ID, false, false)?;
        push_external_pda_meta(
            metas,
            program_index,
            &[
                Seed::Literal {
                    bytes: b"daily_usage".to_vec(),
                },
                Seed::AccountKey {
                    index: module_meta_index,
                },
                Seed::AccountData {
                    account_index: 7,
                    data_index: TRANSFER_APPROVAL_SOURCE_WALLET_OFFSET,
                    length: 32,
                },
            ],
            true,
        )?;
        return Ok(());
    }

    if is_account_type(module_account, "InvestorCountryCapModule")? {
        require_keys_eq!(
            *module_account.owner,
            MOD_COUNTRY_CAP_PROGRAM_ID,
            FracksTokenHookError::InvalidComplianceModule
        );
        let program_index = module_meta_index
            .checked_add(1)
            .ok_or_else(|| error!(FracksTokenHookError::InvalidExtraAccountMetas))?;
        push_fixed_meta(metas, &MOD_COUNTRY_CAP_PROGRAM_ID, false, false)?;
        push_external_pda_meta(
            metas,
            program_index,
            &[
                Seed::Literal {
                    bytes: b"country_count".to_vec(),
                },
                Seed::AccountKey {
                    index: module_meta_index,
                },
                Seed::AccountData {
                    account_index: 7,
                    data_index: TRANSFER_APPROVAL_FROM_COUNTRY_OFFSET,
                    length: 2,
                },
            ],
            true,
        )?;
        push_external_pda_meta(
            metas,
            program_index,
            &[
                Seed::Literal {
                    bytes: b"country_count".to_vec(),
                },
                Seed::AccountKey {
                    index: module_meta_index,
                },
                Seed::AccountData {
                    account_index: 7,
                    data_index: TRANSFER_APPROVAL_TO_COUNTRY_OFFSET,
                    length: 2,
                },
            ],
            true,
        )?;
    }

    Ok(())
}

fn push_compliance_module_meta(
    metas: &mut Vec<ExtraAccountMeta>,
    index: usize,
) -> Result<()> {
    metas.push(
        ExtraAccountMeta::new_with_pubkey_data(
            &PubkeyData::AccountData {
                account_index: 8,
                data_index: COMPLIANCE_MODULES_OFFSET
                    .checked_add((index as u8).saturating_mul(32))
                    .ok_or_else(|| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
            },
            false,
            true,
        )
        .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
    );
    Ok(())
}

fn push_fixed_meta(
    metas: &mut Vec<ExtraAccountMeta>,
    pubkey: &Pubkey,
    is_signer: bool,
    is_writable: bool,
) -> Result<()> {
    metas.push(
        ExtraAccountMeta::new_with_pubkey(pubkey, is_signer, is_writable)
            .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
    );
    Ok(())
}

fn push_external_pda_meta(
    metas: &mut Vec<ExtraAccountMeta>,
    program_index: u8,
    seeds: &[Seed],
    is_writable: bool,
) -> Result<()> {
    metas.push(
        ExtraAccountMeta::new_external_pda_with_seeds(program_index, seeds, false, is_writable)
            .map_err(|_| error!(FracksTokenHookError::InvalidExtraAccountMetas))?,
    );
    Ok(())
}

fn read_token_account<'info>(
    token_account_info: &AccountInfo<'info>,
) -> Result<spl_token_2022::state::Account> {
    require_keys_eq!(
        *token_account_info.owner,
        spl_token_2022::id(),
        FracksTokenHookError::InvalidTokenAccount
    );
    let data = token_account_info.try_borrow_data()?;
    let account = StateWithExtensions::<spl_token_2022::state::Account>::unpack(&data)
        .map_err(|_| error!(FracksTokenHookError::InvalidTokenAccount))?;
    Ok(account.base)
}

fn validate_token_mint_account<'info>(
    mint_info: &AccountInfo<'info>,
    token_state_info: &AccountInfo<'info>,
    token_state: &TokenStateView,
) -> Result<()> {
    require_keys_eq!(
        *mint_info.owner,
        spl_token_2022::id(),
        FracksTokenHookError::InvalidTokenAccount
    );
    require_keys_eq!(
        mint_info.key(),
        token_state.token_mint,
        FracksTokenHookError::InvalidTokenAccount
    );
    let data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&data)
        .map_err(|_| error!(FracksTokenHookError::InvalidTokenAccount))?;
    let hook = mint
        .get_extension::<TransferHook>()
        .map_err(|_| error!(FracksTokenHookError::MissingTransferHook))?;
    let hook_program: Option<Pubkey> = hook.program_id.into();
    require!(
        hook_program == Some(id()),
        FracksTokenHookError::MissingTransferHook
    );
    let delegate = mint
        .get_extension::<PermanentDelegate>()
        .map_err(|_| error!(FracksTokenHookError::MissingPermanentDelegate))?;
    let permanent_delegate: Option<Pubkey> = delegate.delegate.into();
    require!(
        permanent_delegate == Some(token_state_info.key()),
        FracksTokenHookError::MissingPermanentDelegate
    );
    Ok(())
}

fn is_account_type(account: &AccountInfo, name: &str) -> Result<bool> {
    let data = account.try_borrow_data()?;
    if data.len() < 8 {
        return Ok(false);
    }
    Ok(data[..8] == account_discriminator(name))
}

fn account_discriminator(name: &str) -> [u8; 8] {
    let digest = hash(format!("account:{name}").as_bytes()).to_bytes();
    digest[..8].try_into().expect("discriminator length")
}

fn validate_transfer_hook_invocation<'info>(
    source_token_account: &AccountInfo<'info>,
    destination_token_account: &AccountInfo<'info>,
    mint_info: &AccountInfo<'info>,
    extra_account_metas: &AccountInfo<'info>,
) -> Result<()> {
    let expected_extra_metas =
        spl_transfer_hook_interface::get_extra_account_metas_address(mint_info.key, &id());
    require_keys_eq!(
        extra_account_metas.key(),
        expected_extra_metas,
        FracksTokenHookError::InvalidExtraAccountMetas
    );
    require_keys_eq!(
        *extra_account_metas.owner,
        id(),
        FracksTokenHookError::InvalidExtraAccountMetas
    );
    require!(
        is_transferring_token_account(source_token_account)?,
        FracksTokenHookError::ProgramCalledOutsideTransfer
    );
    require!(
        is_transferring_token_account(destination_token_account)?,
        FracksTokenHookError::ProgramCalledOutsideTransfer
    );
    Ok(())
}

fn validate_extra_account_metas_account<'info>(
    extra_account_metas: &AccountInfo<'info>,
    mint_info: &AccountInfo<'info>,
) -> Result<()> {
    let expected_extra_metas =
        spl_transfer_hook_interface::get_extra_account_metas_address(mint_info.key, &id());
    require_keys_eq!(
        extra_account_metas.key(),
        expected_extra_metas,
        FracksTokenHookError::InvalidExtraAccountMetas
    );
    require_keys_eq!(
        *extra_account_metas.owner,
        id(),
        FracksTokenHookError::InvalidExtraAccountMetas
    );
    Ok(())
}

fn is_transferring_token_account<'info>(token_account_info: &AccountInfo<'info>) -> Result<bool> {
    let data = token_account_info.try_borrow_data()?;
    let account = StateWithExtensions::<spl_token_2022::state::Account>::unpack(&data)
        .map_err(|_| error!(FracksTokenHookError::InvalidTokenAccount))?;
    let hook_account = account
        .get_extension::<TransferHookAccount>()
        .map_err(|_| error!(FracksTokenHookError::ProgramCalledOutsideTransfer))?;
    Ok(bool::from(hook_account.transferring))
}

fn validate_transfer_approval(
    approval: &Account<TransferApproval>,
    token_state: Pubkey,
    source_token_account: Pubkey,
    destination_token_account: Pubkey,
    authority: Pubkey,
    amount: u64,
) -> Result<()> {
    require_keys_eq!(
        approval.token_state,
        token_state,
        FracksTokenHookError::MissingTransferApproval
    );
    require_keys_eq!(
        approval.source_token_account,
        source_token_account,
        FracksTokenHookError::MissingTransferApproval
    );
    require_keys_eq!(
        approval.destination_token_account,
        destination_token_account,
        FracksTokenHookError::MissingTransferApproval
    );
    require_keys_eq!(
        approval.authority,
        authority,
        FracksTokenHookError::MissingTransferApproval
    );
    require!(
        approval.amount == amount && !approval.consumed,
        FracksTokenHookError::MissingTransferApproval
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn invoke_compliance_transferred<'info>(
    compliance_program: &AccountInfo<'info>,
    compliance_state: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    from: Pubkey,
    to: Pubkey,
    amount: u64,
    from_balance_after: u64,
    to_balance_after: u64,
    from_country: u16,
    to_country: u16,
) -> Result<()> {
    require_keys_eq!(
        compliance_program.key(),
        FRACKS_COMPLIANCE_PROGRAM_ID,
        FracksTokenHookError::InvalidCompliance
    );
    require_keys_eq!(
        *compliance_state.owner,
        FRACKS_COMPLIANCE_PROGRAM_ID,
        FracksTokenHookError::InvalidCompliance
    );
    let instruction = Instruction {
        program_id: compliance_program.key(),
        accounts: build_compliance_account_metas(compliance_state, remaining_accounts),
        data: compliance_instruction::Transferred {
            _from: from,
            _to: to,
            amount,
            from_balance_after,
            to_balance_after,
            _from_country: from_country,
            _to_country: to_country,
        }
        .data(),
    };
    let mut infos = Vec::with_capacity(2 + remaining_accounts.len());
    infos.push(compliance_program.clone());
    infos.push(compliance_state.clone());
    infos.extend(remaining_accounts.iter().cloned());
    invoke(&instruction, &infos).map_err(Into::into)
}

fn build_compliance_account_metas(
    compliance_state: &AccountInfo,
    remaining_accounts: &[AccountInfo],
) -> Vec<AccountMeta> {
    let mut metas = Vec::with_capacity(1 + remaining_accounts.len());
    metas.push(AccountMeta::new_readonly(compliance_state.key(), false));
    for account in remaining_accounts {
        if account.is_writable {
            metas.push(AccountMeta::new(account.key(), account.is_signer));
        } else {
            metas.push(AccountMeta::new_readonly(account.key(), account.is_signer));
        }
    }
    metas
}

#[error_code]
pub enum FracksTokenHookError {
    #[msg("Invalid FRACKS token state.")]
    InvalidTokenState,
    #[msg("Invalid Token-2022 account.")]
    InvalidTokenAccount,
    #[msg("Token-2022 mint is missing the FRACKS transfer hook.")]
    MissingTransferHook,
    #[msg("Token-2022 mint is missing the FRACKS permanent delegate.")]
    MissingPermanentDelegate,
    #[msg("Invalid extra-account-metas account.")]
    InvalidExtraAccountMetas,
    #[msg("Transfer hook was called outside an active Token-2022 transfer.")]
    ProgramCalledOutsideTransfer,
    #[msg("FRACKS transfer approval is missing or invalid.")]
    MissingTransferApproval,
    #[msg("Invalid controller authority.")]
    NotController,
    #[msg("Insufficient transferable balance.")]
    InsufficientBalance,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow,
    #[msg("Invalid compliance account.")]
    InvalidCompliance,
    #[msg("Invalid FRACKS owner state.")]
    InvalidOwnerState,
    #[msg("Signer is not the FRACKS token owner.")]
    NotOwner,
    #[msg("Too many compliance modules for Token-2022 extra-account-metas.")]
    TooManyModules,
    #[msg("Invalid compliance module account.")]
    InvalidComplianceModule,
}
