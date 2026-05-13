use anchor_lang::prelude::*;

declare_id!("EmCSJJLnshcnC7jLHmcHKN3XbMjnHY9mZDMYF1Xppig9");

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
