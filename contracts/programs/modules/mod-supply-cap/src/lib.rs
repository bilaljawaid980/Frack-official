use anchor_lang::prelude::*;

declare_id!("EGJvV5cBN7et6Pdthyj6z7xuN8FN2u1wtGQsUjR69Rxb");

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
