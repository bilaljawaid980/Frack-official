use anchor_lang::prelude::*;

declare_id!("6JcKpK45GvhwaPRZoEfLFCNos2eCxCr3N3tGzzaC1ECQ");

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
