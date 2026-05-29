# Code dump for '/home/shahnil/Desktop/FRACKS/ERC-3436' (patterns: *.rs)

## programs/fracks-compliance/src/lib.rs

```
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

declare_id!("9XYxZzDfU17BBpN1qhdu7RDCCrV6uebDgi5xse7Jbz5d");

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
                if module.blocked_countries.contains(&from_country)
                    || module.blocked_countries.contains(&to_country)
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
                let usage_account = find_daily_usage_account(
                    ctx.remaining_accounts,
                    &module_info.key(),
                    module_info.owner,
                    &_from,
                )?;
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
    pub blocked_countries: Vec<u16>,
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

```

## programs/fracks-ctr/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("B15EFQKwnfbNHXHhPVvVcw18PaBeTDsRLNRno3QS8Yna");

const MAX_TOPICS: usize = 20;
const CTR_SPACE: usize = 8 + 32 + 32 + 4 + (8 * MAX_TOPICS) + 1;

#[program]
pub mod fracks_ctr {
    use super::*;

    pub fn initialize_ctr(ctx: Context<InitializeCtr>, token_mint: Pubkey) -> Result<()> {
        let ctr_state = &mut ctx.accounts.ctr_state;
        ctr_state.owner = ctx.accounts.owner.key();
        ctr_state.token_mint = token_mint;
        ctr_state.topics = Vec::new();
        ctr_state.bump = ctx.bumps.ctr_state;
        Ok(())
    }

    pub fn add_claim_topic(ctx: Context<MutateCtr>, topic_id: u64) -> Result<()> {
        let ctr_state = &mut ctx.accounts.ctr_state;
        require!(
            !ctr_state.topics.contains(&topic_id),
            FracksCtrError::TopicAlreadyExists
        );
        require!(ctr_state.topics.len() < MAX_TOPICS, FracksCtrError::MaxTopicsReached);

        ctr_state.topics.push(topic_id);

        emit!(ClaimTopicAdded {
            topic_id,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn remove_claim_topic(ctx: Context<MutateCtr>, topic_id: u64) -> Result<()> {
        let ctr_state = &mut ctx.accounts.ctr_state;
        let index = ctr_state
            .topics
            .iter()
            .position(|topic| *topic == topic_id)
            .ok_or_else(|| error!(FracksCtrError::TopicNotFound))?;

        ctr_state.topics.remove(index);

        emit!(ClaimTopicRemoved {
            topic_id,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct InitializeCtr<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = CTR_SPACE,
        seeds = [b"ctr_state", token_mint.as_ref()],
        bump
    )]
    pub ctr_state: Account<'info, ClaimTopicsState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateCtr<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"ctr_state", ctr_state.token_mint.as_ref()],
        bump = ctr_state.bump,
        has_one = owner @ FracksCtrError::NotOwner
    )]
    pub ctr_state: Account<'info, ClaimTopicsState>,
}

#[account]
pub struct ClaimTopicsState {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub topics: Vec<u64>,
    pub bump: u8,
}

#[event]
pub struct ClaimTopicAdded {
    pub topic_id: u64,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ClaimTopicRemoved {
    pub topic_id: u64,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[error_code(offset = 0)]
pub enum FracksCtrError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Maximum topics reached.")]
    MaxTopicsReached = 6039,
    #[msg("Topic already exists.")]
    TopicAlreadyExists = 6040,
    #[msg("Topic not found.")]
    TopicNotFound = 6041,
}

```

## programs/fracks-factory/src/lib.rs

```
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_2022_extensions::permanent_delegate::{
    permanent_delegate_initialize, PermanentDelegateInitialize,
};
use anchor_spl::token_2022_extensions::transfer_hook::{
    transfer_hook_initialize, TransferHookInitialize,
};

use fracks_compliance::cpi::accounts::{
    InitializeCompliance, UpdateComplianceOwner as BindComplianceModule,
};
use fracks_compliance::program::FracksCompliance;
use fracks_ctr::cpi::accounts::{InitializeCtr, MutateCtr as AddClaimTopic};
use fracks_ctr::program::FracksCtr;
use fracks_irp::cpi::accounts::InitializeRegistry;
use fracks_irp::program::FracksIrp;
use fracks_irs::cpi::accounts::{InitializeIrs, UpdateIrsOwnerState as BindRegistry};
use fracks_irs::program::FracksIrs;
use fracks_tir::cpi::accounts::{AddTrustedIssuer, InitializeTir};
use fracks_tir::program::FracksTir;
use fracks_token_hook::cpi::accounts::InitializeExtraAccountMetas;
use fracks_token_hook::program::FracksTokenHook;
use fracks_token::cpi::accounts::InitializeToken;
use fracks_token::program::FracksToken;

declare_id!("6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe");

const MAX_CLAIM_TOPICS: usize = 20;
const MAX_TRUSTED_ISSUERS: usize = 16;
const MAX_COMPLIANCE_MODULES: usize = 15;
const FACTORY_STATE_SPACE: usize = 8 + (32 * 9) + 8 + 1;
const TOKEN_DEPLOYMENT_SPACE: usize = 8 + 8 + 32 + 32 + (32 * 8) + 8 + 1;
const TOKEN_2022_MINT_EXTENSIONS: [spl_token_2022::extension::ExtensionType; 2] = [
    spl_token_2022::extension::ExtensionType::TransferHook,
    spl_token_2022::extension::ExtensionType::PermanentDelegate,
];

#[program]
pub mod fracks_factory {
    use super::*;

    pub fn initialize_factory(ctx: Context<InitializeFactory>) -> Result<()> {
        let state = &mut ctx.accounts.factory_state;
        state.owner = ctx.accounts.owner.key();
        state.pending_owner = Pubkey::default();
        state.token_program_id = ctx.accounts.token_program.key();
        state.fid_program_id = fracks_fid::id();
        state.irp_program_id = ctx.accounts.irp_program.key();
        state.irs_program_id = ctx.accounts.irs_program.key();
        state.tir_program_id = ctx.accounts.tir_program.key();
        state.ctr_program_id = ctx.accounts.ctr_program.key();
        state.compliance_program_id = ctx.accounts.compliance_program.key();
        state.deployment_count = 0;
        state.bump = ctx.bumps.factory_state;
        Ok(())
    }

    pub fn update_program_ids(
        ctx: Context<UpdateFactoryState>,
        program_ids: ProgramIds,
    ) -> Result<()> {
        let state = &mut ctx.accounts.factory_state;
        state.token_program_id = program_ids.token_program_id;
        state.fid_program_id = program_ids.fid_program_id;
        state.irp_program_id = program_ids.irp_program_id;
        state.irs_program_id = program_ids.irs_program_id;
        state.tir_program_id = program_ids.tir_program_id;
        state.ctr_program_id = program_ids.ctr_program_id;
        state.compliance_program_id = program_ids.compliance_program_id;
        Ok(())
    }

    pub fn transfer_factory_ownership(
        ctx: Context<UpdateFactoryState>,
        new_owner: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            new_owner,
            Pubkey::default(),
            FracksFactoryError::InvalidPendingOwner
        );
        ctx.accounts.factory_state.pending_owner = new_owner;
        Ok(())
    }

    pub fn accept_factory_ownership(ctx: Context<AcceptFactoryOwnership>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.factory_state.pending_owner,
            ctx.accounts.pending_owner.key(),
            FracksFactoryError::NotPendingOwner
        );
        ctx.accounts.factory_state.owner = ctx.accounts.pending_owner.key();
        ctx.accounts.factory_state.pending_owner = Pubkey::default();
        Ok(())
    }

    pub fn create_token_mint(ctx: Context<CreateTokenMint>, decimals: u8) -> Result<()> {
        initialize_token_2022_mint(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.token_mint_account.to_account_info(),
            ctx.accounts.token_state.key(),
            ctx.accounts.hook_program.key(),
            ctx.accounts.token_2022_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            decimals,
        )
    }

    pub fn deploy_token_suite<'info>(
        ctx: Context<'_, '_, '_, 'info, DeployTokenSuite<'info>>,
        args: DeployTokenSuiteArgs,
    ) -> Result<()> {
        validate_args(&args)?;
        verify_program_ids(&ctx.accounts.factory_state, &ctx.accounts)?;

        let expected_token_state = Pubkey::find_program_address(
            &[b"token_state", args.token_mint.as_ref()],
            &ctx.accounts.token_program.key(),
        )
        .0;
        let expected_owner_state = Pubkey::find_program_address(
            &[b"owner", args.token_mint.as_ref()],
            &ctx.accounts.token_program.key(),
        )
        .0;
        let expected_tir_state = Pubkey::find_program_address(
            &[b"tir_state", args.token_mint.as_ref()],
            &ctx.accounts.tir_program.key(),
        )
        .0;
        let expected_ctr_state = Pubkey::find_program_address(
            &[b"ctr_state", args.token_mint.as_ref()],
            &ctx.accounts.ctr_program.key(),
        )
        .0;
        let expected_irp_state = Pubkey::find_program_address(
            &[b"irp_state", args.token_mint.as_ref()],
            &ctx.accounts.irp_program.key(),
        )
        .0;
        let expected_compliance_state = Pubkey::find_program_address(
            &[b"compliance_state", args.token_mint.as_ref()],
            &ctx.accounts.compliance_program.key(),
        )
        .0;
        let expected_irs_state = args.shared_irs.unwrap_or_else(|| {
            Pubkey::find_program_address(
                &[b"irs_state", ctx.accounts.issuer.key().as_ref()],
                &ctx.accounts.irs_program.key(),
            )
            .0
        });

        require_keys_eq!(
            ctx.accounts.token_state.key(),
            expected_token_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.owner_state.key(),
            expected_owner_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.tir_state.key(),
            expected_tir_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.ctr_state.key(),
            expected_ctr_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.irp_state.key(),
            expected_irp_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.compliance_state.key(),
            expected_compliance_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.irs_state.key(),
            expected_irs_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.token_mint_account.key(),
            args.token_mint,
            FracksFactoryError::InvalidDerivedAccount
        );

        let trusted_issuer_account_count = args.trusted_issuers.len();
        require!(
            ctx.remaining_accounts.len() >= trusted_issuer_account_count,
            FracksFactoryError::MissingTrustedIssuerAccounts
        );
        require!(
            ctx.remaining_accounts.len()
                >= trusted_issuer_account_count
                    .checked_add(args.compliance_modules.len())
                    .ok_or_else(|| error!(FracksFactoryError::ArithmeticOverflow))?,
            FracksFactoryError::MissingComplianceModuleAccounts
        );

        require!(
            ctx.accounts.deployment.deployed_at == 0,
            FracksFactoryError::DeploymentAlreadyExists
        );

        fracks_token::cpi::initialize_token(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                InitializeToken {
                    owner: ctx.accounts.issuer.to_account_info(),
                    token_state: ctx.accounts.token_state.to_account_info(),
                    owner_state: ctx.accounts.owner_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
            args.token_name.clone(),
            args.token_symbol.clone(),
            args.decimals,
            args.isin.clone(),
            ctx.accounts.irp_state.key(),
            ctx.accounts.compliance_state.key(),
        )?;

        fracks_ctr::cpi::initialize_ctr(
            CpiContext::new(
                ctx.accounts.ctr_program.to_account_info(),
                InitializeCtr {
                    owner: ctx.accounts.issuer.to_account_info(),
                    ctr_state: ctx.accounts.ctr_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
        )?;

        for topic in &args.claim_topics {
            fracks_ctr::cpi::add_claim_topic(
                CpiContext::new(
                    ctx.accounts.ctr_program.to_account_info(),
                    AddClaimTopic {
                        owner: ctx.accounts.issuer.to_account_info(),
                        ctr_state: ctx.accounts.ctr_state.to_account_info(),
                    },
                ),
                *topic,
            )?;
        }

        fracks_tir::cpi::initialize_tir(
            CpiContext::new(
                ctx.accounts.tir_program.to_account_info(),
                InitializeTir {
                    owner: ctx.accounts.issuer.to_account_info(),
                    tir_state: ctx.accounts.tir_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
        )?;

        for (index, issuer) in args.trusted_issuers.iter().enumerate() {
            let issuer_entry = ctx.remaining_accounts[index].clone();
            let expected_issuer_entry = Pubkey::find_program_address(
                &[
                    b"issuer_entry",
                    ctx.accounts.tir_state.key().as_ref(),
                    issuer.issuer_fid.as_ref(),
                ],
                &ctx.accounts.tir_program.key(),
            )
            .0;
            require_keys_eq!(
                issuer_entry.key(),
                expected_issuer_entry,
                FracksFactoryError::InvalidDerivedAccount
            );

            fracks_tir::cpi::add_trusted_issuer(
                CpiContext::new(
                    ctx.accounts.tir_program.to_account_info(),
                    AddTrustedIssuer {
                        owner: ctx.accounts.issuer.to_account_info(),
                        tir_state: ctx.accounts.tir_state.to_account_info(),
                        issuer_entry,
                        system_program: ctx.accounts.system_program.to_account_info(),
                    },
                ),
                issuer.issuer_fid,
                issuer.topics.clone(),
                issuer.label.clone(),
            )?;
        }

        if args.shared_irs.is_none() {
            fracks_irs::cpi::initialize_irs(CpiContext::new(
                ctx.accounts.irs_program.to_account_info(),
                InitializeIrs {
                    owner: ctx.accounts.issuer.to_account_info(),
                    irs_state: ctx.accounts.irs_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ))?;
        }

        fracks_irp::cpi::initialize_registry(
            CpiContext::new(
                ctx.accounts.irp_program.to_account_info(),
                InitializeRegistry {
                    owner: ctx.accounts.issuer.to_account_info(),
                    registry_state: ctx.accounts.irp_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
            ctx.accounts.irs_state.key(),
            ctx.accounts.tir_state.key(),
            ctx.accounts.ctr_state.key(),
        )?;

        fracks_irs::cpi::bind_registry(
            CpiContext::new(
                ctx.accounts.irs_program.to_account_info(),
                BindRegistry {
                    owner: ctx.accounts.issuer.to_account_info(),
                    irs_state: ctx.accounts.irs_state.to_account_info(),
                },
            ),
            ctx.accounts.irp_state.key(),
        )?;

        fracks_compliance::cpi::initialize_compliance(
            CpiContext::new(
                ctx.accounts.compliance_program.to_account_info(),
                InitializeCompliance {
                    owner: ctx.accounts.issuer.to_account_info(),
                    compliance_state: ctx.accounts.compliance_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
        )?;

        for module in &args.compliance_modules {
            fracks_compliance::cpi::bind_module(
                CpiContext::new(
                    ctx.accounts.compliance_program.to_account_info(),
                    BindComplianceModule {
                        owner: ctx.accounts.issuer.to_account_info(),
                        compliance_state: ctx.accounts.compliance_state.to_account_info(),
                    },
                ),
                *module,
            )?;
        }

        let module_accounts_start = trusted_issuer_account_count;
        let module_accounts_end = module_accounts_start
            .checked_add(args.compliance_modules.len())
            .ok_or_else(|| error!(FracksFactoryError::ArithmeticOverflow))?;
        for (index, module) in args.compliance_modules.iter().enumerate() {
            let module_account = &ctx.remaining_accounts[module_accounts_start + index];
            require_keys_eq!(
                module_account.key(),
                *module,
                FracksFactoryError::InvalidDerivedAccount
            );
        }
        fracks_token_hook::cpi::initialize_extra_account_metas(
            CpiContext::new(
                ctx.accounts.hook_program.to_account_info(),
                InitializeExtraAccountMetas {
                    payer: ctx.accounts.issuer.to_account_info(),
                    token_state: ctx.accounts.token_state.to_account_info(),
                    owner_state: ctx.accounts.owner_state.to_account_info(),
                    compliance_state: ctx.accounts.compliance_state.to_account_info(),
                    token_mint_account: ctx.accounts.token_mint_account.to_account_info(),
                    extra_account_metas: ctx.accounts.extra_account_metas.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            )
            .with_remaining_accounts(
                ctx.remaining_accounts[module_accounts_start..module_accounts_end].to_vec(),
            ),
        )?;

        let deployment = &mut ctx.accounts.deployment;
        deployment.deployment_id = ctx.accounts.factory_state.deployment_count;
        deployment.issuer = ctx.accounts.issuer.key();
        deployment.salt = args.salt;
        deployment.token_mint = args.token_mint;
        deployment.token_state = ctx.accounts.token_state.key();
        deployment.owner_state = ctx.accounts.owner_state.key();
        deployment.irp_state = ctx.accounts.irp_state.key();
        deployment.irs_state = ctx.accounts.irs_state.key();
        deployment.tir_state = ctx.accounts.tir_state.key();
        deployment.ctr_state = ctx.accounts.ctr_state.key();
        deployment.compliance_state = ctx.accounts.compliance_state.key();
        deployment.deployed_at = Clock::get()?.unix_timestamp;
        deployment.bump = ctx.bumps.deployment;

        ctx.accounts.factory_state.deployment_count = ctx
            .accounts
            .factory_state
            .deployment_count
            .checked_add(1)
            .ok_or_else(|| error!(FracksFactoryError::ArithmeticOverflow))?;

        emit!(TokenSuiteDeployed {
            issuer: ctx.accounts.issuer.key(),
            deployment_id: deployment.deployment_id,
            token_mint: deployment.token_mint,
            token_state: deployment.token_state,
            irp_state: deployment.irp_state,
            irs_state: deployment.irs_state,
            tir_state: deployment.tir_state,
            ctr_state: deployment.ctr_state,
            compliance_state: deployment.compliance_state,
            deployed_at: deployment.deployed_at,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeFactory<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = FACTORY_STATE_SPACE,
        seeds = [b"factory_state"],
        bump
    )]
    pub factory_state: Account<'info, FactoryState>,
    pub token_program: Program<'info, FracksToken>,
    pub irp_program: Program<'info, FracksIrp>,
    pub irs_program: Program<'info, FracksIrs>,
    pub tir_program: Program<'info, FracksTir>,
    pub ctr_program: Program<'info, FracksCtr>,
    pub compliance_program: Program<'info, FracksCompliance>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFactoryState<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"factory_state"],
        bump = factory_state.bump,
        has_one = owner @ FracksFactoryError::NotOwner
    )]
    pub factory_state: Account<'info, FactoryState>,
}

#[derive(Accounts)]
pub struct CreateTokenMint<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Deterministic FRACKS token_state PDA that becomes mint authority and permanent delegate.
    pub token_state: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_mint_account: Signer<'info>,
    pub hook_program: Program<'info, FracksTokenHook>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptFactoryOwnership<'info> {
    #[account(mut)]
    pub pending_owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"factory_state"],
        bump = factory_state.bump
    )]
    pub factory_state: Account<'info, FactoryState>,
}

#[derive(Accounts)]
#[instruction(args: DeployTokenSuiteArgs)]
pub struct DeployTokenSuite<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"factory_state"],
        bump = factory_state.bump
    )]
    pub factory_state: Account<'info, FactoryState>,
    #[account(
        init_if_needed,
        payer = issuer,
        space = TOKEN_DEPLOYMENT_SPACE,
        seeds = [b"deployment", issuer.key().as_ref(), args.salt.as_ref()],
        bump
    )]
    pub deployment: Account<'info, TokenDeployment>,
    /// CHECK: Validated against the token program PDA derivation.
    #[account(mut)]
    pub token_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the token program PDA derivation.
    #[account(mut)]
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the IRS program PDA derivation.
    #[account(mut)]
    pub irs_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the TIR program PDA derivation.
    #[account(mut)]
    pub tir_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the CTR program PDA derivation.
    #[account(mut)]
    pub ctr_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the IRP program PDA derivation.
    #[account(mut)]
    pub irp_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the compliance program PDA derivation.
    #[account(mut)]
    pub compliance_state: UncheckedAccount<'info>,
    /// CHECK: Token-2022 mint validated by hook extra-account-metas initialization.
    pub token_mint_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Hook-owned Token-2022 extra-account-metas PDA initialized during suite deployment.
    pub extra_account_metas: UncheckedAccount<'info>,
    pub token_program: Program<'info, FracksToken>,
    pub hook_program: Program<'info, FracksTokenHook>,
    pub irp_program: Program<'info, FracksIrp>,
    pub irs_program: Program<'info, FracksIrs>,
    pub tir_program: Program<'info, FracksTir>,
    pub ctr_program: Program<'info, FracksCtr>,
    pub compliance_program: Program<'info, FracksCompliance>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct FactoryState {
    pub owner: Pubkey,
    pub pending_owner: Pubkey,
    pub token_program_id: Pubkey,
    pub fid_program_id: Pubkey,
    pub irp_program_id: Pubkey,
    pub irs_program_id: Pubkey,
    pub tir_program_id: Pubkey,
    pub ctr_program_id: Pubkey,
    pub compliance_program_id: Pubkey,
    pub deployment_count: u64,
    pub bump: u8,
}

#[account]
pub struct TokenDeployment {
    pub deployment_id: u64,
    pub issuer: Pubkey,
    pub salt: [u8; 32],
    pub token_mint: Pubkey,
    pub token_state: Pubkey,
    pub owner_state: Pubkey,
    pub irp_state: Pubkey,
    pub irs_state: Pubkey,
    pub tir_state: Pubkey,
    pub ctr_state: Pubkey,
    pub compliance_state: Pubkey,
    pub deployed_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct ProgramIds {
    pub token_program_id: Pubkey,
    pub fid_program_id: Pubkey,
    pub irp_program_id: Pubkey,
    pub irs_program_id: Pubkey,
    pub tir_program_id: Pubkey,
    pub ctr_program_id: Pubkey,
    pub compliance_program_id: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TrustedIssuerInput {
    pub issuer_fid: Pubkey,
    pub topics: Vec<u64>,
    pub label: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DeployTokenSuiteArgs {
    pub token_mint: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
    pub decimals: u8,
    pub isin: String,
    pub claim_topics: Vec<u64>,
    pub trusted_issuers: Vec<TrustedIssuerInput>,
    pub compliance_modules: Vec<Pubkey>,
    pub shared_irs: Option<Pubkey>,
    pub salt: [u8; 32],
}

#[event]
pub struct TokenSuiteDeployed {
    pub issuer: Pubkey,
    pub deployment_id: u64,
    pub token_mint: Pubkey,
    pub token_state: Pubkey,
    pub irp_state: Pubkey,
    pub irs_state: Pubkey,
    pub tir_state: Pubkey,
    pub ctr_state: Pubkey,
    pub compliance_state: Pubkey,
    pub deployed_at: i64,
}

fn validate_args(args: &DeployTokenSuiteArgs) -> Result<()> {
    require!(
        !args.token_name.is_empty() && args.token_name.len() <= 64,
        FracksFactoryError::InvalidTokenMetadata
    );
    require!(
        !args.token_symbol.is_empty() && args.token_symbol.len() <= 12,
        FracksFactoryError::InvalidTokenMetadata
    );
    require!(
        !args.isin.is_empty() && args.isin.len() <= 24,
        FracksFactoryError::InvalidTokenMetadata
    );
    require!(
        args.claim_topics.len() <= MAX_CLAIM_TOPICS,
        FracksFactoryError::TooManyClaimTopics
    );
    require!(
        args.trusted_issuers.len() <= MAX_TRUSTED_ISSUERS,
        FracksFactoryError::TooManyTrustedIssuers
    );
    require!(
        args.compliance_modules.len() <= MAX_COMPLIANCE_MODULES,
        FracksFactoryError::TooManyComplianceModules
    );
    for issuer in &args.trusted_issuers {
        require!(
            !issuer.topics.is_empty(),
            FracksFactoryError::TrustedIssuerTopicsEmpty
        );
        require!(
            !issuer.label.is_empty() && issuer.label.len() <= 64,
            FracksFactoryError::InvalidTrustedIssuerLabel
        );
    }
    Ok(())
}

fn initialize_token_2022_mint<'info>(
    payer: AccountInfo<'info>,
    token_mint_account: AccountInfo<'info>,
    token_state: Pubkey,
    hook_program: Pubkey,
    token_2022_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    decimals: u8,
) -> Result<()> {
    require!(
        token_mint_account.data_is_empty(),
        FracksFactoryError::TokenMintAlreadyInitialized
    );
    let mint_space =
        spl_token_2022::extension::ExtensionType::try_calculate_account_len::<
            spl_token_2022::state::Mint,
        >(&TOKEN_2022_MINT_EXTENSIONS)
        .map_err(|_| error!(FracksFactoryError::InvalidTokenMint))?;
    let rent_lamports = Rent::get()?.minimum_balance(mint_space);
    invoke(
        &system_instruction::create_account(
            &payer.key(),
            &token_mint_account.key(),
            rent_lamports,
            mint_space as u64,
            &token_2022_program.key(),
        ),
        &[
            payer.clone(),
            token_mint_account.clone(),
            system_program,
        ],
    )?;
    transfer_hook_initialize(
        CpiContext::new(
            token_2022_program.clone(),
            TransferHookInitialize {
                token_program_id: token_2022_program.clone(),
                mint: token_mint_account.clone(),
            },
        ),
        Some(payer.key()),
        Some(hook_program),
    )?;
    permanent_delegate_initialize(
        CpiContext::new(
            token_2022_program.clone(),
            PermanentDelegateInitialize {
                token_program_id: token_2022_program.clone(),
                mint: token_mint_account.clone(),
            },
        ),
        &token_state,
    )?;
    anchor_spl::token_2022::initialize_mint2(
        CpiContext::new(
            token_2022_program,
            anchor_spl::token_2022::InitializeMint2 {
                mint: token_mint_account,
            },
        ),
        decimals,
        &token_state,
        None,
    )
}

fn verify_program_ids(
    state: &FactoryState,
    accounts: &DeployTokenSuite<'_>,
) -> Result<()> {
    require_keys_eq!(
        state.token_program_id,
        accounts.token_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    require_keys_eq!(
        state.irp_program_id,
        accounts.irp_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    require_keys_eq!(
        state.irs_program_id,
        accounts.irs_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    require_keys_eq!(
        state.tir_program_id,
        accounts.tir_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    require_keys_eq!(
        state.ctr_program_id,
        accounts.ctr_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    require_keys_eq!(
        state.compliance_program_id,
        accounts.compliance_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    Ok(())
}

#[error_code(offset = 0)]
pub enum FracksFactoryError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Deployment already exists for this issuer and salt.")]
    DeploymentAlreadyExists = 6060,
    #[msg("One or more derived accounts do not match the expected PDA.")]
    InvalidDerivedAccount = 6061,
    #[msg("The provided program IDs do not match the factory configuration.")]
    ProgramIdMismatch = 6062,
    #[msg("Missing issuer entry accounts for trusted issuer initialization.")]
    MissingTrustedIssuerAccounts = 6063,
    #[msg("Token metadata is invalid.")]
    InvalidTokenMetadata = 6064,
    #[msg("Too many claim topics were provided.")]
    TooManyClaimTopics = 6065,
    #[msg("Too many trusted issuers were provided.")]
    TooManyTrustedIssuers = 6066,
    #[msg("Too many compliance modules were provided.")]
    TooManyComplianceModules = 6067,
    #[msg("Trusted issuers must declare at least one topic.")]
    TrustedIssuerTopicsEmpty = 6068,
    #[msg("Trusted issuer labels must be between 1 and 64 characters.")]
    InvalidTrustedIssuerLabel = 6069,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6070,
    #[msg("Missing compliance module accounts for hook extra-account-metas initialization.")]
    MissingComplianceModuleAccounts = 6071,
    #[msg("Token-2022 mint account is already initialized.")]
    TokenMintAlreadyInitialized = 6072,
    #[msg("Token-2022 mint account is invalid.")]
    InvalidTokenMint = 6073,
    #[msg("Pending owner mismatch.")]
    NotPendingOwner = 6074,
    #[msg("Pending owner cannot be the default pubkey.")]
    InvalidPendingOwner = 6075,
}

```

## programs/fracks-fid/src/lib.rs

```
use anchor_lang::prelude::*;

pub mod utils;

use utils::{construct_claim_message, verify_ed25519_instruction};

declare_id!("7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH");

const COUNTRY_MAX: u16 = 999;
const FID_SPACE: usize = 8 + 32 + 32 + 32 + 4 + 1 + 2 + 1;
const CLAIM_SPACE: usize = 8 + 32 + 4 + 8 + 32 + 32 + 32 + 64 + 8 + 8 + 1 + 1;

#[program]
pub mod fracks_fid {
    use super::*;

    pub fn create_fid(ctx: Context<CreateFid>, is_issuer: bool, country: u16) -> Result<()> {
        let fid_pubkey = ctx.accounts.fid.key();
        let fid = &mut ctx.accounts.fid;

        require!(fid.owner == Pubkey::default(), FracksFidError::FidAlreadyExists);
        validate_country(is_issuer, country)?;

        fid.owner = ctx.accounts.owner.key();
        fid.management_key = ctx.accounts.owner.key();
        fid.signer_key = ctx.accounts.owner.key();
        fid.claim_count = 0;
        fid.is_issuer = is_issuer;
        fid.country = if is_issuer { 0 } else { country };
        fid.bump = ctx.bumps.fid;

        emit!(FidCreated {
            owner: fid.owner,
            fid_pubkey,
            is_issuer,
            country: fid.country,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn set_management_key(ctx: Context<SetManagementKey>, new_key: Pubkey) -> Result<()> {
        ctx.accounts.fid.management_key = new_key;
        Ok(())
    }

    pub fn set_signer_key(ctx: Context<SetSignerKey>, new_key: Pubkey) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let fid = &mut ctx.accounts.fid;

        require!(
            authority == fid.owner || authority == fid.management_key,
            FracksFidError::Unauthorized
        );

        fid.signer_key = new_key;
        Ok(())
    }

    pub fn add_claim(
        ctx: Context<AddClaim>,
        topic: u64,
        data_hash: [u8; 32],
        signature: [u8; 64],
        expires_at: i64,
    ) -> Result<()> {
        require!(ctx.accounts.issuer_fid.is_issuer, FracksFidError::InvalidIssuerFid);
        require_keys_eq!(
            ctx.accounts.issuer_owner.key(),
            ctx.accounts.issuer_fid.owner,
            FracksFidError::Unauthorized
        );

        let message = construct_claim_message(
            &ctx.accounts.issuer_fid.key(),
            &ctx.accounts.target_fid.key(),
            topic,
            &data_hash,
            expires_at,
        );
        verify_ed25519_instruction(
            &ctx.accounts.instructions_sysvar,
            &ctx.accounts.issuer_fid.signer_key,
            &message,
            &signature,
        )?;

        let target_fid = &mut ctx.accounts.target_fid;
        let claim = &mut ctx.accounts.claim;
        let claim_id = target_fid.claim_count;

        claim.fid = target_fid.key();
        claim.claim_id = claim_id;
        claim.topic = topic;
        claim.issuer_fid = ctx.accounts.issuer_fid.key();
        claim.data_hash = data_hash;
        claim.signer_key = ctx.accounts.issuer_fid.signer_key;
        claim.signature = signature;
        claim.issued_at = Clock::get()?.unix_timestamp;
        claim.expires_at = expires_at;
        claim.revoked = false;
        claim.bump = ctx.bumps.claim;

        target_fid.claim_count = target_fid
            .claim_count
            .checked_add(1)
            .ok_or_else(|| error!(FracksFidError::ArithmeticOverflow))?;

        emit!(ClaimAdded {
            fid: claim.fid,
            claim_id,
            topic,
            issuer_fid: claim.issuer_fid,
            expires_at,
            timestamp: claim.issued_at,
        });

        Ok(())
    }

    pub fn revoke_claim(ctx: Context<RevokeClaim>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.issuer_owner.key(),
            ctx.accounts.issuer_fid.owner,
            FracksFidError::Unauthorized
        );
        require_keys_eq!(
            ctx.accounts.claim.issuer_fid,
            ctx.accounts.issuer_fid.key(),
            FracksFidError::InvalidIssuerFid
        );

        let claim = &mut ctx.accounts.claim;
        claim.revoked = true;

        emit!(ClaimRevoked {
            fid: claim.fid,
            claim_id: claim.claim_id,
            topic: claim.topic,
            by_issuer: ctx.accounts.issuer_fid.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn remove_claim(ctx: Context<RemoveClaim>) -> Result<()> {
        let fid = &ctx.accounts.fid;
        let authority = ctx.accounts.authority.key();

        require!(
            authority == fid.owner || authority == fid.management_key,
            FracksFidError::Unauthorized
        );

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(is_issuer: bool, country: u16)]
pub struct CreateFid<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init_if_needed,
        payer = owner,
        space = FID_SPACE,
        seeds = [b"fid", owner.key().as_ref()],
        bump
    )]
    pub fid: Account<'info, FidAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetManagementKey<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"fid", owner.key().as_ref()],
        bump = fid.bump,
        has_one = owner @ FracksFidError::Unauthorized
    )]
    pub fid: Account<'info, FidAccount>,
}

#[derive(Accounts)]
pub struct SetSignerKey<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"fid", fid.owner.as_ref()],
        bump = fid.bump
    )]
    pub fid: Account<'info, FidAccount>,
}

#[derive(Accounts)]
pub struct AddClaim<'info> {
    #[account(mut)]
    pub issuer_owner: Signer<'info>,
    #[account(
        seeds = [b"fid", issuer_fid.owner.as_ref()],
        bump = issuer_fid.bump
    )]
    pub issuer_fid: Account<'info, FidAccount>,
    #[account(mut)]
    pub target_fid: Account<'info, FidAccount>,
    #[account(
        init,
        payer = issuer_owner,
        space = CLAIM_SPACE,
        seeds = [b"claim", target_fid.key().as_ref(), &target_fid.claim_count.to_le_bytes()],
        bump
    )]
    pub claim: Account<'info, ClaimAccount>,
    /// CHECK: The sysvar account is validated inside the helper.
    pub instructions_sysvar: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeClaim<'info> {
    #[account(mut)]
    pub issuer_owner: Signer<'info>,
    #[account(
        seeds = [b"fid", issuer_fid.owner.as_ref()],
        bump = issuer_fid.bump
    )]
    pub issuer_fid: Account<'info, FidAccount>,
    #[account(
        mut,
        seeds = [b"claim", claim.fid.as_ref(), &claim.claim_id.to_le_bytes()],
        bump = claim.bump
    )]
    pub claim: Account<'info, ClaimAccount>,
}

#[derive(Accounts)]
pub struct RemoveClaim<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub fid: Account<'info, FidAccount>,
    #[account(
        mut,
        close = authority,
        seeds = [b"claim", claim.fid.as_ref(), &claim.claim_id.to_le_bytes()],
        bump = claim.bump,
        constraint = claim.fid == fid.key() @ FracksFidError::ClaimFidMismatch
    )]
    pub claim: Account<'info, ClaimAccount>,
}

#[account]
pub struct FidAccount {
    pub owner: Pubkey,
    pub management_key: Pubkey,
    pub signer_key: Pubkey,
    pub claim_count: u32,
    pub is_issuer: bool,
    pub country: u16,
    pub bump: u8,
}

#[account]
pub struct ClaimAccount {
    pub fid: Pubkey,
    pub claim_id: u32,
    pub topic: u64,
    pub issuer_fid: Pubkey,
    pub data_hash: [u8; 32],
    pub signer_key: Pubkey,
    pub signature: [u8; 64],
    pub issued_at: i64,
    pub expires_at: i64,
    pub revoked: bool,
    pub bump: u8,
}

#[event]
pub struct FidCreated {
    pub owner: Pubkey,
    pub fid_pubkey: Pubkey,
    pub is_issuer: bool,
    pub country: u16,
    pub timestamp: i64,
}

#[event]
pub struct ClaimAdded {
    pub fid: Pubkey,
    pub claim_id: u32,
    pub topic: u64,
    pub issuer_fid: Pubkey,
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct ClaimRevoked {
    pub fid: Pubkey,
    pub claim_id: u32,
    pub topic: u64,
    pub by_issuer: Pubkey,
    pub timestamp: i64,
}

#[error_code(offset = 0)]
pub enum FracksFidError {
    #[msg("Signer is not authorized for this action.")]
    Unauthorized = 6025,
    #[msg("Claim issuer FID is invalid for this operation.")]
    InvalidIssuerFid = 6026,
    #[msg("An ed25519 verification instruction is required before add_claim.")]
    MissingEd25519Instruction = 6027,
    #[msg("The provided instructions sysvar account is invalid.")]
    InvalidInstructionsSysvar = 6028,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6029,
    #[msg("Claim account does not belong to the provided FID.")]
    ClaimFidMismatch = 6030,
    #[msg("Claim signature is invalid.")]
    InvalidClaimSignature = 6008,
    #[msg("FID already exists for this wallet.")]
    FidAlreadyExists = 6012,
    #[msg("Country code is invalid.")]
    InvalidCountryCode = 6017,
}

fn validate_country(is_issuer: bool, country: u16) -> Result<()> {
    if is_issuer {
        require!(country <= COUNTRY_MAX, FracksFidError::InvalidCountryCode);
    } else {
        require!(
            country > 0 && country <= COUNTRY_MAX,
            FracksFidError::InvalidCountryCode
        );
    }

    Ok(())
}

```

## programs/fracks-fid/src/utils.rs

```
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use solana_program::{
    ed25519_program,
    hash::hash,
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};

use crate::FracksFidError;

const ED25519_SERIALIZED_OFFSETS_START: usize = 2;
const ED25519_OFFSETS_SIZE: usize = 14;
const ED25519_HEADER_SIZE: usize = ED25519_SERIALIZED_OFFSETS_START + ED25519_OFFSETS_SIZE;
const ED25519_SIGNATURE_SIZE: usize = 64;
const ED25519_PUBKEY_SIZE: usize = 32;

pub fn construct_claim_message(
    issuer_fid: &Pubkey,
    holder_fid: &Pubkey,
    topic: u64,
    data_hash: &[u8; 32],
    expires_at: i64,
) -> [u8; 32] {
    let mut payload = Vec::with_capacity(112);
    payload.extend_from_slice(issuer_fid.as_ref());
    payload.extend_from_slice(holder_fid.as_ref());
    payload.extend_from_slice(&topic.to_le_bytes());
    payload.extend_from_slice(data_hash);
    payload.extend_from_slice(&expires_at.to_le_bytes());
    hash(&payload).to_bytes()
}

pub fn verify_ed25519_instruction(
    instructions_sysvar: &AccountInfo,
    expected_pubkey: &Pubkey,
    expected_message: &[u8; 32],
    expected_signature: &[u8; 64],
) -> Result<()> {
    require_keys_eq!(
        instructions_sysvar.key(),
        solana_program::sysvar::instructions::id(),
        FracksFidError::InvalidInstructionsSysvar
    );

    let current_index = load_current_index_checked(instructions_sysvar)? as usize;
    require!(current_index > 0, FracksFidError::MissingEd25519Instruction);

    for ix_index in (0..current_index).rev() {
        let instruction = load_instruction_at_checked(ix_index, instructions_sysvar)?;
        if instruction.program_id != ed25519_program::id() {
            continue;
        }

        return verify_ed25519_data(
            &instruction,
            expected_pubkey,
            expected_message,
            expected_signature,
        );
    }

    err!(FracksFidError::MissingEd25519Instruction)
}

fn verify_ed25519_data(
    instruction: &Instruction,
    expected_pubkey: &Pubkey,
    expected_message: &[u8; 32],
    expected_signature: &[u8; 64],
) -> Result<()> {
    let data = instruction.data.as_slice();

    require!(data.len() >= ED25519_HEADER_SIZE, FracksFidError::InvalidClaimSignature);
    require!(data[0] == 1, FracksFidError::InvalidClaimSignature);

    let signature_offset = read_u16(data, 2)? as usize;
    let signature_instruction_index = read_u16(data, 4)?;
    let public_key_offset = read_u16(data, 6)? as usize;
    let public_key_instruction_index = read_u16(data, 8)?;
    let message_data_offset = read_u16(data, 10)? as usize;
    let message_data_size = read_u16(data, 12)? as usize;
    let message_instruction_index = read_u16(data, 14)?;

    require!(
        signature_instruction_index == u16::MAX
            && public_key_instruction_index == u16::MAX
            && message_instruction_index == u16::MAX,
        FracksFidError::InvalidClaimSignature
    );
    require!(
        message_data_size == expected_message.len(),
        FracksFidError::InvalidClaimSignature
    );

    let public_key = slice(data, public_key_offset, ED25519_PUBKEY_SIZE)?;
    let signature = slice(data, signature_offset, ED25519_SIGNATURE_SIZE)?;
    let message = slice(data, message_data_offset, message_data_size)?;

    require!(public_key == expected_pubkey.as_ref(), FracksFidError::InvalidClaimSignature);
    require!(
        signature == expected_signature.as_slice(),
        FracksFidError::InvalidClaimSignature
    );
    require!(
        message == expected_message.as_slice(),
        FracksFidError::InvalidClaimSignature
    );

    Ok(())
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = slice(data, offset, 2)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn slice(data: &[u8], offset: usize, len: usize) -> Result<&[u8]> {
    data.get(offset..offset.saturating_add(len))
        .ok_or_else(|| error!(FracksFidError::InvalidClaimSignature))
}

```

## programs/fracks-irp/src/lib.rs

```
use anchor_lang::prelude::*;

pub mod utils;

use utils::{
    deserialize_view, ensure_bound_registry, find_wallet_identity, verify_claim_for_topic,
};

declare_id!("6dDKwtRbGkHJhU9LztpDkBC3fUdM46WeKJdrASFikce6");

const MAX_IDENTITY_AGENTS: usize = 10;
const IRP_SPACE: usize = 8 + 32 + 32 + 32 + 32 + 32 + 4 + (32 * MAX_IDENTITY_AGENTS) + 8 + 1;

#[program]
pub mod fracks_irp {
    use super::*;

    pub fn initialize_registry(
        ctx: Context<InitializeRegistry>,
        token_mint: Pubkey,
        irs: Pubkey,
        tir: Pubkey,
        ctr: Pubkey,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry_state;
        registry.token_mint = token_mint;
        registry.owner = ctx.accounts.owner.key();
        registry.irs_account = irs;
        registry.tir_account = tir;
        registry.ctr_account = ctr;
        registry.identity_agents = Vec::new();
        registry.registered_count = 0;
        registry.bump = ctx.bumps.registry_state;
        Ok(())
    }

    pub fn add_identity_agent(ctx: Context<UpdateRegistryOwner>, agent: Pubkey) -> Result<()> {
        let registry = &mut ctx.accounts.registry_state;
        require!(
            !registry.identity_agents.contains(&agent),
            FracksIrpError::IdentityAgentAlreadyExists
        );
        require!(
            registry.identity_agents.len() < MAX_IDENTITY_AGENTS,
            FracksIrpError::MaxIdentityAgentsReached
        );
        registry.identity_agents.push(agent);
        Ok(())
    }

    pub fn remove_identity_agent(ctx: Context<UpdateRegistryOwner>, agent: Pubkey) -> Result<()> {
        let registry = &mut ctx.accounts.registry_state;
        let index = registry
            .identity_agents
            .iter()
            .position(|entry| *entry == agent)
            .ok_or_else(|| error!(FracksIrpError::NotIdentityAgent))?;
        registry.identity_agents.remove(index);
        Ok(())
    }

    pub fn update_irs_reference(
        ctx: Context<UpdateRegistryOwner>,
        new_irs: Pubkey,
    ) -> Result<()> {
        ctx.accounts.registry_state.irs_account = new_irs;
        Ok(())
    }

    pub fn update_tir_reference(
        ctx: Context<UpdateRegistryOwner>,
        new_tir: Pubkey,
    ) -> Result<()> {
        ctx.accounts.registry_state.tir_account = new_tir;
        Ok(())
    }

    pub fn update_ctr_reference(
        ctx: Context<UpdateRegistryOwner>,
        new_ctr: Pubkey,
    ) -> Result<()> {
        ctx.accounts.registry_state.ctr_account = new_ctr;
        Ok(())
    }

    pub fn transfer_registry_ownership(
        ctx: Context<UpdateRegistryOwner>,
        new_owner: Pubkey,
    ) -> Result<()> {
        ctx.accounts.registry_state.owner = new_owner;
        Ok(())
    }

    pub fn is_verified(ctx: Context<IsVerified>, wallet: Pubkey) -> Result<bool> {
        let registry = &ctx.accounts.registry_state;
        let irs_state = deserialize_view::<IdentityRegistryStorageStateView>(&ctx.accounts.irs_state)?;
        let tir_state = deserialize_view::<TrustedIssuersStateView>(&ctx.accounts.tir_state)?;
        let ctr_state = deserialize_view::<ClaimTopicsStateView>(&ctx.accounts.ctr_state)?;

        require_keys_eq!(
            ctx.accounts.irs_state.key(),
            registry.irs_account,
            FracksIrpError::InvalidRegistryReference
        );
        require_keys_eq!(
            ctx.accounts.tir_state.key(),
            registry.tir_account,
            FracksIrpError::InvalidRegistryReference
        );
        require_keys_eq!(
            ctx.accounts.ctr_state.key(),
            registry.ctr_account,
            FracksIrpError::InvalidRegistryReference
        );
        require_keys_eq!(
            irs_state.owner,
            registry.owner,
            FracksIrpError::InvalidRegistryReference
        );
        require_keys_eq!(
            tir_state.token_mint,
            registry.token_mint,
            FracksIrpError::InvalidRegistryReference
        );
        require_keys_eq!(
            ctr_state.token_mint,
            registry.token_mint,
            FracksIrpError::InvalidRegistryReference
        );
        ensure_bound_registry(&irs_state, &registry.key())?;

        let wallet_identity = match find_wallet_identity(
            &wallet,
            &ctx.accounts.irs_state.key(),
            &ctx.accounts.wallet_identity,
        )? {
            Some(identity) if identity.wallet == wallet && identity.irs == ctx.accounts.irs_state.key() => {
                identity
            }
            _ => return Ok(false),
        };

        if ctr_state.topics.is_empty() {
            return Ok(true);
        }

        let now = Clock::get()?.unix_timestamp;
        for topic in ctr_state.topics {
            let found_valid = verify_claim_for_topic(
                wallet_identity.fid,
                topic,
                &ctx.accounts.tir_state.key(),
                ctx.remaining_accounts,
                now,
            )?;
            if !found_valid {
                return Ok(false);
            }
        }

        Ok(true)
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, irs: Pubkey, tir: Pubkey, ctr: Pubkey)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = IRP_SPACE,
        seeds = [b"irp_state", token_mint.as_ref()],
        bump
    )]
    pub registry_state: Account<'info, IdentityRegistryState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRegistryOwner<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"irp_state", registry_state.token_mint.as_ref()],
        bump = registry_state.bump,
        has_one = owner @ FracksIrpError::NotOwner
    )]
    pub registry_state: Account<'info, IdentityRegistryState>,
}

#[derive(Accounts)]
pub struct IsVerified<'info> {
    #[account(
        seeds = [b"irp_state", registry_state.token_mint.as_ref()],
        bump = registry_state.bump
    )]
    pub registry_state: Account<'info, IdentityRegistryState>,
    /// CHECK: Verified in instruction.
    pub irs_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction.
    pub tir_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction.
    pub ctr_state: UncheckedAccount<'info>,
    /// CHECK: Optional and verified in instruction.
    pub wallet_identity: UncheckedAccount<'info>,
}

#[account]
pub struct IdentityRegistryState {
    pub token_mint: Pubkey,
    pub owner: Pubkey,
    pub irs_account: Pubkey,
    pub tir_account: Pubkey,
    pub ctr_account: Pubkey,
    pub identity_agents: Vec<Pubkey>,
    pub registered_count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct IdentityRegistryStorageStateView {
    pub owner: Pubkey,
    pub bound_registries: Vec<Pubkey>,
    pub registered_count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct WalletIdentityView {
    pub wallet: Pubkey,
    pub fid: Pubkey,
    pub country: u16,
    pub irs: Pubkey,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct TrustedIssuersStateView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub issuer_count: u32,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct ClaimTopicsStateView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub topics: Vec<u64>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FidAccountView {
    pub owner: Pubkey,
    pub management_key: Pubkey,
    pub signer_key: Pubkey,
    pub claim_count: u32,
    pub is_issuer: bool,
    pub country: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClaimAccountView {
    pub fid: Pubkey,
    pub claim_id: u32,
    pub topic: u64,
    pub issuer_fid: Pubkey,
    pub data_hash: [u8; 32],
    pub signer_key: Pubkey,
    pub signature: [u8; 64],
    pub issued_at: i64,
    pub expires_at: i64,
    pub revoked: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct IssuerEntryView {
    pub issuer_fid: Pubkey,
    pub tir: Pubkey,
    pub allowed_topics: Vec<u64>,
    pub is_active: bool,
    pub label: String,
    pub bump: u8,
}

#[error_code(offset = 0)]
pub enum FracksIrpError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Caller does not have Identity Agent permission.")]
    NotIdentityAgent = 6008,
    #[msg("Registry reference is invalid.")]
    InvalidRegistryReference = 6013,
    #[msg("Identity agent already exists.")]
    IdentityAgentAlreadyExists = 6042,
    #[msg("Maximum identity agents reached.")]
    MaxIdentityAgentsReached = 6043,
    #[msg("Trusted issuer entry not found.")]
    TrustedIssuerNotFound = 6044,
    #[msg("Issuer FID account not found.")]
    IssuerFidNotFound = 6045,
    #[msg("Claim signature is invalid.")]
    InvalidClaimSignature = 6046,
}

```

## programs/fracks-irp/src/utils.rs

```
use anchor_lang::prelude::*;

use crate::{
    ClaimAccountView, FidAccountView, FracksIrpError, IdentityRegistryStorageStateView,
    IssuerEntryView, WalletIdentityView,
};

pub fn deserialize_view<T: AnchorDeserialize>(account: &AccountInfo) -> Result<T> {
    let data = account.try_borrow_data()?;
    require!(data.len() >= 8, FracksIrpError::InvalidRegistryReference);
    let mut slice: &[u8] = &data[8..];
    T::deserialize(&mut slice).map_err(|_| error!(FracksIrpError::InvalidRegistryReference))
}

pub fn find_wallet_identity<'info>(
    wallet: &Pubkey,
    irs: &Pubkey,
    wallet_identity_info: &AccountInfo<'info>,
) -> Result<Option<WalletIdentityView>> {
    if wallet_identity_info.owner == &System::id() {
        return Ok(None);
    }

    let expected_wallet_identity = Pubkey::find_program_address(
        &[b"wallet_identity", irs.as_ref(), wallet.as_ref()],
        &fracks_irs::id(),
    )
    .0;
    if wallet_identity_info.key() != expected_wallet_identity {
        return Ok(None);
    }

    let identity = deserialize_view::<WalletIdentityView>(wallet_identity_info)?;
    if identity.wallet != *wallet || identity.irs != *irs {
        return Ok(None);
    }
    Ok(Some(identity))
}

pub fn verify_claim_for_topic(
    holder_fid: Pubkey,
    topic: u64,
    tir_state: &Pubkey,
    remaining_accounts: &[AccountInfo],
    now: i64,
) -> Result<bool> {
    for account in remaining_accounts {
        let claim = match deserialize_view::<ClaimAccountView>(account) {
            Ok(claim) => claim,
            Err(_) => continue,
        };

        let expected_claim = Pubkey::find_program_address(
            &[b"claim", claim.fid.as_ref(), &claim.claim_id.to_le_bytes()],
            &fracks_fid::id(),
        )
        .0;
        if account.key() != expected_claim {
            continue;
        }

        if claim.fid != holder_fid
            || claim.topic != topic
            || claim.revoked
            || (claim.expires_at != 0 && claim.expires_at < now)
        {
            continue;
        }

        let issuer_entry = find_issuer_entry(remaining_accounts, tir_state, &claim.issuer_fid)?;
        if !issuer_entry.is_active || !issuer_entry.allowed_topics.contains(&topic) {
            continue;
        }
        let issuer_fid = find_issuer_fid(remaining_accounts, &claim.issuer_fid)?;
        if !issuer_fid.is_issuer {
            continue;
        }
        if claim.signer_key == issuer_fid.signer_key {
            return Ok(true);
        }
    }

    Ok(false)
}

fn find_issuer_entry(
    accounts: &[AccountInfo],
    tir_state: &Pubkey,
    issuer_fid: &Pubkey,
) -> Result<IssuerEntryView> {
    for account in accounts {
        if let Ok(entry) = deserialize_view::<IssuerEntryView>(account) {
            let expected_entry = Pubkey::find_program_address(
                &[b"issuer_entry", tir_state.as_ref(), issuer_fid.as_ref()],
                &fracks_tir::id(),
            )
            .0;
            if account.key() == expected_entry && entry.tir == *tir_state && entry.issuer_fid == *issuer_fid {
                return Ok(entry);
            }
        }
    }

    err!(FracksIrpError::TrustedIssuerNotFound)
}

fn find_issuer_fid(accounts: &[AccountInfo], issuer_fid: &Pubkey) -> Result<FidAccountView> {
    for account in accounts {
        if account.key() != *issuer_fid {
            continue;
        }
        if let Ok(fid) = deserialize_view::<FidAccountView>(account) {
            let expected_fid = Pubkey::find_program_address(
                &[b"fid", fid.owner.as_ref()],
                &fracks_fid::id(),
            )
            .0;
            if account.key() == expected_fid {
                return Ok(fid);
            }
        }
    }

    err!(FracksIrpError::IssuerFidNotFound)
}
pub fn ensure_bound_registry(irs_state: &IdentityRegistryStorageStateView, irp: &Pubkey) -> Result<()> {
    require!(
        irs_state.bound_registries.contains(irp),
        FracksIrpError::InvalidRegistryReference
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::AnchorSerialize;
    use anchor_lang::solana_program::clock::Epoch;

    fn account_info_with_data(key: Pubkey, owner: Pubkey, payload: Vec<u8>) -> AccountInfo<'static> {
        let key = Box::leak(Box::new(key));
        let owner = Box::leak(Box::new(owner));
        let lamports = Box::leak(Box::new(0u64));
        let data = Box::leak(payload.into_boxed_slice());
        AccountInfo::new(key, false, false, lamports, data, owner, false, Epoch::default())
    }

    fn serialize_account<T: AnchorSerialize>(value: &T) -> Vec<u8> {
        let mut data = vec![0u8; 8];
        value.serialize(&mut data).expect("serialize");
        data
    }

    #[test]
    fn rejects_wallet_identity_on_wrong_pda() {
        let wallet = Pubkey::new_unique();
        let irs = Pubkey::new_unique();
        let wrong_key = Pubkey::new_unique();
        let identity = WalletIdentityView {
            wallet,
            fid: Pubkey::new_unique(),
            country: 840,
            irs,
            bump: 0,
        };
        let account = account_info_with_data(wrong_key, fracks_irs::id(), serialize_account(&identity));

        let resolved = find_wallet_identity(&wallet, &irs, &account).expect("find_wallet_identity");
        assert!(resolved.is_none());
    }

    #[test]
    fn rejects_claim_remaining_account_on_wrong_pda() {
        let holder_fid = Pubkey::new_unique();
        let fake_claim_key = Pubkey::new_unique();
        let claim = ClaimAccountView {
            fid: holder_fid,
            claim_id: 0,
            topic: 1,
            issuer_fid: Pubkey::new_unique(),
            data_hash: [7u8; 32],
            signer_key: Pubkey::new_unique(),
            signature: [9u8; 64],
            issued_at: 1,
            expires_at: 0,
            revoked: false,
            bump: 0,
        };
        let fake_claim = account_info_with_data(fake_claim_key, fracks_fid::id(), serialize_account(&claim));

        let verified = verify_claim_for_topic(holder_fid, 1, &Pubkey::new_unique(), &[fake_claim], 10)
            .expect("verify_claim_for_topic");
        assert!(!verified);
    }
}

```

## programs/fracks-irs/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("CsrdR7QK3ma6hxU46Cp4DZHAdbGPWPiwmGjhKsR9VzdS");

const COUNTRY_MIN: u16 = 1;
const COUNTRY_MAX: u16 = 999;
const MAX_BOUND_REGISTRIES: usize = 32;
const IRS_SPACE: usize = 8 + 32 + 4 + (32 * MAX_BOUND_REGISTRIES) + 8 + 1;
const WALLET_IDENTITY_SPACE: usize = 8 + 32 + 32 + 2 + 32 + 1;

#[program]
pub mod fracks_irs {
    use super::*;

    pub fn initialize_irs(ctx: Context<InitializeIrs>) -> Result<()> {
        let irs_state = &mut ctx.accounts.irs_state;
        irs_state.owner = ctx.accounts.owner.key();
        irs_state.bound_registries = Vec::new();
        irs_state.registered_count = 0;
        irs_state.bump = ctx.bumps.irs_state;
        Ok(())
    }

    pub fn bind_registry(ctx: Context<UpdateIrsOwnerState>, irp_pubkey: Pubkey) -> Result<()> {
        let irs_state = &mut ctx.accounts.irs_state;
        require!(
            !irs_state.bound_registries.contains(&irp_pubkey),
            FracksIrsError::RegistryAlreadyBound
        );
        require!(
            irs_state.bound_registries.len() < MAX_BOUND_REGISTRIES,
            FracksIrsError::MaxBoundRegistriesReached
        );

        irs_state.bound_registries.push(irp_pubkey);

        emit!(RegistryBound {
            irs: irs_state.key(),
            registry: irp_pubkey,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn unbind_registry(ctx: Context<UpdateIrsOwnerState>, irp_pubkey: Pubkey) -> Result<()> {
        let irs_state = &mut ctx.accounts.irs_state;
        let index = irs_state
            .bound_registries
            .iter()
            .position(|registry| *registry == irp_pubkey)
            .ok_or_else(|| error!(FracksIrsError::RegistryNotBound))?;

        irs_state.bound_registries.remove(index);

        emit!(RegistryUnbound {
            irs: irs_state.key(),
            registry: irp_pubkey,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn register_identity(
        ctx: Context<RegisterIdentity>,
        wallet: Pubkey,
        fid: Pubkey,
        country: u16,
    ) -> Result<()> {
        validate_country(country)?;
        authorize_identity_actor(
            &ctx.accounts.authority,
            &ctx.accounts.irs_state,
            &ctx.accounts.registry_state,
        )?;

        let wallet_identity = &mut ctx.accounts.wallet_identity;
        require!(
            wallet_identity.wallet == Pubkey::default(),
            FracksIrsError::WalletAlreadyRegistered
        );

        wallet_identity.wallet = wallet;
        wallet_identity.fid = fid;
        wallet_identity.country = country;
        wallet_identity.irs = ctx.accounts.irs_state.key();
        wallet_identity.bump = ctx.bumps.wallet_identity;

        ctx.accounts.irs_state.registered_count = ctx
            .accounts
            .irs_state
            .registered_count
            .checked_add(1)
            .ok_or_else(|| error!(FracksIrsError::ArithmeticOverflow))?;

        emit!(IdentityRegistered {
            wallet,
            fid,
            country,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn update_identity(ctx: Context<MutateWalletIdentity>, new_fid: Pubkey) -> Result<()> {
        authorize_identity_actor(
            &ctx.accounts.authority,
            &ctx.accounts.irs_state,
            &ctx.accounts.registry_state,
        )?;
        ctx.accounts.wallet_identity.fid = new_fid;

        emit!(IdentityUpdated {
            wallet: ctx.accounts.wallet_identity.wallet,
            fid: new_fid,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn update_country(ctx: Context<MutateWalletIdentity>, new_country: u16) -> Result<()> {
        validate_country(new_country)?;
        authorize_identity_actor(
            &ctx.accounts.authority,
            &ctx.accounts.irs_state,
            &ctx.accounts.registry_state,
        )?;
        ctx.accounts.wallet_identity.country = new_country;

        emit!(CountryUpdated {
            wallet: ctx.accounts.wallet_identity.wallet,
            country: new_country,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn remove_identity(ctx: Context<RemoveIdentity>) -> Result<()> {
        authorize_identity_actor(
            &ctx.accounts.authority,
            &ctx.accounts.irs_state,
            &ctx.accounts.registry_state,
        )?;
        let wallet = ctx.accounts.wallet_identity.wallet;
        ctx.accounts.irs_state.registered_count = ctx
            .accounts
            .irs_state
            .registered_count
            .checked_sub(1)
            .ok_or_else(|| error!(FracksIrsError::ArithmeticOverflow))?;

        emit!(IdentityRemoved {
            wallet,
            by_agent: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeIrs<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = IRS_SPACE,
        seeds = [b"irs_state", owner.key().as_ref()],
        bump
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateIrsOwnerState<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"irs_state", owner.key().as_ref()],
        bump = irs_state.bump,
        has_one = owner @ FracksIrsError::NotOwner
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey, fid: Pubkey, country: u16)]
pub struct RegisterIdentity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"irs_state", irs_state.owner.as_ref()],
        bump = irs_state.bump
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
    /// CHECK: Optional when the IRS owner performs bootstrap actions; otherwise validated.
    pub registry_state: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = WALLET_IDENTITY_SPACE,
        seeds = [b"wallet_identity", irs_state.key().as_ref(), wallet.as_ref()],
        bump
    )]
    pub wallet_identity: Account<'info, WalletIdentity>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateWalletIdentity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"irs_state", irs_state.owner.as_ref()],
        bump = irs_state.bump
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
    /// CHECK: Optional when the IRS owner performs bootstrap actions; otherwise validated.
    pub registry_state: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"wallet_identity", irs_state.key().as_ref(), wallet_identity.wallet.as_ref()],
        bump = wallet_identity.bump,
        constraint = wallet_identity.irs == irs_state.key() @ FracksIrsError::WalletNotRegistered
    )]
    pub wallet_identity: Account<'info, WalletIdentity>,
}

#[derive(Accounts)]
pub struct RemoveIdentity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"irs_state", irs_state.owner.as_ref()],
        bump = irs_state.bump
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
    /// CHECK: Optional when the IRS owner performs bootstrap actions; otherwise validated.
    pub registry_state: UncheckedAccount<'info>,
    #[account(
        mut,
        close = authority,
        seeds = [b"wallet_identity", irs_state.key().as_ref(), wallet_identity.wallet.as_ref()],
        bump = wallet_identity.bump,
        constraint = wallet_identity.irs == irs_state.key() @ FracksIrsError::WalletNotRegistered
    )]
    pub wallet_identity: Account<'info, WalletIdentity>,
}

#[account]
pub struct IdentityRegistryStorageState {
    pub owner: Pubkey,
    pub bound_registries: Vec<Pubkey>,
    pub registered_count: u64,
    pub bump: u8,
}

#[account]
pub struct WalletIdentity {
    pub wallet: Pubkey,
    pub fid: Pubkey,
    pub country: u16,
    pub irs: Pubkey,
    pub bump: u8,
}

#[event]
pub struct RegistryBound {
    pub irs: Pubkey,
    pub registry: Pubkey,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RegistryUnbound {
    pub irs: Pubkey,
    pub registry: Pubkey,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct IdentityRegistered {
    pub wallet: Pubkey,
    pub fid: Pubkey,
    pub country: u16,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct IdentityUpdated {
    pub wallet: Pubkey,
    pub fid: Pubkey,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct CountryUpdated {
    pub wallet: Pubkey,
    pub country: u16,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct IdentityRemoved {
    pub wallet: Pubkey,
    pub by_agent: Pubkey,
    pub timestamp: i64,
}

#[error_code(offset = 0)]
pub enum FracksIrsError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Caller does not have Identity Agent permission.")]
    NotIdentityAgent = 6008,
    #[msg("Registry reference is invalid.")]
    InvalidRegistryReference = 6013,
    #[msg("Wallet is already registered.")]
    WalletAlreadyRegistered = 6015,
    #[msg("Wallet is not registered.")]
    WalletNotRegistered = 6016,
    #[msg("Country code is invalid.")]
    InvalidCountryCode = 6017,
    #[msg("Registry is already bound.")]
    RegistryAlreadyBound = 6031,
    #[msg("Registry is not bound.")]
    RegistryNotBound = 6032,
    #[msg("Maximum bound registries reached.")]
    MaxBoundRegistriesReached = 6033,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6034,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
struct IdentityRegistryStateView {
    pub token_mint: Pubkey,
    pub owner: Pubkey,
    pub irs_account: Pubkey,
    pub tir_account: Pubkey,
    pub ctr_account: Pubkey,
    pub identity_agents: Vec<Pubkey>,
    pub registered_count: u64,
    pub bump: u8,
}

fn validate_country(country: u16) -> Result<()> {
    require!(
        (COUNTRY_MIN..=COUNTRY_MAX).contains(&country),
        FracksIrsError::InvalidCountryCode
    );
    Ok(())
}

fn authorize_identity_actor<'info>(
    authority: &Signer<'info>,
    irs_state: &Account<'info, IdentityRegistryStorageState>,
    registry_state: &UncheckedAccount<'info>,
) -> Result<()> {
    if authority.key() == irs_state.owner {
        return Ok(());
    }

    require!(
        irs_state.bound_registries.contains(&registry_state.key()),
        FracksIrsError::InvalidRegistryReference
    );

    let registry = deserialize_registry_state(registry_state)?;
    require_keys_eq!(
        registry.irs_account,
        irs_state.key(),
        FracksIrsError::InvalidRegistryReference
    );
    require!(
        registry.identity_agents.contains(&authority.key()),
        FracksIrsError::NotIdentityAgent
    );
    Ok(())
}

fn deserialize_registry_state(account: &AccountInfo) -> Result<IdentityRegistryStateView> {
    let data = account.try_borrow_data()?;
    require!(data.len() >= 8, FracksIrsError::InvalidRegistryReference);
    let mut slice: &[u8] = &data[8..];
    IdentityRegistryStateView::deserialize(&mut slice)
        .map_err(|_| error!(FracksIrsError::InvalidRegistryReference))
}

```

## programs/fracks-tir/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("Am5W7oEe8NCU4jdLP8qyUT3gjUPCDsvTSxGhdCQp1ETS");

const MAX_TOPICS_PER_ISSUER: usize = 20;
const MAX_LABEL_LENGTH: usize = 64;
const TIR_SPACE: usize = 8 + 32 + 32 + 4 + 1;
const ISSUER_ENTRY_SPACE: usize = 8 + 32 + 32 + 4 + (8 * MAX_TOPICS_PER_ISSUER) + 1 + 4 + MAX_LABEL_LENGTH + 1;

#[program]
pub mod fracks_tir {
    use super::*;

    pub fn initialize_tir(ctx: Context<InitializeTir>, token_mint: Pubkey) -> Result<()> {
        let tir_state = &mut ctx.accounts.tir_state;
        tir_state.owner = ctx.accounts.owner.key();
        tir_state.token_mint = token_mint;
        tir_state.issuer_count = 0;
        tir_state.bump = ctx.bumps.tir_state;
        Ok(())
    }

    pub fn add_trusted_issuer(
        ctx: Context<AddTrustedIssuer>,
        issuer_fid: Pubkey,
        topics: Vec<u64>,
        label: String,
    ) -> Result<()> {
        validate_topics(&topics)?;
        validate_label(&label)?;

        let issuer_entry = &mut ctx.accounts.issuer_entry;
        issuer_entry.issuer_fid = issuer_fid;
        issuer_entry.tir = ctx.accounts.tir_state.key();
        issuer_entry.allowed_topics = topics.clone();
        issuer_entry.is_active = true;
        issuer_entry.label = label.clone();
        issuer_entry.bump = ctx.bumps.issuer_entry;

        ctx.accounts.tir_state.issuer_count = ctx
            .accounts
            .tir_state
            .issuer_count
            .checked_add(1)
            .ok_or_else(|| error!(FracksTirError::ArithmeticOverflow))?;

        emit!(TrustedIssuerAdded {
            issuer_fid,
            topics,
            label,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn update_issuer_topics(
        ctx: Context<MutateIssuerEntry>,
        new_topics: Vec<u64>,
    ) -> Result<()> {
        validate_topics(&new_topics)?;
        ctx.accounts.issuer_entry.allowed_topics = new_topics.clone();

        emit!(IssuerTopicsUpdated {
            issuer_fid: ctx.accounts.issuer_entry.issuer_fid,
            topics: new_topics,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn deactivate_issuer(ctx: Context<MutateIssuerEntry>) -> Result<()> {
        ctx.accounts.issuer_entry.is_active = false;

        emit!(TrustedIssuerDeactivated {
            issuer_fid: ctx.accounts.issuer_entry.issuer_fid,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn reactivate_issuer(ctx: Context<MutateIssuerEntry>) -> Result<()> {
        ctx.accounts.issuer_entry.is_active = true;

        emit!(TrustedIssuerReactivated {
            issuer_fid: ctx.accounts.issuer_entry.issuer_fid,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn remove_trusted_issuer(ctx: Context<RemoveTrustedIssuer>) -> Result<()> {
        let issuer_fid = ctx.accounts.issuer_entry.issuer_fid;
        ctx.accounts.tir_state.issuer_count = ctx
            .accounts
            .tir_state
            .issuer_count
            .checked_sub(1)
            .ok_or_else(|| error!(FracksTirError::ArithmeticOverflow))?;

        emit!(TrustedIssuerRemoved {
            issuer_fid,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn is_trusted_for_topic(
        ctx: Context<ReadIssuerEntry>,
        issuer_fid: Pubkey,
        topic: u64,
    ) -> Result<bool> {
        if ctx.accounts.issuer_entry.issuer_fid != issuer_fid {
            return Ok(false);
        }

        Ok(ctx.accounts.issuer_entry.is_active
            && ctx.accounts.issuer_entry.allowed_topics.contains(&topic))
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct InitializeTir<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = TIR_SPACE,
        seeds = [b"tir_state", token_mint.as_ref()],
        bump
    )]
    pub tir_state: Account<'info, TrustedIssuersState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(issuer_fid: Pubkey, topics: Vec<u64>, label: String)]
pub struct AddTrustedIssuer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"tir_state", tir_state.token_mint.as_ref()],
        bump = tir_state.bump,
        has_one = owner @ FracksTirError::NotOwner
    )]
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        init,
        payer = owner,
        space = ISSUER_ENTRY_SPACE,
        seeds = [b"issuer_entry", tir_state.key().as_ref(), issuer_fid.as_ref()],
        bump
    )]
    pub issuer_entry: Account<'info, IssuerEntry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateIssuerEntry<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"tir_state", tir_state.token_mint.as_ref()],
        bump = tir_state.bump,
        has_one = owner @ FracksTirError::NotOwner
    )]
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        mut,
        seeds = [b"issuer_entry", tir_state.key().as_ref(), issuer_entry.issuer_fid.as_ref()],
        bump = issuer_entry.bump,
        constraint = issuer_entry.tir == tir_state.key() @ FracksTirError::IssuerNotTrusted
    )]
    pub issuer_entry: Account<'info, IssuerEntry>,
}

#[derive(Accounts)]
pub struct RemoveTrustedIssuer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"tir_state", tir_state.token_mint.as_ref()],
        bump = tir_state.bump,
        has_one = owner @ FracksTirError::NotOwner
    )]
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        mut,
        close = owner,
        seeds = [b"issuer_entry", tir_state.key().as_ref(), issuer_entry.issuer_fid.as_ref()],
        bump = issuer_entry.bump,
        constraint = issuer_entry.tir == tir_state.key() @ FracksTirError::IssuerNotTrusted
    )]
    pub issuer_entry: Account<'info, IssuerEntry>,
}

#[derive(Accounts)]
pub struct ReadIssuerEntry<'info> {
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        seeds = [b"issuer_entry", tir_state.key().as_ref(), issuer_entry.issuer_fid.as_ref()],
        bump = issuer_entry.bump,
        constraint = issuer_entry.tir == tir_state.key() @ FracksTirError::IssuerNotTrusted
    )]
    pub issuer_entry: Account<'info, IssuerEntry>,
}

#[account]
pub struct TrustedIssuersState {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub issuer_count: u32,
    pub bump: u8,
}

#[account]
pub struct IssuerEntry {
    pub issuer_fid: Pubkey,
    pub tir: Pubkey,
    pub allowed_topics: Vec<u64>,
    pub is_active: bool,
    pub label: String,
    pub bump: u8,
}

#[event]
pub struct TrustedIssuerAdded {
    pub issuer_fid: Pubkey,
    pub topics: Vec<u64>,
    pub label: String,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct IssuerTopicsUpdated {
    pub issuer_fid: Pubkey,
    pub topics: Vec<u64>,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TrustedIssuerDeactivated {
    pub issuer_fid: Pubkey,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TrustedIssuerReactivated {
    pub issuer_fid: Pubkey,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TrustedIssuerRemoved {
    pub issuer_fid: Pubkey,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[error_code(offset = 0)]
pub enum FracksTirError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Claim issuer is not trusted.")]
    IssuerNotTrusted = 6007,
    #[msg("Too many topics supplied.")]
    TooManyTopics = 6035,
    #[msg("Issuer label is too long.")]
    LabelTooLong = 6036,
    #[msg("Duplicate topic supplied.")]
    DuplicateTopic = 6037,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6038,
}

fn validate_topics(topics: &[u64]) -> Result<()> {
    require!(
        topics.len() <= MAX_TOPICS_PER_ISSUER,
        FracksTirError::TooManyTopics
    );

    let mut deduped = topics.to_vec();
    deduped.sort_unstable();
    deduped.dedup();
    require!(deduped.len() == topics.len(), FracksTirError::DuplicateTopic);
    Ok(())
}

fn validate_label(label: &str) -> Result<()> {
    require!(label.len() <= MAX_LABEL_LENGTH, FracksTirError::LabelTooLong);
    Ok(())
}

```

## programs/fracks-token-hook/src/lib.rs

```
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

declare_id!("CQwdsA97gSiPMUzNXjS22AUu6HmvzMK2XZVqhswYEHLi");

const FRACKS_TOKEN_PROGRAM_ID: Pubkey = pubkey!("Gr9Y5q2aHtQEpYHgqme3hctqQ2sNRGF1ZVx9cQvMDjBn");
const FRACKS_COMPLIANCE_PROGRAM_ID: Pubkey = pubkey!("9XYxZzDfU17BBpN1qhdu7RDCCrV6uebDgi5xse7Jbz5d");
const MOD_MAX_INVESTORS_PROGRAM_ID: Pubkey = pubkey!("4KVbq2esECUHZZdsBiDMM3mxYt8K7rNJUdotG6uZJfRQ");
const MOD_DAILY_LIMIT_PROGRAM_ID: Pubkey = pubkey!("FYJ1K8cWUsDmbxNpgaBaEmm3RpvvfpxBBWg2MLm4x8Sq");
const MOD_COUNTRY_CAP_PROGRAM_ID: Pubkey = pubkey!("Cv1HA7nHX8vxZvyCKXjk3gYPkqhfHFXxEsyxSXyRT3Ci");
const TRANSFER_APPROVAL_SPACE: usize = 8 + (32 * 6) + (8 * 3) + (2 * 2) + 1 + 1 + 1 + 1;
const BASE_EXTRA_METAS: usize = 5;
const MAX_MODULE_EXTRA_METAS: usize = 4;
const EXTRA_ACCOUNT_META_SIZE: usize = 35;
const EXTRA_ACCOUNT_METAS_SPACE: usize =
    12 + 4 + (EXTRA_ACCOUNT_META_SIZE * (BASE_EXTRA_METAS + (15 * MAX_MODULE_EXTRA_METAS)));
const TOKEN_STATE_COMPLIANCE_OFFSET: u8 = 72;
const OWNER_STATE_OWNER_OFFSET: usize = 8;
const OWNER_STATE_TOKEN_MINT_OFFSET: usize = 72;
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
    require!(data.len() >= 105, FracksTokenHookError::InvalidOwnerState);
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

```

## programs/fracks-token/src/lib.rs

```
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
    MaxInvestorsModuleView, MaxTransferModuleView, SupplyCapModuleView,
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

declare_id!("Gr9Y5q2aHtQEpYHgqme3hctqQ2sNRGF1ZVx9cQvMDjBn");

const MAX_NAME_LEN: usize = 64;
const MAX_SYMBOL_LEN: usize = 12;
const MAX_ISIN_LEN: usize = 24;
const TOKEN_STATE_SPACE: usize =
    8 + 32 + 32 + 32 + 1 + 1 + (4 + MAX_NAME_LEN) + (4 + MAX_SYMBOL_LEN) + (4 + MAX_ISIN_LEN) + 1;
const OWNER_STATE_SPACE: usize = 8 + 32 + 32 + 32 + 1;
const AGENT_ROLE_SPACE: usize = 8 + 32 + 32 + 1 + 1;
const FROZEN_WALLET_SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1;
const PARTIAL_FREEZE_SPACE: usize = 8 + 32 + 32 + 8 + 32 + 1;
const TRANSFER_APPROVAL_KIND_TRANSFER: u8 = 0;
const TRANSFER_APPROVAL_KIND_FORCED: u8 = 1;
const TRANSFER_APPROVAL_KIND_RECOVERY: u8 = 2;
const FRACKS_TOKEN_HOOK_ID: Pubkey = pubkey!("CQwdsA97gSiPMUzNXjS22AUu6HmvzMK2XZVqhswYEHLi");

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
        owner_state.pending_owner = Pubkey::default();
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
            by_agent: ctx.accounts.agent.key(),
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
            by_agent: ctx.accounts.agent.key(),
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
            ctx.accounts.agent.to_account_info(),
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
            by_agent: ctx.accounts.agent.key(),
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
            ctx.accounts.agent.to_account_info(),
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
                    authority: ctx.accounts.agent.to_account_info(),
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
                    authority: ctx.accounts.agent.to_account_info(),
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
                authority: ctx.accounts.agent.to_account_info(),
                irs_state: ctx.accounts.irs_state.to_account_info(),
                registry_state: ctx.accounts.irp_state.to_account_info(),
                wallet_identity: ctx.accounts.lost_wallet_identity.to_account_info(),
            },
        ))?;

        emit!(TokenRecovery {
            lost_wallet,
            new_wallet,
            amount,
            by_agent: ctx.accounts.agent.key(),
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
        ctx.accounts.owner_state.pending_owner = new_owner;
        Ok(())
    }

    pub fn accept_ownership(ctx: Context<AcceptOwnership>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.owner_state.pending_owner,
            ctx.accounts.pending_owner.key(),
            FracksTokenError::NotPendingOwner
        );
        ctx.accounts.owner_state.owner = ctx.accounts.pending_owner.key();
        ctx.accounts.owner_state.pending_owner = Pubkey::default();
        Ok(())
    }

    pub fn freeze_wallet(ctx: Context<FreezeWallet>) -> Result<()> {
        let frozen = &mut ctx.accounts.frozen_wallet;
        frozen.wallet = ctx.accounts.wallet.key();
        frozen.token_mint = ctx.accounts.token_state.token_mint;
        frozen.frozen_by = ctx.accounts.agent.key();
        frozen.frozen_at = Clock::get()?.unix_timestamp;
        frozen.bump = ctx.bumps.frozen_wallet;

        emit!(WalletFrozen {
            wallet: frozen.wallet,
            by_agent: ctx.accounts.agent.key(),
            timestamp: frozen.frozen_at,
        });
        Ok(())
    }

    pub fn unfreeze_wallet(ctx: Context<UnfreezeWallet>) -> Result<()> {
        emit!(WalletUnfrozen {
            wallet: ctx.accounts.frozen_wallet.wallet,
            by_agent: ctx.accounts.agent.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn freeze_partial(ctx: Context<FreezePartial>, amount: u64) -> Result<()> {
        require!(amount > 0, FracksTokenError::InvalidFreezeAmount);
        let partial = &mut ctx.accounts.partial_freeze;
        partial.wallet = ctx.accounts.wallet.key();
        partial.token_mint = ctx.accounts.token_state.token_mint;
        partial.frozen_amount = partial
            .frozen_amount
            .checked_add(amount)
            .ok_or_else(|| error!(FracksTokenError::ArithmeticOverflow))?;
        partial.frozen_by = ctx.accounts.agent.key();
        partial.bump = ctx.bumps.partial_freeze;

        emit!(PartialFreezeUpdated {
            wallet: partial.wallet,
            frozen_amount: partial.frozen_amount,
            by_agent: ctx.accounts.agent.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    pub fn unfreeze_partial(ctx: Context<FreezePartial>, amount: u64) -> Result<()> {
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
            by_agent: ctx.accounts.agent.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        if partial.frozen_amount == 0 {
            partial.close(ctx.accounts.agent.to_account_info())?;
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
pub struct AcceptOwnership<'info> {
    #[account(mut)]
    pub pending_owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"owner", owner_state.token_mint.as_ref()],
        bump = owner_state.bump
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
pub struct AgentOperation<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"agent", token_state.token_mint.as_ref(), agent.key().as_ref()],
        bump = agent_role.bump,
        constraint = agent_role.is_active @ FracksTokenError::NotAgent
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
    pub agent: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"agent", token_state.token_mint.as_ref(), agent.key().as_ref()],
        bump = agent_role.bump,
        constraint = agent_role.is_active @ FracksTokenError::NotAgent
    )]
    pub agent_role: Account<'info, AgentRole>,
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
    pub agent: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"agent", token_state.token_mint.as_ref(), agent.key().as_ref()],
        bump = agent_role.bump,
        constraint = agent_role.is_active @ FracksTokenError::NotAgent
    )]
    pub agent_role: Account<'info, AgentRole>,
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
    pub agent: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"agent", token_state.token_mint.as_ref(), agent.key().as_ref()],
        bump = agent_role.bump,
        constraint = agent_role.is_active @ FracksTokenError::NotAgent
    )]
    pub agent_role: Account<'info, AgentRole>,
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
    pub agent: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"agent", token_state.token_mint.as_ref(), agent.key().as_ref()],
        bump = agent_role.bump,
        constraint = agent_role.is_active @ FracksTokenError::NotAgent
    )]
    pub agent_role: Account<'info, AgentRole>,
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
    pub agent: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"agent", token_state.token_mint.as_ref(), agent.key().as_ref()],
        bump = agent_role.bump,
        constraint = agent_role.is_active @ FracksTokenError::NotAgent
    )]
    pub agent_role: Account<'info, AgentRole>,
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
    pub agent: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"agent", token_state.token_mint.as_ref(), agent.key().as_ref()],
        bump = agent_role.bump,
        constraint = agent_role.is_active @ FracksTokenError::NotAgent
    )]
    pub agent_role: Account<'info, AgentRole>,
    /// CHECK: Used as a PDA seed only.
    pub wallet: UncheckedAccount<'info>,
    #[account(
        init,
        payer = agent,
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
    pub agent: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"agent", token_state.token_mint.as_ref(), agent.key().as_ref()],
        bump = agent_role.bump,
        constraint = agent_role.is_active @ FracksTokenError::NotAgent
    )]
    pub agent_role: Account<'info, AgentRole>,
    #[account(
        mut,
        close = agent,
        seeds = [b"frozen", token_state.token_mint.as_ref(), frozen_wallet.wallet.as_ref()],
        bump = frozen_wallet.bump
    )]
    pub frozen_wallet: Account<'info, FrozenWallet>,
}

#[derive(Accounts)]
pub struct FreezePartial<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(
        seeds = [b"token_state", token_state.token_mint.as_ref()],
        bump = token_state.bump
    )]
    pub token_state: Account<'info, TokenState>,
    #[account(
        seeds = [b"agent", token_state.token_mint.as_ref(), agent.key().as_ref()],
        bump = agent_role.bump,
        constraint = agent_role.is_active @ FracksTokenError::NotAgent
    )]
    pub agent_role: Account<'info, AgentRole>,
    /// CHECK: Used as a PDA seed only.
    pub wallet: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = agent,
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
    pub pending_owner: Pubkey,
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
    #[msg("Insufficient transferable balance.")]
    InsufficientBalance = 6010,
    #[msg("Registry reference is invalid.")]
    InvalidRegistryReference = 6013,
    #[msg("Pending owner mismatch.")]
    NotPendingOwner = 6025,
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

    let sender_identity = require_wallet_identity(
        from_wallet_identity,
        &from_wallet.key(),
        &irs_state.key(),
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
    find_wallet_identity(wallet, irs, wallet_identity_info)
        .map_err(|_| error!(FracksTokenError::InvalidRegistryReference))?
        .ok_or_else(|| error!(FracksTokenError::WalletNotVerified))
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

```

## programs/modules/mod-country-cap/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("Cv1HA7nHX8vxZvyCKXjk3gYPkqhfHFXxEsyxSXyRT3Ci");

const MAX_COUNTRY_CAPS: usize = 32;
const MODULE_SPACE: usize = 8 + 32 + 32 + 32 + 4 + (10 * MAX_COUNTRY_CAPS) + 1;
const COUNT_SPACE: usize = 8 + 32 + 2 + 8 + 1;

#[program]
pub mod mod_country_cap {
    use super::*;

    pub fn initialize_module(
        ctx: Context<InitializeModule>,
        token_mint: Pubkey,
        country_caps: Vec<CountryCapEntry>,
    ) -> Result<()> {
        require!(country_caps.len() <= MAX_COUNTRY_CAPS, ModCountryCapError::TooManyCountryCaps);
        let module = &mut ctx.accounts.module_state;
        module.owner = ctx.accounts.owner.key();
        module.token_mint = token_mint;
        module.hook_authority = ctx.accounts.owner.key();
        module.country_caps = country_caps;
        module.bump = ctx.bumps.module_state;
        Ok(())
    }

    pub fn set_hook_authority(
        ctx: Context<UpdateModuleOwner>,
        hook_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.module_state.hook_authority = hook_authority;
        Ok(())
    }

    pub fn can_transfer(
        ctx: Context<CheckCountryCount>,
        amount: u64,
        to_balance: u64,
        to_country: u16,
    ) -> Result<bool> {
        if amount == 0 || to_balance > 0 {
            return Ok(true);
        }
        let Some(cap) = ctx
            .accounts
            .module_state
            .country_caps
            .iter()
            .find(|entry| entry.country == to_country)
            .map(|entry| entry.cap) else {
            return Ok(true);
        };
        Ok(ctx.accounts.country_count.count < cap)
    }

    pub fn initialize_country_count(
        ctx: Context<InitializeCountryCount>,
        country: u16,
    ) -> Result<()> {
        let count = &mut ctx.accounts.country_count;
        count.module = ctx.accounts.module_state.key();
        count.country = country;
        count.count = 0;
        count.bump = ctx.bumps.country_count;
        Ok(())
    }

    pub fn transferred(
        ctx: Context<UpdateCountryCounts>,
        amount: u64,
        from_balance_after: u64,
        to_balance_after: u64,
        from_country: u16,
        to_country: u16,
    ) -> Result<()> {
        let sender_exits = amount > 0 && from_balance_after == 0;
        let receiver_enters = amount > 0 && to_balance_after == amount;

        if from_country == to_country {
            if sender_exits && !receiver_enters {
                initialize_count_if_needed(
                    &mut ctx.accounts.from_country_count,
                    ctx.accounts.module_state.key(),
                    from_country,
                );
                ctx.accounts.from_country_count.count = ctx.accounts.from_country_count.count
                    .checked_sub(1)
                    .ok_or_else(|| error!(ModCountryCapError::ArithmeticOverflow))?;
            } else if receiver_enters && !sender_exits {
                initialize_count_if_needed(
                    &mut ctx.accounts.to_country_count,
                    ctx.accounts.module_state.key(),
                    to_country,
                );
                ctx.accounts.to_country_count.count = ctx.accounts.to_country_count.count
                    .checked_add(1)
                    .ok_or_else(|| error!(ModCountryCapError::ArithmeticOverflow))?;
            }
            return Ok(());
        }

        if sender_exits {
            initialize_count_if_needed(&mut ctx.accounts.from_country_count, ctx.accounts.module_state.key(), from_country);
            ctx.accounts.from_country_count.count = ctx.accounts.from_country_count.count
                .checked_sub(1)
                .ok_or_else(|| error!(ModCountryCapError::ArithmeticOverflow))?;
        }
        if receiver_enters {
            initialize_count_if_needed(&mut ctx.accounts.to_country_count, ctx.accounts.module_state.key(), to_country);
            ctx.accounts.to_country_count.count = ctx.accounts.to_country_count.count
                .checked_add(1)
                .ok_or_else(|| error!(ModCountryCapError::ArithmeticOverflow))?;
        }
        Ok(())
    }

    pub fn created(
        ctx: Context<UpdateSingleCountryCount>,
        amount: u64,
        to_balance_after: u64,
        to_country: u16,
    ) -> Result<()> {
        if amount > 0 && to_balance_after == amount {
            initialize_count_if_needed(&mut ctx.accounts.country_count, ctx.accounts.module_state.key(), to_country);
            ctx.accounts.country_count.count = ctx.accounts.country_count.count
                .checked_add(1)
                .ok_or_else(|| error!(ModCountryCapError::ArithmeticOverflow))?;
        }
        Ok(())
    }

    pub fn destroyed(
        ctx: Context<UpdateSingleCountryCount>,
        amount: u64,
        from_balance_after: u64,
        from_country: u16,
    ) -> Result<()> {
        if amount > 0 && from_balance_after == 0 {
            initialize_count_if_needed(&mut ctx.accounts.country_count, ctx.accounts.module_state.key(), from_country);
            ctx.accounts.country_count.count = ctx.accounts.country_count.count
                .checked_sub(1)
                .ok_or_else(|| error!(ModCountryCapError::ArithmeticOverflow))?;
        }
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, country_caps: Vec<CountryCapEntry>)]
pub struct InitializeModule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = MODULE_SPACE,
        seeds = [b"mod_country_cap", token_mint.as_ref()],
        bump
    )]
    pub module_state: Account<'info, InvestorCountryCapModule>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckCountryCount<'info> {
    #[account(
        seeds = [b"mod_country_cap", module_state.token_mint.as_ref()],
        bump = module_state.bump
    )]
    pub module_state: Account<'info, InvestorCountryCapModule>,
    pub country_count: Account<'info, CountryInvestorCount>,
}

#[derive(Accounts)]
pub struct UpdateSingleCountryCount<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mod_country_cap", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        constraint = is_module_authority(&module_state, authority.key()) @ ModCountryCapError::NotAuthorized
    )]
    pub module_state: Account<'info, InvestorCountryCapModule>,
    #[account(
        mut,
        constraint = country_count.module == module_state.key() @ ModCountryCapError::InvalidCountryCount
    )]
    pub country_count: Account<'info, CountryInvestorCount>,
}

#[derive(Accounts)]
pub struct UpdateCountryCounts<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mod_country_cap", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        constraint = is_module_authority(&module_state, authority.key()) @ ModCountryCapError::NotAuthorized
    )]
    pub module_state: Account<'info, InvestorCountryCapModule>,
    #[account(
        mut,
        constraint = from_country_count.module == module_state.key() @ ModCountryCapError::InvalidCountryCount
    )]
    pub from_country_count: Account<'info, CountryInvestorCount>,
    #[account(
        mut,
        constraint = to_country_count.module == module_state.key() @ ModCountryCapError::InvalidCountryCount
    )]
    pub to_country_count: Account<'info, CountryInvestorCount>,
}

#[derive(Accounts)]
pub struct UpdateModuleOwner<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mod_country_cap", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        has_one = owner @ ModCountryCapError::NotOwner
    )]
    pub module_state: Account<'info, InvestorCountryCapModule>,
}

#[derive(Accounts)]
#[instruction(country: u16)]
pub struct InitializeCountryCount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"mod_country_cap", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        has_one = owner @ ModCountryCapError::NotOwner
    )]
    pub module_state: Account<'info, InvestorCountryCapModule>,
    #[account(
        init,
        payer = owner,
        space = COUNT_SPACE,
        seeds = [b"country_count", module_state.key().as_ref(), &country.to_le_bytes()],
        bump
    )]
    pub country_count: Account<'info, CountryInvestorCount>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct InvestorCountryCapModule {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub hook_authority: Pubkey,
    pub country_caps: Vec<CountryCapEntry>,
    pub bump: u8,
}

#[account]
#[derive(Default)]
pub struct CountryInvestorCount {
    pub module: Pubkey,
    pub country: u16,
    pub count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CountryCapEntry {
    pub country: u16,
    pub cap: u64,
}

#[error_code(offset = 0)]
pub enum ModCountryCapError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Signer is not authorized to update module hook state.")]
    NotAuthorized = 6001,
    #[msg("Invalid country count account.")]
    InvalidCountryCount = 6002,
    #[msg("Too many country caps.")]
    TooManyCountryCaps = 6003,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6004,
}

fn initialize_count_if_needed(
    count: &mut Account<CountryInvestorCount>,
    module: Pubkey,
    country: u16,
) {
    if count.module == Pubkey::default() {
        count.module = module;
        count.country = country;
        count.count = 0;
    }
}

fn is_module_authority(module: &InvestorCountryCapModule, authority: Pubkey) -> bool {
    authority == module.owner || authority == module.hook_authority
}

```

## programs/modules/mod-country-restrict/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("BCGKsDTyncA4EbHzxGVmEi3pheotJiaxCwYvHGxERiZ7");

const MAX_COUNTRIES: usize = 32;
const MODULE_SPACE: usize = 8 + 32 + 32 + 4 + (2 * MAX_COUNTRIES) + 1;

#[program]
pub mod mod_country_restrict {
    use super::*;

    pub fn initialize_module(
        ctx: Context<InitializeModule>,
        token_mint: Pubkey,
        blocked_countries: Vec<u16>,
    ) -> Result<()> {
        require!(blocked_countries.len() <= MAX_COUNTRIES, ModCountryRestrictError::TooManyCountries);
        let module = &mut ctx.accounts.module_state;
        module.owner = ctx.accounts.owner.key();
        module.token_mint = token_mint;
        module.blocked_countries = blocked_countries;
        module.bump = ctx.bumps.module_state;
        Ok(())
    }

    pub fn can_transfer(
        ctx: Context<ReadModule>,
        from_country: u16,
        to_country: u16,
    ) -> Result<bool> {
        Ok(!ctx.accounts.module_state.blocked_countries.contains(&from_country)
            && !ctx.accounts.module_state.blocked_countries.contains(&to_country))
    }

    pub fn transferred(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }

    pub fn created(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }

    pub fn destroyed(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, blocked_countries: Vec<u16>)]
pub struct InitializeModule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = MODULE_SPACE,
        seeds = [b"mod_country", token_mint.as_ref()],
        bump
    )]
    pub module_state: Account<'info, CountryRestrictModule>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReadModule<'info> {
    #[account(
        seeds = [b"mod_country", module_state.token_mint.as_ref()],
        bump = module_state.bump
    )]
    pub module_state: Account<'info, CountryRestrictModule>,
}

#[account]
pub struct CountryRestrictModule {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub blocked_countries: Vec<u16>,
    pub bump: u8,
}

#[error_code(offset = 0)]
pub enum ModCountryRestrictError {
    #[msg("Too many countries.")]
    TooManyCountries = 6001,
}

```

## programs/modules/mod-daily-limit/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("FYJ1K8cWUsDmbxNpgaBaEmm3RpvvfpxBBWg2MLm4x8Sq");

const MODULE_SPACE: usize = 8 + 32 + 32 + 32 + 8 + 1;
const USAGE_SPACE: usize = 8 + 32 + 32 + 8 + 8 + 1;
const DAY_SECONDS: i64 = 86_400;

#[program]
pub mod mod_daily_limit {
    use super::*;

    pub fn initialize_module(
        ctx: Context<InitializeModule>,
        token_mint: Pubkey,
        daily_limit: u64,
    ) -> Result<()> {
        let module = &mut ctx.accounts.module_state;
        module.owner = ctx.accounts.owner.key();
        module.token_mint = token_mint;
        module.hook_authority = ctx.accounts.owner.key();
        module.daily_limit = daily_limit;
        module.bump = ctx.bumps.module_state;
        Ok(())
    }

    pub fn set_hook_authority(
        ctx: Context<UpdateModuleOwner>,
        hook_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.module_state.hook_authority = hook_authority;
        Ok(())
    }

    pub fn can_transfer(ctx: Context<CheckUsage>, amount: u64) -> Result<bool> {
        let usage = &ctx.accounts.wallet_usage;
        let now = Clock::get()?.unix_timestamp;
        let used = if usage.wallet == Pubkey::default() || now.saturating_sub(usage.window_started_at) >= DAY_SECONDS {
            0
        } else {
            usage.volume
        };
        Ok(used.saturating_add(amount) <= ctx.accounts.module_state.daily_limit)
    }

    pub fn initialize_wallet_usage(
        ctx: Context<InitializeWalletUsage>,
        wallet: Pubkey,
    ) -> Result<()> {
        let usage = &mut ctx.accounts.wallet_usage;
        usage.module = ctx.accounts.module_state.key();
        usage.wallet = wallet;
        usage.window_started_at = 0;
        usage.volume = 0;
        usage.bump = ctx.bumps.wallet_usage;
        Ok(())
    }

    pub fn transferred(ctx: Context<UpdateUsage>, wallet: Pubkey, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let usage = &mut ctx.accounts.wallet_usage;
        require_keys_eq!(
            usage.module,
            ctx.accounts.module_state.key(),
            ModDailyLimitError::InvalidUsageAccount
        );
        require_keys_eq!(usage.wallet, wallet, ModDailyLimitError::InvalidUsageAccount);
        if usage.window_started_at == 0 || now.saturating_sub(usage.window_started_at) >= DAY_SECONDS {
            usage.window_started_at = now;
            usage.volume = 0;
        }
        usage.volume = usage
            .volume
            .checked_add(amount)
            .ok_or_else(|| error!(ModDailyLimitError::ArithmeticOverflow))?;
        Ok(())
    }

    pub fn created(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }

    pub fn destroyed(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, daily_limit: u64)]
pub struct InitializeModule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = MODULE_SPACE,
        seeds = [b"mod_daily_limit", token_mint.as_ref()],
        bump
    )]
    pub module_state: Account<'info, DailyTransferLimitModule>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReadModule<'info> {
    #[account(
        seeds = [b"mod_daily_limit", module_state.token_mint.as_ref()],
        bump = module_state.bump
    )]
    pub module_state: Account<'info, DailyTransferLimitModule>,
}

#[derive(Accounts)]
pub struct CheckUsage<'info> {
    #[account(
        seeds = [b"mod_daily_limit", module_state.token_mint.as_ref()],
        bump = module_state.bump
    )]
    pub module_state: Account<'info, DailyTransferLimitModule>,
    pub wallet_usage: Account<'info, DailyWalletUsage>,
}

#[derive(Accounts)]
pub struct UpdateModuleOwner<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mod_daily_limit", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        has_one = owner @ ModDailyLimitError::NotOwner
    )]
    pub module_state: Account<'info, DailyTransferLimitModule>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct InitializeWalletUsage<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"mod_daily_limit", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        has_one = owner @ ModDailyLimitError::NotOwner
    )]
    pub module_state: Account<'info, DailyTransferLimitModule>,
    #[account(
        init,
        payer = owner,
        space = USAGE_SPACE,
        seeds = [b"daily_usage", module_state.key().as_ref(), wallet.as_ref()],
        bump
    )]
    pub wallet_usage: Account<'info, DailyWalletUsage>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct UpdateUsage<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mod_daily_limit", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        constraint = is_module_authority(&module_state, authority.key()) @ ModDailyLimitError::NotAuthorized
    )]
    pub module_state: Account<'info, DailyTransferLimitModule>,
    #[account(
        mut,
        seeds = [b"daily_usage", module_state.key().as_ref(), wallet.as_ref()],
        bump = wallet_usage.bump
    )]
    pub wallet_usage: Account<'info, DailyWalletUsage>,
}

#[account]
pub struct DailyTransferLimitModule {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub hook_authority: Pubkey,
    pub daily_limit: u64,
    pub bump: u8,
}

#[account]
#[derive(Default)]
pub struct DailyWalletUsage {
    pub module: Pubkey,
    pub wallet: Pubkey,
    pub window_started_at: i64,
    pub volume: u64,
    pub bump: u8,
}

#[error_code(offset = 0)]
pub enum ModDailyLimitError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Signer is not authorized to update module hook state.")]
    NotAuthorized = 6001,
    #[msg("Invalid wallet usage account.")]
    InvalidUsageAccount = 6002,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6003,
}

fn is_module_authority(module: &DailyTransferLimitModule, authority: Pubkey) -> bool {
    authority == module.owner || authority == module.hook_authority
}

```

## programs/modules/mod-lockup/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("6XqxWPwZQrfTo2ZJeT7wBhJaXd1eKjB2kx5ZrP1CLwa9");

const MODULE_SPACE: usize = 8 + 32 + 32 + 8 + 1;

#[program]
pub mod mod_lockup {
    use super::*;

    pub fn initialize_module(
        ctx: Context<InitializeModule>,
        token_mint: Pubkey,
        lockup_end: i64,
    ) -> Result<()> {
        let module = &mut ctx.accounts.module_state;
        module.owner = ctx.accounts.owner.key();
        module.token_mint = token_mint;
        module.lockup_end = lockup_end;
        module.bump = ctx.bumps.module_state;
        Ok(())
    }

    pub fn can_transfer(ctx: Context<ReadModule>) -> Result<bool> {
        Ok(Clock::get()?.unix_timestamp >= ctx.accounts.module_state.lockup_end)
    }

    pub fn transferred(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }

    pub fn created(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }

    pub fn destroyed(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, lockup_end: i64)]
pub struct InitializeModule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = MODULE_SPACE,
        seeds = [b"mod_lockup", token_mint.as_ref()],
        bump
    )]
    pub module_state: Account<'info, LockupModule>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReadModule<'info> {
    #[account(
        seeds = [b"mod_lockup", module_state.token_mint.as_ref()],
        bump = module_state.bump
    )]
    pub module_state: Account<'info, LockupModule>,
}

#[account]
pub struct LockupModule {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub lockup_end: i64,
    pub bump: u8,
}

```

## programs/modules/mod-max-balance/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("9BjLakhcX1ms34VjRwUgMZQAgdbsMM8C1gSPqrJTyCpH");

const MODULE_SPACE: usize = 8 + 32 + 32 + 8 + 1;

#[program]
pub mod mod_max_balance {
    use super::*;

    pub fn initialize_module(
        ctx: Context<InitializeModule>,
        token_mint: Pubkey,
        max_balance: u64,
    ) -> Result<()> {
        let module = &mut ctx.accounts.module_state;
        module.owner = ctx.accounts.owner.key();
        module.token_mint = token_mint;
        module.max_balance = max_balance;
        module.bump = ctx.bumps.module_state;
        Ok(())
    }

    pub fn can_transfer(
        ctx: Context<ReadModule>,
        amount: u64,
        to_balance: u64,
    ) -> Result<bool> {
        Ok(to_balance.saturating_add(amount) <= ctx.accounts.module_state.max_balance)
    }

    pub fn transferred(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }

    pub fn created(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }

    pub fn destroyed(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, max_balance: u64)]
pub struct InitializeModule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = MODULE_SPACE,
        seeds = [b"mod_max_balance", token_mint.as_ref()],
        bump
    )]
    pub module_state: Account<'info, MaxBalanceModule>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReadModule<'info> {
    #[account(
        seeds = [b"mod_max_balance", module_state.token_mint.as_ref()],
        bump = module_state.bump
    )]
    pub module_state: Account<'info, MaxBalanceModule>,
}

#[account]
pub struct MaxBalanceModule {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub max_balance: u64,
    pub bump: u8,
}

```

## programs/modules/mod-max-investors/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("4KVbq2esECUHZZdsBiDMM3mxYt8K7rNJUdotG6uZJfRQ");

const MODULE_SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;

#[program]
pub mod mod_max_investors {
    use super::*;

    pub fn initialize_module(
        ctx: Context<InitializeModule>,
        token_mint: Pubkey,
        max_investors: u64,
    ) -> Result<()> {
        let module = &mut ctx.accounts.module_state;
        module.owner = ctx.accounts.owner.key();
        module.token_mint = token_mint;
        module.hook_authority = ctx.accounts.owner.key();
        module.max_investors = max_investors;
        module.holder_count = 0;
        module.bump = ctx.bumps.module_state;
        Ok(())
    }

    pub fn set_hook_authority(
        ctx: Context<UpdateModuleOwner>,
        hook_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.module_state.hook_authority = hook_authority;
        Ok(())
    }

    pub fn can_transfer(
        ctx: Context<ReadModule>,
        amount: u64,
        to_balance: u64,
    ) -> Result<bool> {
        if to_balance == 0 && amount > 0 {
            return Ok(ctx.accounts.module_state.holder_count < ctx.accounts.module_state.max_investors);
        }
        Ok(true)
    }

    pub fn transferred(
        ctx: Context<MutateModule>,
        amount: u64,
        from_balance_after: u64,
        to_balance_after: u64,
    ) -> Result<()> {
        if amount > 0 && from_balance_after == 0 {
            ctx.accounts.module_state.holder_count = ctx.accounts.module_state.holder_count
                .checked_sub(1)
                .ok_or_else(|| error!(ModMaxInvestorsError::ArithmeticOverflow))?;
        }
        if amount > 0 && to_balance_after == amount {
            ctx.accounts.module_state.holder_count = ctx.accounts.module_state.holder_count
                .checked_add(1)
                .ok_or_else(|| error!(ModMaxInvestorsError::ArithmeticOverflow))?;
        }
        Ok(())
    }

    pub fn created(ctx: Context<MutateModule>, amount: u64, to_balance_after: u64) -> Result<()> {
        if amount > 0 && to_balance_after == amount {
            ctx.accounts.module_state.holder_count = ctx.accounts.module_state.holder_count
                .checked_add(1)
                .ok_or_else(|| error!(ModMaxInvestorsError::ArithmeticOverflow))?;
        }
        Ok(())
    }

    pub fn destroyed(ctx: Context<MutateModule>, amount: u64, from_balance_after: u64) -> Result<()> {
        if amount > 0 && from_balance_after == 0 {
            ctx.accounts.module_state.holder_count = ctx.accounts.module_state.holder_count
                .checked_sub(1)
                .ok_or_else(|| error!(ModMaxInvestorsError::ArithmeticOverflow))?;
        }
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, max_investors: u64)]
pub struct InitializeModule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = MODULE_SPACE,
        seeds = [b"mod_max_investors", token_mint.as_ref()],
        bump
    )]
    pub module_state: Account<'info, MaxInvestorsModule>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReadModule<'info> {
    #[account(
        seeds = [b"mod_max_investors", module_state.token_mint.as_ref()],
        bump = module_state.bump
    )]
    pub module_state: Account<'info, MaxInvestorsModule>,
}

#[derive(Accounts)]
pub struct UpdateModuleOwner<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mod_max_investors", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        has_one = owner @ ModMaxInvestorsError::NotOwner
    )]
    pub module_state: Account<'info, MaxInvestorsModule>,
}

#[derive(Accounts)]
pub struct MutateModule<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mod_max_investors", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        constraint = is_module_authority(&module_state, authority.key()) @ ModMaxInvestorsError::NotAuthorized
    )]
    pub module_state: Account<'info, MaxInvestorsModule>,
}

#[account]
pub struct MaxInvestorsModule {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub hook_authority: Pubkey,
    pub max_investors: u64,
    pub holder_count: u64,
    pub bump: u8,
}

#[error_code(offset = 0)]
pub enum ModMaxInvestorsError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Signer is not authorized to update module hook state.")]
    NotAuthorized = 6001,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6002,
}

fn is_module_authority(module: &MaxInvestorsModule, authority: Pubkey) -> bool {
    authority == module.owner || authority == module.hook_authority
}

```

## programs/modules/mod-max-transfer/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("Ee6RXC46Nb4Bo2BTQcXBHfuxLZdzbKtPmb3sGf2Egiqh");

const MODULE_SPACE: usize = 8 + 32 + 32 + 8 + 1;

#[program]
pub mod mod_max_transfer {
    use super::*;

    pub fn initialize_module(
        ctx: Context<InitializeModule>,
        token_mint: Pubkey,
        max_amount: u64,
    ) -> Result<()> {
        let module = &mut ctx.accounts.module_state;
        module.owner = ctx.accounts.owner.key();
        module.token_mint = token_mint;
        module.max_amount = max_amount;
        module.bump = ctx.bumps.module_state;
        Ok(())
    }

    pub fn can_transfer(ctx: Context<ReadModule>, amount: u64) -> Result<bool> {
        Ok(amount <= ctx.accounts.module_state.max_amount)
    }

    pub fn transferred(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }

    pub fn created(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }

    pub fn destroyed(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, max_amount: u64)]
pub struct InitializeModule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = MODULE_SPACE,
        seeds = [b"mod_max_transfer", token_mint.as_ref()],
        bump
    )]
    pub module_state: Account<'info, MaxTransferModule>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReadModule<'info> {
    #[account(
        seeds = [b"mod_max_transfer", module_state.token_mint.as_ref()],
        bump = module_state.bump
    )]
    pub module_state: Account<'info, MaxTransferModule>,
}

#[account]
pub struct MaxTransferModule {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub max_amount: u64,
    pub bump: u8,
}

```

## programs/modules/mod-supply-cap/src/lib.rs

```
use anchor_lang::prelude::*;

declare_id!("EkgX6pGFCFT7FuNWuBAAMePy43iU9oETLDota4nTA3x8");

const MODULE_SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;

#[program]
pub mod mod_supply_cap {
    use super::*;

    pub fn initialize_module(
        ctx: Context<InitializeModule>,
        token_mint: Pubkey,
        max_supply: u64,
    ) -> Result<()> {
        let module = &mut ctx.accounts.module_state;
        module.owner = ctx.accounts.owner.key();
        module.token_mint = token_mint;
        module.hook_authority = ctx.accounts.owner.key();
        module.max_supply = max_supply;
        module.total_supply = 0;
        module.bump = ctx.bumps.module_state;
        Ok(())
    }

    pub fn set_hook_authority(
        ctx: Context<UpdateModuleOwner>,
        hook_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.module_state.hook_authority = hook_authority;
        Ok(())
    }

    pub fn can_transfer(_ctx: Context<ReadModule>) -> Result<bool> {
        Ok(true)
    }

    pub fn transferred(_ctx: Context<ReadModule>) -> Result<()> {
        Ok(())
    }

    pub fn created(ctx: Context<MutateModule>, amount: u64) -> Result<()> {
        let module = &mut ctx.accounts.module_state;
        let new_total = module
            .total_supply
            .checked_add(amount)
            .ok_or_else(|| error!(ModSupplyCapError::ArithmeticOverflow))?;
        require!(new_total <= module.max_supply, ModSupplyCapError::MaxSupplyExceeded);
        module.total_supply = new_total;
        Ok(())
    }

    pub fn destroyed(ctx: Context<MutateModule>, amount: u64) -> Result<()> {
        ctx.accounts.module_state.total_supply =
            ctx.accounts.module_state.total_supply
                .checked_sub(amount)
                .ok_or_else(|| error!(ModSupplyCapError::ArithmeticOverflow))?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, max_supply: u64)]
pub struct InitializeModule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = MODULE_SPACE,
        seeds = [b"mod_supply_cap", token_mint.as_ref()],
        bump
    )]
    pub module_state: Account<'info, SupplyCapModule>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReadModule<'info> {
    #[account(
        seeds = [b"mod_supply_cap", module_state.token_mint.as_ref()],
        bump = module_state.bump
    )]
    pub module_state: Account<'info, SupplyCapModule>,
}

#[derive(Accounts)]
pub struct UpdateModuleOwner<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mod_supply_cap", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        has_one = owner @ ModSupplyCapError::NotOwner
    )]
    pub module_state: Account<'info, SupplyCapModule>,
}

#[derive(Accounts)]
pub struct MutateModule<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"mod_supply_cap", module_state.token_mint.as_ref()],
        bump = module_state.bump,
        constraint = is_module_authority(&module_state, authority.key()) @ ModSupplyCapError::NotAuthorized
    )]
    pub module_state: Account<'info, SupplyCapModule>,
}

#[account]
pub struct SupplyCapModule {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub hook_authority: Pubkey,
    pub max_supply: u64,
    pub total_supply: u64,
    pub bump: u8,
}

#[error_code(offset = 0)]
pub enum ModSupplyCapError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Signer is not authorized to update module hook state.")]
    NotAuthorized = 6001,
    #[msg("Max supply exceeded.")]
    MaxSupplyExceeded = 6002,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6003,
}

fn is_module_authority(module: &SupplyCapModule, authority: Pubkey) -> bool {
    authority == module.owner || authority == module.hook_authority
}

```

