use anchor_lang::prelude::*;

declare_id!("8r9euzP3dFg8d3sA6fh3Ur73cMbvEAbj5UbigHVEXimZ");

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
