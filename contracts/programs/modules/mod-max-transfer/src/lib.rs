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
