use anchor_lang::prelude::*;

declare_id!("EvDVqTUjs3ZsAUfPQdyVskYCzoPTbWybF5tcBtWYfAuz");

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
