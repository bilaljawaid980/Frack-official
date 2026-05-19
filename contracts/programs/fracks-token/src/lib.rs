use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_option::COption,
};
use anchor_lang::InstructionData;
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{
        permanent_delegate::PermanentDelegate,
        transfer_hook::TransferHook,
        BaseStateWithExtensions, StateWithExtensions,
    },
};
use fracks_compliance::{
    instruction as compliance_instruction,
    ComplianceState, CountryInvestorCountView, CountryRestrictModuleView, DailyTransferLimitModuleView,
    DailyWalletUsageView, InvestorCountryCapModuleView, LockupModuleView, MaxBalanceModuleView,
    MaxInvestorsModuleView, MaxTransferModuleView,
};
use fracks_irp::utils::{
    deserialize_view as irp_deserialize_view, ensure_bound_registry, find_wallet_identity,
    verify_claim_for_topic,
};
use fracks_irp::{
    ClaimTopicsStateView, IdentityRegistryState, IdentityRegistryStorageStateView, TrustedIssuersStateView,
    WalletIdentityView,
};
use fracks_irs::program::FracksIrs;
use fracks_token_hook::program::FracksTokenHook;
use solana_program::hash::hash;

declare_id!("92MCTz2KpWqhSD7LWay97LmZbdmpAj4fJ3FXtV7rbW9s");

const MAX_NAME_LEN: usize = 64;
const MAX_SYMBOL_LEN: usize = 12;
const MAX_ISIN_LEN: usize = 24;
const TOKEN_STATE_SPACE: usize =
    8 + 32 + 32 + 32 + 1 + 1 + (4 + MAX_NAME_LEN) + (4 + MAX_SYMBOL_LEN) + (4 + MAX_ISIN_LEN) + 1;
const OWNER_STATE_SPACE: usize = 8 + 32 + 32 + 1;
const AGENT_ROLE_SPACE: usize = 8 + 32 + 32 + 1 + 1;
const FROZEN_WALLET_SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1;
const PARTIAL_FREEZE_SPACE: usize = 8 + 32 + 32 + 8 + 32 + 1;
const TRANSFER_APPROVAL_KIND_TRANSFER: u8 = 0;
const TRANSFER_APPROVAL_KIND_FORCED: u8 = 1;
const TRANSFER_APPROVAL_KIND_RECOVERY: u8 = 2;
const FRACKS_TOKEN_HOOK_ID: Pubkey = pubkey!("4sLPqAViuzo1yJJExKn2TfP42enBQPhvAUZq5japm85m");

#[program]
pub mod fracks_token {
    use super::*;

    pub fn initialize_token(
        ctx: Context<InitializeToken>,
        token_mint: Pubkey,
        name: String,
        symbol: String,
        decimals: u8,
        isin: String,
        identity_registry: Pubkey,
        compliance: Pubkey,
    ) -> Result<()> {
        validate_metadata(&name, &symbol, &isin)?;

        let token_state = &mut ctx.accounts.token_state;
        token_state.token_mint = token_mint;
        token_state.identity_registry = identity_registry;
        token_state.compliance = compliance;
        token_state.paused = false;
        token_state.decimals = decimals;
        token_state.name = name;
        token_state.symbol = symbol;
        token_state.isin = isin;
        token_state.bump = ctx.bumps.token_state;

        let owner_state = &mut ctx.accounts.owner_state;
        owner_state.owner = ctx.accounts.owner.key();
        owner_state.token_mint = token_mint;
        owner_state.bump = ctx.bumps.owner_state;
        Ok(())
    }

    pub fn transfer<'info>(
        ctx: Context<'_, '_, '_, 'info, TransferEvaluation<'info>>,
        amount: u64,
        from_balance: u64,
        to_balance: u64,
    ) -> Result<()> {
        validate_token_mint_account(
            &ctx.accounts.token_mint_account,
            &ctx.accounts.token_state,
            true,
        )?;
        let source = read_token_account(&ctx.accounts.source_token_account)?;
        let destination = read_token_account(&ctx.accounts.destination_token_account)?;
        require!(source.amount == from_balance, FracksTokenError::InvalidTokenAccount);
        require!(destination.amount == to_balance, FracksTokenError::InvalidTokenAccount);
        validate_token_account(
            &ctx.accounts.source_token_account,
            &source,
            &ctx.accounts.token_state.token_mint,
            &ctx.accounts.from_wallet.key(),
        )?;
        validate_token_account(
            &ctx.accounts.destination_token_account,
            &destination,
            &ctx.accounts.token_state.token_mint,
            &ctx.accounts.to_wallet.key(),
        )?;

        let evaluation =
            evaluate_transfer(&ctx.accounts, &ctx.remaining_accounts, amount, from_balance, to_balance)?;
        approve_hook_transfer(
            &ctx.accounts.hook_program,
            ctx.accounts.from_wallet.to_account_info(),
            ctx.accounts.token_state.to_account_info(),
            &ctx.accounts.token_state,
            &ctx.accounts.token_mint_account,
            &ctx.accounts.source_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.transfer_approval,
            ctx.accounts.from_wallet.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.from_wallet.key(),
            ctx.accounts.to_wallet.key(),
            ctx.accounts.from_wallet.key(),
            amount,
            from_balance,
            to_balance,
            evaluation.sender_country,
            evaluation.receiver_country,
            TRANSFER_APPROVAL_KIND_TRANSFER,
        )?;

        Ok(())
    }

    pub fn mint<'info>(
        ctx: Context<'_, '_, '_, 'info, MintOperation<'info>>,
        to: Pubkey,
        amount: u64,
        to_balance_after: u64,
    ) -> Result<()> {
        authorize_operator(
            ctx.accounts.authority.key(),
            &ctx.accounts.token_state,
            &ctx.accounts.owner_state.to_account_info(),
            &ctx.accounts.agent_role.to_account_info(),
        )?;
        require!(!ctx.accounts.token_state.paused, FracksTokenError::TokenPaused);
        ensure_wallet_not_frozen(
            &ctx.accounts.to_frozen,
            &to,
            &ctx.accounts.token_state.token_mint,
        )?;
        let receiver_identity = verify_wallet_against_irp(
            &ctx.accounts.token_state,
            &to,
            &ctx.accounts.irp_state,
            &ctx.accounts.irs_state,
            &ctx.accounts.tir_state,
            &ctx.accounts.ctr_state,
            &ctx.accounts.wallet_identity,
            &ctx.remaining_accounts,
        )?;
        validate_token_mint_account(
            &ctx.accounts.token_mint_account,
            &ctx.accounts.token_state,
            true,
        )?;
        let destination = read_token_account(&ctx.accounts.destination_token_account)?;
        validate_token_account(
            &ctx.accounts.destination_token_account,
            &destination,
            &ctx.accounts.token_state.token_mint,
            &to,
        )?;
        require!(
            destination
                .amount
                .checked_add(amount)
                .ok_or_else(|| error!(FracksTokenError::ArithmeticOverflow))?
                == to_balance_after,
            FracksTokenError::InvalidTokenAccount
        );
        invoke_compliance_created(
            &ctx.accounts.compliance_program,
            &ctx.accounts.compliance_state,
            &ctx.remaining_accounts,
            to,
            amount,
            to_balance_after,
            receiver_identity.country,
        )?;
        let token_state_bump = [ctx.accounts.token_state.bump];
        let token_state_seeds = &[
            b"token_state".as_ref(),
            ctx.accounts.token_state.token_mint.as_ref(),
            token_state_bump.as_ref(),
        ];
        invoke_token_mint_to_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.token_mint_account,
            &ctx.accounts.destination_token_account,
            ctx.accounts.token_state.to_account_info(),
            token_state_seeds,
            amount,
            ctx.accounts.token_state.decimals,
        )?;

        emit!(TokensMinted {
            to,
            amount,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn burn<'info>(
        ctx: Context<'_, '_, '_, 'info, BurnOperation<'info>>,
        from: Pubkey,
        amount: u64,
        from_balance_after: u64,
    ) -> Result<()> {
        authorize_operator(
            ctx.accounts.authority.key(),
            &ctx.accounts.token_state,
            &ctx.accounts.owner_state.to_account_info(),
            &ctx.accounts.agent_role.to_account_info(),
        )?;
        require!(!ctx.accounts.token_state.paused, FracksTokenError::TokenPaused);
        let sender_identity = require_wallet_identity(
            &ctx.accounts.from_wallet_identity,
            &from,
            &ctx.accounts.irs_state.key(),
        )?;
        validate_token_mint_account(
            &ctx.accounts.token_mint_account,
            &ctx.accounts.token_state,
            true,
        )?;
        let source = read_token_account(&ctx.accounts.source_token_account)?;
        validate_token_account(
            &ctx.accounts.source_token_account,
            &source,
            &ctx.accounts.token_state.token_mint,
            &from,
        )?;
        require!(
            source
                .amount
                .checked_sub(amount)
                .ok_or_else(|| error!(FracksTokenError::InsufficientBalance))?
                == from_balance_after,
            FracksTokenError::InvalidTokenAccount
        );
        invoke_compliance_destroyed(
            &ctx.accounts.compliance_program,
            &ctx.accounts.compliance_state,
            &ctx.remaining_accounts,
            from,
            amount,
            from_balance_after,
            sender_identity.country,
        )?;
        let token_state_bump = [ctx.accounts.token_state.bump];
        let token_state_seeds = &[
            b"token_state".as_ref(),
            ctx.accounts.token_state.token_mint.as_ref(),
            token_state_bump.as_ref(),
        ];
        invoke_token_burn_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.source_token_account,
            &ctx.accounts.token_mint_account,
            ctx.accounts.token_state.to_account_info(),
            token_state_seeds,
            amount,
            ctx.accounts.token_state.decimals,
        )?;
        emit!(TokensBurned {
            from,
            amount,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn forced_transfer<'info>(
        ctx: Context<'_, '_, '_, 'info, ForcedTransferOperation<'info>>,
        from: Pubkey,
        to: Pubkey,
        amount: u64,
        from_balance: u64,
        to_balance: u64,
    ) -> Result<()> {
        authorize_operator(
            ctx.accounts.authority.key(),
            &ctx.accounts.token_state,
            &ctx.accounts.owner_state.to_account_info(),
            &ctx.accounts.agent_role.to_account_info(),
        )?;
        require!(!ctx.accounts.token_state.paused, FracksTokenError::TokenPaused);
        ensure_wallet_not_frozen(
            &ctx.accounts.to_frozen,
            &to,
            &ctx.accounts.token_state.token_mint,
        )?;

        let sender_identity = require_wallet_identity(
            &ctx.accounts.from_wallet_identity,
            &from,
            &ctx.accounts.irs_state.key(),
        )?;
        let receiver_identity = verify_wallet_against_irp(
            &ctx.accounts.token_state,
            &to,
            &ctx.accounts.irp_state,
            &ctx.accounts.irs_state,
            &ctx.accounts.tir_state,
            &ctx.accounts.ctr_state,
            &ctx.accounts.to_wallet_identity,
            &ctx.remaining_accounts,
        )?;
        validate_token_mint_account(
            &ctx.accounts.token_mint_account,
            &ctx.accounts.token_state,
            true,
        )?;
        let source = read_token_account(&ctx.accounts.source_token_account)?;
        let destination = read_token_account(&ctx.accounts.destination_token_account)?;
        require!(source.amount == from_balance, FracksTokenError::InvalidTokenAccount);
        require!(destination.amount == to_balance, FracksTokenError::InvalidTokenAccount);
        validate_token_account(
            &ctx.accounts.source_token_account,
            &source,
            &ctx.accounts.token_state.token_mint,
            &from,
        )?;
        validate_token_account(
            &ctx.accounts.destination_token_account,
            &destination,
            &ctx.accounts.token_state.token_mint,
            &to,
        )?;

        evaluate_compliance(
            &ctx.accounts.token_state,
            &ctx.accounts.compliance_state,
            &ctx.remaining_accounts,
            from,
            to,
            amount,
            from_balance,
            to_balance,
            sender_identity.country,
            receiver_identity.country,
        )?;

        approve_hook_transfer(
            &ctx.accounts.hook_program,
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.token_state.to_account_info(),
            &ctx.accounts.token_state,
            &ctx.accounts.token_mint_account,
            &ctx.accounts.source_token_account,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.transfer_approval,
            ctx.accounts.token_state.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            from,
            to,
            ctx.accounts.token_state.key(),
            amount,
            from_balance,
            to_balance,
            sender_identity.country,
            receiver_identity.country,
            TRANSFER_APPROVAL_KIND_FORCED,
        )?;
        let token_state_bump = [ctx.accounts.token_state.bump];
        let token_state_seeds = &[
            b"token_state".as_ref(),
            ctx.accounts.token_state.token_mint.as_ref(),
            token_state_bump.as_ref(),
        ];
        let hook_accounts = build_token_hook_accounts(
            ctx.accounts.controller_program.to_account_info(),
            ctx.accounts.token_state.to_account_info(),
            ctx.accounts.transfer_approval.to_account_info(),
            &ctx.accounts.compliance_state,
            &ctx.accounts.compliance_program,
            &ctx.accounts.extra_account_metas,
            ctx.accounts.hook_program.to_account_info(),
            &ctx.remaining_accounts,
        )?;
        invoke_token_transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.source_token_account,
            &ctx.accounts.token_mint_account,
            &ctx.accounts.destination_token_account,
            ctx.accounts.token_state.to_account_info(),
            token_state_seeds,
            amount,
            ctx.accounts.token_state.decimals,
            &hook_accounts,
        )?;

        let partial = &mut ctx.accounts.from_partial_freeze;
        partial.frozen_amount = partial.frozen_amount.saturating_sub(amount);

        emit!(ForcedTransferExecuted {
            from,
            to,
            amount,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn recovery<'info>(
        ctx: Context<'_, '_, '_, 'info, RecoveryOperation<'info>>,
        lost_wallet: Pubkey,
        new_wallet: Pubkey,
        amount: u64,
    ) -> Result<()> {
        authorize_operator(
            ctx.accounts.authority.key(),
            &ctx.accounts.token_state,
            &ctx.accounts.owner_state.to_account_info(),
            &ctx.accounts.agent_role.to_account_info(),
        )?;
        require!(!ctx.accounts.token_state.paused, FracksTokenError::TokenPaused);
        require!(lost_wallet != new_wallet, FracksTokenError::InvalidRecoveryTarget);
        ensure_wallet_not_frozen(
            &ctx.accounts.new_wallet_frozen,
            &new_wallet,
            &ctx.accounts.token_state.token_mint,
        )?;
        let receiver_identity = verify_wallet_against_irp(
            &ctx.accounts.token_state,
            &new_wallet,
            &ctx.accounts.irp_state,
            &ctx.accounts.irs_state,
            &ctx.accounts.tir_state,
            &ctx.accounts.ctr_state,
            &ctx.accounts.new_wallet_identity,
            &ctx.remaining_accounts,
        )?;
        let lost_identity = require_wallet_identity(
            &ctx.accounts.lost_wallet_identity,
            &lost_wallet,
            &ctx.accounts.irs_state.key(),
        )?;
        validate_token_mint_account(
            &ctx.accounts.token_mint_account,
            &ctx.accounts.token_state,
            true,
        )?;
        let source = read_token_account(&ctx.accounts.lost_token_account)?;
        let destination = read_token_account(&ctx.accounts.new_token_account)?;
        validate_token_account(
            &ctx.accounts.lost_token_account,
            &source,
            &ctx.accounts.token_state.token_mint,
            &lost_wallet,
        )?;
        validate_token_account(
            &ctx.accounts.new_token_account,
            &destination,
            &ctx.accounts.token_state.token_mint,
            &new_wallet,
        )?;
        require!(source.amount >= amount, FracksTokenError::InsufficientBalance);

        approve_hook_transfer(
            &ctx.accounts.hook_program,
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.token_state.to_account_info(),
            &ctx.accounts.token_state,
            &ctx.accounts.token_mint_account,
            &ctx.accounts.lost_token_account,
            &ctx.accounts.new_token_account,
            &ctx.accounts.transfer_approval,
            ctx.accounts.token_state.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            lost_wallet,
            new_wallet,
            ctx.accounts.token_state.key(),
            amount,
            source.amount,
            destination.amount,
            lost_identity.country,
            receiver_identity.country,
            TRANSFER_APPROVAL_KIND_RECOVERY,
        )?;
        let token_state_bump = [ctx.accounts.token_state.bump];
        let token_state_seeds = &[
            b"token_state".as_ref(),
            ctx.accounts.token_state.token_mint.as_ref(),
            token_state_bump.as_ref(),
        ];
        let hook_accounts = build_token_hook_accounts(
            ctx.accounts.controller_program.to_account_info(),
            ctx.accounts.token_state.to_account_info(),
            ctx.accounts.transfer_approval.to_account_info(),
            &ctx.accounts.compliance_state,
            &ctx.accounts.compliance_program,
            &ctx.accounts.extra_account_metas,
            ctx.accounts.hook_program.to_account_info(),
            &ctx.remaining_accounts,
        )?;
        invoke_token_transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.lost_token_account,
            &ctx.accounts.token_mint_account,
            &ctx.accounts.new_token_account,
            ctx.accounts.token_state.to_account_info(),
            token_state_seeds,
            amount,
            ctx.accounts.token_state.decimals,
            &hook_accounts,
        )?;
        Ok(())
    }

    pub fn finalize_recovery<'info>(
        ctx: Context<'_, '_, '_, 'info, FinalizeRecovery<'info>>,
        lost_wallet: Pubkey,
        new_wallet: Pubkey,
        amount: u64,
    ) -> Result<()> {
        authorize_operator(
            ctx.accounts.authority.key(),
            &ctx.accounts.token_state,
            &ctx.accounts.owner_state.to_account_info(),
            &ctx.accounts.agent_role.to_account_info(),
        )?;
        require!(
            ctx.accounts.transfer_approval.kind == TRANSFER_APPROVAL_KIND_RECOVERY
                && ctx.accounts.transfer_approval.consumed
                && !ctx.accounts.transfer_approval.finalized,
            FracksTokenError::MissingTransferApproval
        );
        let expected_approval = Pubkey::find_program_address(
            &[
                b"transfer_approval",
                ctx.accounts.transfer_approval.source_token_account.as_ref(),
                ctx.accounts.transfer_approval.destination_token_account.as_ref(),
                ctx.accounts.token_state.key().as_ref(),
            ],
            &FRACKS_TOKEN_HOOK_ID,
        )
        .0;
        require_keys_eq!(
            ctx.accounts.transfer_approval.key(),
            expected_approval,
            FracksTokenError::MissingTransferApproval
        );
        require_keys_eq!(
            ctx.accounts.transfer_approval.source_wallet,
            lost_wallet,
            FracksTokenError::MissingTransferApproval
        );
        require_keys_eq!(
            ctx.accounts.transfer_approval.destination_wallet,
            new_wallet,
            FracksTokenError::MissingTransferApproval
        );
        require!(
            ctx.accounts.transfer_approval.amount == amount,
            FracksTokenError::MissingTransferApproval
        );
        let lost_identity = require_wallet_identity(
            &ctx.accounts.lost_wallet_identity,
            &lost_wallet,
            &ctx.accounts.irs_state.key(),
        )?;
        fracks_irs::cpi::update_identity(
            CpiContext::new(
                ctx.accounts.irs_program.to_account_info(),
                fracks_irs::cpi::accounts::MutateWalletIdentity {
                    authority: ctx.accounts.authority.to_account_info(),
                    irs_state: ctx.accounts.irs_state.to_account_info(),
                    registry_state: ctx.accounts.irp_state.to_account_info(),
                    wallet_identity: ctx.accounts.new_wallet_identity.to_account_info(),
                },
            ),
            lost_identity.fid,
        )?;
        fracks_irs::cpi::update_country(
            CpiContext::new(
                ctx.accounts.irs_program.to_account_info(),
                fracks_irs::cpi::accounts::MutateWalletIdentity {
                    authority: ctx.accounts.authority.to_account_info(),
                    irs_state: ctx.accounts.irs_state.to_account_info(),
                    registry_state: ctx.accounts.irp_state.to_account_info(),
                    wallet_identity: ctx.accounts.new_wallet_identity.to_account_info(),
                },
            ),
            lost_identity.country,
        )?;
        fracks_irs::cpi::remove_identity(CpiContext::new(
            ctx.accounts.irs_program.to_account_info(),
            fracks_irs::cpi::accounts::RemoveIdentity {
                authority: ctx.accounts.authority.to_account_info(),
                irs_state: ctx.accounts.irs_state.to_account_info(),
                registry_state: ctx.accounts.irp_state.to_account_info(),
                wallet_identity: ctx.accounts.lost_wallet_identity.to_account_info(),
            },
        ))?;

        emit!(TokenRecovery {
            lost_wallet,
            new_wallet,
            amount,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        ctx.accounts.transfer_approval.finalized = true;
        Ok(())
    }

    pub fn pause(ctx: Context<UpdateOwnerState>) -> Result<()> {
        ctx.accounts.token_state.paused = true;
        emit!(TokenPaused {
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn unpause(ctx: Context<UpdateOwnerState>) -> Result<()> {
        ctx.accounts.token_state.paused = false;
        emit!(TokenUnpaused {
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn set_identity_registry(
        ctx: Context<UpdateOwnerState>,
        new_identity_registry: Pubkey,
    ) -> Result<()> {
        ctx.accounts.token_state.identity_registry = new_identity_registry;
        Ok(())
    }

    pub fn set_compliance(ctx: Context<UpdateOwnerState>, new_compliance: Pubkey) -> Result<()> {
        ctx.accounts.token_state.compliance = new_compliance;
        Ok(())
    }

    pub fn add_agent(ctx: Context<AddAgent>, agent: Pubkey) -> Result<()> {
        let role = &mut ctx.accounts.agent_role;
        role.agent = agent;
        role.token_mint = ctx.accounts.token_state.token_mint;
        role.is_active = true;
        role.bump = ctx.bumps.agent_role;

        emit!(AgentAdded {
            agent,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn remove_agent(ctx: Context<RemoveAgent>) -> Result<()> {
        emit!(AgentRemoved {
            agent: ctx.accounts.agent_role.agent,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn transfer_ownership(ctx: Context<UpdateOwnerState>, new_owner: Pubkey) -> Result<()> {
        require_keys_neq!(new_owner, Pubkey::default(), FracksTokenError::InvalidOwner);
        ctx.accounts.owner_state.owner = new_owner;
        Ok(())
    }

    pub fn freeze_wallet(ctx: Context<FreezeWallet>) -> Result<()> {
        authorize_operator(
            ctx.accounts.authority.key(),
            &ctx.accounts.token_state,
            &ctx.accounts.owner_state.to_account_info(),
            &ctx.accounts.agent_role.to_account_info(),
        )?;
        let frozen = &mut ctx.accounts.frozen_wallet;
        frozen.wallet = ctx.accounts.wallet.key();
        frozen.token_mint = ctx.accounts.token_state.token_mint;
        frozen.frozen_by = ctx.accounts.authority.key();
        frozen.frozen_at = Clock::get()?.unix_timestamp;
        frozen.bump = ctx.bumps.frozen_wallet;

        emit!(WalletFrozen {
            wallet: frozen.wallet,
            by_agent: ctx.accounts.authority.key(),
            timestamp: frozen.frozen_at,
        });
        Ok(())
    }

    pub fn unfreeze_wallet(ctx: Context<UnfreezeWallet>) -> Result<()> {
        authorize_operator(
            ctx.accounts.authority.key(),
            &ctx.accounts.token_state,
            &ctx.accounts.owner_state.to_account_info(),
            &ctx.accounts.agent_role.to_account_info(),
        )?;
        emit!(WalletUnfrozen {
            wallet: ctx.accounts.frozen_wallet.wallet,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn freeze_partial(ctx: Context<FreezePartial>, amount: u64) -> Result<()> {
        authorize_operator(
            ctx.accounts.authority.key(),
            &ctx.accounts.token_state,
            &ctx.accounts.owner_state.to_account_info(),
            &ctx.accounts.agent_role.to_account_info(),
        )?;
        require!(amount > 0, FracksTokenError::InvalidFreezeAmount);
        let partial = &mut ctx.accounts.partial_freeze;
        partial.wallet = ctx.accounts.wallet.key();
        partial.token_mint = ctx.accounts.token_state.token_mint;
        partial.frozen_amount = partial
            .frozen_amount
            .checked_add(amount)
            .ok_or_else(|| error!(FracksTokenError::ArithmeticOverflow))?;
        partial.frozen_by = ctx.accounts.authority.key();
        partial.bump = ctx.bumps.partial_freeze;

        emit!(PartialFreezeUpdated {
            wallet: partial.wallet,
            frozen_amount: partial.frozen_amount,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn unfreeze_partial(ctx: Context<FreezePartial>, amount: u64) -> Result<()> {
        authorize_operator(
            ctx.accounts.authority.key(),
            &ctx.accounts.token_state,
            &ctx.accounts.owner_state.to_account_info(),
            &ctx.accounts.agent_role.to_account_info(),
        )?;
        require!(amount > 0, FracksTokenError::InvalidFreezeAmount);
        let partial = &mut ctx.accounts.partial_freeze;
        require!(
            partial.frozen_amount >= amount,
            FracksTokenError::InvalidFreezeAmount
        );
        partial.frozen_amount = partial.frozen_amount.saturating_sub(amount);

        emit!(PartialFreezeUpdated {
            wallet: partial.wallet,
            frozen_amount: partial.frozen_amount,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        if partial.frozen_amount == 0 {
            partial.close(ctx.accounts.authority.to_account_info())?;
        }
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct InitializeToken<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = TOKEN_STATE_SPACE,
        seeds = [b"token_state", token_mint.as_ref()],
        bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        init,
        payer = owner,
        space = OWNER_STATE_SPACE,
        seeds = [b"owner", token_mint.as_ref()],
        bump
    )]
    pub owner_state: Account<'info, OwnerState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateOwnerState<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        mut,
        seeds = [b"owner", owner_state.token_mint.as_ref()],
        bump = owner_state.bump,
        constraint = owner_state.token_mint == token_state.token_mint @ FracksTokenError::InvalidRegistryReference,
        constraint = owner_state.owner == owner.key() @ FracksTokenError::NotOwner
    )]
    pub owner_state: Account<'info, OwnerState>,
}

#[derive(Accounts)]
#[instruction(agent: Pubkey)]
pub struct AddAgent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"owner", owner_state.token_mint.as_ref()],
        bump = owner_state.bump,
        constraint = owner_state.token_mint == token_state.token_mint @ FracksTokenError::InvalidRegistryReference,
        constraint = owner_state.owner == owner.key() @ FracksTokenError::NotOwner
    )]
    pub owner_state: Account<'info, OwnerState>,
    #[account(
        init,
        payer = owner,
        space = AGENT_ROLE_SPACE,
        seeds = [b"agent", token_state.token_mint.as_ref(), agent.as_ref()],
        bump
    )]
    pub agent_role: Account<'info, AgentRole>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveAgent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"owner", owner_state.token_mint.as_ref()],
        bump = owner_state.bump,
        constraint = owner_state.token_mint == token_state.token_mint @ FracksTokenError::InvalidRegistryReference,
        constraint = owner_state.owner == owner.key() @ FracksTokenError::NotOwner
    )]
    pub owner_state: Account<'info, OwnerState>,
    #[account(
        mut,
        close = owner,
        seeds = [b"agent", token_state.token_mint.as_ref(), agent_role.agent.as_ref()],
        bump = agent_role.bump
    )]
    pub agent_role: Account<'info, AgentRole>,
}

#[derive(Accounts)]
pub struct TransferEvaluation<'info> {
    pub token_state: Account<'info, TokenState>,
    #[account(mut)]
    /// CHECK: Token-2022 account validated in instruction.
    pub source_token_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Token-2022 mint validated in instruction.
    pub token_mint_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Token-2022 account validated in instruction.
    pub destination_token_account: UncheckedAccount<'info>,
    #[account(mut)]
    pub from_wallet: Signer<'info>,
    /// CHECK: Used as a comparison key and for events only.
    pub to_wallet: UncheckedAccount<'info>,
    /// CHECK: Transfer-hook validation PDA validated by Token-2022.
    pub extra_account_metas: UncheckedAccount<'info>,
    /// CHECK: Fixed FRACKS token controller program account required by the hook EAM list.
    #[account(address = id() @ FracksTokenError::InvalidTokenProgram)]
    pub controller_program: UncheckedAccount<'info>,
    pub hook_program: Program<'info, FracksTokenHook>,
    #[account(mut)]
    /// CHECK: Hook-owned approval PDA initialized by the hook CPI.
    pub transfer_approval: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Verified in instruction against token_state.identity_registry.
    pub irp_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP and IRS views.
    pub irs_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP view.
    pub tir_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP view.
    pub ctr_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against token_state.compliance.
    pub compliance_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against compliance_state.owner.
    pub compliance_program: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction.
    pub from_wallet_identity: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction.
    pub to_wallet_identity: UncheckedAccount<'info>,
    /// CHECK: Optional frozen marker.
    pub from_frozen: UncheckedAccount<'info>,
    /// CHECK: Optional frozen marker.
    pub to_frozen: UncheckedAccount<'info>,
    /// CHECK: Optional partial freeze marker.
    pub from_partial_freeze: UncheckedAccount<'info>,
    /// CHECK: Must be the canonical Token-2022 program.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MintOperation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    /// CHECK: Optional owner state for direct issuer authority; verified in instruction.
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Optional agent role for delegated authority; verified in instruction.
    pub agent_role: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against token_state.identity_registry.
    pub irp_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP and IRS views.
    pub irs_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP view.
    pub tir_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP view.
    pub ctr_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against token_state.compliance.
    pub compliance_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against compliance_state.owner.
    pub compliance_program: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction.
    pub wallet_identity: UncheckedAccount<'info>,
    /// CHECK: Optional frozen marker.
    pub to_frozen: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Token-2022 mint validated in instruction.
    pub token_mint_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Token-2022 destination token account validated in instruction.
    pub destination_token_account: UncheckedAccount<'info>,
    /// CHECK: Must be the canonical Token-2022 program.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct BurnOperation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    /// CHECK: Optional owner state for direct issuer authority; verified in instruction.
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Optional agent role for delegated authority; verified in instruction.
    pub agent_role: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against token_state.compliance.
    pub compliance_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against compliance_state.owner.
    pub compliance_program: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP-linked IRS state.
    pub irs_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction.
    pub from_wallet_identity: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Token-2022 mint validated in instruction.
    pub token_mint_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Token-2022 source token account validated in instruction.
    pub source_token_account: UncheckedAccount<'info>,
    /// CHECK: Must be the canonical Token-2022 program.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ForcedTransferOperation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    /// CHECK: Optional owner state for direct issuer authority; verified in instruction.
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Optional agent role for delegated authority; verified in instruction.
    pub agent_role: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against token_state.identity_registry.
    pub irp_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP and IRS views.
    pub irs_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP view.
    pub tir_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP view.
    pub ctr_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against token_state.compliance.
    pub compliance_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against compliance_state.owner.
    pub compliance_program: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction.
    pub from_wallet_identity: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction.
    pub to_wallet_identity: UncheckedAccount<'info>,
    /// CHECK: Optional frozen marker.
    pub to_frozen: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"partial_freeze", token_state.token_mint.as_ref(), from_partial_freeze.wallet.as_ref()],
        bump = from_partial_freeze.bump
    )]
    pub from_partial_freeze: Account<'info, PartialFreeze>,
    #[account(mut)]
    /// CHECK: Token-2022 mint validated in instruction.
    pub token_mint_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Token-2022 source token account validated in instruction.
    pub source_token_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Token-2022 destination token account validated in instruction.
    pub destination_token_account: UncheckedAccount<'info>,
    /// CHECK: Transfer-hook validation PDA validated by Token-2022.
    pub extra_account_metas: UncheckedAccount<'info>,
    /// CHECK: Fixed FRACKS token controller program account required by the hook EAM list.
    #[account(address = id() @ FracksTokenError::InvalidTokenProgram)]
    pub controller_program: UncheckedAccount<'info>,
    pub hook_program: Program<'info, FracksTokenHook>,
    #[account(mut)]
    /// CHECK: Hook-owned approval PDA initialized by the hook CPI.
    pub transfer_approval: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Must be the canonical Token-2022 program.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RecoveryOperation<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    /// CHECK: Optional owner state for direct issuer authority; verified in instruction.
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Optional agent role for delegated authority; verified in instruction.
    pub agent_role: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against token_state.identity_registry.
    pub irp_state: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Verified in instruction against the IRP and IRS views.
    pub irs_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP view.
    pub tir_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against the IRP view.
    pub ctr_state: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Verified in instruction.
    pub new_wallet_identity: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Verified in instruction.
    pub lost_wallet_identity: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against token_state.compliance.
    pub compliance_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction against compliance_state.owner.
    pub compliance_program: UncheckedAccount<'info>,
    /// CHECK: Optional frozen marker.
    pub new_wallet_frozen: UncheckedAccount<'info>,
    pub irs_program: Program<'info, FracksIrs>,
    #[account(mut)]
    /// CHECK: Token-2022 mint validated in instruction.
    pub token_mint_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Token-2022 lost-wallet token account validated in instruction.
    pub lost_token_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Token-2022 new-wallet token account validated in instruction.
    pub new_token_account: UncheckedAccount<'info>,
    /// CHECK: Transfer-hook validation PDA validated by Token-2022.
    pub extra_account_metas: UncheckedAccount<'info>,
    /// CHECK: Fixed FRACKS token controller program account required by the hook EAM list.
    #[account(address = id() @ FracksTokenError::InvalidTokenProgram)]
    pub controller_program: UncheckedAccount<'info>,
    pub hook_program: Program<'info, FracksTokenHook>,
    #[account(mut)]
    /// CHECK: Hook-owned approval PDA initialized by the hook CPI.
    pub transfer_approval: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Must be the canonical Token-2022 program.
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FinalizeRecovery<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    /// CHECK: Optional owner state for direct issuer authority; verified in instruction.
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Optional agent role for delegated authority; verified in instruction.
    pub agent_role: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Verified by the IRS CPI.
    pub irs_state: UncheckedAccount<'info>,
    /// CHECK: Registry authority account for the IRS CPI.
    pub irp_state: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Verified in instruction.
    pub new_wallet_identity: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Verified in instruction.
    pub lost_wallet_identity: UncheckedAccount<'info>,
    #[account(mut)]
    pub transfer_approval: Account<'info, fracks_token_hook::TransferApproval>,
    pub irs_program: Program<'info, FracksIrs>,
}

#[derive(Accounts)]
pub struct FreezeWallet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    /// CHECK: Optional owner state for direct issuer authority; verified in instruction.
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Optional agent role for delegated authority; verified in instruction.
    pub agent_role: UncheckedAccount<'info>,
    /// CHECK: Used as a PDA seed only.
    pub wallet: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = FROZEN_WALLET_SPACE,
        seeds = [b"frozen", token_state.token_mint.as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub frozen_wallet: Account<'info, FrozenWallet>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnfreezeWallet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    /// CHECK: Optional owner state for direct issuer authority; verified in instruction.
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Optional agent role for delegated authority; verified in instruction.
    pub agent_role: UncheckedAccount<'info>,
    #[account(
        mut,
        close = authority,
        seeds = [b"frozen", token_state.token_mint.as_ref(), frozen_wallet.wallet.as_ref()],
        bump = frozen_wallet.bump
    )]
    pub frozen_wallet: Account<'info, FrozenWallet>,
}

#[derive(Accounts)]
pub struct FreezePartial<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    /// CHECK: Optional owner state for direct issuer authority; verified in instruction.
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Optional agent role for delegated authority; verified in instruction.
    pub agent_role: UncheckedAccount<'info>,
    /// CHECK: Used as a PDA seed only.
    pub wallet: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = PARTIAL_FREEZE_SPACE,
        seeds = [b"partial_freeze", token_state.token_mint.as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub partial_freeze: Account<'info, PartialFreeze>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct TokenState {
    pub token_mint: Pubkey,
    pub identity_registry: Pubkey,
    pub compliance: Pubkey,
    pub paused: bool,
    pub decimals: u8,
    pub name: String,
    pub symbol: String,
    pub isin: String,
    pub bump: u8,
}

#[account]
pub struct OwnerState {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub bump: u8,
}

#[account]
pub struct AgentRole {
    pub agent: Pubkey,
    pub token_mint: Pubkey,
    pub is_active: bool,
    pub bump: u8,
}

#[account]
pub struct FrozenWallet {
    pub wallet: Pubkey,
    pub token_mint: Pubkey,
    pub frozen_by: Pubkey,
    pub frozen_at: i64,
    pub bump: u8,
}

#[account]
pub struct PartialFreeze {
    pub wallet: Pubkey,
    pub token_mint: Pubkey,
    pub frozen_amount: u64,
    pub frozen_by: Pubkey,
    pub bump: u8,
}

#[event]
pub struct TransferExecuted {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensMinted {
    pub to: Pubkey,
    pub amount: u64,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokensBurned {
    pub from: Pubkey,
    pub amount: u64,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ForcedTransferExecuted {
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokenRecovery {
    pub lost_wallet: Pubkey,
    pub new_wallet: Pubkey,
    pub amount: u64,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct WalletFrozen {
    pub wallet: Pubkey,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct WalletUnfrozen {
    pub wallet: Pubkey,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PartialFreezeUpdated {
    pub wallet: Pubkey,
    pub frozen_amount: u64,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokenPaused {
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokenUnpaused {
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AgentAdded {
    pub agent: Pubkey,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AgentRemoved {
    pub agent: Pubkey,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[error_code(offset = 0)]
pub enum FracksTokenError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Wallet is not verified.")]
    WalletNotVerified = 6001,
    #[msg("Wallet is frozen.")]
    WalletFrozen = 6002,
    #[msg("Token is paused.")]
    TokenPaused = 6003,
    #[msg("Compliance check failed.")]
    ComplianceCheckFailed = 6004,
    #[msg("Signer is not an active agent.")]
    NotAgent = 6009,
    #[msg("Signer is neither the suite owner nor an active agent.")]
    UnauthorizedAuthority = 6011,
    #[msg("Insufficient transferable balance.")]
    InsufficientBalance = 6010,
    #[msg("Registry reference is invalid.")]
    InvalidRegistryReference = 6013,
    #[msg("Owner address is invalid.")]
    InvalidOwner = 6025,
    #[msg("Metadata exceeds the documented length limits.")]
    MetadataTooLong = 6026,
    #[msg("Freeze amount is invalid.")]
    InvalidFreezeAmount = 6029,
    #[msg("Recovery target is invalid.")]
    InvalidRecoveryTarget = 6030,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6031,
    #[msg("Token-2022 account is invalid.")]
    InvalidTokenAccount = 6032,
    #[msg("Token-2022 program is invalid.")]
    InvalidTokenProgram = 6033,
    #[msg("Token-2022 mint is missing the FRACKS transfer hook.")]
    MissingTransferHook = 6034,
    #[msg("Token-2022 mint is missing the FRACKS permanent delegate.")]
    MissingPermanentDelegate = 6035,
    #[msg("Token-2022 authority is invalid.")]
    InvalidTokenAuthority = 6036,
    #[msg("Required Token-2022 authority did not sign.")]
    MissingTokenAuthority = 6037,
    #[msg("Transfer hook was called outside an active Token-2022 transfer.")]
    ProgramCalledOutsideTransfer = 6038,
    #[msg("FRACKS transfer approval is missing or invalid.")]
    MissingTransferApproval = 6039,
}

fn validate_metadata(name: &str, symbol: &str, isin: &str) -> Result<()> {
    require!(name.len() <= MAX_NAME_LEN, FracksTokenError::MetadataTooLong);
    require!(symbol.len() <= MAX_SYMBOL_LEN, FracksTokenError::MetadataTooLong);
    require!(isin.len() <= MAX_ISIN_LEN, FracksTokenError::MetadataTooLong);
    Ok(())
}

fn authorize_operator<'info>(
    authority: Pubkey,
    token_state: &Account<'info, TokenState>,
    owner_state_info: &AccountInfo<'info>,
    agent_role_info: &AccountInfo<'info>,
) -> Result<()> {
    let expected_owner_state = Pubkey::find_program_address(
        &[b"owner", token_state.token_mint.as_ref()],
        &id(),
    )
    .0;
    if owner_state_info.owner == &id()
        && !owner_state_info.data_is_empty()
        && owner_state_info.key() == expected_owner_state
    {
        let owner_state = deserialize_account_data::<OwnerState>(owner_state_info)?;
        require_keys_eq!(
            owner_state.token_mint,
            token_state.token_mint,
            FracksTokenError::InvalidRegistryReference
        );
        if owner_state.owner == authority {
            return Ok(());
        }
    }

    let expected_agent_role = Pubkey::find_program_address(
        &[
            b"agent",
            token_state.token_mint.as_ref(),
            authority.as_ref(),
        ],
        &id(),
    )
    .0;
    if agent_role_info.owner == &id()
        && !agent_role_info.data_is_empty()
        && agent_role_info.key() == expected_agent_role
    {
        let agent_role = deserialize_account_data::<AgentRole>(agent_role_info)?;
        require_keys_eq!(
            agent_role.token_mint,
            token_state.token_mint,
            FracksTokenError::InvalidRegistryReference
        );
        require!(agent_role.is_active, FracksTokenError::NotAgent);
        return Ok(());
    }

    err!(FracksTokenError::UnauthorizedAuthority)
}

fn deserialize_account_data<T: AccountDeserialize>(account: &AccountInfo) -> Result<T> {
    let data = account.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    T::try_deserialize(&mut slice).map_err(Into::into)
}

fn evaluate_transfer<'info>(
    accounts: &TransferEvaluation<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    amount: u64,
    from_balance: u64,
    to_balance: u64,
) -> Result<TransferEvaluationSummary> {
    evaluate_transfer_components(
        &accounts.token_state,
        &accounts.from_wallet,
        &accounts.to_wallet,
        &accounts.irp_state,
        &accounts.irs_state,
        &accounts.tir_state,
        &accounts.ctr_state,
        &accounts.compliance_state,
        &accounts.from_wallet_identity,
        &accounts.to_wallet_identity,
        &accounts.from_frozen,
        &accounts.to_frozen,
        &accounts.from_partial_freeze,
        remaining_accounts,
        amount,
        from_balance,
        to_balance,
    )
}

fn evaluate_transfer_components<'info>(
    token_state: &TokenState,
    from_wallet: &AccountInfo<'info>,
    to_wallet: &AccountInfo<'info>,
    irp_state: &AccountInfo<'info>,
    irs_state: &AccountInfo<'info>,
    tir_state: &AccountInfo<'info>,
    ctr_state: &AccountInfo<'info>,
    compliance_state: &AccountInfo<'info>,
    from_wallet_identity: &AccountInfo<'info>,
    to_wallet_identity: &AccountInfo<'info>,
    from_frozen: &AccountInfo<'info>,
    to_frozen: &AccountInfo<'info>,
    from_partial_freeze: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    amount: u64,
    from_balance: u64,
    to_balance: u64,
) -> Result<TransferEvaluationSummary> {
    require!(!token_state.paused, FracksTokenError::TokenPaused);
    ensure_wallet_not_frozen(
        from_frozen,
        &from_wallet.key(),
        &token_state.token_mint,
    )?;
    ensure_wallet_not_frozen(
        to_frozen,
        &to_wallet.key(),
        &token_state.token_mint,
    )?;

    let frozen_amount = read_partial_freeze_amount(
        from_partial_freeze,
        &from_wallet.key(),
        &token_state.token_mint,
    )?;
    let transferable = from_balance.saturating_sub(frozen_amount);
    require!(amount <= transferable, FracksTokenError::InsufficientBalance);

    let sender_identity = verify_wallet_against_irp(
        token_state,
        &from_wallet.key(),
        irp_state,
        irs_state,
        tir_state,
        ctr_state,
        from_wallet_identity,
        remaining_accounts,
    )?;
    let receiver_identity = verify_wallet_against_irp(
        token_state,
        &to_wallet.key(),
        irp_state,
        irs_state,
        tir_state,
        ctr_state,
        to_wallet_identity,
        remaining_accounts,
    )?;

    evaluate_compliance(
        token_state,
        compliance_state,
        remaining_accounts,
        from_wallet.key(),
        to_wallet.key(),
        amount,
        from_balance,
        to_balance,
        sender_identity.country,
        receiver_identity.country,
    )?;

    Ok(TransferEvaluationSummary {
        sender_country: sender_identity.country,
        receiver_country: receiver_identity.country,
    })
}

fn verify_wallet_against_irp<'info>(
    token_state: &TokenState,
    wallet: &Pubkey,
    irp_state_info: &AccountInfo<'info>,
    irs_state_info: &AccountInfo<'info>,
    tir_state_info: &AccountInfo<'info>,
    ctr_state_info: &AccountInfo<'info>,
    wallet_identity_info: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<WalletIdentityView> {
    require_keys_eq!(
        token_state.identity_registry,
        irp_state_info.key(),
        FracksTokenError::InvalidRegistryReference
    );

    let registry = irp_deserialize_view::<IdentityRegistryState>(irp_state_info)
        .map_err(|_| error!(FracksTokenError::InvalidRegistryReference))?;
    let irs_state = irp_deserialize_view::<IdentityRegistryStorageStateView>(irs_state_info)
        .map_err(|_| error!(FracksTokenError::InvalidRegistryReference))?;
    let tir_state = irp_deserialize_view::<TrustedIssuersStateView>(tir_state_info)
        .map_err(|_| error!(FracksTokenError::InvalidRegistryReference))?;
    let ctr_state = irp_deserialize_view::<ClaimTopicsStateView>(ctr_state_info)
        .map_err(|_| error!(FracksTokenError::InvalidRegistryReference))?;

    require_keys_eq!(
        registry.irs_account,
        irs_state_info.key(),
        FracksTokenError::InvalidRegistryReference
    );
    require_keys_eq!(
        registry.tir_account,
        tir_state_info.key(),
        FracksTokenError::InvalidRegistryReference
    );
    require_keys_eq!(
        registry.ctr_account,
        ctr_state_info.key(),
        FracksTokenError::InvalidRegistryReference
    );
    require_keys_eq!(
        registry.token_mint,
        token_state.token_mint,
        FracksTokenError::InvalidRegistryReference
    );
    require_keys_eq!(
        tir_state.token_mint,
        token_state.token_mint,
        FracksTokenError::InvalidRegistryReference
    );
    require_keys_eq!(
        ctr_state.token_mint,
        token_state.token_mint,
        FracksTokenError::InvalidRegistryReference
    );
    ensure_bound_registry(&irs_state, &irp_state_info.key())
        .map_err(|_| error!(FracksTokenError::InvalidRegistryReference))?;

    let identity = find_wallet_identity(wallet, &irs_state_info.key(), wallet_identity_info)
        .map_err(|_| error!(FracksTokenError::WalletNotVerified))?
        .ok_or_else(|| error!(FracksTokenError::WalletNotVerified))?;
    require!(identity.is_active, FracksTokenError::WalletNotVerified);

    let now = Clock::get()?.unix_timestamp;
    for topic in ctr_state.topics {
        let valid = verify_claim_for_topic(
            identity.fid,
            topic,
            &tir_state_info.key(),
            remaining_accounts,
            now,
        )
        .map_err(|_| error!(FracksTokenError::WalletNotVerified))?;
        require!(valid, FracksTokenError::WalletNotVerified);
    }

    Ok(identity)
}

fn require_wallet_identity<'info>(
    wallet_identity_info: &AccountInfo<'info>,
    wallet: &Pubkey,
    irs: &Pubkey,
) -> Result<WalletIdentityView> {
    let identity = find_wallet_identity(wallet, irs, wallet_identity_info)
        .map_err(|_| error!(FracksTokenError::InvalidRegistryReference))?
        .ok_or_else(|| error!(FracksTokenError::WalletNotVerified))?;
    require!(identity.is_active, FracksTokenError::WalletNotVerified);
    Ok(identity)
}

fn read_token_account<'info>(
    token_account_info: &AccountInfo<'info>,
) -> Result<spl_token_2022::state::Account> {
    require_keys_eq!(
        *token_account_info.owner,
        spl_token_2022::id(),
        FracksTokenError::InvalidTokenAccount
    );
    let data = token_account_info.try_borrow_data()?;
    StateWithExtensions::<spl_token_2022::state::Account>::unpack(&data)
        .map(|account| account.base)
        .map_err(|_| error!(FracksTokenError::InvalidTokenAccount))
}

fn validate_token_account<'info>(
    token_account_info: &AccountInfo<'info>,
    token_account: &spl_token_2022::state::Account,
    token_mint: &Pubkey,
    owner: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *token_account_info.owner,
        spl_token_2022::id(),
        FracksTokenError::InvalidTokenAccount
    );
    require_keys_eq!(
        token_account.mint,
        *token_mint,
        FracksTokenError::InvalidTokenAccount
    );
    require_keys_eq!(
        token_account.owner,
        *owner,
        FracksTokenError::InvalidTokenAccount
    );
    require!(!token_account.is_frozen(), FracksTokenError::WalletFrozen);
    Ok(())
}

fn validate_token_mint_account<'info>(
    mint_info: &AccountInfo<'info>,
    token_state: &TokenState,
    require_permanent_delegate: bool,
) -> Result<()> {
    require_keys_eq!(
        mint_info.key(),
        token_state.token_mint,
        FracksTokenError::InvalidTokenAccount
    );
    require_keys_eq!(
        *mint_info.owner,
        spl_token_2022::id(),
        FracksTokenError::InvalidTokenAccount
    );

    let data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&data)
        .map_err(|_| error!(FracksTokenError::InvalidTokenAccount))?;
    require!(mint.base.is_initialized, FracksTokenError::InvalidTokenAccount);
    require!(
        mint.base.decimals == token_state.decimals,
        FracksTokenError::InvalidTokenAccount
    );

    let hook = mint
        .get_extension::<TransferHook>()
        .map_err(|_| error!(FracksTokenError::MissingTransferHook))?;
    let hook_program: Option<Pubkey> = hook.program_id.into();
    require!(
        hook_program == Some(FRACKS_TOKEN_HOOK_ID),
        FracksTokenError::MissingTransferHook
    );

    if require_permanent_delegate {
        let delegate = mint
            .get_extension::<PermanentDelegate>()
            .map_err(|_| error!(FracksTokenError::MissingPermanentDelegate))?;
        let permanent_delegate: Option<Pubkey> = delegate.delegate.into();
        require!(
            permanent_delegate == Some(token_state_pda_key(token_state)),
            FracksTokenError::MissingPermanentDelegate
        );
    }

    match mint.base.mint_authority {
        COption::Some(authority) => require_keys_eq!(
            authority,
            token_state_pda_key(token_state),
            FracksTokenError::InvalidTokenAuthority
        ),
        COption::None => return err!(FracksTokenError::InvalidTokenAuthority),
    }

    Ok(())
}

fn token_state_pda_key(token_state: &TokenState) -> Pubkey {
    Pubkey::create_program_address(
        &[
            b"token_state",
            token_state.token_mint.as_ref(),
            &[token_state.bump],
        ],
        &id(),
    )
    .expect("token_state bump must produce a valid PDA")
}

#[allow(clippy::too_many_arguments)]
fn approve_hook_transfer<'info>(
    hook_program: &Program<'info, FracksTokenHook>,
    payer: AccountInfo<'info>,
    controller_authority: AccountInfo<'info>,
    token_state: &Account<'info, TokenState>,
    token_mint_account: &AccountInfo<'info>,
    source_token_account: &AccountInfo<'info>,
    destination_token_account: &AccountInfo<'info>,
    transfer_approval: &AccountInfo<'info>,
    authority_seed: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
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
    let token_state_bump = [token_state.bump];
    let token_state_seeds = &[
        b"token_state".as_ref(),
        token_state.token_mint.as_ref(),
        token_state_bump.as_ref(),
    ];
    fracks_token_hook::cpi::approve_transfer(
        CpiContext::new_with_signer(
            hook_program.to_account_info(),
            fracks_token_hook::cpi::accounts::ApproveTransfer {
                payer,
                controller_authority,
                token_state: token_state.to_account_info(),
                token_mint_account: token_mint_account.clone(),
                source_token_account: source_token_account.clone(),
                destination_token_account: destination_token_account.clone(),
                transfer_approval: transfer_approval.clone(),
                authority_seed,
                system_program,
            },
            &[token_state_seeds],
        ),
        source_wallet,
        destination_wallet,
        authority,
        amount,
        from_balance,
        to_balance,
        from_country,
        to_country,
        kind,
    )
}

fn build_token_hook_accounts<'info>(
    controller_program: AccountInfo<'info>,
    token_state: AccountInfo<'info>,
    transfer_approval: AccountInfo<'info>,
    compliance_state: &AccountInfo<'info>,
    compliance_program: &AccountInfo<'info>,
    extra_account_metas: &AccountInfo<'info>,
    hook_program: AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<Vec<AccountInfo<'info>>> {
    let compliance = deserialize_local::<ComplianceState>(compliance_state)?;
    let mut accounts = Vec::with_capacity(7 + compliance.modules.len());
    accounts.push(controller_program);
    accounts.push(token_state);
    accounts.push(transfer_approval);
    accounts.push(compliance_state.clone());
    accounts.push(compliance_program.clone());
    for module in &compliance.modules {
        let module_info = remaining_accounts
            .iter()
            .find(|account| account.key() == *module)
            .cloned()
            .ok_or_else(|| error!(FracksTokenError::ComplianceCheckFailed))?;
        accounts.push(module_info);
    }
    accounts.push(extra_account_metas.clone());
    accounts.push(hook_program);
    Ok(accounts)
}

#[allow(clippy::too_many_arguments)]
fn invoke_token_transfer_checked<'info>(
    token_program: &AccountInfo<'info>,
    source_token_account: &AccountInfo<'info>,
    token_mint_account: &AccountInfo<'info>,
    destination_token_account: &AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[u8]],
    amount: u64,
    decimals: u8,
    hook_accounts: &[AccountInfo<'info>],
) -> Result<()> {
    require_keys_eq!(
        token_program.key(),
        spl_token_2022::id(),
        FracksTokenError::InvalidTokenProgram
    );
    let mut instruction = spl_token_2022::instruction::transfer_checked(
        token_program.key,
        source_token_account.key,
        token_mint_account.key,
        destination_token_account.key,
        authority.key,
        &[],
        amount,
        decimals,
    )
    .map_err(|_| error!(FracksTokenError::InvalidTokenAccount))?;

    for account in hook_accounts {
        if account.is_writable {
            instruction
                .accounts
                .push(AccountMeta::new(account.key(), account.is_signer));
        } else {
            instruction
                .accounts
                .push(AccountMeta::new_readonly(account.key(), account.is_signer));
        }
    }

    let mut infos = Vec::with_capacity(5 + hook_accounts.len());
    infos.push(source_token_account.clone());
    infos.push(token_mint_account.clone());
    infos.push(destination_token_account.clone());
    infos.push(authority);
    infos.extend(hook_accounts.iter().cloned());

    if signer_seeds.is_empty() {
        invoke(&instruction, &infos).map_err(Into::into)
    } else {
        invoke_signed(&instruction, &infos, &[signer_seeds]).map_err(Into::into)
    }
}

fn invoke_token_mint_to_checked<'info>(
    token_program: &AccountInfo<'info>,
    token_mint_account: &AccountInfo<'info>,
    destination_token_account: &AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[u8]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    require_keys_eq!(
        token_program.key(),
        spl_token_2022::id(),
        FracksTokenError::InvalidTokenProgram
    );
    let instruction = spl_token_2022::instruction::mint_to_checked(
        token_program.key,
        token_mint_account.key,
        destination_token_account.key,
        authority.key,
        &[],
        amount,
        decimals,
    )
    .map_err(|_| error!(FracksTokenError::InvalidTokenAccount))?;
    invoke_signed(
        &instruction,
        &[
            token_mint_account.clone(),
            destination_token_account.clone(),
            authority,
        ],
        &[signer_seeds],
    )
    .map_err(Into::into)
}

fn invoke_token_burn_checked<'info>(
    token_program: &AccountInfo<'info>,
    source_token_account: &AccountInfo<'info>,
    token_mint_account: &AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[u8]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    require_keys_eq!(
        token_program.key(),
        spl_token_2022::id(),
        FracksTokenError::InvalidTokenProgram
    );
    let instruction = spl_token_2022::instruction::burn_checked(
        token_program.key,
        source_token_account.key,
        token_mint_account.key,
        authority.key,
        &[],
        amount,
        decimals,
    )
    .map_err(|_| error!(FracksTokenError::InvalidTokenAccount))?;
    invoke_signed(
        &instruction,
        &[
            source_token_account.clone(),
            token_mint_account.clone(),
            authority,
        ],
        &[signer_seeds],
    )
    .map_err(Into::into)
}

fn ensure_wallet_not_frozen<'info>(
    frozen_info: &AccountInfo<'info>,
    wallet: &Pubkey,
    token_mint: &Pubkey,
) -> Result<()> {
    if frozen_info.key() == System::id() || frozen_info.data_is_empty() || frozen_info.owner == &System::id() {
        return Ok(());
    }

    let frozen = deserialize_local::<FrozenWallet>(frozen_info)?;
    require!(frozen.wallet == *wallet, FracksTokenError::WalletFrozen);
    require!(frozen.token_mint == *token_mint, FracksTokenError::WalletFrozen);
    err!(FracksTokenError::WalletFrozen)
}

fn read_partial_freeze_amount<'info>(
    partial_info: &AccountInfo<'info>,
    wallet: &Pubkey,
    token_mint: &Pubkey,
) -> Result<u64> {
    if partial_info.key() == System::id() || partial_info.data_is_empty() || partial_info.owner == &System::id() {
        return Ok(0);
    }

    let partial = deserialize_local::<PartialFreeze>(partial_info)?;
    require!(
        partial.wallet == *wallet && partial.token_mint == *token_mint,
        FracksTokenError::InvalidRegistryReference
    );
    Ok(partial.frozen_amount)
}

fn evaluate_compliance<'info>(
    token_state: &TokenState,
    compliance_state_info: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    from: Pubkey,
    _to: Pubkey,
    amount: u64,
    from_balance: u64,
    to_balance: u64,
    from_country: u16,
    to_country: u16,
) -> Result<()> {
    require_keys_eq!(
        token_state.compliance,
        compliance_state_info.key(),
        FracksTokenError::InvalidRegistryReference
    );
    require!(to_balance <= u64::MAX - amount, FracksTokenError::ComplianceCheckFailed);

    let state = deserialize_local::<ComplianceState>(compliance_state_info)?;
    require!(
        state.token_mint == token_state.token_mint,
        FracksTokenError::InvalidRegistryReference
    );
    if state.modules_paused {
        return Ok(());
    }

    let now = Clock::get()?.unix_timestamp;
    for module_key in &state.modules {
        let module_info = remaining_accounts
            .iter()
            .find(|account| account.key() == *module_key)
            .ok_or_else(|| error!(FracksTokenError::ComplianceCheckFailed))?;

        if matches_account_discriminator(module_info, "MaxInvestorsModule")? {
            let module = deserialize_local::<MaxInvestorsModuleView>(module_info)?;
            require!(
                !(to_balance == 0 && amount > 0 && module.holder_count >= module.max_investors),
                FracksTokenError::ComplianceCheckFailed
            );
            continue;
        }

        if matches_account_discriminator(module_info, "CountryRestrictModule")? {
            let module = deserialize_local::<CountryRestrictModuleView>(module_info)?;
            require!(
                !module.blocked_countries.contains(&from_country)
                    && !module.blocked_countries.contains(&to_country),
                FracksTokenError::ComplianceCheckFailed
            );
            continue;
        }

        if matches_account_discriminator(module_info, "MaxBalanceModule")? {
            let module = deserialize_local::<MaxBalanceModuleView>(module_info)?;
            require!(
                to_balance.saturating_add(amount) <= module.max_balance,
                FracksTokenError::ComplianceCheckFailed
            );
            continue;
        }

        if matches_account_discriminator(module_info, "MaxTransferModule")? {
            let module = deserialize_local::<MaxTransferModuleView>(module_info)?;
            require!(amount <= module.max_amount, FracksTokenError::ComplianceCheckFailed);
            continue;
        }

        if matches_account_discriminator(module_info, "LockupModule")? {
            let module = deserialize_local::<LockupModuleView>(module_info)?;
            require!(now >= module.lockup_end, FracksTokenError::ComplianceCheckFailed);
            continue;
        }

        if matches_account_discriminator(module_info, "DailyTransferLimitModule")? {
            let module = deserialize_local::<DailyTransferLimitModuleView>(module_info)?;
            let used = read_daily_usage(
                remaining_accounts,
                &module_info.key(),
                module_info.owner,
                &from,
                now,
            )?;
            require!(
                used.saturating_add(amount) <= module.daily_limit,
                FracksTokenError::ComplianceCheckFailed
            );
            continue;
        }

        if matches_account_discriminator(module_info, "SupplyCapModule")? {
            continue;
        }

        if matches_account_discriminator(module_info, "InvestorCountryCapModule")? {
            let module = deserialize_local::<InvestorCountryCapModuleView>(module_info)?;
            if to_balance == 0 && amount > 0 {
                if let Some(cap) = module
                    .country_caps
                    .iter()
                    .find(|entry| entry.country == to_country)
                    .map(|entry| entry.cap)
                {
                    let count = read_country_count(
                        remaining_accounts,
                        &module_info.key(),
                        module_info.owner,
                        to_country,
                    )?;
                    require!(count < cap, FracksTokenError::ComplianceCheckFailed);
                }
            }
            continue;
        }

        return err!(FracksTokenError::ComplianceCheckFailed);
    }

    let _ = from_balance;
    Ok(())
}

fn deserialize_local<T: AnchorDeserialize>(account: &AccountInfo) -> Result<T> {
    let data = account.try_borrow_data()?;
    require!(data.len() >= 8, FracksTokenError::InvalidRegistryReference);
    let mut slice: &[u8] = &data[8..];
    T::deserialize(&mut slice).map_err(|_| error!(FracksTokenError::InvalidRegistryReference))
}

fn read_daily_usage<'info>(
    accounts: &[AccountInfo<'info>],
    module: &Pubkey,
    module_program: &Pubkey,
    wallet: &Pubkey,
    now: i64,
) -> Result<u64> {
    for account in accounts {
        if account.owner != module_program || !matches_account_discriminator(account, "DailyWalletUsage")? {
            continue;
        }
        let expected_usage = Pubkey::find_program_address(
            &[b"daily_usage", module.as_ref(), wallet.as_ref()],
            module_program,
        )
        .0;
        if account.key() != expected_usage {
            continue;
        }
        if let Ok(usage) = deserialize_local::<DailyWalletUsageView>(account) {
            if usage.module == *module && usage.wallet == *wallet {
                if now.saturating_sub(usage.window_started_at) >= 86_400 {
                    return Ok(0);
                }
                return Ok(usage.volume);
            }
        }
    }
    Ok(0)
}

fn read_country_count<'info>(
    accounts: &[AccountInfo<'info>],
    module: &Pubkey,
    module_program: &Pubkey,
    country: u16,
) -> Result<u64> {
    for account in accounts {
        if account.owner != module_program || !matches_account_discriminator(account, "CountryInvestorCount")? {
            continue;
        }
        let expected_count = Pubkey::find_program_address(
            &[b"country_count", module.as_ref(), &country.to_le_bytes()],
            module_program,
        )
        .0;
        if account.key() != expected_count {
            continue;
        }
        if let Ok(count) = deserialize_local::<CountryInvestorCountView>(account) {
            if count.module == *module && count.country == country {
                return Ok(count.count);
            }
        }
    }
    Ok(0)
}

fn matches_account_discriminator(account: &AccountInfo, name: &str) -> Result<bool> {
    let data = account.try_borrow_data()?;
    if data.len() < 8 {
        return Ok(false);
    }
    let digest = hash(format!("account:{name}").as_bytes()).to_bytes();
    Ok(data[..8] == digest[..8])
}

struct TransferEvaluationSummary {
    sender_country: u16,
    receiver_country: u16,
}

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
        *compliance_state.owner,
        FracksTokenError::InvalidRegistryReference
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

fn invoke_compliance_created<'info>(
    compliance_program: &AccountInfo<'info>,
    compliance_state: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    to: Pubkey,
    amount: u64,
    to_balance_after: u64,
    to_country: u16,
) -> Result<()> {
    require_keys_eq!(
        compliance_program.key(),
        *compliance_state.owner,
        FracksTokenError::InvalidRegistryReference
    );
    let instruction = Instruction {
        program_id: compliance_program.key(),
        accounts: build_compliance_account_metas(compliance_state, remaining_accounts),
        data: compliance_instruction::Created {
            _to: to,
            amount,
            to_balance_after,
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

fn invoke_compliance_destroyed<'info>(
    compliance_program: &AccountInfo<'info>,
    compliance_state: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    from: Pubkey,
    amount: u64,
    from_balance_after: u64,
    from_country: u16,
) -> Result<()> {
    require_keys_eq!(
        compliance_program.key(),
        *compliance_state.owner,
        FracksTokenError::InvalidRegistryReference
    );
    let instruction = Instruction {
        program_id: compliance_program.key(),
        accounts: build_compliance_account_metas(compliance_state, remaining_accounts),
        data: compliance_instruction::Destroyed {
            _from: from,
            amount,
            from_balance_after,
            _from_country: from_country,
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

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::clock::Epoch;
    use anchor_lang::AnchorSerialize;

    fn serialize_account<T: AnchorSerialize>(name: &str, value: &T) -> Vec<u8> {
        let digest = hash(format!("account:{name}").as_bytes()).to_bytes();
        let mut data = digest[..8].to_vec();
        value.serialize(&mut data).expect("serialize");
        data
    }

    fn account_info_with_data(key: Pubkey, owner: Pubkey, payload: Vec<u8>) -> AccountInfo<'static> {
        let key = Box::leak(Box::new(key));
        let owner = Box::leak(Box::new(owner));
        let lamports = Box::leak(Box::new(0u64));
        let data = Box::leak(payload.into_boxed_slice());
        AccountInfo::new(key, false, false, lamports, data, owner, false, Epoch::default())
    }

    #[test]
    fn rejects_daily_usage_helper_on_wrong_pda() {
        let module = Pubkey::new_unique();
        let module_program = Pubkey::new_unique();
        let wallet = Pubkey::new_unique();
        let now = 1_000_000;
        let payload = serialize_account(
            "DailyWalletUsage",
            &DailyWalletUsageView {
                module,
                wallet,
                window_started_at: now,
                volume: 77,
                bump: 0,
            },
        );
        let fake_usage = account_info_with_data(Pubkey::new_unique(), module_program, payload);

        let used =
            read_daily_usage(&[fake_usage], &module, &module_program, &wallet, now).expect("read_daily_usage");
        assert_eq!(used, 0);
    }
}
