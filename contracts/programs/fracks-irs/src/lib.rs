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
