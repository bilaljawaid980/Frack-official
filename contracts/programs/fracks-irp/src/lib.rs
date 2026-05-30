use anchor_lang::prelude::*;

pub mod utils;

use utils::{
    deserialize_view, ensure_bound_registry, find_wallet_identity, verify_claim_for_topic,
};

declare_id!("HQqgbvfmSzY1yEyhVbyhYqSsbVrRmjUnPmm2nE4ZwRvZ");

const MAX_IDENTITY_AGENTS: usize = 10;
const IRP_SPACE: usize = 8 + 32 + 32 + 32 + 32 + 32 + 4 + (32 * MAX_IDENTITY_AGENTS) + 8 + 1;

#[program]
pub mod fracks_irp {
    use super::*;

    pub fn initialize_registry(
        ctx: Context<InitializeRegistry>,
        token_mint: Pubkey,
        irs: Pubkey,
        tir: Pubkey,
        ctr: Pubkey,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.registry_state;
        registry.token_mint = token_mint;
        registry.owner = ctx.accounts.owner.key();
        registry.irs_account = irs;
        registry.tir_account = tir;
        registry.ctr_account = ctr;
        registry.identity_agents = Vec::new();
        registry.registered_count = 0;
        registry.bump = ctx.bumps.registry_state;
        Ok(())
    }

    pub fn add_identity_agent(ctx: Context<UpdateRegistryOwner>, agent: Pubkey) -> Result<()> {
        let registry = &mut ctx.accounts.registry_state;
        require!(
            !registry.identity_agents.contains(&agent),
            FracksIrpError::IdentityAgentAlreadyExists
        );
        require!(
            registry.identity_agents.len() < MAX_IDENTITY_AGENTS,
            FracksIrpError::MaxIdentityAgentsReached
        );
        registry.identity_agents.push(agent);
        Ok(())
    }

    pub fn remove_identity_agent(ctx: Context<UpdateRegistryOwner>, agent: Pubkey) -> Result<()> {
        let registry = &mut ctx.accounts.registry_state;
        let index = registry
            .identity_agents
            .iter()
            .position(|entry| *entry == agent)
            .ok_or_else(|| error!(FracksIrpError::NotIdentityAgent))?;
        registry.identity_agents.remove(index);
        Ok(())
    }

    pub fn update_irs_reference(
        ctx: Context<UpdateRegistryOwner>,
        new_irs: Pubkey,
    ) -> Result<()> {
        ctx.accounts.registry_state.irs_account = new_irs;
        Ok(())
    }

    pub fn update_tir_reference(
        ctx: Context<UpdateRegistryOwner>,
        new_tir: Pubkey,
    ) -> Result<()> {
        ctx.accounts.registry_state.tir_account = new_tir;
        Ok(())
    }

    pub fn update_ctr_reference(
        ctx: Context<UpdateRegistryOwner>,
        new_ctr: Pubkey,
    ) -> Result<()> {
        ctx.accounts.registry_state.ctr_account = new_ctr;
        Ok(())
    }

    pub fn transfer_registry_ownership(
        ctx: Context<UpdateRegistryOwner>,
        new_owner: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(new_owner, Pubkey::default(), FracksIrpError::InvalidOwner);
        ctx.accounts.registry_state.owner = new_owner;
        Ok(())
    }

    pub fn is_verified(ctx: Context<IsVerified>, wallet: Pubkey) -> Result<bool> {
        Ok(evaluate_verification(ctx, wallet)?.verified)
    }

    pub fn verification_status(
        ctx: Context<IsVerified>,
        wallet: Pubkey,
    ) -> Result<VerificationStatus> {
        evaluate_verification(ctx, wallet)
    }
}

fn evaluate_verification(ctx: Context<IsVerified>, wallet: Pubkey) -> Result<VerificationStatus> {
        let registry = &ctx.accounts.registry_state;
        let irs_state = deserialize_view::<IdentityRegistryStorageStateView>(&ctx.accounts.irs_state)?;
        let tir_state = deserialize_view::<TrustedIssuersStateView>(&ctx.accounts.tir_state)?;
        let ctr_state = deserialize_view::<ClaimTopicsStateView>(&ctx.accounts.ctr_state)?;

        require_keys_eq!(
            ctx.accounts.irs_state.key(),
            registry.irs_account,
            FracksIrpError::InvalidRegistryReference
        );
        require_keys_eq!(
            ctx.accounts.tir_state.key(),
            registry.tir_account,
            FracksIrpError::InvalidRegistryReference
        );
        require_keys_eq!(
            ctx.accounts.ctr_state.key(),
            registry.ctr_account,
            FracksIrpError::InvalidRegistryReference
        );
        require_keys_eq!(
            irs_state.owner,
            registry.owner,
            FracksIrpError::InvalidRegistryReference
        );
        require_keys_eq!(
            tir_state.token_mint,
            registry.token_mint,
            FracksIrpError::InvalidRegistryReference
        );
        require_keys_eq!(
            ctr_state.token_mint,
            registry.token_mint,
            FracksIrpError::InvalidRegistryReference
        );
        ensure_bound_registry(&irs_state, &registry.key())?;

        let wallet_identity = match find_wallet_identity(
            &wallet,
            &ctx.accounts.irs_state.key(),
            &ctx.accounts.wallet_identity,
        )? {
            Some(identity) if identity.wallet == wallet && identity.irs == ctx.accounts.irs_state.key() => {
                identity
            }
            _ => {
                return Ok(VerificationStatus {
                    verified: false,
                    reason: VerificationReason::MissingIdentity,
                    missing_topic: 0,
                })
            }
        };

        if !wallet_identity.is_active {
            return Ok(VerificationStatus {
                verified: false,
                reason: VerificationReason::IdentityInactive,
                missing_topic: 0,
            });
        }

        if ctr_state.topics.is_empty() {
            return Ok(VerificationStatus {
                verified: true,
                reason: VerificationReason::Verified,
                missing_topic: 0,
            });
        }

        let now = Clock::get()?.unix_timestamp;
        for topic in ctr_state.topics {
            let found_valid = verify_claim_for_topic(
                wallet_identity.fid,
                topic,
                &ctx.accounts.tir_state.key(),
                ctx.remaining_accounts,
                now,
            )?;
            if !found_valid {
                return Ok(VerificationStatus {
                    verified: false,
                    reason: VerificationReason::MissingRequiredClaim,
                    missing_topic: topic,
                });
            }
        }

        Ok(VerificationStatus {
            verified: true,
            reason: VerificationReason::Verified,
            missing_topic: 0,
        })
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, irs: Pubkey, tir: Pubkey, ctr: Pubkey)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = IRP_SPACE,
        seeds = [b"irp_state", token_mint.as_ref()],
        bump
    )]
    pub registry_state: Account<'info, IdentityRegistryState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRegistryOwner<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"irp_state", registry_state.token_mint.as_ref()],
        bump = registry_state.bump,
        has_one = owner @ FracksIrpError::NotOwner
    )]
    pub registry_state: Account<'info, IdentityRegistryState>,
}

#[derive(Accounts)]
pub struct IsVerified<'info> {
    #[account(
        seeds = [b"irp_state", registry_state.token_mint.as_ref()],
        bump = registry_state.bump
    )]
    pub registry_state: Account<'info, IdentityRegistryState>,
    /// CHECK: Verified in instruction.
    pub irs_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction.
    pub tir_state: UncheckedAccount<'info>,
    /// CHECK: Verified in instruction.
    pub ctr_state: UncheckedAccount<'info>,
    /// CHECK: Optional and verified in instruction.
    pub wallet_identity: UncheckedAccount<'info>,
}

#[account]
pub struct IdentityRegistryState {
    pub token_mint: Pubkey,
    pub owner: Pubkey,
    pub irs_account: Pubkey,
    pub tir_account: Pubkey,
    pub ctr_account: Pubkey,
    pub identity_agents: Vec<Pubkey>,
    pub registered_count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct IdentityRegistryStorageStateView {
    pub owner: Pubkey,
    pub authority_seed: Pubkey,
    pub bound_registries: Vec<Pubkey>,
    pub registered_count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct WalletIdentityView {
    pub wallet: Pubkey,
    pub fid: Pubkey,
    pub country: u16,
    pub irs: Pubkey,
    pub is_active: bool,
    pub activated_by: Pubkey,
    pub activated_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum VerificationReason {
    Verified,
    MissingIdentity,
    IdentityInactive,
    MissingRequiredClaim,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VerificationStatus {
    pub verified: bool,
    pub reason: VerificationReason,
    pub missing_topic: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct TrustedIssuersStateView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub issuer_count: u32,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct ClaimTopicsStateView {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub topics: Vec<u64>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FidAccountView {
    pub owner: Pubkey,
    pub management_key: Pubkey,
    pub signer_key: Pubkey,
    pub claim_count: u32,
    pub is_issuer: bool,
    pub country: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClaimAccountView {
    pub fid: Pubkey,
    pub claim_id: u32,
    pub topic: u64,
    pub issuer_fid: Pubkey,
    pub data_hash: [u8; 32],
    pub signer_key: Pubkey,
    pub signature: [u8; 64],
    pub issued_at: i64,
    pub expires_at: i64,
    pub revoked: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct IssuerEntryView {
    pub issuer_fid: Pubkey,
    pub tir: Pubkey,
    pub allowed_topics: Vec<u64>,
    pub is_active: bool,
    pub label: String,
    pub bump: u8,
}

#[error_code(offset = 0)]
pub enum FracksIrpError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Owner address is invalid.")]
    InvalidOwner = 6001,
    #[msg("Caller does not have Identity Agent permission.")]
    NotIdentityAgent = 6008,
    #[msg("Registry reference is invalid.")]
    InvalidRegistryReference = 6013,
    #[msg("Identity agent already exists.")]
    IdentityAgentAlreadyExists = 6042,
    #[msg("Maximum identity agents reached.")]
    MaxIdentityAgentsReached = 6043,
    #[msg("Trusted issuer entry not found.")]
    TrustedIssuerNotFound = 6044,
    #[msg("Issuer FID account not found.")]
    IssuerFidNotFound = 6045,
    #[msg("Claim signature is invalid.")]
    InvalidClaimSignature = 6046,
}
