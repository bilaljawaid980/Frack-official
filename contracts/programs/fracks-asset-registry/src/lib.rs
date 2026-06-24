use anchor_lang::prelude::*;
use fracks_fid::FidAccount;
use fracks_tir::{IssuerEntry, TrustedIssuersState};

declare_id!("3xoAnJ9DqMxj22XfeUYQdwAy6dbKXHHeXxcLBxAY2Pdx");

pub const TOPIC_CUSTODIAN_AUTHORITY: u64 = 4;
pub const TOPIC_VALUATION_AUTHORITY: u64 = 5;
pub const TOPIC_CONSTRUCTION_AUTHORITY: u64 = 6;
pub const TOPIC_SHARIAH_AUTHORITY: u64 = 7;
pub const TOPIC_PROPERTY_MANAGER_AUTHORITY: u64 = 8;

const MAX_FARD_REF_LEN: usize = 64;
const MAX_SPV_REG_LEN: usize = 64;
const ASSET_REGISTRY_SPACE: usize = 8 + 1536;
const SUCCESSION_CLAIM_SPACE: usize = 8 + 384;

#[program]
pub mod fracks_asset_registry {
    use super::*;

    pub fn initialize_asset_registry(
        ctx: Context<InitializeAssetRegistry>,
        args: InitializeAssetRegistryArgs,
    ) -> Result<()> {
        validate_fard_ref(&args.fard_ref)?;
        validate_spv_secp_reg(&args.spv_secp_reg)?;
        require_keys_neq!(args.custodian_fid, args.issuer_fid, FracksAssetRegistryError::CustodianCannotEqualIssuer);
        require_keys_eq!(ctx.accounts.issuer_fid_account.key(), args.issuer_fid, FracksAssetRegistryError::InvalidIssuerFid);
        require_keys_eq!(ctx.accounts.issuer_fid_account.owner, ctx.accounts.issuer.key(), FracksAssetRegistryError::InvalidIssuerFid);

        let registry = &mut ctx.accounts.asset_registry;
        registry.asset_id = args.asset_id;
        registry.token_mint = args.token_mint;
        registry.issuer = ctx.accounts.issuer.key();
        registry.issuer_fid = args.issuer_fid;
        registry.fard_ref = args.fard_ref;
        registry.spv_secp_reg = args.spv_secp_reg;
        registry.province = args.province;
        registry.whitepaper_hash = args.whitepaper_hash;
        registry.legal_opinion_hash = args.legal_opinion_hash;
        registry.custodian_fid = args.custodian_fid;
        registry.custody_attestation_date = 0;
        registry.custody_attestation_expiry = 0;
        registry.valuer_fid = Pubkey::default();
        registry.current_nav = 0;
        registry.nav_date = 0;
        registry.nav_validity_days = args.nav_validity_days;
        registry.lifecycle_state = AssetLifecycleState::PendingCustody as u8;
        registry.title_dispute_flag = false;
        registry.encumbrance_flag = args.encumbrance_flag;
        registry.insurance_policy_hash = args.insurance_policy_hash;
        registry.beneficial_owner_hash = args.beneficial_owner_hash;
        registry.reserve_ratio_bps = 0;
        registry.last_reserve_attestation = 0;
        registry.mandate_status = CustodyMandateStatus::Pending as u8;
        registry.mandate_accepted_at = 0;
        registry.mandate_released_at = 0;
        registry.release_notice_expiry = 0;
        registry.current_milestone_id = 0;
        registry.current_completion_bps = 0;
        registry.escrow_released_total = 0;
        registry.created_at = Clock::get()?.unix_timestamp;
        registry.updated_at = registry.created_at;
        registry.bump = ctx.bumps.asset_registry;

        emit!(AssetRegistryInitialized {
            asset_id: registry.asset_id,
            token_mint: registry.token_mint,
            issuer: registry.issuer,
            issuer_fid: registry.issuer_fid,
            custodian_fid: registry.custodian_fid,
            timestamp: registry.created_at,
        });

        Ok(())
    }

    pub fn attest_custody(
        ctx: Context<CustodyAttestation>,
        document_hash: [u8; 32],
        attestation_hash: [u8; 32],
        validity_seconds: i64,
    ) -> Result<()> {
        validate_positive_validity(validity_seconds)?;
        validate_role_topic(
            &ctx.accounts.tir_state,
            &ctx.accounts.custodian_issuer_entry,
            ctx.accounts.asset_registry.custodian_fid,
            TOPIC_CUSTODIAN_AUTHORITY,
        )?;
        require_keys_eq!(
            ctx.accounts.custodian_fid_account.key(),
            ctx.accounts.asset_registry.custodian_fid,
            FracksAssetRegistryError::InvalidCustodianFid
        );
        require_keys_eq!(
            ctx.accounts.custodian_fid_account.owner,
            ctx.accounts.custodian.key(),
            FracksAssetRegistryError::UnauthorizedCustodian
        );

        let now = Clock::get()?.unix_timestamp;
        let registry = &mut ctx.accounts.asset_registry;
        registry.custody_document_hash = document_hash;
        registry.custody_attestation_hash = attestation_hash;
        registry.custody_attestation_date = now;
        registry.custody_attestation_expiry = now
            .checked_add(validity_seconds)
            .ok_or_else(|| error!(FracksAssetRegistryError::ArithmeticOverflow))?;
        registry.updated_at = now;
        if registry.lifecycle_state == AssetLifecycleState::PendingCustody as u8 {
            registry.lifecycle_state = AssetLifecycleState::Active as u8;
        }

        emit!(CustodyAttested {
            asset_id: registry.asset_id,
            custodian: ctx.accounts.custodian.key(),
            custodian_fid: registry.custodian_fid,
            expires_at: registry.custody_attestation_expiry,
        });

        Ok(())
    }

    pub fn attest_reserve(
        ctx: Context<CustodyAttestation>,
        reserve_ratio_bps: u16,
        attestation_hash: [u8; 32],
        validity_seconds: i64,
    ) -> Result<()> {
        require!(reserve_ratio_bps <= 10_000, FracksAssetRegistryError::InvalidReserveRatio);
        validate_positive_validity(validity_seconds)?;
        validate_role_topic(
            &ctx.accounts.tir_state,
            &ctx.accounts.custodian_issuer_entry,
            ctx.accounts.asset_registry.custodian_fid,
            TOPIC_CUSTODIAN_AUTHORITY,
        )?;
        require_keys_eq!(
            ctx.accounts.custodian_fid_account.owner,
            ctx.accounts.custodian.key(),
            FracksAssetRegistryError::UnauthorizedCustodian
        );

        let now = Clock::get()?.unix_timestamp;
        let registry = &mut ctx.accounts.asset_registry;
        registry.reserve_ratio_bps = reserve_ratio_bps;
        registry.reserve_attestation_hash = attestation_hash;
        registry.last_reserve_attestation = now;
        registry.custody_attestation_expiry = now
            .checked_add(validity_seconds)
            .ok_or_else(|| error!(FracksAssetRegistryError::ArithmeticOverflow))?;
        registry.updated_at = now;

        emit!(ReserveAttested {
            asset_id: registry.asset_id,
            custodian: ctx.accounts.custodian.key(),
            reserve_ratio_bps,
            expires_at: registry.custody_attestation_expiry,
        });

        Ok(())
    }

    pub fn attest_valuation(
        ctx: Context<ValuationAttestation>,
        nav: u64,
        methodology_hash: [u8; 32],
        nav_validity_days: u16,
    ) -> Result<()> {
        require!(nav > 0, FracksAssetRegistryError::InvalidNav);
        require!(nav_validity_days > 0, FracksAssetRegistryError::InvalidNavValidity);
        validate_role_topic(
            &ctx.accounts.tir_state,
            &ctx.accounts.valuer_issuer_entry,
            ctx.accounts.valuer_fid_account.key(),
            TOPIC_VALUATION_AUTHORITY,
        )?;
        require_keys_eq!(
            ctx.accounts.valuer_fid_account.owner,
            ctx.accounts.valuer.key(),
            FracksAssetRegistryError::UnauthorizedValuer
        );

        let now = Clock::get()?.unix_timestamp;
        let registry = &mut ctx.accounts.asset_registry;
        registry.valuer_fid = ctx.accounts.valuer_fid_account.key();
        registry.current_nav = nav;
        registry.nav_date = now;
        registry.nav_validity_days = nav_validity_days;
        registry.valuation_methodology_hash = methodology_hash;
        registry.updated_at = now;

        emit!(ValuationAttested {
            asset_id: registry.asset_id,
            valuer: ctx.accounts.valuer.key(),
            valuer_fid: registry.valuer_fid,
            nav,
            nav_validity_days,
        });

        Ok(())
    }


    pub fn accept_custody_mandate(ctx: Context<CustodyAttestation>) -> Result<()> {
        validate_role_topic(
            &ctx.accounts.tir_state,
            &ctx.accounts.custodian_issuer_entry,
            ctx.accounts.asset_registry.custodian_fid,
            TOPIC_CUSTODIAN_AUTHORITY,
        )?;
        require_keys_eq!(
            ctx.accounts.custodian_fid_account.owner,
            ctx.accounts.custodian.key(),
            FracksAssetRegistryError::UnauthorizedCustodian
        );

        let now = Clock::get()?.unix_timestamp;
        let registry = &mut ctx.accounts.asset_registry;
        registry.mandate_status = CustodyMandateStatus::Accepted as u8;
        registry.mandate_accepted_at = now;
        registry.updated_at = now;

        emit!(CustodyMandateAccepted {
            asset_id: registry.asset_id,
            custodian: ctx.accounts.custodian.key(),
            custodian_fid: registry.custodian_fid,
            accepted_at: now,
        });

        Ok(())
    }

    pub fn release_custody_mandate(
        ctx: Context<ReleaseCustodyMandate>,
        reason_hash: [u8; 32],
        notice_seconds: i64,
    ) -> Result<()> {
        require!(notice_seconds >= 0, FracksAssetRegistryError::InvalidValidityWindow);
        let signer = ctx.accounts.authority.key();
        let is_issuer = signer == ctx.accounts.asset_registry.issuer;
        let is_custodian = ctx.accounts.custodian_fid_account.owner == signer
            && ctx.accounts.custodian_fid_account.key() == ctx.accounts.asset_registry.custodian_fid;
        require!(is_issuer || is_custodian, FracksAssetRegistryError::UnauthorizedAssetAuthority);

        let now = Clock::get()?.unix_timestamp;
        let registry = &mut ctx.accounts.asset_registry;
        registry.release_reason_hash = reason_hash;
        registry.release_notice_expiry = now
            .checked_add(notice_seconds)
            .ok_or_else(|| error!(FracksAssetRegistryError::ArithmeticOverflow))?;
        registry.mandate_released_at = now;
        registry.mandate_status = CustodyMandateStatus::ReleasePending as u8;
        registry.lifecycle_state = AssetLifecycleState::Paused as u8;
        registry.updated_at = now;

        emit!(CustodyMandateReleased {
            asset_id: registry.asset_id,
            authority: signer,
            reason_hash,
            release_notice_expiry: registry.release_notice_expiry,
        });

        Ok(())
    }

    pub fn sign_redemption_event(
        ctx: Context<CustodyAttestation>,
        redemption_id: u64,
        redemption_hash: [u8; 32],
    ) -> Result<()> {
        validate_role_topic(
            &ctx.accounts.tir_state,
            &ctx.accounts.custodian_issuer_entry,
            ctx.accounts.asset_registry.custodian_fid,
            TOPIC_CUSTODIAN_AUTHORITY,
        )?;
        require_keys_eq!(
            ctx.accounts.custodian_fid_account.owner,
            ctx.accounts.custodian.key(),
            FracksAssetRegistryError::UnauthorizedCustodian
        );

        let registry = &mut ctx.accounts.asset_registry;
        registry.last_redemption_event_hash = redemption_hash;
        registry.updated_at = Clock::get()?.unix_timestamp;

        emit!(RedemptionEventSigned {
            asset_id: registry.asset_id,
            redemption_id,
            custodian: ctx.accounts.custodian.key(),
            redemption_hash,
        });

        Ok(())
    }

    pub fn attest_milestone(
        ctx: Context<ConstructionAttestation>,
        milestone_id: u16,
        cert_hash: [u8; 32],
        completion_bps: u16,
        updated_nav: u64,
    ) -> Result<()> {
        require!(milestone_id > 0, FracksAssetRegistryError::InvalidMilestone);
        require!(completion_bps <= 10_000, FracksAssetRegistryError::InvalidCompletionRatio);
        require!(updated_nav > 0, FracksAssetRegistryError::InvalidNav);
        validate_role_topic(
            &ctx.accounts.tir_state,
            &ctx.accounts.certifier_issuer_entry,
            ctx.accounts.certifier_fid_account.key(),
            TOPIC_CONSTRUCTION_AUTHORITY,
        )?;
        require_keys_eq!(
            ctx.accounts.certifier_fid_account.owner,
            ctx.accounts.certifier.key(),
            FracksAssetRegistryError::UnauthorizedCertifier
        );

        let now = Clock::get()?.unix_timestamp;
        let registry = &mut ctx.accounts.asset_registry;
        registry.current_milestone_id = milestone_id;
        registry.current_milestone_hash = cert_hash;
        registry.current_completion_bps = completion_bps;
        registry.current_nav = updated_nav;
        registry.nav_date = now;
        registry.lifecycle_state = if completion_bps >= 10_000 {
            AssetLifecycleState::ConstructionComplete as u8
        } else {
            AssetLifecycleState::UnderConstruction as u8
        };
        registry.updated_at = now;

        emit!(MilestoneAttested {
            asset_id: registry.asset_id,
            milestone_id,
            certifier: ctx.accounts.certifier.key(),
            certifier_fid: ctx.accounts.certifier_fid_account.key(),
            completion_bps,
            updated_nav,
            cert_hash,
        });

        Ok(())
    }

    pub fn release_escrow_tranche(
        ctx: Context<IssuerOrAdminMutateAsset>,
        milestone_id: u16,
        amount: u64,
        developer_wallet: Pubkey,
    ) -> Result<()> {
        require!(amount > 0, FracksAssetRegistryError::InvalidEscrowAmount);
        require!(ctx.accounts.asset_registry.current_milestone_id >= milestone_id, FracksAssetRegistryError::MilestoneNotAttested);
        let registry = &mut ctx.accounts.asset_registry;
        registry.escrow_released_total = registry
            .escrow_released_total
            .checked_add(amount)
            .ok_or_else(|| error!(FracksAssetRegistryError::ArithmeticOverflow))?;
        registry.updated_at = Clock::get()?.unix_timestamp;

        emit!(EscrowTrancheReleased {
            asset_id: registry.asset_id,
            milestone_id,
            amount,
            developer_wallet,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }

    pub fn distribute_apartment_tokens(
        ctx: Context<IssuerOrAdminMutateAsset>,
        child_asset_hash: [u8; 32],
        distribution_hash: [u8; 32],
    ) -> Result<()> {
        let registry = &mut ctx.accounts.asset_registry;
        registry.apartment_distribution_hash = distribution_hash;
        registry.lifecycle_state = AssetLifecycleState::ApartmentDistribution as u8;
        registry.updated_at = Clock::get()?.unix_timestamp;

        emit!(ApartmentTokensDistributed {
            asset_id: registry.asset_id,
            child_asset_hash,
            distribution_hash,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }

    pub fn set_title_flags(
        ctx: Context<IssuerOrAdminMutateAsset>,
        title_dispute_flag: bool,
        encumbrance_flag: bool,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.asset_registry;
        registry.title_dispute_flag = title_dispute_flag;
        registry.encumbrance_flag = encumbrance_flag;
        registry.updated_at = Clock::get()?.unix_timestamp;

        emit!(TitleFlagsUpdated {
            asset_id: registry.asset_id,
            title_dispute_flag,
            encumbrance_flag,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }


    pub fn title_dispute_freeze(
        ctx: Context<IssuerOrAdminMutateAsset>,
        court_order_hash: [u8; 32],
    ) -> Result<()> {
        let registry = &mut ctx.accounts.asset_registry;
        registry.title_dispute_flag = true;
        registry.title_dispute_order_hash = court_order_hash;
        registry.lifecycle_state = AssetLifecycleState::Paused as u8;
        registry.updated_at = Clock::get()?.unix_timestamp;

        emit!(TitleDisputeFrozen {
            asset_id: registry.asset_id,
            court_order_hash,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }

    pub fn lift_dispute_freeze(ctx: Context<IssuerOrAdminMutateAsset>) -> Result<()> {
        let registry = &mut ctx.accounts.asset_registry;
        registry.title_dispute_flag = false;
        registry.updated_at = Clock::get()?.unix_timestamp;

        emit!(TitleDisputeLifted {
            asset_id: registry.asset_id,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }

    pub fn create_succession_claim(
        ctx: Context<CreateSuccessionClaim>,
        deceased_wallet: Pubkey,
        death_cert_hash: [u8; 32],
        wirasat_hash: [u8; 32],
        court_ref_hash: [u8; 32],
    ) -> Result<()> {
        let claim = &mut ctx.accounts.succession_claim;
        claim.deceased_wallet = deceased_wallet;
        claim.claimant = ctx.accounts.claimant.key();
        claim.death_cert_hash = death_cert_hash;
        claim.wirasat_hash = wirasat_hash;
        claim.court_ref_hash = court_ref_hash;
        claim.status = SuccessionStatus::Pending as u8;
        claim.created_at = Clock::get()?.unix_timestamp;
        claim.approved_at = 0;
        claim.executed_at = 0;
        claim.bump = ctx.bumps.succession_claim;

        emit!(SuccessionClaimCreated {
            succession_claim: claim.key(),
            deceased_wallet,
            claimant: claim.claimant,
        });

        Ok(())
    }

    pub fn approve_succession(ctx: Context<ApproveSuccession>, approval_hash: [u8; 32]) -> Result<()> {
        let claim = &mut ctx.accounts.succession_claim;
        require!(claim.status == SuccessionStatus::Pending as u8, FracksAssetRegistryError::InvalidSuccessionStatus);
        claim.status = SuccessionStatus::Approved as u8;
        claim.approver = ctx.accounts.authority.key();
        claim.approval_hash = approval_hash;
        claim.approved_at = Clock::get()?.unix_timestamp;

        emit!(SuccessionApproved {
            succession_claim: claim.key(),
            deceased_wallet: claim.deceased_wallet,
            authority: ctx.accounts.authority.key(),
            approval_hash,
        });

        Ok(())
    }

    pub fn execute_succession_transfer(
        ctx: Context<ApproveSuccession>,
        heirs_hash: [u8; 32],
        transfer_hash: [u8; 32],
    ) -> Result<()> {
        let claim = &mut ctx.accounts.succession_claim;
        require!(claim.status == SuccessionStatus::Approved as u8, FracksAssetRegistryError::InvalidSuccessionStatus);
        claim.status = SuccessionStatus::Executed as u8;
        claim.heirs_hash = heirs_hash;
        claim.transfer_hash = transfer_hash;
        claim.executed_at = Clock::get()?.unix_timestamp;

        emit!(SuccessionExecuted {
            succession_claim: claim.key(),
            deceased_wallet: claim.deceased_wallet,
            authority: ctx.accounts.authority.key(),
            heirs_hash,
            transfer_hash,
        });

        Ok(())
    }

    pub fn transition_lifecycle(
        ctx: Context<IssuerOrAdminMutateAsset>,
        lifecycle_state: AssetLifecycleState,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.asset_registry;
        registry.lifecycle_state = lifecycle_state as u8;
        registry.updated_at = Clock::get()?.unix_timestamp;

        emit!(LifecycleTransitioned {
            asset_id: registry.asset_id,
            lifecycle_state: registry.lifecycle_state,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }

    pub fn declare_total_loss(
        ctx: Context<IssuerOrAdminMutateAsset>,
        insurance_claim_hash: [u8; 32],
    ) -> Result<()> {
        let registry = &mut ctx.accounts.asset_registry;
        registry.insurance_claim_hash = insurance_claim_hash;
        registry.lifecycle_state = AssetLifecycleState::TotalLoss as u8;
        registry.updated_at = Clock::get()?.unix_timestamp;

        emit!(TotalLossDeclared {
            asset_id: registry.asset_id,
            insurance_claim_hash,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeAssetRegistryArgs {
    pub asset_id: u64,
    pub token_mint: Pubkey,
    pub issuer_fid: Pubkey,
    pub custodian_fid: Pubkey,
    pub fard_ref: String,
    pub spv_secp_reg: String,
    pub province: u16,
    pub whitepaper_hash: [u8; 32],
    pub legal_opinion_hash: [u8; 32],
    pub insurance_policy_hash: [u8; 32],
    pub beneficial_owner_hash: [u8; 32],
    pub nav_validity_days: u16,
    pub encumbrance_flag: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AssetLifecycleState {
    PendingCustody = 0,
    Active = 1,
    Paused = 2,
    Matured = 3,
    Redeemed = 4,
    TotalLoss = 5,
    LandOnly = 6,
    DevelopmentInitiated = 7,
    UnderConstruction = 8,
    Milestone1 = 9,
    Milestone2 = 10,
    Milestone3 = 11,
    Milestone4 = 12,
    Milestone5 = 13,
    ConstructionComplete = 14,
    ApartmentDistribution = 15,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CustodyMandateStatus {
    Pending = 0,
    Accepted = 1,
    ReleasePending = 2,
    Released = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SuccessionStatus {
    Pending = 1,
    Approved = 2,
    Executed = 3,
}

#[derive(Accounts)]
#[instruction(args: InitializeAssetRegistryArgs)]
pub struct InitializeAssetRegistry<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(
        init,
        payer = issuer,
        space = ASSET_REGISTRY_SPACE,
        seeds = [b"asset_registry", args.asset_id.to_le_bytes().as_ref()],
        bump
    )]
    pub asset_registry: Account<'info, AssetRegistry>,
    #[account(
        seeds = [b"fid", issuer.key().as_ref()],
        seeds::program = fracks_fid::ID,
        bump = issuer_fid_account.bump,
        constraint = issuer_fid_account.owner == issuer.key() @ FracksAssetRegistryError::InvalidIssuerFid
    )]
    pub issuer_fid_account: Account<'info, FidAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CustodyAttestation<'info> {
    #[account(mut)]
    pub custodian: Signer<'info>,
    #[account(
        mut,
        seeds = [b"asset_registry", &asset_registry.asset_id.to_le_bytes()],
        bump = asset_registry.bump
    )]
    pub asset_registry: Account<'info, AssetRegistry>,
    #[account(
        seeds = [b"fid", custodian.key().as_ref()],
        seeds::program = fracks_fid::ID,
        bump = custodian_fid_account.bump,
        constraint = custodian_fid_account.owner == custodian.key() @ FracksAssetRegistryError::InvalidCustodianFid
    )]
    pub custodian_fid_account: Account<'info, FidAccount>,
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        constraint = custodian_issuer_entry.tir == tir_state.key() @ FracksAssetRegistryError::RoleNotTrusted
    )]
    pub custodian_issuer_entry: Account<'info, IssuerEntry>,
}

#[derive(Accounts)]
pub struct ValuationAttestation<'info> {
    #[account(mut)]
    pub valuer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"asset_registry", &asset_registry.asset_id.to_le_bytes()],
        bump = asset_registry.bump
    )]
    pub asset_registry: Account<'info, AssetRegistry>,
    #[account(
        seeds = [b"fid", valuer.key().as_ref()],
        seeds::program = fracks_fid::ID,
        bump = valuer_fid_account.bump,
        constraint = valuer_fid_account.owner == valuer.key() @ FracksAssetRegistryError::InvalidValuerFid
    )]
    pub valuer_fid_account: Account<'info, FidAccount>,
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        constraint = valuer_issuer_entry.tir == tir_state.key() @ FracksAssetRegistryError::RoleNotTrusted
    )]
    pub valuer_issuer_entry: Account<'info, IssuerEntry>,
}

#[derive(Accounts)]
pub struct ConstructionAttestation<'info> {
    #[account(mut)]
    pub certifier: Signer<'info>,
    #[account(
        mut,
        seeds = [b"asset_registry", &asset_registry.asset_id.to_le_bytes()],
        bump = asset_registry.bump
    )]
    pub asset_registry: Account<'info, AssetRegistry>,
    #[account(
        seeds = [b"fid", certifier.key().as_ref()],
        seeds::program = fracks_fid::ID,
        bump = certifier_fid_account.bump,
        constraint = certifier_fid_account.owner == certifier.key() @ FracksAssetRegistryError::InvalidCertifierFid
    )]
    pub certifier_fid_account: Account<'info, FidAccount>,
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        constraint = certifier_issuer_entry.tir == tir_state.key() @ FracksAssetRegistryError::RoleNotTrusted
    )]
    pub certifier_issuer_entry: Account<'info, IssuerEntry>,
}

#[derive(Accounts)]
pub struct ReleaseCustodyMandate<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"asset_registry", &asset_registry.asset_id.to_le_bytes()],
        bump = asset_registry.bump
    )]
    pub asset_registry: Account<'info, AssetRegistry>,
    pub custodian_fid_account: Account<'info, FidAccount>,
}

#[derive(Accounts)]
#[instruction(deceased_wallet: Pubkey)]
pub struct CreateSuccessionClaim<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,
    #[account(
        init,
        payer = claimant,
        space = SUCCESSION_CLAIM_SPACE,
        seeds = [b"succession", deceased_wallet.as_ref()],
        bump
    )]
    pub succession_claim: Account<'info, SuccessionClaim>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveSuccession<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub succession_claim: Account<'info, SuccessionClaim>,
}

#[derive(Accounts)]
pub struct IssuerOrAdminMutateAsset<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"asset_registry", &asset_registry.asset_id.to_le_bytes()],
        bump = asset_registry.bump,
        constraint = authority.key() == asset_registry.issuer @ FracksAssetRegistryError::UnauthorizedAssetAuthority
    )]
    pub asset_registry: Account<'info, AssetRegistry>,
}

#[account]
pub struct AssetRegistry {
    pub asset_id: u64,
    pub token_mint: Pubkey,
    pub issuer: Pubkey,
    pub issuer_fid: Pubkey,
    pub fard_ref: String,
    pub spv_secp_reg: String,
    pub province: u16,
    pub whitepaper_hash: [u8; 32],
    pub legal_opinion_hash: [u8; 32],
    pub custodian_fid: Pubkey,
    pub custody_document_hash: [u8; 32],
    pub custody_attestation_hash: [u8; 32],
    pub custody_attestation_date: i64,
    pub custody_attestation_expiry: i64,
    pub valuer_fid: Pubkey,
    pub current_nav: u64,
    pub nav_date: i64,
    pub nav_validity_days: u16,
    pub lifecycle_state: u8,
    pub title_dispute_flag: bool,
    pub encumbrance_flag: bool,
    pub insurance_policy_hash: [u8; 32],
    pub beneficial_owner_hash: [u8; 32],
    pub valuation_methodology_hash: [u8; 32],
    pub reserve_attestation_hash: [u8; 32],
    pub reserve_ratio_bps: u16,
    pub last_reserve_attestation: i64,
    pub insurance_claim_hash: [u8; 32],
    pub mandate_status: u8,
    pub mandate_accepted_at: i64,
    pub mandate_released_at: i64,
    pub release_notice_expiry: i64,
    pub release_reason_hash: [u8; 32],
    pub current_milestone_id: u16,
    pub current_milestone_hash: [u8; 32],
    pub current_completion_bps: u16,
    pub escrow_released_total: u64,
    pub apartment_distribution_hash: [u8; 32],
    pub title_dispute_order_hash: [u8; 32],
    pub last_redemption_event_hash: [u8; 32],
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[account]
pub struct SuccessionClaim {
    pub deceased_wallet: Pubkey,
    pub claimant: Pubkey,
    pub approver: Pubkey,
    pub death_cert_hash: [u8; 32],
    pub wirasat_hash: [u8; 32],
    pub court_ref_hash: [u8; 32],
    pub approval_hash: [u8; 32],
    pub heirs_hash: [u8; 32],
    pub transfer_hash: [u8; 32],
    pub status: u8,
    pub created_at: i64,
    pub approved_at: i64,
    pub executed_at: i64,
    pub bump: u8,
}

#[event]
pub struct AssetRegistryInitialized {
    pub asset_id: u64,
    pub token_mint: Pubkey,
    pub issuer: Pubkey,
    pub issuer_fid: Pubkey,
    pub custodian_fid: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct CustodyAttested {
    pub asset_id: u64,
    pub custodian: Pubkey,
    pub custodian_fid: Pubkey,
    pub expires_at: i64,
}

#[event]
pub struct ReserveAttested {
    pub asset_id: u64,
    pub custodian: Pubkey,
    pub reserve_ratio_bps: u16,
    pub expires_at: i64,
}

#[event]
pub struct ValuationAttested {
    pub asset_id: u64,
    pub valuer: Pubkey,
    pub valuer_fid: Pubkey,
    pub nav: u64,
    pub nav_validity_days: u16,
}

#[event]
pub struct TitleFlagsUpdated {
    pub asset_id: u64,
    pub title_dispute_flag: bool,
    pub encumbrance_flag: bool,
    pub authority: Pubkey,
}

#[event]
pub struct LifecycleTransitioned {
    pub asset_id: u64,
    pub lifecycle_state: u8,
    pub authority: Pubkey,
}

#[event]
pub struct TotalLossDeclared {
    pub asset_id: u64,
    pub insurance_claim_hash: [u8; 32],
    pub authority: Pubkey,
}

#[event]
pub struct CustodyMandateAccepted {
    pub asset_id: u64,
    pub custodian: Pubkey,
    pub custodian_fid: Pubkey,
    pub accepted_at: i64,
}

#[event]
pub struct CustodyMandateReleased {
    pub asset_id: u64,
    pub authority: Pubkey,
    pub reason_hash: [u8; 32],
    pub release_notice_expiry: i64,
}

#[event]
pub struct RedemptionEventSigned {
    pub asset_id: u64,
    pub redemption_id: u64,
    pub custodian: Pubkey,
    pub redemption_hash: [u8; 32],
}

#[event]
pub struct MilestoneAttested {
    pub asset_id: u64,
    pub milestone_id: u16,
    pub certifier: Pubkey,
    pub certifier_fid: Pubkey,
    pub completion_bps: u16,
    pub updated_nav: u64,
    pub cert_hash: [u8; 32],
}

#[event]
pub struct EscrowTrancheReleased {
    pub asset_id: u64,
    pub milestone_id: u16,
    pub amount: u64,
    pub developer_wallet: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct ApartmentTokensDistributed {
    pub asset_id: u64,
    pub child_asset_hash: [u8; 32],
    pub distribution_hash: [u8; 32],
    pub authority: Pubkey,
}

#[event]
pub struct TitleDisputeFrozen {
    pub asset_id: u64,
    pub court_order_hash: [u8; 32],
    pub authority: Pubkey,
}

#[event]
pub struct TitleDisputeLifted {
    pub asset_id: u64,
    pub authority: Pubkey,
}

#[event]
pub struct SuccessionClaimCreated {
    pub succession_claim: Pubkey,
    pub deceased_wallet: Pubkey,
    pub claimant: Pubkey,
}

#[event]
pub struct SuccessionApproved {
    pub succession_claim: Pubkey,
    pub deceased_wallet: Pubkey,
    pub authority: Pubkey,
    pub approval_hash: [u8; 32],
}

#[event]
pub struct SuccessionExecuted {
    pub succession_claim: Pubkey,
    pub deceased_wallet: Pubkey,
    pub authority: Pubkey,
    pub heirs_hash: [u8; 32],
    pub transfer_hash: [u8; 32],
}

fn validate_fard_ref(value: &str) -> Result<()> {
    require!(value.as_bytes().len() <= MAX_FARD_REF_LEN, FracksAssetRegistryError::FardRefTooLong);
    Ok(())
}

fn validate_spv_secp_reg(value: &str) -> Result<()> {
    require!(value.as_bytes().len() <= MAX_SPV_REG_LEN, FracksAssetRegistryError::SpvRegTooLong);
    Ok(())
}

fn validate_positive_validity(validity_seconds: i64) -> Result<()> {
    require!(validity_seconds > 0, FracksAssetRegistryError::InvalidValidityWindow);
    Ok(())
}

fn validate_role_topic(
    tir_state: &Account<TrustedIssuersState>,
    issuer_entry: &Account<IssuerEntry>,
    expected_fid: Pubkey,
    topic: u64,
) -> Result<()> {
    require_keys_eq!(issuer_entry.tir, tir_state.key(), FracksAssetRegistryError::RoleNotTrusted);
    require_keys_eq!(issuer_entry.issuer_fid, expected_fid, FracksAssetRegistryError::RoleNotTrusted);
    require!(issuer_entry.is_active, FracksAssetRegistryError::RoleNotTrusted);
    require!(
        issuer_entry.allowed_topics.contains(&topic),
        FracksAssetRegistryError::RoleTopicMissing
    );
    Ok(())
}

#[error_code(offset = 7000)]
pub enum FracksAssetRegistryError {
    #[msg("Fard reference is too long.")]
    FardRefTooLong,
    #[msg("SPV SECP registration reference is too long.")]
    SpvRegTooLong,
    #[msg("Issuer FID is invalid.")]
    InvalidIssuerFid,
    #[msg("Custodian FID is invalid.")]
    InvalidCustodianFid,
    #[msg("Valuer FID is invalid.")]
    InvalidValuerFid,
    #[msg("Custodian cannot be the same FID as issuer.")]
    CustodianCannotEqualIssuer,
    #[msg("Custodian signer is not authorized.")]
    UnauthorizedCustodian,
    #[msg("Valuer signer is not authorized.")]
    UnauthorizedValuer,
    #[msg("Role FID is not trusted in TIR.")]
    RoleNotTrusted,
    #[msg("Role FID is missing the required claim topic.")]
    RoleTopicMissing,
    #[msg("Validity window is invalid.")]
    InvalidValidityWindow,
    #[msg("Reserve ratio is invalid.")]
    InvalidReserveRatio,
    #[msg("NAV must be greater than zero.")]
    InvalidNav,
    #[msg("NAV validity days must be greater than zero.")]
    InvalidNavValidity,
    #[msg("Only the asset issuer can mutate this asset.")]
    UnauthorizedAssetAuthority,
    #[msg("Certifier FID is invalid.")]
    InvalidCertifierFid,
    #[msg("Certifier signer is not authorized.")]
    UnauthorizedCertifier,
    #[msg("Milestone is invalid.")]
    InvalidMilestone,
    #[msg("Completion ratio is invalid.")]
    InvalidCompletionRatio,
    #[msg("Escrow amount is invalid.")]
    InvalidEscrowAmount,
    #[msg("Milestone has not been attested yet.")]
    MilestoneNotAttested,
    #[msg("Succession claim is not in the required status.")]
    InvalidSuccessionStatus,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow,
}
