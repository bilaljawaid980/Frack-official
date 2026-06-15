use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_2022::spl_token_2022::extension::metadata_pointer::instruction as metadata_pointer_instruction;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_2022_extensions::permanent_delegate::{
    permanent_delegate_initialize, PermanentDelegateInitialize,
};
use anchor_spl::token_2022_extensions::transfer_hook::{
    transfer_hook_initialize, TransferHookInitialize,
};

use fracks_compliance::cpi::accounts::{
    InitializeCompliance, UpdateComplianceOwner as ComplianceOwnerAccounts,
};
use fracks_compliance::program::FracksCompliance;
use fracks_ctr::cpi::accounts::{InitializeCtr, MutateCtr as CtrOwnerAccounts};
use fracks_ctr::program::FracksCtr;
use fracks_fid::FidAccount;
use fracks_irp::cpi::accounts::{InitializeRegistry, UpdateRegistryOwner};
use fracks_irp::program::FracksIrp;
use fracks_irs::cpi::accounts::{InitializeIrs, UpdateIrsOwnerState as IrsOwnerAccounts};
use fracks_irs::program::FracksIrs;
use fracks_tir::cpi::accounts::{AddTrustedIssuer, InitializeTir, TransferTirOwnership};
use fracks_tir::program::FracksTir;
use fracks_token::cpi::accounts::{InitializeMintMetadata, InitializeToken, UpdateOwnerState};
use fracks_token::program::FracksToken;
use fracks_token_hook::cpi::accounts::InitializeExtraAccountMetas;
use fracks_token_hook::program::FracksTokenHook;

declare_id!("FtrzQ1hhjL7vbEPAxLBeLgrmomanSVj9UpV6LLJ5TYFS");

const MAX_CLAIM_TOPICS: usize = 20;
const MAX_TRUSTED_ISSUERS: usize = 16;
const MAX_COMPLIANCE_MODULES: usize = 15;
const TOPIC_CUSTODIAN_AUTHORITY: u64 = 4;
const MAX_ATTESTATION_VALIDITY_SECONDS: i64 = 365 * 24 * 60 * 60;
const FACTORY_STATE_SPACE: usize = 8 + (32 * 8) + 8 + 1;
const TOKEN_DEPLOYMENT_SPACE: usize = 8 + 8 + 8 + 32 + (32 * 11) + 8 + 1;
const PLATFORM_AUTHORITY_SPACE: usize = 8 + 32 + 8 + 1 + 8 + 1;
const CUSTODY_MANDATE_SPACE: usize = 8 + 8 + (32 * 4) + 2 + (8 * 4) + 1;
const CUSTODY_ATTESTATION_SPACE: usize = 8 + 8 + (32 * 6) + 2 + (8 * 2) + 1 + 1;
const REDEMPTION_SIGNATURE_SPACE: usize = 8 + 8 + 8 + 32 + 32 + 32 + 8 + 1;
const MAX_METADATA_SPACE: usize = 512;
const TOKEN_2022_MINT_EXTENSIONS: [spl_token_2022::extension::ExtensionType; 3] = [
    spl_token_2022::extension::ExtensionType::TransferHook,
    spl_token_2022::extension::ExtensionType::PermanentDelegate,
    spl_token_2022::extension::ExtensionType::MetadataPointer,
];

#[program]
pub mod fracks_factory {
    use super::*;

    pub fn initialize_factory(ctx: Context<InitializeFactory>) -> Result<()> {
        let state = &mut ctx.accounts.factory_state;
        state.owner = ctx.accounts.owner.key();
        state.token_program_id = ctx.accounts.token_program.key();
        state.fid_program_id = fracks_fid::id();
        state.irp_program_id = ctx.accounts.irp_program.key();
        state.irs_program_id = ctx.accounts.irs_program.key();
        state.tir_program_id = ctx.accounts.tir_program.key();
        state.ctr_program_id = ctx.accounts.ctr_program.key();
        state.compliance_program_id = ctx.accounts.compliance_program.key();
        state.deployment_count = 0;
        state.bump = ctx.bumps.factory_state;
        Ok(())
    }

    pub fn update_program_ids(
        ctx: Context<UpdateFactoryState>,
        program_ids: ProgramIds,
    ) -> Result<()> {
        let state = &mut ctx.accounts.factory_state;
        state.token_program_id = program_ids.token_program_id;
        state.fid_program_id = program_ids.fid_program_id;
        state.irp_program_id = program_ids.irp_program_id;
        state.irs_program_id = program_ids.irs_program_id;
        state.tir_program_id = program_ids.tir_program_id;
        state.ctr_program_id = program_ids.ctr_program_id;
        state.compliance_program_id = program_ids.compliance_program_id;
        Ok(())
    }

    pub fn transfer_factory_ownership(
        ctx: Context<UpdateFactoryState>,
        new_owner: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            new_owner,
            Pubkey::default(),
            FracksFactoryError::InvalidOwner
        );
        ctx.accounts.factory_state.owner = new_owner;
        Ok(())
    }

    pub fn create_token_mint(ctx: Context<CreateTokenMint>, decimals: u8) -> Result<()> {
        initialize_token_2022_mint(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.token_mint_account.to_account_info(),
            ctx.accounts.token_state.key(),
            ctx.accounts.hook_program.key(),
            ctx.accounts.token_2022_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            decimals,
        )
    }

    pub fn approve_platform_authority(
        ctx: Context<ApprovePlatformAuthority>,
        authority_fid: Pubkey,
        topic: u64,
    ) -> Result<()> {
        let role = &mut ctx.accounts.platform_authority;
        role.authority_fid = authority_fid;
        role.topic = topic;
        role.active = true;
        role.created_at = Clock::get()?.unix_timestamp;
        role.bump = ctx.bumps.platform_authority;

        emit!(PlatformAuthorityApproved {
            authority_fid,
            topic,
            admin: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    pub fn revoke_platform_authority(
        ctx: Context<RevokePlatformAuthority>,
        authority_fid: Pubkey,
        topic: u64,
    ) -> Result<()> {
        let role = &mut ctx.accounts.platform_authority;
        require_keys_eq!(
            role.authority_fid,
            authority_fid,
            FracksFactoryError::PlatformAuthorityMissing
        );
        require!(
            role.topic == topic,
            FracksFactoryError::PlatformAuthorityMissing
        );
        role.active = false;

        emit!(PlatformAuthorityRevoked {
            authority_fid,
            topic,
            admin: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    pub fn create_custody_mandate(
        ctx: Context<CreateCustodyMandate>,
        asset_id: u64,
        issuer_fid: Pubkey,
        custodian: Pubkey,
        custodian_fid: Pubkey,
    ) -> Result<()> {
        require_keys_neq!(
            custodian,
            Pubkey::default(),
            FracksFactoryError::InvalidCustodian
        );
        require_keys_neq!(
            issuer_fid,
            custodian_fid,
            FracksFactoryError::CustodianCannotEqualIssuer
        );
        require!(
            ctx.accounts.authority.key() == ctx.accounts.issuer.key()
                || ctx.accounts.authority.key() == ctx.accounts.factory_state.owner,
            FracksFactoryError::UnauthorizedCustodyMandate
        );
        require_keys_eq!(
            ctx.accounts.issuer_fid_account.key(),
            issuer_fid,
            FracksFactoryError::InvalidIssuerFid
        );
        require_keys_eq!(
            ctx.accounts.issuer_fid_account.owner,
            ctx.accounts.issuer.key(),
            FracksFactoryError::InvalidIssuerFid
        );
        require_keys_eq!(
            ctx.accounts.custodian_fid_account.key(),
            custodian_fid,
            FracksFactoryError::InvalidCustodianFid
        );
        require_keys_eq!(
            ctx.accounts.custodian_fid_account.owner,
            custodian,
            FracksFactoryError::InvalidCustodianFid
        );
        require!(
            ctx.accounts.custodian_authority.active
                && ctx.accounts.custodian_authority.topic == TOPIC_CUSTODIAN_AUTHORITY
                && ctx.accounts.custodian_authority.authority_fid == custodian_fid,
            FracksFactoryError::PlatformAuthorityMissing
        );

        let mandate = &mut ctx.accounts.custody_mandate;
        mandate.asset_id = asset_id;
        mandate.issuer = ctx.accounts.issuer.key();
        mandate.issuer_fid = issuer_fid;
        mandate.custodian = custodian;
        mandate.custodian_fid = custodian_fid;
        mandate.active = false;
        mandate.accepted = false;
        mandate.created_at = Clock::get()?.unix_timestamp;
        mandate.accepted_at = 0;
        mandate.released_at = 0;
        mandate.release_notice_at = 0;
        mandate.bump = ctx.bumps.custody_mandate;

        emit!(CustodyMandateCreated {
            asset_id,
            issuer: mandate.issuer,
            issuer_fid,
            custodian,
            custodian_fid,
            timestamp: mandate.created_at,
        });

        Ok(())
    }

    pub fn accept_custody_mandate(ctx: Context<AcceptCustodyMandate>) -> Result<()> {
        let mandate = &mut ctx.accounts.custody_mandate;
        require_keys_eq!(
            ctx.accounts.custodian.key(),
            mandate.custodian,
            FracksFactoryError::UnauthorizedCustodian
        );
        require_keys_eq!(
            ctx.accounts.custodian_fid_account.key(),
            mandate.custodian_fid,
            FracksFactoryError::InvalidCustodianFid
        );
        require_keys_eq!(
            ctx.accounts.custodian_fid_account.owner,
            mandate.custodian,
            FracksFactoryError::InvalidCustodianFid
        );

        mandate.accepted = true;
        mandate.active = true;
        mandate.accepted_at = Clock::get()?.unix_timestamp;
        mandate.released_at = 0;
        mandate.release_notice_at = 0;

        emit!(CustodyMandateAccepted {
            asset_id: mandate.asset_id,
            custodian: mandate.custodian,
            custodian_fid: mandate.custodian_fid,
            timestamp: mandate.accepted_at,
        });

        Ok(())
    }

    pub fn attest_custody(
        ctx: Context<AttestCustody>,
        document_hash: [u8; 32],
        attestation_hash: [u8; 32],
        validity_seconds: i64,
    ) -> Result<()> {
        validate_attestation_authority(&ctx.accounts.custodian, &ctx.accounts.custody_mandate)?;
        validate_attestation_validity(validity_seconds)?;

        let now = Clock::get()?.unix_timestamp;
        let attestation = &mut ctx.accounts.custody_attestation;
        attestation.asset_id = ctx.accounts.custody_mandate.asset_id;
        attestation.custody_mandate = ctx.accounts.custody_mandate.key();
        attestation.custodian = ctx.accounts.custody_mandate.custodian;
        attestation.custodian_fid = ctx.accounts.custody_mandate.custodian_fid;
        attestation.document_hash = document_hash;
        attestation.attestation_hash = attestation_hash;
        attestation.reserve_ratio_bps = 0;
        attestation.attested_at = now;
        attestation.expires_at = now
            .checked_add(validity_seconds)
            .ok_or_else(|| error!(FracksFactoryError::ArithmeticOverflow))?;
        attestation.active = true;
        attestation.bump = ctx.bumps.custody_attestation;

        emit!(CustodyAttested {
            asset_id: attestation.asset_id,
            custody_mandate: attestation.custody_mandate,
            custodian: attestation.custodian,
            expires_at: attestation.expires_at,
            timestamp: now,
        });

        Ok(())
    }

    pub fn attest_reserve(
        ctx: Context<AttestReserve>,
        reserve_ratio_bps: u16,
        attestation_hash: [u8; 32],
        validity_seconds: i64,
    ) -> Result<()> {
        validate_attestation_authority(&ctx.accounts.custodian, &ctx.accounts.custody_mandate)?;
        validate_attestation_validity(validity_seconds)?;
        require!(
            reserve_ratio_bps <= 10_000,
            FracksFactoryError::InvalidReserveRatio
        );

        let now = Clock::get()?.unix_timestamp;
        let attestation = &mut ctx.accounts.custody_attestation;
        require!(
            attestation.active && attestation.custody_mandate == ctx.accounts.custody_mandate.key(),
            FracksFactoryError::CustodyAttestationMissing
        );
        attestation.reserve_ratio_bps = reserve_ratio_bps;
        attestation.attestation_hash = attestation_hash;
        attestation.attested_at = now;
        attestation.expires_at = now
            .checked_add(validity_seconds)
            .ok_or_else(|| error!(FracksFactoryError::ArithmeticOverflow))?;

        emit!(ReserveAttested {
            asset_id: attestation.asset_id,
            custody_mandate: attestation.custody_mandate,
            custodian: attestation.custodian,
            reserve_ratio_bps,
            expires_at: attestation.expires_at,
            timestamp: now,
        });

        Ok(())
    }

    pub fn release_custody_mandate(
        ctx: Context<ReleaseCustodyMandate>,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let mandate = &mut ctx.accounts.custody_mandate;
        require!(
            authority == mandate.custodian || authority == ctx.accounts.factory_state.owner,
            FracksFactoryError::UnauthorizedCustodyRelease
        );
        mandate.active = false;
        mandate.released_at = Clock::get()?.unix_timestamp;

        emit!(CustodyMandateReleased {
            asset_id: mandate.asset_id,
            custody_mandate: mandate.key(),
            released_by: authority,
            reason_hash,
            timestamp: mandate.released_at,
        });

        Ok(())
    }

    pub fn sign_redemption_event(
        ctx: Context<SignRedemptionEvent>,
        redemption_id: u64,
        attestation_hash: [u8; 32],
    ) -> Result<()> {
        validate_attestation_authority(&ctx.accounts.custodian, &ctx.accounts.custody_mandate)?;
        let signature = &mut ctx.accounts.redemption_signature;
        signature.asset_id = ctx.accounts.custody_mandate.asset_id;
        signature.redemption_id = redemption_id;
        signature.custody_mandate = ctx.accounts.custody_mandate.key();
        signature.custodian = ctx.accounts.custody_mandate.custodian;
        signature.attestation_hash = attestation_hash;
        signature.signed_at = Clock::get()?.unix_timestamp;
        signature.bump = ctx.bumps.redemption_signature;

        emit!(RedemptionEventSigned {
            asset_id: signature.asset_id,
            redemption_id,
            custodian: signature.custodian,
            timestamp: signature.signed_at,
        });

        Ok(())
    }

    pub fn deploy_token_suite<'info>(
        ctx: Context<'_, '_, '_, 'info, DeployTokenSuite<'info>>,
        args: DeployTokenSuiteArgs,
    ) -> Result<()> {
        validate_args(&args)?;
        verify_program_ids(&ctx.accounts.factory_state, &ctx.accounts)?;
        validate_custody_gate(
            &ctx.accounts.custody_mandate,
            &ctx.accounts.custody_attestation,
            args.asset_id,
        )?;

        let expected_token_state = Pubkey::find_program_address(
            &[b"token_state", args.token_mint.as_ref()],
            &ctx.accounts.token_program.key(),
        )
        .0;
        let expected_owner_state = Pubkey::find_program_address(
            &[b"owner", args.token_mint.as_ref()],
            &ctx.accounts.token_program.key(),
        )
        .0;
        let expected_tir_state = Pubkey::find_program_address(
            &[b"tir_state", args.token_mint.as_ref()],
            &ctx.accounts.tir_program.key(),
        )
        .0;
        let expected_ctr_state = Pubkey::find_program_address(
            &[b"ctr_state", args.token_mint.as_ref()],
            &ctx.accounts.ctr_program.key(),
        )
        .0;
        let expected_irp_state = Pubkey::find_program_address(
            &[b"irp_state", args.token_mint.as_ref()],
            &ctx.accounts.irp_program.key(),
        )
        .0;
        let expected_compliance_state = Pubkey::find_program_address(
            &[b"compliance_state", args.token_mint.as_ref()],
            &ctx.accounts.compliance_program.key(),
        )
        .0;
        let expected_irs_state = args.shared_irs.unwrap_or_else(|| {
            Pubkey::find_program_address(
                &[b"irs_state", args.token_mint.as_ref()],
                &ctx.accounts.irs_program.key(),
            )
            .0
        });

        require_keys_eq!(
            ctx.accounts.token_state.key(),
            expected_token_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.owner_state.key(),
            expected_owner_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.tir_state.key(),
            expected_tir_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.ctr_state.key(),
            expected_ctr_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.irp_state.key(),
            expected_irp_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.compliance_state.key(),
            expected_compliance_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.irs_state.key(),
            expected_irs_state,
            FracksFactoryError::InvalidDerivedAccount
        );
        require_keys_eq!(
            ctx.accounts.token_mint_account.key(),
            args.token_mint,
            FracksFactoryError::InvalidDerivedAccount
        );

        let irs_info = ctx.accounts.irs_state.to_account_info();
        let irs_already_initialized =
            irs_info.owner == &ctx.accounts.irs_program.key() && !irs_info.data_is_empty();

        let trusted_issuer_account_count = args.trusted_issuers.len();
        require!(
            ctx.remaining_accounts.len() >= trusted_issuer_account_count,
            FracksFactoryError::MissingTrustedIssuerAccounts
        );
        require!(
            ctx.remaining_accounts.len()
                >= trusted_issuer_account_count
                    .checked_add(args.compliance_modules.len())
                    .ok_or_else(|| error!(FracksFactoryError::ArithmeticOverflow))?,
            FracksFactoryError::MissingComplianceModuleAccounts
        );

        require!(
            ctx.accounts.deployment.deployed_at == 0,
            FracksFactoryError::DeploymentAlreadyExists
        );
        require!(
            args.shared_irs.is_none(),
            FracksFactoryError::SharedIrsUnsupported
        );
        require!(
            !irs_already_initialized,
            FracksFactoryError::IrsAlreadyInitialized
        );

        fracks_token::cpi::initialize_token(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                InitializeToken {
                    owner: ctx.accounts.admin.to_account_info(),
                    token_state: ctx.accounts.token_state.to_account_info(),
                    owner_state: ctx.accounts.owner_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
            args.token_name.clone(),
            args.token_symbol.clone(),
            args.decimals,
            args.isin.clone(),
            ctx.accounts.irp_state.key(),
            ctx.accounts.compliance_state.key(),
        )?;

        fracks_token::cpi::initialize_mint_metadata(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                InitializeMintMetadata {
                    owner: ctx.accounts.admin.to_account_info(),
                    token_state: ctx.accounts.token_state.to_account_info(),
                    owner_state: ctx.accounts.owner_state.to_account_info(),
                    token_mint_account: ctx.accounts.token_mint_account.to_account_info(),
                    token_2022_program: ctx.accounts.token_2022_program.to_account_info(),
                },
            ),
            args.token_name.clone(),
            args.token_symbol.clone(),
            format!("https://fracks.app/token/{}", args.token_mint),
        )?;

        fracks_ctr::cpi::initialize_ctr(
            CpiContext::new(
                ctx.accounts.ctr_program.to_account_info(),
                InitializeCtr {
                    owner: ctx.accounts.admin.to_account_info(),
                    ctr_state: ctx.accounts.ctr_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
        )?;

        for topic in &args.claim_topics {
            fracks_ctr::cpi::add_claim_topic(
                CpiContext::new(
                    ctx.accounts.ctr_program.to_account_info(),
                    CtrOwnerAccounts {
                        owner: ctx.accounts.admin.to_account_info(),
                        ctr_state: ctx.accounts.ctr_state.to_account_info(),
                    },
                ),
                *topic,
            )?;
        }

        fracks_tir::cpi::initialize_tir(
            CpiContext::new(
                ctx.accounts.tir_program.to_account_info(),
                InitializeTir {
                    owner: ctx.accounts.admin.to_account_info(),
                    tir_state: ctx.accounts.tir_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
        )?;

        for (index, issuer) in args.trusted_issuers.iter().enumerate() {
            let issuer_entry = ctx.remaining_accounts[index].clone();
            let expected_issuer_entry = Pubkey::find_program_address(
                &[
                    b"issuer_entry",
                    ctx.accounts.tir_state.key().as_ref(),
                    issuer.issuer_fid.as_ref(),
                ],
                &ctx.accounts.tir_program.key(),
            )
            .0;
            require_keys_eq!(
                issuer_entry.key(),
                expected_issuer_entry,
                FracksFactoryError::InvalidDerivedAccount
            );

            fracks_tir::cpi::add_trusted_issuer(
                CpiContext::new(
                    ctx.accounts.tir_program.to_account_info(),
                    AddTrustedIssuer {
                        owner: ctx.accounts.admin.to_account_info(),
                        tir_state: ctx.accounts.tir_state.to_account_info(),
                        issuer_entry,
                        system_program: ctx.accounts.system_program.to_account_info(),
                    },
                ),
                issuer.issuer_fid,
                issuer.topics.clone(),
                issuer.label.clone(),
            )?;
        }

        fracks_irs::cpi::initialize_irs(
            CpiContext::new(
                ctx.accounts.irs_program.to_account_info(),
                InitializeIrs {
                    owner: ctx.accounts.admin.to_account_info(),
                    irs_state: ctx.accounts.irs_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
        )?;

        fracks_irp::cpi::initialize_registry(
            CpiContext::new(
                ctx.accounts.irp_program.to_account_info(),
                InitializeRegistry {
                    owner: ctx.accounts.admin.to_account_info(),
                    registry_state: ctx.accounts.irp_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
            ctx.accounts.irs_state.key(),
            ctx.accounts.tir_state.key(),
            ctx.accounts.ctr_state.key(),
        )?;

        fracks_irs::cpi::bind_registry(
            CpiContext::new(
                ctx.accounts.irs_program.to_account_info(),
                IrsOwnerAccounts {
                    owner: ctx.accounts.admin.to_account_info(),
                    irs_state: ctx.accounts.irs_state.to_account_info(),
                },
            ),
            ctx.accounts.irp_state.key(),
        )?;

        fracks_compliance::cpi::initialize_compliance(
            CpiContext::new(
                ctx.accounts.compliance_program.to_account_info(),
                InitializeCompliance {
                    owner: ctx.accounts.admin.to_account_info(),
                    compliance_state: ctx.accounts.compliance_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            args.token_mint,
        )?;

        for module in &args.compliance_modules {
            fracks_compliance::cpi::bind_module(
                CpiContext::new(
                    ctx.accounts.compliance_program.to_account_info(),
                    ComplianceOwnerAccounts {
                        owner: ctx.accounts.admin.to_account_info(),
                        compliance_state: ctx.accounts.compliance_state.to_account_info(),
                    },
                ),
                *module,
            )?;
        }

        let module_accounts_start = trusted_issuer_account_count;
        let module_accounts_end = module_accounts_start
            .checked_add(args.compliance_modules.len())
            .ok_or_else(|| error!(FracksFactoryError::ArithmeticOverflow))?;
        for (index, module) in args.compliance_modules.iter().enumerate() {
            let module_account = &ctx.remaining_accounts[module_accounts_start + index];
            require_keys_eq!(
                module_account.key(),
                *module,
                FracksFactoryError::InvalidDerivedAccount
            );
        }
        fracks_token_hook::cpi::initialize_extra_account_metas(
            CpiContext::new(
                ctx.accounts.hook_program.to_account_info(),
                InitializeExtraAccountMetas {
                    payer: ctx.accounts.admin.to_account_info(),
                    token_state: ctx.accounts.token_state.to_account_info(),
                    owner_state: ctx.accounts.owner_state.to_account_info(),
                    compliance_state: ctx.accounts.compliance_state.to_account_info(),
                    token_mint_account: ctx.accounts.token_mint_account.to_account_info(),
                    extra_account_metas: ctx.accounts.extra_account_metas.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            )
            .with_remaining_accounts(
                ctx.remaining_accounts[module_accounts_start..module_accounts_end].to_vec(),
            ),
        )?;

        fracks_token::cpi::transfer_ownership(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                UpdateOwnerState {
                    owner: ctx.accounts.admin.to_account_info(),
                    token_state: ctx.accounts.token_state.to_account_info(),
                    owner_state: ctx.accounts.owner_state.to_account_info(),
                },
            ),
            args.issuer,
        )?;
        fracks_ctr::cpi::transfer_ownership(
            CpiContext::new(
                ctx.accounts.ctr_program.to_account_info(),
                CtrOwnerAccounts {
                    owner: ctx.accounts.admin.to_account_info(),
                    ctr_state: ctx.accounts.ctr_state.to_account_info(),
                },
            ),
            args.issuer,
        )?;
        fracks_tir::cpi::transfer_ownership(
            CpiContext::new(
                ctx.accounts.tir_program.to_account_info(),
                TransferTirOwnership {
                    owner: ctx.accounts.admin.to_account_info(),
                    tir_state: ctx.accounts.tir_state.to_account_info(),
                },
            ),
            args.issuer,
        )?;
        fracks_irp::cpi::transfer_registry_ownership(
            CpiContext::new(
                ctx.accounts.irp_program.to_account_info(),
                UpdateRegistryOwner {
                    owner: ctx.accounts.admin.to_account_info(),
                    registry_state: ctx.accounts.irp_state.to_account_info(),
                },
            ),
            args.issuer,
        )?;
        fracks_irs::cpi::transfer_ownership(
            CpiContext::new(
                ctx.accounts.irs_program.to_account_info(),
                IrsOwnerAccounts {
                    owner: ctx.accounts.admin.to_account_info(),
                    irs_state: ctx.accounts.irs_state.to_account_info(),
                },
            ),
            args.issuer,
        )?;
        fracks_compliance::cpi::transfer_ownership(
            CpiContext::new(
                ctx.accounts.compliance_program.to_account_info(),
                ComplianceOwnerAccounts {
                    owner: ctx.accounts.admin.to_account_info(),
                    compliance_state: ctx.accounts.compliance_state.to_account_info(),
                },
            ),
            args.issuer,
        )?;

        let deployment = &mut ctx.accounts.deployment;
        deployment.deployment_id = ctx.accounts.factory_state.deployment_count;
        deployment.asset_id = args.asset_id;
        deployment.issuer = args.issuer;
        deployment.salt = args.salt;
        deployment.token_mint = args.token_mint;
        deployment.token_state = ctx.accounts.token_state.key();
        deployment.owner_state = ctx.accounts.owner_state.key();
        deployment.irp_state = ctx.accounts.irp_state.key();
        deployment.irs_state = ctx.accounts.irs_state.key();
        deployment.tir_state = ctx.accounts.tir_state.key();
        deployment.ctr_state = ctx.accounts.ctr_state.key();
        deployment.compliance_state = ctx.accounts.compliance_state.key();
        deployment.custody_mandate = ctx.accounts.custody_mandate.key();
        deployment.custody_attestation = ctx.accounts.custody_attestation.key();
        deployment.deployed_at = Clock::get()?.unix_timestamp;
        deployment.bump = ctx.bumps.deployment;

        ctx.accounts.factory_state.deployment_count = ctx
            .accounts
            .factory_state
            .deployment_count
            .checked_add(1)
            .ok_or_else(|| error!(FracksFactoryError::ArithmeticOverflow))?;

        emit!(TokenSuiteDeployed {
            issuer: args.issuer,
            deployment_id: deployment.deployment_id,
            asset_id: deployment.asset_id,
            token_mint: deployment.token_mint,
            token_state: deployment.token_state,
            irp_state: deployment.irp_state,
            irs_state: deployment.irs_state,
            tir_state: deployment.tir_state,
            ctr_state: deployment.ctr_state,
            compliance_state: deployment.compliance_state,
            custody_mandate: deployment.custody_mandate,
            custody_attestation: deployment.custody_attestation,
            deployed_at: deployment.deployed_at,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeFactory<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = FACTORY_STATE_SPACE,
        seeds = [b"factory_state"],
        bump
    )]
    pub factory_state: Account<'info, FactoryState>,
    pub token_program: Program<'info, FracksToken>,
    pub irp_program: Program<'info, FracksIrp>,
    pub irs_program: Program<'info, FracksIrs>,
    pub tir_program: Program<'info, FracksTir>,
    pub ctr_program: Program<'info, FracksCtr>,
    pub compliance_program: Program<'info, FracksCompliance>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFactoryState<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"factory_state"],
        bump = factory_state.bump,
        has_one = owner @ FracksFactoryError::NotOwner
    )]
    pub factory_state: Account<'info, FactoryState>,
}

#[derive(Accounts)]
pub struct CreateTokenMint<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Deterministic FRACKS token_state PDA that becomes mint authority and permanent delegate.
    pub token_state: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_mint_account: Signer<'info>,
    pub hook_program: Program<'info, FracksTokenHook>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(authority_fid: Pubkey, topic: u64)]
pub struct ApprovePlatformAuthority<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [b"factory_state"],
        bump = factory_state.bump,
        constraint = factory_state.owner == admin.key() @ FracksFactoryError::NotOwner
    )]
    pub factory_state: Account<'info, FactoryState>,
    #[account(
        init_if_needed,
        payer = admin,
        space = PLATFORM_AUTHORITY_SPACE,
        seeds = [b"platform_authority".as_ref(), authority_fid.as_ref(), &topic.to_le_bytes()],
        bump
    )]
    pub platform_authority: Account<'info, PlatformAuthority>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(authority_fid: Pubkey, topic: u64)]
pub struct RevokePlatformAuthority<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        seeds = [b"factory_state"],
        bump = factory_state.bump,
        constraint = factory_state.owner == admin.key() @ FracksFactoryError::NotOwner
    )]
    pub factory_state: Account<'info, FactoryState>,
    #[account(
        mut,
        seeds = [b"platform_authority".as_ref(), authority_fid.as_ref(), &topic.to_le_bytes()],
        bump = platform_authority.bump
    )]
    pub platform_authority: Account<'info, PlatformAuthority>,
}

#[derive(Accounts)]
#[instruction(asset_id: u64, issuer_fid: Pubkey, custodian: Pubkey, custodian_fid: Pubkey)]
pub struct CreateCustodyMandate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"factory_state"],
        bump = factory_state.bump
    )]
    pub factory_state: Account<'info, FactoryState>,
    /// CHECK: Issuer wallet is checked against issuer_fid_account.owner in instruction.
    pub issuer: UncheckedAccount<'info>,
    #[account(
        seeds = [b"fid", issuer.key().as_ref()],
        bump = issuer_fid_account.bump,
        seeds::program = fracks_fid::ID
    )]
    pub issuer_fid_account: Account<'info, FidAccount>,
    #[account(
        seeds = [b"fid", custodian.as_ref()],
        bump = custodian_fid_account.bump,
        seeds::program = fracks_fid::ID
    )]
    pub custodian_fid_account: Account<'info, FidAccount>,
    #[account(
        seeds = [b"platform_authority".as_ref(), custodian_fid.as_ref(), &TOPIC_CUSTODIAN_AUTHORITY.to_le_bytes()],
        bump = custodian_authority.bump
    )]
    pub custodian_authority: Account<'info, PlatformAuthority>,
    #[account(
        init,
        payer = authority,
        space = CUSTODY_MANDATE_SPACE,
        seeds = [b"custody_mandate".as_ref(), &asset_id.to_le_bytes()],
        bump
    )]
    pub custody_mandate: Box<Account<'info, CustodyMandate>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptCustodyMandate<'info> {
    #[account(mut)]
    pub custodian: Signer<'info>,
    #[account(
        mut,
        seeds = [b"custody_mandate".as_ref(), &custody_mandate.asset_id.to_le_bytes()],
        bump = custody_mandate.bump
    )]
    pub custody_mandate: Box<Account<'info, CustodyMandate>>,
    #[account(
        seeds = [b"fid", custodian.key().as_ref()],
        bump = custodian_fid_account.bump,
        seeds::program = fracks_fid::ID
    )]
    pub custodian_fid_account: Account<'info, FidAccount>,
}

#[derive(Accounts)]
pub struct AttestCustody<'info> {
    #[account(mut)]
    pub custodian: Signer<'info>,
    #[account(
        seeds = [b"custody_mandate".as_ref(), &custody_mandate.asset_id.to_le_bytes()],
        bump = custody_mandate.bump
    )]
    pub custody_mandate: Box<Account<'info, CustodyMandate>>,
    #[account(
        init_if_needed,
        payer = custodian,
        space = CUSTODY_ATTESTATION_SPACE,
        seeds = [b"custody_attestation".as_ref(), custody_mandate.key().as_ref()],
        bump
    )]
    pub custody_attestation: Box<Account<'info, CustodyAttestation>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AttestReserve<'info> {
    #[account(mut)]
    pub custodian: Signer<'info>,
    #[account(
        seeds = [b"custody_mandate".as_ref(), &custody_mandate.asset_id.to_le_bytes()],
        bump = custody_mandate.bump
    )]
    pub custody_mandate: Box<Account<'info, CustodyMandate>>,
    #[account(
        mut,
        seeds = [b"custody_attestation".as_ref(), custody_mandate.key().as_ref()],
        bump = custody_attestation.bump
    )]
    pub custody_attestation: Box<Account<'info, CustodyAttestation>>,
}

#[derive(Accounts)]
pub struct ReleaseCustodyMandate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [b"factory_state"],
        bump = factory_state.bump
    )]
    pub factory_state: Account<'info, FactoryState>,
    #[account(
        mut,
        seeds = [b"custody_mandate".as_ref(), &custody_mandate.asset_id.to_le_bytes()],
        bump = custody_mandate.bump
    )]
    pub custody_mandate: Box<Account<'info, CustodyMandate>>,
}

#[derive(Accounts)]
#[instruction(redemption_id: u64)]
pub struct SignRedemptionEvent<'info> {
    #[account(mut)]
    pub custodian: Signer<'info>,
    #[account(
        seeds = [b"custody_mandate".as_ref(), &custody_mandate.asset_id.to_le_bytes()],
        bump = custody_mandate.bump
    )]
    pub custody_mandate: Box<Account<'info, CustodyMandate>>,
    #[account(
        init,
        payer = custodian,
        space = REDEMPTION_SIGNATURE_SPACE,
        seeds = [
            b"redemption_signature".as_ref(),
            custody_mandate.key().as_ref(),
            &redemption_id.to_le_bytes()
        ],
        bump
    )]
    pub redemption_signature: Account<'info, RedemptionSignature>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: DeployTokenSuiteArgs)]
pub struct DeployTokenSuite<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [b"factory_state"],
        bump = factory_state.bump,
        constraint = factory_state.owner == admin.key() @ FracksFactoryError::NotOwner
    )]
    pub factory_state: Account<'info, FactoryState>,
    /// CHECK: Issuer wallet is passed explicitly and becomes the final owner of the deployed suite.
    #[account(constraint = issuer.key() == args.issuer @ FracksFactoryError::InvalidIssuer)]
    pub issuer: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = admin,
        space = TOKEN_DEPLOYMENT_SPACE,
        seeds = [b"deployment", args.issuer.as_ref(), args.salt.as_ref()],
        bump
    )]
    pub deployment: Box<Account<'info, TokenDeployment>>,
    #[account(
        seeds = [b"custody_mandate".as_ref(), &args.asset_id.to_le_bytes()],
        bump = custody_mandate.bump
    )]
    pub custody_mandate: Box<Account<'info, CustodyMandate>>,
    #[account(
        seeds = [b"custody_attestation".as_ref(), custody_mandate.key().as_ref()],
        bump = custody_attestation.bump
    )]
    pub custody_attestation: Box<Account<'info, CustodyAttestation>>,
    /// CHECK: Validated against the token program PDA derivation.
    #[account(mut)]
    pub token_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the token program PDA derivation.
    #[account(mut)]
    pub owner_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the IRS program PDA derivation.
    #[account(mut)]
    pub irs_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the TIR program PDA derivation.
    #[account(mut)]
    pub tir_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the CTR program PDA derivation.
    #[account(mut)]
    pub ctr_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the IRP program PDA derivation.
    #[account(mut)]
    pub irp_state: UncheckedAccount<'info>,
    /// CHECK: Validated against the compliance program PDA derivation.
    #[account(mut)]
    pub compliance_state: UncheckedAccount<'info>,
    /// CHECK: Token-2022 mint validated by hook extra-account-metas initialization.
    #[account(mut)]
    pub token_mint_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Hook-owned Token-2022 extra-account-metas PDA initialized during suite deployment.
    pub extra_account_metas: UncheckedAccount<'info>,
    pub token_program: Program<'info, FracksToken>,
    pub token_2022_program: Program<'info, Token2022>,
    pub hook_program: Program<'info, FracksTokenHook>,
    pub irp_program: Program<'info, FracksIrp>,
    pub irs_program: Program<'info, FracksIrs>,
    pub tir_program: Program<'info, FracksTir>,
    pub ctr_program: Program<'info, FracksCtr>,
    pub compliance_program: Program<'info, FracksCompliance>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct FactoryState {
    pub owner: Pubkey,
    pub token_program_id: Pubkey,
    pub fid_program_id: Pubkey,
    pub irp_program_id: Pubkey,
    pub irs_program_id: Pubkey,
    pub tir_program_id: Pubkey,
    pub ctr_program_id: Pubkey,
    pub compliance_program_id: Pubkey,
    pub deployment_count: u64,
    pub bump: u8,
}

#[account]
pub struct TokenDeployment {
    pub deployment_id: u64,
    pub asset_id: u64,
    pub issuer: Pubkey,
    pub salt: [u8; 32],
    pub token_mint: Pubkey,
    pub token_state: Pubkey,
    pub owner_state: Pubkey,
    pub irp_state: Pubkey,
    pub irs_state: Pubkey,
    pub tir_state: Pubkey,
    pub ctr_state: Pubkey,
    pub compliance_state: Pubkey,
    pub custody_mandate: Pubkey,
    pub custody_attestation: Pubkey,
    pub deployed_at: i64,
    pub bump: u8,
}

#[account]
pub struct PlatformAuthority {
    pub authority_fid: Pubkey,
    pub topic: u64,
    pub active: bool,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
pub struct CustodyMandate {
    pub asset_id: u64,
    pub issuer: Pubkey,
    pub issuer_fid: Pubkey,
    pub custodian: Pubkey,
    pub custodian_fid: Pubkey,
    pub active: bool,
    pub accepted: bool,
    pub created_at: i64,
    pub accepted_at: i64,
    pub released_at: i64,
    pub release_notice_at: i64,
    pub bump: u8,
}

#[account]
pub struct CustodyAttestation {
    pub asset_id: u64,
    pub custody_mandate: Pubkey,
    pub custodian: Pubkey,
    pub custodian_fid: Pubkey,
    pub document_hash: [u8; 32],
    pub attestation_hash: [u8; 32],
    pub reserve_ratio_bps: u16,
    pub attested_at: i64,
    pub expires_at: i64,
    pub active: bool,
    pub bump: u8,
}

#[account]
pub struct RedemptionSignature {
    pub asset_id: u64,
    pub redemption_id: u64,
    pub custody_mandate: Pubkey,
    pub custodian: Pubkey,
    pub attestation_hash: [u8; 32],
    pub signed_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct ProgramIds {
    pub token_program_id: Pubkey,
    pub fid_program_id: Pubkey,
    pub irp_program_id: Pubkey,
    pub irs_program_id: Pubkey,
    pub tir_program_id: Pubkey,
    pub ctr_program_id: Pubkey,
    pub compliance_program_id: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TrustedIssuerInput {
    pub issuer_fid: Pubkey,
    pub topics: Vec<u64>,
    pub label: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DeployTokenSuiteArgs {
    pub issuer: Pubkey,
    pub asset_id: u64,
    pub token_mint: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
    pub decimals: u8,
    pub isin: String,
    pub claim_topics: Vec<u64>,
    pub trusted_issuers: Vec<TrustedIssuerInput>,
    pub compliance_modules: Vec<Pubkey>,
    pub shared_irs: Option<Pubkey>,
    pub salt: [u8; 32],
}

#[event]
pub struct PlatformAuthorityApproved {
    pub authority_fid: Pubkey,
    pub topic: u64,
    pub admin: Pubkey,
}

#[event]
pub struct PlatformAuthorityRevoked {
    pub authority_fid: Pubkey,
    pub topic: u64,
    pub admin: Pubkey,
}

#[event]
pub struct CustodyMandateCreated {
    pub asset_id: u64,
    pub issuer: Pubkey,
    pub issuer_fid: Pubkey,
    pub custodian: Pubkey,
    pub custodian_fid: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct CustodyMandateAccepted {
    pub asset_id: u64,
    pub custodian: Pubkey,
    pub custodian_fid: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct CustodyAttested {
    pub asset_id: u64,
    pub custody_mandate: Pubkey,
    pub custodian: Pubkey,
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct ReserveAttested {
    pub asset_id: u64,
    pub custody_mandate: Pubkey,
    pub custodian: Pubkey,
    pub reserve_ratio_bps: u16,
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct CustodyMandateReleased {
    pub asset_id: u64,
    pub custody_mandate: Pubkey,
    pub released_by: Pubkey,
    pub reason_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct RedemptionEventSigned {
    pub asset_id: u64,
    pub redemption_id: u64,
    pub custodian: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokenSuiteDeployed {
    pub issuer: Pubkey,
    pub deployment_id: u64,
    pub asset_id: u64,
    pub token_mint: Pubkey,
    pub token_state: Pubkey,
    pub irp_state: Pubkey,
    pub irs_state: Pubkey,
    pub tir_state: Pubkey,
    pub ctr_state: Pubkey,
    pub compliance_state: Pubkey,
    pub custody_mandate: Pubkey,
    pub custody_attestation: Pubkey,
    pub deployed_at: i64,
}

fn validate_custody_gate(
    custody_mandate: &Account<CustodyMandate>,
    custody_attestation: &Account<CustodyAttestation>,
    asset_id: u64,
) -> Result<()> {
    require!(
        custody_mandate.asset_id == asset_id,
        FracksFactoryError::InvalidCustodyMandate
    );
    require!(
        custody_mandate.active && custody_mandate.accepted,
        FracksFactoryError::CustodyMandateInactive
    );
    require_keys_neq!(
        custody_mandate.issuer_fid,
        custody_mandate.custodian_fid,
        FracksFactoryError::CustodianCannotEqualIssuer
    );
    require!(
        custody_attestation.active
            && custody_attestation.asset_id == asset_id
            && custody_attestation.custody_mandate == custody_mandate.key()
            && custody_attestation.custodian == custody_mandate.custodian
            && custody_attestation.custodian_fid == custody_mandate.custodian_fid,
        FracksFactoryError::CustodyAttestationMissing
    );
    require!(
        custody_attestation.expires_at > Clock::get()?.unix_timestamp,
        FracksFactoryError::CustodyAttestationExpired
    );
    Ok(())
}

fn validate_attestation_authority(
    custodian: &Signer,
    custody_mandate: &Account<CustodyMandate>,
) -> Result<()> {
    require!(
        custody_mandate.active && custody_mandate.accepted,
        FracksFactoryError::CustodyMandateInactive
    );
    require_keys_eq!(
        custodian.key(),
        custody_mandate.custodian,
        FracksFactoryError::UnauthorizedCustodian
    );
    Ok(())
}

fn validate_attestation_validity(validity_seconds: i64) -> Result<()> {
    require!(
        validity_seconds > 0 && validity_seconds <= MAX_ATTESTATION_VALIDITY_SECONDS,
        FracksFactoryError::InvalidAttestationValidity
    );
    Ok(())
}

fn validate_args(args: &DeployTokenSuiteArgs) -> Result<()> {
    require_keys_neq!(
        args.issuer,
        Pubkey::default(),
        FracksFactoryError::InvalidIssuer
    );
    require!(
        !args.token_name.is_empty() && args.token_name.len() <= 64,
        FracksFactoryError::InvalidTokenMetadata
    );
    require!(
        !args.token_symbol.is_empty() && args.token_symbol.len() <= 12,
        FracksFactoryError::InvalidTokenMetadata
    );
    require!(
        !args.isin.is_empty() && args.isin.len() <= 24,
        FracksFactoryError::InvalidTokenMetadata
    );
    require!(
        args.claim_topics.len() <= MAX_CLAIM_TOPICS,
        FracksFactoryError::TooManyClaimTopics
    );
    require!(
        args.trusted_issuers.len() <= MAX_TRUSTED_ISSUERS,
        FracksFactoryError::TooManyTrustedIssuers
    );
    require!(
        args.compliance_modules.len() <= MAX_COMPLIANCE_MODULES,
        FracksFactoryError::TooManyComplianceModules
    );
    for issuer in &args.trusted_issuers {
        require!(
            !issuer.topics.is_empty(),
            FracksFactoryError::TrustedIssuerTopicsEmpty
        );
        require!(
            !issuer.label.is_empty() && issuer.label.len() <= 64,
            FracksFactoryError::InvalidTrustedIssuerLabel
        );
    }
    Ok(())
}

fn initialize_token_2022_mint<'info>(
    payer: AccountInfo<'info>,
    token_mint_account: AccountInfo<'info>,
    token_state: Pubkey,
    hook_program: Pubkey,
    token_2022_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    decimals: u8,
) -> Result<()> {
    require!(
        token_mint_account.data_is_empty(),
        FracksFactoryError::TokenMintAlreadyInitialized
    );
    let mint_space = spl_token_2022::extension::ExtensionType::try_calculate_account_len::<
        spl_token_2022::state::Mint,
    >(&TOKEN_2022_MINT_EXTENSIONS)
    .map_err(|_| error!(FracksFactoryError::InvalidTokenMint))?;
    let metadata_rent_space = mint_space
        .checked_add(MAX_METADATA_SPACE)
        .ok_or_else(|| error!(FracksFactoryError::ArithmeticOverflow))?;
    let rent_lamports = Rent::get()?.minimum_balance(metadata_rent_space);
    invoke(
        &system_instruction::create_account(
            &payer.key(),
            &token_mint_account.key(),
            rent_lamports,
            mint_space as u64,
            &token_2022_program.key(),
        ),
        &[payer.clone(), token_mint_account.clone(), system_program],
    )?;
    transfer_hook_initialize(
        CpiContext::new(
            token_2022_program.clone(),
            TransferHookInitialize {
                token_program_id: token_2022_program.clone(),
                mint: token_mint_account.clone(),
            },
        ),
        Some(payer.key()),
        Some(hook_program),
    )?;
    permanent_delegate_initialize(
        CpiContext::new(
            token_2022_program.clone(),
            PermanentDelegateInitialize {
                token_program_id: token_2022_program.clone(),
                mint: token_mint_account.clone(),
            },
        ),
        &token_state,
    )?;
    invoke(
        &metadata_pointer_instruction::initialize(
            &token_2022_program.key(),
            &token_mint_account.key(),
            Some(token_state),
            Some(token_mint_account.key()),
        )
        .map_err(|_| error!(FracksFactoryError::InvalidTokenMint))?,
        &[token_mint_account.clone()],
    )?;
    anchor_spl::token_2022::initialize_mint2(
        CpiContext::new(
            token_2022_program,
            anchor_spl::token_2022::InitializeMint2 {
                mint: token_mint_account,
            },
        ),
        decimals,
        &token_state,
        None,
    )
}

fn verify_program_ids(state: &FactoryState, accounts: &DeployTokenSuite<'_>) -> Result<()> {
    require_keys_eq!(
        state.token_program_id,
        accounts.token_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    require_keys_eq!(
        state.irp_program_id,
        accounts.irp_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    require_keys_eq!(
        state.irs_program_id,
        accounts.irs_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    require_keys_eq!(
        state.tir_program_id,
        accounts.tir_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    require_keys_eq!(
        state.ctr_program_id,
        accounts.ctr_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    require_keys_eq!(
        state.compliance_program_id,
        accounts.compliance_program.key(),
        FracksFactoryError::ProgramIdMismatch
    );
    Ok(())
}

#[error_code(offset = 0)]
pub enum FracksFactoryError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Issuer address is invalid.")]
    InvalidIssuer = 6001,
    #[msg("Deployment already exists for this issuer and salt.")]
    DeploymentAlreadyExists = 6060,
    #[msg("One or more derived accounts do not match the expected PDA.")]
    InvalidDerivedAccount = 6061,
    #[msg("The provided program IDs do not match the factory configuration.")]
    ProgramIdMismatch = 6062,
    #[msg("Missing issuer entry accounts for trusted issuer initialization.")]
    MissingTrustedIssuerAccounts = 6063,
    #[msg("Token metadata is invalid.")]
    InvalidTokenMetadata = 6064,
    #[msg("Too many claim topics were provided.")]
    TooManyClaimTopics = 6065,
    #[msg("Too many trusted issuers were provided.")]
    TooManyTrustedIssuers = 6066,
    #[msg("Too many compliance modules were provided.")]
    TooManyComplianceModules = 6067,
    #[msg("Trusted issuers must declare at least one topic.")]
    TrustedIssuerTopicsEmpty = 6068,
    #[msg("Trusted issuer labels must be between 1 and 64 characters.")]
    InvalidTrustedIssuerLabel = 6069,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6070,
    #[msg("Missing compliance module accounts for hook extra-account-metas initialization.")]
    MissingComplianceModuleAccounts = 6071,
    #[msg("Token-2022 mint account is already initialized.")]
    TokenMintAlreadyInitialized = 6072,
    #[msg("Token-2022 mint account is invalid.")]
    InvalidTokenMint = 6073,
    #[msg("Owner address is invalid.")]
    InvalidOwner = 6074,
    #[msg("Shared IRS deployment is disabled for the direct admin-to-issuer authority model.")]
    SharedIrsUnsupported = 6075,
    #[msg("IRS state is already initialized for this token suite.")]
    IrsAlreadyInitialized = 6076,
    #[msg("Custodian wallet is invalid.")]
    InvalidCustodian = 6077,
    #[msg("Issuer FID account is invalid for this mandate.")]
    InvalidIssuerFid = 6078,
    #[msg("Custodian FID account is invalid for this mandate.")]
    InvalidCustodianFid = 6079,
    #[msg("Custodian FID must be different from issuer FID.")]
    CustodianCannotEqualIssuer = 6080,
    #[msg("Custodian does not have the required custodian authority topic.")]
    CustodianRoleMissing = 6081,
    #[msg("Only the issuer or platform admin can create this custody mandate.")]
    UnauthorizedCustodyMandate = 6082,
    #[msg("Only the mandated custodian can perform this custody action.")]
    UnauthorizedCustodian = 6083,
    #[msg("Custody mandate is invalid for this asset.")]
    InvalidCustodyMandate = 6084,
    #[msg("Custody mandate is not active and accepted.")]
    CustodyMandateInactive = 6085,
    #[msg("Active custody attestation is missing for this asset.")]
    CustodyAttestationMissing = 6086,
    #[msg("Custody attestation has expired.")]
    CustodyAttestationExpired = 6087,
    #[msg("Custody attestation validity window is invalid.")]
    InvalidAttestationValidity = 6088,
    #[msg("Reserve ratio must be between 0 and 10000 basis points.")]
    InvalidReserveRatio = 6089,
    #[msg("Only the custodian or platform admin can release this custody mandate.")]
    UnauthorizedCustodyRelease = 6090,
    #[msg("The custodian is not approved as a platform authority for the required topic.")]
    PlatformAuthorityMissing = 6091,
}
