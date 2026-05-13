use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_2022_extensions::permanent_delegate::{
    permanent_delegate_initialize, PermanentDelegateInitialize,
};
use anchor_spl::token_2022_extensions::transfer_hook::{
    transfer_hook_initialize, TransferHookInitialize,
};

use fracks_compliance::cpi::accounts::{
    InitializeCompliance, UpdateComplianceOwner as BindComplianceModule,
};
use fracks_compliance::program::FracksCompliance;
use fracks_ctr::cpi::accounts::{InitializeCtr, MutateCtr as AddClaimTopic};
use fracks_ctr::program::FracksCtr;
use fracks_irp::cpi::accounts::InitializeRegistry;
use fracks_irp::program::FracksIrp;
use fracks_irs::cpi::accounts::{InitializeIrs, UpdateIrsOwnerState as BindRegistry};
use fracks_irs::program::FracksIrs;
use fracks_tir::cpi::accounts::{AddTrustedIssuer, InitializeTir};
use fracks_tir::program::FracksTir;
use fracks_token_hook::cpi::accounts::InitializeExtraAccountMetas;
use fracks_token_hook::program::FracksTokenHook;
use fracks_token::cpi::accounts::InitializeToken;
use fracks_token::program::FracksToken;

declare_id!("3Vd81SWhR97nafQjsb43NGuP2L3RiCVcyzprXJ2yFs5M");

const MAX_CLAIM_TOPICS: usize = 20;
const MAX_TRUSTED_ISSUERS: usize = 16;
const MAX_COMPLIANCE_MODULES: usize = 15;
const FACTORY_STATE_SPACE: usize = 8 + (32 * 9) + 8 + 1;
const TOKEN_DEPLOYMENT_SPACE: usize = 8 + 8 + 32 + 32 + (32 * 8) + 8 + 1;
const TOKEN_2022_MINT_EXTENSIONS: [spl_token_2022::extension::ExtensionType; 2] = [
    spl_token_2022::extension::ExtensionType::TransferHook,
    spl_token_2022::extension::ExtensionType::PermanentDelegate,
];

#[program]
pub mod fracks_factory {
    use super::*;

    pub fn initialize_factory(ctx: Context<InitializeFactory>) -> Result<()> {
        let state = &mut ctx.accounts.factory_state;
        state.owner = ctx.accounts.owner.key();
        state.pending_owner = Pubkey::default();
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
            FracksFactoryError::InvalidPendingOwner
        );
        ctx.accounts.factory_state.pending_owner = new_owner;
        Ok(())
    }

    pub fn accept_factory_ownership(ctx: Context<AcceptFactoryOwnership>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.factory_state.pending_owner,
            ctx.accounts.pending_owner.key(),
            FracksFactoryError::NotPendingOwner
        );
        ctx.accounts.factory_state.owner = ctx.accounts.pending_owner.key();
        ctx.accounts.factory_state.pending_owner = Pubkey::default();
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

    pub fn deploy_token_suite<'info>(
        ctx: Context<'_, '_, '_, 'info, DeployTokenSuite<'info>>,
        args: DeployTokenSuiteArgs,
    ) -> Result<()> {
        validate_args(&args)?;
        verify_program_ids(&ctx.accounts.factory_state, &ctx.accounts)?;

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
                &[b"irs_state", ctx.accounts.issuer.key().as_ref()],
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

        fracks_token::cpi::initialize_token(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                InitializeToken {
                    owner: ctx.accounts.issuer.to_account_info(),
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

        fracks_ctr::cpi::initialize_ctr(
            CpiContext::new(
                ctx.accounts.ctr_program.to_account_info(),
                InitializeCtr {
                    owner: ctx.accounts.issuer.to_account_info(),
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
                    AddClaimTopic {
                        owner: ctx.accounts.issuer.to_account_info(),
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
                    owner: ctx.accounts.issuer.to_account_info(),
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
                        owner: ctx.accounts.issuer.to_account_info(),
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

        if args.shared_irs.is_none() {
            fracks_irs::cpi::initialize_irs(CpiContext::new(
                ctx.accounts.irs_program.to_account_info(),
                InitializeIrs {
                    owner: ctx.accounts.issuer.to_account_info(),
                    irs_state: ctx.accounts.irs_state.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ))?;
        }

        fracks_irp::cpi::initialize_registry(
            CpiContext::new(
                ctx.accounts.irp_program.to_account_info(),
                InitializeRegistry {
                    owner: ctx.accounts.issuer.to_account_info(),
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
                BindRegistry {
                    owner: ctx.accounts.issuer.to_account_info(),
                    irs_state: ctx.accounts.irs_state.to_account_info(),
                },
            ),
            ctx.accounts.irp_state.key(),
        )?;

        fracks_compliance::cpi::initialize_compliance(
            CpiContext::new(
                ctx.accounts.compliance_program.to_account_info(),
                InitializeCompliance {
                    owner: ctx.accounts.issuer.to_account_info(),
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
                    BindComplianceModule {
                        owner: ctx.accounts.issuer.to_account_info(),
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
                    payer: ctx.accounts.issuer.to_account_info(),
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

        let deployment = &mut ctx.accounts.deployment;
        deployment.deployment_id = ctx.accounts.factory_state.deployment_count;
        deployment.issuer = ctx.accounts.issuer.key();
        deployment.salt = args.salt;
        deployment.token_mint = args.token_mint;
        deployment.token_state = ctx.accounts.token_state.key();
        deployment.owner_state = ctx.accounts.owner_state.key();
        deployment.irp_state = ctx.accounts.irp_state.key();
        deployment.irs_state = ctx.accounts.irs_state.key();
        deployment.tir_state = ctx.accounts.tir_state.key();
        deployment.ctr_state = ctx.accounts.ctr_state.key();
        deployment.compliance_state = ctx.accounts.compliance_state.key();
        deployment.deployed_at = Clock::get()?.unix_timestamp;
        deployment.bump = ctx.bumps.deployment;

        ctx.accounts.factory_state.deployment_count = ctx
            .accounts
            .factory_state
            .deployment_count
            .checked_add(1)
            .ok_or_else(|| error!(FracksFactoryError::ArithmeticOverflow))?;

        emit!(TokenSuiteDeployed {
            issuer: ctx.accounts.issuer.key(),
            deployment_id: deployment.deployment_id,
            token_mint: deployment.token_mint,
            token_state: deployment.token_state,
            irp_state: deployment.irp_state,
            irs_state: deployment.irs_state,
            tir_state: deployment.tir_state,
            ctr_state: deployment.ctr_state,
            compliance_state: deployment.compliance_state,
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
pub struct AcceptFactoryOwnership<'info> {
    #[account(mut)]
    pub pending_owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"factory_state"],
        bump = factory_state.bump
    )]
    pub factory_state: Account<'info, FactoryState>,
}

#[derive(Accounts)]
#[instruction(args: DeployTokenSuiteArgs)]
pub struct DeployTokenSuite<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"factory_state"],
        bump = factory_state.bump
    )]
    pub factory_state: Account<'info, FactoryState>,
    #[account(
        init_if_needed,
        payer = issuer,
        space = TOKEN_DEPLOYMENT_SPACE,
        seeds = [b"deployment", issuer.key().as_ref(), args.salt.as_ref()],
        bump
    )]
    pub deployment: Account<'info, TokenDeployment>,
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
    pub token_mint_account: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Hook-owned Token-2022 extra-account-metas PDA initialized during suite deployment.
    pub extra_account_metas: UncheckedAccount<'info>,
    pub token_program: Program<'info, FracksToken>,
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
    pub pending_owner: Pubkey,
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
    pub deployed_at: i64,
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
pub struct TokenSuiteDeployed {
    pub issuer: Pubkey,
    pub deployment_id: u64,
    pub token_mint: Pubkey,
    pub token_state: Pubkey,
    pub irp_state: Pubkey,
    pub irs_state: Pubkey,
    pub tir_state: Pubkey,
    pub ctr_state: Pubkey,
    pub compliance_state: Pubkey,
    pub deployed_at: i64,
}

fn validate_args(args: &DeployTokenSuiteArgs) -> Result<()> {
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
    let mint_space =
        spl_token_2022::extension::ExtensionType::try_calculate_account_len::<
            spl_token_2022::state::Mint,
        >(&TOKEN_2022_MINT_EXTENSIONS)
        .map_err(|_| error!(FracksFactoryError::InvalidTokenMint))?;
    let rent_lamports = Rent::get()?.minimum_balance(mint_space);
    invoke(
        &system_instruction::create_account(
            &payer.key(),
            &token_mint_account.key(),
            rent_lamports,
            mint_space as u64,
            &token_2022_program.key(),
        ),
        &[
            payer.clone(),
            token_mint_account.clone(),
            system_program,
        ],
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

fn verify_program_ids(
    state: &FactoryState,
    accounts: &DeployTokenSuite<'_>,
) -> Result<()> {
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
    #[msg("Pending owner mismatch.")]
    NotPendingOwner = 6074,
    #[msg("Pending owner cannot be the default pubkey.")]
    InvalidPendingOwner = 6075,
}
