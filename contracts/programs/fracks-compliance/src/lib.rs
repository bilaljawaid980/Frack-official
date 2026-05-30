use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::{AccountMeta, Instruction}, program::invoke};
use mod_country_cap::cpi::accounts::{
    UpdateCountryCounts as MutateCountryCountsModule,
    UpdateSingleCountryCount as MutateSingleCountryCountModule,
};
use mod_daily_limit::cpi::accounts::UpdateUsage as MutateDailyLimitModule;
use mod_max_investors::cpi::accounts::MutateModule as MutateMaxInvestorsModule;
use mod_supply_cap::cpi::accounts::MutateModule as MutateSupplyCapModule;
use solana_program::hash::hash;

declare_id!("HnJiNrmDeVFZksgEXaQwyVqHXQLRcyqXEksbYhkiPFFV");

const MAX_MODULES: usize = 15;
const COMPLIANCE_SPACE: usize = 8 + 32 + 32 + 4 + (32 * MAX_MODULES) + 1 + 1;

#[program]
pub mod fracks_compliance {
    use super::*;

    pub fn initialize_compliance(
        ctx: Context<InitializeCompliance>,
        token_mint: Pubkey,
    ) -> Result<()> {
        let state = &mut ctx.accounts.compliance_state;
        state.owner = ctx.accounts.owner.key();
        state.token_mint = token_mint;
        state.modules = Vec::new();
        state.modules_paused = false;
        state.bump = ctx.bumps.compliance_state;
        Ok(())
    }

    pub fn bind_module(ctx: Context<UpdateComplianceOwner>, module_pubkey: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.compliance_state;
        require!(state.modules.len() < MAX_MODULES, FracksComplianceError::MaxModulesReached);
        require!(
            !state.modules.contains(&module_pubkey),
            FracksComplianceError::ModuleAlreadyBound
        );
        state.modules.push(module_pubkey);
        Ok(())
    }

    pub fn unbind_module(ctx: Context<UpdateComplianceOwner>, module_pubkey: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.compliance_state;
        let index = state
            .modules
            .iter()
            .position(|module| *module == module_pubkey)
            .ok_or_else(|| error!(FracksComplianceError::ModuleNotBound))?;
        state.modules.remove(index);
        Ok(())
    }

    pub fn set_modules_paused(
        ctx: Context<UpdateComplianceOwner>,
        paused: bool,
    ) -> Result<()> {
        ctx.accounts.compliance_state.modules_paused = paused;
        Ok(())
    }

    pub fn transfer_ownership(
        ctx: Context<UpdateComplianceOwner>,
        new_owner: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            new_owner,
            Pubkey::default(),
            FracksComplianceError::InvalidOwner
        );
        ctx.accounts.compliance_state.owner = new_owner;
        Ok(())
    }

    pub fn call_module_function<'info>(
        ctx: Context<'_, '_, '_, 'info, ForwardModuleCall<'info>>,
        data: Vec<u8>,
    ) -> Result<()> {
        let instruction = Instruction {
            program_id: ctx.accounts.module_program.key(),
            accounts: build_forward_account_metas(
                &ctx.accounts.owner.to_account_info(),
                ctx.remaining_accounts,
            ),
            data,
        };
        let mut infos = Vec::with_capacity(2 + ctx.remaining_accounts.len());
        infos.push(ctx.accounts.module_program.to_account_info());
        infos.push(ctx.accounts.owner.to_account_info());
        infos.extend(ctx.remaining_accounts.iter().cloned());
        invoke(&instruction, &infos).map_err(Into::into)
    }

    pub fn can_transfer(
        ctx: Context<ReadCompliance>,
        _from: Pubkey,
        _to: Pubkey,
        amount: u64,
        _from_balance: u64,
        to_balance: u64,
        from_country: u16,
        to_country: u16,
    ) -> Result<bool> {
        let state = &ctx.accounts.compliance_state;
        if state.modules_paused {
            return Ok(true);
        }

        let now = Clock::get()?.unix_timestamp;
        for module_key in &state.modules {
            let module_info = ctx
                .remaining_accounts
                .iter()
                .find(|account| account.key() == *module_key)
                .ok_or_else(|| error!(FracksComplianceError::MissingModuleAccount))?;

            if is_account_type(module_info, "MaxInvestorsModule")? {
                let module = deserialize_view::<MaxInvestorsModuleView>(module_info)?;
                if to_balance == 0 && amount > 0 && module.holder_count >= module.max_investors {
                    return Ok(false);
                }
                continue;
            }

            if is_account_type(module_info, "CountryRestrictModule")? {
                let module = deserialize_view::<CountryRestrictModuleView>(module_info)?;
                if !module.allowed_countries.contains(&from_country)
                    || !module.allowed_countries.contains(&to_country)
                {
                    return Ok(false);
                }
                continue;
            }

            if is_account_type(module_info, "MaxBalanceModule")? {
                let module = deserialize_view::<MaxBalanceModuleView>(module_info)?;
                if to_balance.saturating_add(amount) > module.max_balance {
                    return Ok(false);
                }
                continue;
            }

            if is_account_type(module_info, "MaxTransferModule")? {
                let module = deserialize_view::<MaxTransferModuleView>(module_info)?;
                if amount > module.max_amount {
                    return Ok(false);
                }
                continue;
            }

            if is_account_type(module_info, "LockupModule")? {
                let module = deserialize_view::<LockupModuleView>(module_info)?;
                if now < module.lockup_end {
                    return Ok(false);
                }
                continue;
            }

            if is_account_type(module_info, "DailyTransferLimitModule")? {
                let module = deserialize_view::<DailyTransferLimitModuleView>(module_info)?;
                let used = read_daily_usage(
                    ctx.remaining_accounts,
                    &module_info.key(),
                    module_info.owner,
                    &_from,
                    now,
                )?;
                if used.saturating_add(amount) > module.daily_limit {
                    return Ok(false);
                }
                continue;
            }

            if is_account_type(module_info, "SupplyCapModule")? {
                continue;
            }

            if is_account_type(module_info, "InvestorCountryCapModule")? {
                let module = deserialize_view::<InvestorCountryCapModuleView>(module_info)?;
                if to_balance == 0 && amount > 0 {
                    if let Some(cap) = module
                        .country_caps
                        .iter()
                        .find(|entry| entry.country == to_country)
                        .map(|entry| entry.cap)
                    {
                        let count = read_country_count(
                            ctx.remaining_accounts,
                            &module_info.key(),
                            module_info.owner,
                            to_country,
                        )?;
                        if count >= cap {
                            return Ok(false);
                        }
                    }
                }
                continue;
            }

            return err!(FracksComplianceError::InvalidModuleAccount);
        }

        Ok(true)
    }

    pub fn transferred<'info>(
        ctx: Context<'_, '_, '_, 'info, ReadCompliance<'info>>,
        _from: Pubkey,
        _to: Pubkey,
        amount: u64,
        from_balance_after: u64,
        to_balance_after: u64,
        _from_country: u16,
        _to_country: u16,
    ) -> Result<()> {
        for module_key in &ctx.accounts.compliance_state.modules {
            let module_info = ctx
                .remaining_accounts
                .iter()
                .find(|account| account.key() == *module_key)
                .ok_or_else(|| error!(FracksComplianceError::MissingModuleAccount))?;

            if is_account_type(module_info, "MaxInvestorsModule")? {
                let module = deserialize_view::<MaxInvestorsModuleView>(module_info)?;
                ensure_hook_authority(&ctx.accounts.compliance_state, module.hook_authority)?;
                let program = ctx
                    .remaining_accounts
                    .iter()
                    .find(|account| account.key() == *module_info.owner)
                    .cloned()
                    .ok_or_else(|| error!(FracksComplianceError::MissingModuleProgramAccount))?;
                let bump_seed = [ctx.accounts.compliance_state.bump];
                let signer_seeds: [&[u8]; 3] = [
                    b"compliance_state",
                    ctx.accounts.compliance_state.token_mint.as_ref(),
                    &bump_seed,
                ];
                mod_max_investors::cpi::transferred(
                    CpiContext::new_with_signer(
                        program,
                        MutateMaxInvestorsModule {
                            authority: ctx.accounts.compliance_state.to_account_info(),
                            module_state: module_info.clone(),
                        },
                        &[&signer_seeds],
                    ),
                    amount,
                    from_balance_after,
                    to_balance_after,
                )?;
                continue;
            }

            if is_account_type(module_info, "SupplyCapModule")? {
                continue;
            }

            if is_account_type(module_info, "DailyTransferLimitModule")? {
                let module = deserialize_view::<DailyTransferLimitModuleView>(module_info)?;
                ensure_hook_authority(&ctx.accounts.compliance_state, module.hook_authority)?;
                let program = ctx
                    .remaining_accounts
                    .iter()
                    .find(|account| account.key() == *module_info.owner)
                    .cloned()
                    .ok_or_else(|| error!(FracksComplianceError::MissingModuleProgramAccount))?;
                if let Ok(usage_account) = find_daily_usage_account(
                    ctx.remaining_accounts,
                    &module_info.key(),
                    module_info.owner,
                    &_from,
                ) {
                    let bump_seed = [ctx.accounts.compliance_state.bump];
                    let signer_seeds: [&[u8]; 3] = [
                        b"compliance_state",
                        ctx.accounts.compliance_state.token_mint.as_ref(),
                        &bump_seed,
                    ];
                    mod_daily_limit::cpi::transferred(
                        CpiContext::new_with_signer(
                            program,
                            MutateDailyLimitModule {
                                authority: ctx.accounts.compliance_state.to_account_info(),
                                module_state: module_info.clone(),
                                wallet_usage: usage_account,
                            },
                            &[&signer_seeds],
                        ),
                        _from,
                        amount,
                    )?;
                }
                continue;
            }

            if is_account_type(module_info, "InvestorCountryCapModule")? {
                let module = deserialize_view::<InvestorCountryCapModuleView>(module_info)?;
                ensure_hook_authority(&ctx.accounts.compliance_state, module.hook_authority)?;
                let program = ctx
                    .remaining_accounts
                    .iter()
                    .find(|account| account.key() == *module_info.owner)
                    .cloned()
                    .ok_or_else(|| error!(FracksComplianceError::MissingModuleProgramAccount))?;
                let from_country_count = find_country_count_account(
                    ctx.remaining_accounts,
                    &module_info.key(),
                    module_info.owner,
                    _from_country,
                )?;
                let to_country_count = find_country_count_account(
                    ctx.remaining_accounts,
                    &module_info.key(),
                    module_info.owner,
                    _to_country,
                )?;
                let bump_seed = [ctx.accounts.compliance_state.bump];
                let signer_seeds: [&[u8]; 3] = [
                    b"compliance_state",
                    ctx.accounts.compliance_state.token_mint.as_ref(),
                    &bump_seed,
                ];
                mod_country_cap::cpi::transferred(
                    CpiContext::new_with_signer(
                        program,
                        MutateCountryCountsModule {
                            authority: ctx.accounts.compliance_state.to_account_info(),
                            module_state: module_info.clone(),
                            from_country_count,
                            to_country_count,
                        },
                        &[&signer_seeds],
                    ),
                    amount,
                    from_balance_after,
                    to_balance_after,
                    _from_country,
                    _to_country,
                )?;
                continue;
            }
        }
        Ok(())
    }

    pub fn created<'info>(
        ctx: Context<'_, '_, '_, 'info, ReadCompliance<'info>>,
        _to: Pubkey,
        amount: u64,
        to_balance_after: u64,
        _to_country: u16,
    ) -> Result<()> {
        if ctx.accounts.compliance_state.modules_paused {
            return Ok(());
        }

        let now = Clock::get()?.unix_timestamp;
        for module_key in &ctx.accounts.compliance_state.modules {
            let module_info = ctx
                .remaining_accounts
                .iter()
                .find(|account| account.key() == *module_key)
                .ok_or_else(|| error!(FracksComplianceError::MissingModuleAccount))?;

            if is_account_type(module_info, "CountryRestrictModule")? {
                let module = deserialize_view::<CountryRestrictModuleView>(module_info)?;
                require!(
                    module.allowed_countries.contains(&_to_country),
                    FracksComplianceError::ComplianceCheckFailed
                );
                continue;
            }

            if is_account_type(module_info, "MaxBalanceModule")? {
                let module = deserialize_view::<MaxBalanceModuleView>(module_info)?;
                require!(
                    to_balance_after <= module.max_balance,
                    FracksComplianceError::ComplianceCheckFailed
                );
                continue;
            }

            if is_account_type(module_info, "MaxTransferModule")? {
                let module = deserialize_view::<MaxTransferModuleView>(module_info)?;
                require!(amount <= module.max_amount, FracksComplianceError::ComplianceCheckFailed);
                continue;
            }

            if is_account_type(module_info, "LockupModule")? {
                let module = deserialize_view::<LockupModuleView>(module_info)?;
                require!(now >= module.lockup_end, FracksComplianceError::ComplianceCheckFailed);
                continue;
            }

            if is_account_type(module_info, "MaxInvestorsModule")? {
                let module = deserialize_view::<MaxInvestorsModuleView>(module_info)?;
                ensure_hook_authority(&ctx.accounts.compliance_state, module.hook_authority)?;
                let program = ctx
                    .remaining_accounts
                    .iter()
                    .find(|account| account.key() == *module_info.owner)
                    .cloned()
                    .ok_or_else(|| error!(FracksComplianceError::MissingModuleProgramAccount))?;
                let bump_seed = [ctx.accounts.compliance_state.bump];
                let signer_seeds: [&[u8]; 3] = [
                    b"compliance_state",
                    ctx.accounts.compliance_state.token_mint.as_ref(),
                    &bump_seed,
                ];
                mod_max_investors::cpi::created(
                    CpiContext::new_with_signer(
                        program,
                        MutateMaxInvestorsModule {
                            authority: ctx.accounts.compliance_state.to_account_info(),
                            module_state: module_info.clone(),
                        },
                        &[&signer_seeds],
                    ),
                    amount,
                    to_balance_after,
                )?;
                continue;
            }

            if is_account_type(module_info, "SupplyCapModule")? {
                let module = deserialize_view::<SupplyCapModuleView>(module_info)?;
                ensure_hook_authority(&ctx.accounts.compliance_state, module.hook_authority)?;
                let program = ctx
                    .remaining_accounts
                    .iter()
                    .find(|account| account.key() == *module_info.owner)
                    .cloned()
                    .ok_or_else(|| error!(FracksComplianceError::MissingModuleProgramAccount))?;
                let bump_seed = [ctx.accounts.compliance_state.bump];
                let signer_seeds: [&[u8]; 3] = [
                    b"compliance_state",
                    ctx.accounts.compliance_state.token_mint.as_ref(),
                    &bump_seed,
                ];
                mod_supply_cap::cpi::created(
                    CpiContext::new_with_signer(
                        program,
                        MutateSupplyCapModule {
                            authority: ctx.accounts.compliance_state.to_account_info(),
                            module_state: module_info.clone(),
                        },
                        &[&signer_seeds],
                    ),
                    amount,
                )?;
                continue;
            }

            if is_account_type(module_info, "InvestorCountryCapModule")? {
                let module = deserialize_view::<InvestorCountryCapModuleView>(module_info)?;
                ensure_hook_authority(&ctx.accounts.compliance_state, module.hook_authority)?;
                let program = ctx
                    .remaining_accounts
                    .iter()
                    .find(|account| account.key() == *module_info.owner)
                    .cloned()
                    .ok_or_else(|| error!(FracksComplianceError::MissingModuleProgramAccount))?;
                let country_count = find_country_count_account(
                    ctx.remaining_accounts,
                    &module_info.key(),
                    module_info.owner,
                    _to_country,
                )?;
                let bump_seed = [ctx.accounts.compliance_state.bump];
                let signer_seeds: [&[u8]; 3] = [
                    b"compliance_state",
                    ctx.accounts.compliance_state.token_mint.as_ref(),
                    &bump_seed,
                ];
                mod_country_cap::cpi::created(
                    CpiContext::new_with_signer(
                        program,
                        MutateSingleCountryCountModule {
                            authority: ctx.accounts.compliance_state.to_account_info(),
                            module_state: module_info.clone(),
                            country_count,
                        },
                        &[&signer_seeds],
                    ),
                    amount,
                    to_balance_after,
                    _to_country,
                )?;
                continue;
            }
        }
        Ok(())
    }

    pub fn destroyed<'info>(
        ctx: Context<'_, '_, '_, 'info, ReadCompliance<'info>>,
        _from: Pubkey,
        amount: u64,
        from_balance_after: u64,
        _from_country: u16,
    ) -> Result<()> {
        for module_key in &ctx.accounts.compliance_state.modules {
            let module_info = ctx
                .remaining_accounts
                .iter()
                .find(|account| account.key() == *module_key)
                .ok_or_else(|| error!(FracksComplianceError::MissingModuleAccount))?;

            if is_account_type(module_info, "MaxInvestorsModule")? {
                let module = deserialize_view::<MaxInvestorsModuleView>(module_info)?;
                ensure_hook_authority(&ctx.accounts.compliance_state, module.hook_authority)?;
                let program = ctx
                    .remaining_accounts
                    .iter()
                    .find(|account| account.key() == *module_info.owner)
                    .cloned()
                    .ok_or_else(|| error!(FracksComplianceError::MissingModuleProgramAccount))?;
                let bump_seed = [ctx.accounts.compliance_state.bump];
                let signer_seeds: [&[u8]; 3] = [
                    b"compliance_state",
                    ctx.accounts.compliance_state.token_mint.as_ref(),
                    &bump_seed,
                ];
                mod_max_investors::cpi::destroyed(
                    CpiContext::new_with_signer(
                        program,
                        MutateMaxInvestorsModule {
                            authority: ctx.accounts.compliance_state.to_account_info(),
                            module_state: module_info.clone(),
                        },
                        &[&signer_seeds],
                    ),
                    amount,
                    from_balance_after,
                )?;
                continue;
            }

            if is_account_type(module_info, "SupplyCapModule")? {
                let module = deserialize_view::<SupplyCapModuleView>(module_info)?;
                ensure_hook_authority(&ctx.accounts.compliance_state, module.hook_authority)?;
                let program = ctx
                    .remaining_accounts
                    .iter()
                    .find(|account| account.key() == *module_info.owner)
                    .cloned()
                    .ok_or_else(|| error!(FracksComplianceError::MissingModuleProgramAccount))?;
                let bump_seed = [ctx.accounts.compliance_state.bump];
                let signer_seeds: [&[u8]; 3] = [
                    b"compliance_state",
                    ctx.accounts.compliance_state.token_mint.as_ref(),
                    &bump_seed,
                ];
                mod_supply_cap::cpi::destroyed(
                    CpiContext::new_with_signer(
                        program,
                        MutateSupplyCapModule {
                            authority: ctx.accounts.compliance_state.to_account_info(),
                            module_state: module_info.clone(),
                        },
                        &[&signer_seeds],
                    ),
                    amount,
                )?;
                continue;
            }

            if is_account_type(module_info, "InvestorCountryCapModule")? {
                let module = deserialize_view::<InvestorCountryCapModuleView>(module_info)?;
                ensure_hook_authority(&ctx.accounts.compliance_state, module.hook_authority)?;
                let program = ctx
                    .remaining_accounts
                    .iter()
                    .find(|account| account.key() == *module_info.owner)
                    .cloned()
                    .ok_or_else(|| error!(FracksComplianceError::MissingModuleProgramAccount))?;
                let country_count = find_country_count_account(
                    ctx.remaining_accounts,
                    &module_info.key(),
                    module_info.owner,
                    _from_country,
                )?;
                let bump_seed = [ctx.accounts.compliance_state.bump];
                let signer_seeds: [&[u8]; 3] = [
                    b"compliance_state",
                    ctx.accounts.compliance_state.token_mint.as_ref(),
                    &bump_seed,
                ];
                mod_country_cap::cpi::destroyed(
                    CpiContext::new_with_signer(
                        program,
                        MutateSingleCountryCountModule {
                            authority: ctx.accounts.compliance_state.to_account_info(),
                            module_state: module_info.clone(),
                            country_count,
                        },
                        &[&signer_seeds],
                    ),
                    amount,
                    from_balance_after,
                    _from_country,
                )?;
                continue;
            }
        }
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct InitializeCompliance<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = COMPLIANCE_SPACE,
        seeds = [b"compliance_state", token_mint.as_ref()],
        bump
    )]
    pub compliance_state: Account<'info, ComplianceState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateComplianceOwner<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"compliance_state", compliance_state.token_mint.as_ref()],
        bump = compliance_state.bump,
        has_one = owner @ FracksComplianceError::NotOwner
    )]
    pub compliance_state: Account<'info, ComplianceState>,
}

#[derive(Accounts)]
pub struct ForwardModuleCall<'info> {
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"compliance_state", compliance_state.token_mint.as_ref()],
        bump = compliance_state.bump,
        has_one = owner @ FracksComplianceError::NotOwner
    )]
    pub compliance_state: Account<'info, ComplianceState>,
    /// CHECK: Owner chooses the target module program to forward into.
    pub module_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ReadCompliance<'info> {
    #[account(
        seeds = [b"compliance_state", compliance_state.token_mint.as_ref()],
        bump = compliance_state.bump
    )]
    pub compliance_state: Account<'info, ComplianceState>,
}

#[account]
pub struct ComplianceState {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub modules: Vec<Pubkey>,
    pub modules_paused: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CountryCapEntryView {
    pub country: u16,
    pub cap: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MaxInvestorsModuleView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub hook_authority: Pubkey,
    pub max_investors: u64,
    pub holder_count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CountryRestrictModuleView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub allowed_countries: Vec<u16>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MaxBalanceModuleView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub max_balance: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MaxTransferModuleView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub max_amount: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LockupModuleView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub lockup_end: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DailyTransferLimitModuleView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub hook_authority: Pubkey,
    pub daily_limit: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DailyWalletUsageView {
    pub module: Pubkey,
    pub wallet: Pubkey,
    pub window_started_at: i64,
    pub volume: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SupplyCapModuleView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub hook_authority: Pubkey,
    pub max_supply: u64,
    pub total_supply: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InvestorCountryCapModuleView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub hook_authority: Pubkey,
    pub country_caps: Vec<CountryCapEntryView>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CountryInvestorCountView {
    pub module: Pubkey,
    pub country: u16,
    pub count: u64,
    pub bump: u8,
}

#[error_code(offset = 0)]
pub enum FracksComplianceError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Owner address is invalid.")]
    InvalidOwner = 6001,
    #[msg("Max modules reached.")]
    MaxModulesReached = 6014,
    #[msg("Module is already bound.")]
    ModuleAlreadyBound = 6047,
    #[msg("Module is not bound.")]
    ModuleNotBound = 6048,
    #[msg("Missing module account.")]
    MissingModuleAccount = 6049,
    #[msg("Invalid module account.")]
    InvalidModuleAccount = 6050,
    #[msg("Missing module program account.")]
    MissingModuleProgramAccount = 6051,
    #[msg("Module hook authority is not bound to this compliance state.")]
    ModuleHookAuthorityMismatch = 6052,
    #[msg("Missing module support account.")]
    MissingModuleSupportAccount = 6053,
    #[msg("Compliance check failed.")]
    ComplianceCheckFailed = 6054,
}

fn deserialize_view<T: AnchorDeserialize>(account: &AccountInfo) -> Result<T> {
    let data = account.try_borrow_data()?;
    require!(data.len() >= 8, FracksComplianceError::InvalidModuleAccount);
    let mut slice: &[u8] = &data[8..];
    T::deserialize(&mut slice).map_err(|_| error!(FracksComplianceError::InvalidModuleAccount))
}

fn read_daily_usage(
    accounts: &[AccountInfo],
    module: &Pubkey,
    module_program: &Pubkey,
    wallet: &Pubkey,
    now: i64,
) -> Result<u64> {
    for account in accounts {
        if account.owner != module_program || !is_account_type(account, "DailyWalletUsage")? {
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
        if is_account_type(account, "DailyWalletUsage")? {
            let usage = deserialize_view::<DailyWalletUsageView>(account)?;
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

fn find_daily_usage_account<'info>(
    accounts: &[AccountInfo<'info>],
    module: &Pubkey,
    module_program: &Pubkey,
    wallet: &Pubkey,
) -> Result<AccountInfo<'info>> {
    for account in accounts {
        if account.owner != module_program || !is_account_type(account, "DailyWalletUsage")? {
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
        let usage = deserialize_view::<DailyWalletUsageView>(account)?;
        if usage.module == *module && usage.wallet == *wallet {
            return Ok(account.clone());
        }
    }

    err!(FracksComplianceError::MissingModuleSupportAccount)
}

fn read_country_count(
    accounts: &[AccountInfo],
    module: &Pubkey,
    module_program: &Pubkey,
    country: u16,
) -> Result<u64> {
    for account in accounts {
        if account.owner != module_program || !is_account_type(account, "CountryInvestorCount")? {
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
        if is_account_type(account, "CountryInvestorCount")? {
            let count = deserialize_view::<CountryInvestorCountView>(account)?;
            if count.module == *module && count.country == country {
                return Ok(count.count);
            }
        }
    }

    Ok(0)
}

fn find_country_count_account<'info>(
    accounts: &[AccountInfo<'info>],
    module: &Pubkey,
    module_program: &Pubkey,
    country: u16,
) -> Result<AccountInfo<'info>> {
    for account in accounts {
        if account.owner != module_program || !is_account_type(account, "CountryInvestorCount")? {
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
        let count = deserialize_view::<CountryInvestorCountView>(account)?;
        if count.module == *module && count.country == country {
            return Ok(account.clone());
        }
    }

    err!(FracksComplianceError::MissingModuleSupportAccount)
}

fn ensure_hook_authority(state: &Account<ComplianceState>, hook_authority: Pubkey) -> Result<()> {
    require_keys_eq!(
        state.key(),
        hook_authority,
        FracksComplianceError::ModuleHookAuthorityMismatch
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
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&digest[..8]);
    discriminator
}

fn build_forward_account_metas(
    owner: &AccountInfo,
    remaining_accounts: &[AccountInfo],
) -> Vec<AccountMeta> {
    let mut metas = Vec::with_capacity(1 + remaining_accounts.len());
    metas.push(AccountMeta::new_readonly(owner.key(), true));
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
    fn rejects_country_count_helper_on_wrong_pda() {
        let module = Pubkey::new_unique();
        let module_program = Pubkey::new_unique();
        let country = 840u16;
        let payload = serialize_account(
            "CountryInvestorCount",
            &CountryInvestorCountView {
                module,
                country,
                count: 5,
                bump: 0,
            },
        );
        let fake_count = account_info_with_data(Pubkey::new_unique(), module_program, payload);

        let count =
            read_country_count(&[fake_count], &module, &module_program, country).expect("read_country_count");
        assert_eq!(count, 0);
    }
}
