use anchor_lang::prelude::*;

declare_id!("9bgANehpsEDdgyo5DwpY36wmnPdpCihSiAP9TLoBBf4L");

const MAX_TOPICS_PER_ISSUER: usize = 20;
const MAX_LABEL_LENGTH: usize = 64;
const TIR_SPACE: usize = 8 + 32 + 32 + 4 + 1;
const ISSUER_ENTRY_SPACE: usize = 8 + 32 + 32 + 4 + (8 * MAX_TOPICS_PER_ISSUER) + 1 + 4 + MAX_LABEL_LENGTH + 1;

#[program]
pub mod fracks_tir {
    use super::*;

    pub fn initialize_tir(ctx: Context<InitializeTir>, token_mint: Pubkey) -> Result<()> {
        let tir_state = &mut ctx.accounts.tir_state;
        tir_state.owner = ctx.accounts.owner.key();
        tir_state.token_mint = token_mint;
        tir_state.issuer_count = 0;
        tir_state.bump = ctx.bumps.tir_state;
        Ok(())
    }

    pub fn add_trusted_issuer(
        ctx: Context<AddTrustedIssuer>,
        issuer_fid: Pubkey,
        topics: Vec<u64>,
        label: String,
    ) -> Result<()> {
        validate_topics(&topics)?;
        validate_label(&label)?;

        let issuer_entry = &mut ctx.accounts.issuer_entry;
        issuer_entry.issuer_fid = issuer_fid;
        issuer_entry.tir = ctx.accounts.tir_state.key();
        issuer_entry.allowed_topics = topics.clone();
        issuer_entry.is_active = true;
        issuer_entry.label = label.clone();
        issuer_entry.bump = ctx.bumps.issuer_entry;

        ctx.accounts.tir_state.issuer_count = ctx
            .accounts
            .tir_state
            .issuer_count
            .checked_add(1)
            .ok_or_else(|| error!(FracksTirError::ArithmeticOverflow))?;

        emit!(TrustedIssuerAdded {
            issuer_fid,
            topics,
            label,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn update_issuer_topics(
        ctx: Context<MutateIssuerEntry>,
        new_topics: Vec<u64>,
    ) -> Result<()> {
        validate_topics(&new_topics)?;
        ctx.accounts.issuer_entry.allowed_topics = new_topics.clone();

        emit!(IssuerTopicsUpdated {
            issuer_fid: ctx.accounts.issuer_entry.issuer_fid,
            topics: new_topics,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn deactivate_issuer(ctx: Context<MutateIssuerEntry>) -> Result<()> {
        ctx.accounts.issuer_entry.is_active = false;

        emit!(TrustedIssuerDeactivated {
            issuer_fid: ctx.accounts.issuer_entry.issuer_fid,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn reactivate_issuer(ctx: Context<MutateIssuerEntry>) -> Result<()> {
        ctx.accounts.issuer_entry.is_active = true;

        emit!(TrustedIssuerReactivated {
            issuer_fid: ctx.accounts.issuer_entry.issuer_fid,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn remove_trusted_issuer(ctx: Context<RemoveTrustedIssuer>) -> Result<()> {
        let issuer_fid = ctx.accounts.issuer_entry.issuer_fid;
        ctx.accounts.tir_state.issuer_count = ctx
            .accounts
            .tir_state
            .issuer_count
            .checked_sub(1)
            .ok_or_else(|| error!(FracksTirError::ArithmeticOverflow))?;

        emit!(TrustedIssuerRemoved {
            issuer_fid,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn transfer_ownership(ctx: Context<TransferTirOwnership>, new_owner: Pubkey) -> Result<()> {
        require_keys_neq!(new_owner, Pubkey::default(), FracksTirError::InvalidOwner);
        ctx.accounts.tir_state.owner = new_owner;
        Ok(())
    }

    pub fn is_trusted_for_topic(
        ctx: Context<ReadIssuerEntry>,
        issuer_fid: Pubkey,
        topic: u64,
    ) -> Result<bool> {
        if ctx.accounts.issuer_entry.issuer_fid != issuer_fid {
            return Ok(false);
        }

        Ok(ctx.accounts.issuer_entry.is_active
            && ctx.accounts.issuer_entry.allowed_topics.contains(&topic))
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct InitializeTir<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = TIR_SPACE,
        seeds = [b"tir_state", token_mint.as_ref()],
        bump
    )]
    pub tir_state: Account<'info, TrustedIssuersState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(issuer_fid: Pubkey, topics: Vec<u64>, label: String)]
pub struct AddTrustedIssuer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"tir_state", tir_state.token_mint.as_ref()],
        bump = tir_state.bump,
        has_one = owner @ FracksTirError::NotOwner
    )]
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        init,
        payer = owner,
        space = ISSUER_ENTRY_SPACE,
        seeds = [b"issuer_entry", tir_state.key().as_ref(), issuer_fid.as_ref()],
        bump
    )]
    pub issuer_entry: Account<'info, IssuerEntry>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateIssuerEntry<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"tir_state", tir_state.token_mint.as_ref()],
        bump = tir_state.bump,
        has_one = owner @ FracksTirError::NotOwner
    )]
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        mut,
        seeds = [b"issuer_entry", tir_state.key().as_ref(), issuer_entry.issuer_fid.as_ref()],
        bump = issuer_entry.bump,
        constraint = issuer_entry.tir == tir_state.key() @ FracksTirError::IssuerNotTrusted
    )]
    pub issuer_entry: Account<'info, IssuerEntry>,
}

#[derive(Accounts)]
pub struct RemoveTrustedIssuer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"tir_state", tir_state.token_mint.as_ref()],
        bump = tir_state.bump,
        has_one = owner @ FracksTirError::NotOwner
    )]
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        mut,
        close = owner,
        seeds = [b"issuer_entry", tir_state.key().as_ref(), issuer_entry.issuer_fid.as_ref()],
        bump = issuer_entry.bump,
        constraint = issuer_entry.tir == tir_state.key() @ FracksTirError::IssuerNotTrusted
    )]
    pub issuer_entry: Account<'info, IssuerEntry>,
}

#[derive(Accounts)]
pub struct TransferTirOwnership<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"tir_state", tir_state.token_mint.as_ref()],
        bump = tir_state.bump,
        has_one = owner @ FracksTirError::NotOwner
    )]
    pub tir_state: Account<'info, TrustedIssuersState>,
}

#[derive(Accounts)]
pub struct ReadIssuerEntry<'info> {
    pub tir_state: Account<'info, TrustedIssuersState>,
    #[account(
        seeds = [b"issuer_entry", tir_state.key().as_ref(), issuer_entry.issuer_fid.as_ref()],
        bump = issuer_entry.bump,
        constraint = issuer_entry.tir == tir_state.key() @ FracksTirError::IssuerNotTrusted
    )]
    pub issuer_entry: Account<'info, IssuerEntry>,
}

#[account]
pub struct TrustedIssuersState {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub issuer_count: u32,
    pub bump: u8,
}

#[account]
pub struct IssuerEntry {
    pub issuer_fid: Pubkey,
    pub tir: Pubkey,
    pub allowed_topics: Vec<u64>,
    pub is_active: bool,
    pub label: String,
    pub bump: u8,
}

#[event]
pub struct TrustedIssuerAdded {
    pub issuer_fid: Pubkey,
    pub topics: Vec<u64>,
    pub label: String,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct IssuerTopicsUpdated {
    pub issuer_fid: Pubkey,
    pub topics: Vec<u64>,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TrustedIssuerDeactivated {
    pub issuer_fid: Pubkey,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TrustedIssuerReactivated {
    pub issuer_fid: Pubkey,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TrustedIssuerRemoved {
    pub issuer_fid: Pubkey,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[error_code(offset = 0)]
pub enum FracksTirError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Owner address is invalid.")]
    InvalidOwner = 6001,
    #[msg("Claim issuer is not trusted.")]
    IssuerNotTrusted = 6007,
    #[msg("Too many topics supplied.")]
    TooManyTopics = 6035,
    #[msg("Issuer label is too long.")]
    LabelTooLong = 6036,
    #[msg("Duplicate topic supplied.")]
    DuplicateTopic = 6037,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6038,
}

fn validate_topics(topics: &[u64]) -> Result<()> {
    require!(
        topics.len() <= MAX_TOPICS_PER_ISSUER,
        FracksTirError::TooManyTopics
    );

    let mut deduped = topics.to_vec();
    deduped.sort_unstable();
    deduped.dedup();
    require!(deduped.len() == topics.len(), FracksTirError::DuplicateTopic);
    Ok(())
}

fn validate_label(label: &str) -> Result<()> {
    require!(label.len() <= MAX_LABEL_LENGTH, FracksTirError::LabelTooLong);
    Ok(())
}
