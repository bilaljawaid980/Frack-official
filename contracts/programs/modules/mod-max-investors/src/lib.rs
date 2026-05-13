use anchor_lang::prelude::*;

declare_id!("FMSVzD74EbSiTj2XHi8xsqcp6pigdxHL7MGHxtRLYte7");

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
