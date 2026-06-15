use anchor_lang::prelude::*;
use fracks_fid::FidAccount;

declare_id!("CnAZUQ9jFm2eLGA8d8ek1gpLwGc6xZqvnbyJ9s7swbWc");

const COUNTRY_MIN: u16 = 1;
const COUNTRY_MAX: u16 = 999;
const MAX_BOUND_REGISTRIES: usize = 32;
const IRS_SPACE: usize = 8 + 32 + 32 + 4 + (32 * MAX_BOUND_REGISTRIES) + 8 + 1;
const WALLET_IDENTITY_SPACE: usize = 8 + 32 + 32 + 2 + 32 + 1 + 32 + 8 + 1;
const ONBOARDING_APPLICATION_SPACE: usize = 8 + 32 + 32 + 32 + 32 + 1 + 32 + 8 + 8 + 1;
const APPLICATION_STATUS_SUBMITTED: u8 = 1;
const APPLICATION_STATUS_APPROVED: u8 = 2;
const APPLICATION_STATUS_REJECTED: u8 = 3;

#[program]
pub mod fracks_irs {
    use super::*;

    pub fn initialize_irs(ctx: Context<InitializeIrs>, authority_seed: Pubkey) -> Result<()> {
        let irs_state = &mut ctx.accounts.irs_state;
        irs_state.owner = ctx.accounts.owner.key();
        irs_state.authority_seed = authority_seed;
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

    pub fn transfer_ownership(ctx: Context<UpdateIrsOwnerState>, new_owner: Pubkey) -> Result<()> {
        require_keys_neq!(new_owner, Pubkey::default(), FracksIrsError::InvalidOwner);
        ctx.accounts.irs_state.owner = new_owner;
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
        validate_investor_fid(&ctx.accounts.fid_account, &wallet, &fid, country)?;

        wallet_identity.wallet = wallet;
        wallet_identity.fid = fid;
        wallet_identity.country = country;
        wallet_identity.irs = ctx.accounts.irs_state.key();
        wallet_identity.is_active = false;
        wallet_identity.activated_by = Pubkey::default();
        wallet_identity.activated_at = 0;
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

    pub fn submit_onboarding_application(
        ctx: Context<SubmitOnboardingApplication>,
        wallet: Pubkey,
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        let application = &mut ctx.accounts.application;
        require!(
            application.status == 0 || application.status == APPLICATION_STATUS_REJECTED,
            FracksIrsError::ApplicationAlreadyOpen
        );

        application.wallet = wallet;
        application.irs = ctx.accounts.irs_state.key();
        application.applicant = ctx.accounts.applicant.key();
        application.metadata_hash = metadata_hash;
        application.status = APPLICATION_STATUS_SUBMITTED;
        application.reviewer = Pubkey::default();
        application.submitted_at = Clock::get()?.unix_timestamp;
        application.reviewed_at = 0;
        application.bump = ctx.bumps.application;

        emit!(ApplicationSubmitted {
            wallet,
            applicant: ctx.accounts.applicant.key(),
            irs: ctx.accounts.irs_state.key(),
            metadata_hash,
            timestamp: application.submitted_at,
        });

        Ok(())
    }

    pub fn review_onboarding_application(
        ctx: Context<ReviewOnboardingApplication>,
        approved: bool,
    ) -> Result<()> {
        authorize_identity_actor(
            &ctx.accounts.authority,
            &ctx.accounts.irs_state,
            &ctx.accounts.registry_state,
        )?;

        let application = &mut ctx.accounts.application;
        require!(
            application.status == APPLICATION_STATUS_SUBMITTED,
            FracksIrsError::ApplicationNotSubmitted
        );

        application.status = if approved {
            APPLICATION_STATUS_APPROVED
        } else {
            APPLICATION_STATUS_REJECTED
        };
        application.reviewer = ctx.accounts.authority.key();
        application.reviewed_at = Clock::get()?.unix_timestamp;

        emit!(ApplicationReviewed {
            wallet: application.wallet,
            reviewer: ctx.accounts.authority.key(),
            approved,
            timestamp: application.reviewed_at,
        });

        Ok(())
    }

    pub fn cancel_onboarding_application(ctx: Context<CancelOnboardingApplication>) -> Result<()> {
        let application = &ctx.accounts.application;
        let authority = ctx.accounts.authority.key();
        require!(
            authority == application.applicant || authority == ctx.accounts.irs_state.owner,
            FracksIrsError::UnauthorizedApplicationCancel
        );

        emit!(ApplicationCancelled {
            wallet: application.wallet,
            applicant: application.applicant,
            cancelled_by: authority,
            irs: application.irs,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn set_identity_activation(
        ctx: Context<SetIdentityActivation>,
        active: bool,
    ) -> Result<()> {
        let timestamp = Clock::get()?.unix_timestamp;
        let wallet_identity = &mut ctx.accounts.wallet_identity;
        wallet_identity.is_active = active;
        wallet_identity.activated_by = ctx.accounts.owner.key();
        wallet_identity.activated_at = timestamp;

        emit!(IdentityActivationChanged {
            wallet: wallet_identity.wallet,
            active,
            by_owner: ctx.accounts.owner.key(),
            timestamp,
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

    pub fn remove_own_identity(ctx: Context<RemoveOwnIdentity>) -> Result<()> {
        let wallet = ctx.accounts.wallet_identity.wallet;
        ctx.accounts.irs_state.registered_count = ctx
            .accounts
            .irs_state
            .registered_count
            .checked_sub(1)
            .ok_or_else(|| error!(FracksIrsError::ArithmeticOverflow))?;

        emit!(IdentityRemoved {
            wallet,
            by_agent: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(authority_seed: Pubkey)]
pub struct InitializeIrs<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = IRS_SPACE,
        seeds = [b"irs_state", authority_seed.as_ref()],
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
        seeds = [b"irs_state", irs_state.authority_seed.as_ref()],
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
        seeds = [b"irs_state", irs_state.authority_seed.as_ref()],
        bump = irs_state.bump
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
    /// CHECK: Optional when the IRS owner performs bootstrap actions; otherwise validated.
    pub registry_state: UncheckedAccount<'info>,
    #[account(
        seeds = [b"fid", wallet.as_ref()],
        bump = fid_account.bump,
        seeds::program = fracks_fid::ID
    )]
    pub fid_account: Account<'info, FidAccount>,
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
#[instruction(wallet: Pubkey, metadata_hash: [u8; 32])]
pub struct SubmitOnboardingApplication<'info> {
    #[account(mut)]
    pub applicant: Signer<'info>,
    #[account(
        seeds = [b"irs_state", irs_state.authority_seed.as_ref()],
        bump = irs_state.bump
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
    #[account(
        init_if_needed,
        payer = applicant,
        space = ONBOARDING_APPLICATION_SPACE,
        seeds = [b"onboarding_application", irs_state.key().as_ref(), wallet.as_ref()],
        bump
    )]
    pub application: Account<'info, OnboardingApplication>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReviewOnboardingApplication<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"irs_state", irs_state.authority_seed.as_ref()],
        bump = irs_state.bump
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
    /// CHECK: Optional when the IRS owner performs bootstrap actions; otherwise validated.
    pub registry_state: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"onboarding_application", irs_state.key().as_ref(), application.wallet.as_ref()],
        bump = application.bump,
        constraint = application.irs == irs_state.key() @ FracksIrsError::InvalidApplication
    )]
    pub application: Account<'info, OnboardingApplication>,
}

#[derive(Accounts)]
pub struct CancelOnboardingApplication<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"irs_state", irs_state.authority_seed.as_ref()],
        bump = irs_state.bump
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
    #[account(
        mut,
        close = authority,
        seeds = [b"onboarding_application", irs_state.key().as_ref(), application.wallet.as_ref()],
        bump = application.bump,
        constraint = application.irs == irs_state.key() @ FracksIrsError::InvalidApplication
    )]
    pub application: Account<'info, OnboardingApplication>,
}

#[derive(Accounts)]
pub struct MutateWalletIdentity<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"irs_state", irs_state.authority_seed.as_ref()],
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
pub struct SetIdentityActivation<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"irs_state", irs_state.authority_seed.as_ref()],
        bump = irs_state.bump,
        has_one = owner @ FracksIrsError::NotOwner
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
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
        seeds = [b"irs_state", irs_state.authority_seed.as_ref()],
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

#[derive(Accounts)]
pub struct RemoveOwnIdentity<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"irs_state", irs_state.authority_seed.as_ref()],
        bump = irs_state.bump
    )]
    pub irs_state: Account<'info, IdentityRegistryStorageState>,
    #[account(
        mut,
        close = owner,
        seeds = [b"wallet_identity", irs_state.key().as_ref(), owner.key().as_ref()],
        bump = wallet_identity.bump,
        constraint = wallet_identity.irs == irs_state.key() @ FracksIrsError::WalletNotRegistered,
        constraint = wallet_identity.wallet == owner.key() @ FracksIrsError::WalletNotRegistered
    )]
    pub wallet_identity: Account<'info, WalletIdentity>,
}

#[account]
pub struct IdentityRegistryStorageState {
    pub owner: Pubkey,
    pub authority_seed: Pubkey,
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
    pub is_active: bool,
    pub activated_by: Pubkey,
    pub activated_at: i64,
    pub bump: u8,
}

#[account]
pub struct OnboardingApplication {
    pub wallet: Pubkey,
    pub irs: Pubkey,
    pub applicant: Pubkey,
    pub metadata_hash: [u8; 32],
    pub status: u8,
    pub reviewer: Pubkey,
    pub submitted_at: i64,
    pub reviewed_at: i64,
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
pub struct ApplicationSubmitted {
    pub wallet: Pubkey,
    pub applicant: Pubkey,
    pub irs: Pubkey,
    pub metadata_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct ApplicationReviewed {
    pub wallet: Pubkey,
    pub reviewer: Pubkey,
    pub approved: bool,
    pub timestamp: i64,
}

#[event]
pub struct ApplicationCancelled {
    pub wallet: Pubkey,
    pub applicant: Pubkey,
    pub cancelled_by: Pubkey,
    pub irs: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct IdentityActivationChanged {
    pub wallet: Pubkey,
    pub active: bool,
    pub by_owner: Pubkey,
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
    #[msg("Owner address is invalid.")]
    InvalidOwner = 6001,
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
    #[msg("Onboarding application is already open.")]
    ApplicationAlreadyOpen = 6035,
    #[msg("Onboarding application has not been submitted.")]
    ApplicationNotSubmitted = 6036,
    #[msg("Onboarding application account is invalid.")]
    InvalidApplication = 6037,
    #[msg("FID account is missing or does not match the wallet being registered.")]
    InvalidFidAccount = 6038,
    #[msg("Investor identity registration requires a non-issuer FID account.")]
    InvalidInvestorFid = 6039,
    #[msg("FID country does not match the IRS identity country.")]
    FidCountryMismatch = 6040,
    #[msg("Only the applicant or IRS owner can cancel this onboarding application.")]
    UnauthorizedApplicationCancel = 6041,
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

fn validate_investor_fid(
    fid_account: &Account<FidAccount>,
    wallet: &Pubkey,
    fid: &Pubkey,
    country: u16,
) -> Result<()> {
    require_keys_eq!(fid_account.key(), *fid, FracksIrsError::InvalidFidAccount);
    require_keys_eq!(
        fid_account.owner,
        *wallet,
        FracksIrsError::InvalidFidAccount
    );
    require!(!fid_account.is_issuer, FracksIrsError::InvalidInvestorFid);
    require!(
        fid_account.country == country,
        FracksIrsError::FidCountryMismatch
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
