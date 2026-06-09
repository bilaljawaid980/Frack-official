use anchor_lang::prelude::*;

declare_id!("EcLffdKdSsCpNczazKsSeRw7FCN6vVjKAEMH5CZGBndr");

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
        bump = module_state.bump
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
