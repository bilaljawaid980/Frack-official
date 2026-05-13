use anchor_lang::prelude::*;

pub mod utils;

use utils::{construct_claim_message, verify_ed25519_instruction};

declare_id!("7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH");

const COUNTRY_MAX: u16 = 999;
const FID_SPACE: usize = 8 + 32 + 32 + 32 + 4 + 1 + 2 + 1;
const CLAIM_SPACE: usize = 8 + 32 + 4 + 8 + 32 + 32 + 32 + 64 + 8 + 8 + 1 + 1;

#[program]
pub mod fracks_fid {
    use super::*;

    pub fn create_fid(ctx: Context<CreateFid>, is_issuer: bool, country: u16) -> Result<()> {
        let fid_pubkey = ctx.accounts.fid.key();
        let fid = &mut ctx.accounts.fid;

        require!(fid.owner == Pubkey::default(), FracksFidError::FidAlreadyExists);
        validate_country(is_issuer, country)?;

        fid.owner = ctx.accounts.owner.key();
        fid.management_key = ctx.accounts.owner.key();
        fid.signer_key = ctx.accounts.owner.key();
        fid.claim_count = 0;
        fid.is_issuer = is_issuer;
        fid.country = if is_issuer { 0 } else { country };
        fid.bump = ctx.bumps.fid;

        emit!(FidCreated {
            owner: fid.owner,
            fid_pubkey,
            is_issuer,
            country: fid.country,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn set_management_key(ctx: Context<SetManagementKey>, new_key: Pubkey) -> Result<()> {
        ctx.accounts.fid.management_key = new_key;
        Ok(())
    }

    pub fn set_signer_key(ctx: Context<SetSignerKey>, new_key: Pubkey) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let fid = &mut ctx.accounts.fid;

        require!(
            authority == fid.owner || authority == fid.management_key,
            FracksFidError::Unauthorized
        );

        fid.signer_key = new_key;
        Ok(())
    }

    pub fn add_claim(
        ctx: Context<AddClaim>,
        topic: u64,
        data_hash: [u8; 32],
        signature: [u8; 64],
        expires_at: i64,
    ) -> Result<()> {
        require!(ctx.accounts.issuer_fid.is_issuer, FracksFidError::InvalidIssuerFid);
        require_keys_eq!(
            ctx.accounts.issuer_owner.key(),
            ctx.accounts.issuer_fid.owner,
            FracksFidError::Unauthorized
        );

        let message = construct_claim_message(
            &ctx.accounts.issuer_fid.key(),
            &ctx.accounts.target_fid.key(),
            topic,
            &data_hash,
            expires_at,
        );
        verify_ed25519_instruction(
            &ctx.accounts.instructions_sysvar,
            &ctx.accounts.issuer_fid.signer_key,
            &message,
            &signature,
        )?;

        let target_fid = &mut ctx.accounts.target_fid;
        let claim = &mut ctx.accounts.claim;
        let claim_id = target_fid.claim_count;

        claim.fid = target_fid.key();
        claim.claim_id = claim_id;
        claim.topic = topic;
        claim.issuer_fid = ctx.accounts.issuer_fid.key();
        claim.data_hash = data_hash;
        claim.signer_key = ctx.accounts.issuer_fid.signer_key;
        claim.signature = signature;
        claim.issued_at = Clock::get()?.unix_timestamp;
        claim.expires_at = expires_at;
        claim.revoked = false;
        claim.bump = ctx.bumps.claim;

        target_fid.claim_count = target_fid
            .claim_count
            .checked_add(1)
            .ok_or_else(|| error!(FracksFidError::ArithmeticOverflow))?;

        emit!(ClaimAdded {
            fid: claim.fid,
            claim_id,
            topic,
            issuer_fid: claim.issuer_fid,
            expires_at,
            timestamp: claim.issued_at,
        });

        Ok(())
    }

    pub fn revoke_claim(ctx: Context<RevokeClaim>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.issuer_owner.key(),
            ctx.accounts.issuer_fid.owner,
            FracksFidError::Unauthorized
        );
        require_keys_eq!(
            ctx.accounts.claim.issuer_fid,
            ctx.accounts.issuer_fid.key(),
            FracksFidError::InvalidIssuerFid
        );

        let claim = &mut ctx.accounts.claim;
        claim.revoked = true;

        emit!(ClaimRevoked {
            fid: claim.fid,
            claim_id: claim.claim_id,
            topic: claim.topic,
            by_issuer: ctx.accounts.issuer_fid.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn remove_claim(ctx: Context<RemoveClaim>) -> Result<()> {
        let fid = &ctx.accounts.fid;
        let authority = ctx.accounts.authority.key();

        require!(
            authority == fid.owner || authority == fid.management_key,
            FracksFidError::Unauthorized
        );

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(is_issuer: bool, country: u16)]
pub struct CreateFid<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init_if_needed,
        payer = owner,
        space = FID_SPACE,
        seeds = [b"fid", owner.key().as_ref()],
        bump
    )]
    pub fid: Account<'info, FidAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetManagementKey<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"fid", owner.key().as_ref()],
        bump = fid.bump,
        has_one = owner @ FracksFidError::Unauthorized
    )]
    pub fid: Account<'info, FidAccount>,
}

#[derive(Accounts)]
pub struct SetSignerKey<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"fid", fid.owner.as_ref()],
        bump = fid.bump
    )]
    pub fid: Account<'info, FidAccount>,
}

#[derive(Accounts)]
pub struct AddClaim<'info> {
    #[account(mut)]
    pub issuer_owner: Signer<'info>,
    #[account(
        seeds = [b"fid", issuer_fid.owner.as_ref()],
        bump = issuer_fid.bump
    )]
    pub issuer_fid: Account<'info, FidAccount>,
    #[account(mut)]
    pub target_fid: Account<'info, FidAccount>,
    #[account(
        init,
        payer = issuer_owner,
        space = CLAIM_SPACE,
        seeds = [b"claim", target_fid.key().as_ref(), &target_fid.claim_count.to_le_bytes()],
        bump
    )]
    pub claim: Account<'info, ClaimAccount>,
    /// CHECK: The sysvar account is validated inside the helper.
    pub instructions_sysvar: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeClaim<'info> {
    #[account(mut)]
    pub issuer_owner: Signer<'info>,
    #[account(
        seeds = [b"fid", issuer_fid.owner.as_ref()],
        bump = issuer_fid.bump
    )]
    pub issuer_fid: Account<'info, FidAccount>,
    #[account(
        mut,
        seeds = [b"claim", claim.fid.as_ref(), &claim.claim_id.to_le_bytes()],
        bump = claim.bump
    )]
    pub claim: Account<'info, ClaimAccount>,
}

#[derive(Accounts)]
pub struct RemoveClaim<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub fid: Account<'info, FidAccount>,
    #[account(
        mut,
        close = authority,
        seeds = [b"claim", claim.fid.as_ref(), &claim.claim_id.to_le_bytes()],
        bump = claim.bump,
        constraint = claim.fid == fid.key() @ FracksFidError::ClaimFidMismatch
    )]
    pub claim: Account<'info, ClaimAccount>,
}

#[account]
pub struct FidAccount {
    pub owner: Pubkey,
    pub management_key: Pubkey,
    pub signer_key: Pubkey,
    pub claim_count: u32,
    pub is_issuer: bool,
    pub country: u16,
    pub bump: u8,
}

#[account]
pub struct ClaimAccount {
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

#[event]
pub struct FidCreated {
    pub owner: Pubkey,
    pub fid_pubkey: Pubkey,
    pub is_issuer: bool,
    pub country: u16,
    pub timestamp: i64,
}

#[event]
pub struct ClaimAdded {
    pub fid: Pubkey,
    pub claim_id: u32,
    pub topic: u64,
    pub issuer_fid: Pubkey,
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct ClaimRevoked {
    pub fid: Pubkey,
    pub claim_id: u32,
    pub topic: u64,
    pub by_issuer: Pubkey,
    pub timestamp: i64,
}

#[error_code(offset = 0)]
pub enum FracksFidError {
    #[msg("Signer is not authorized for this action.")]
    Unauthorized = 6025,
    #[msg("Claim issuer FID is invalid for this operation.")]
    InvalidIssuerFid = 6026,
    #[msg("An ed25519 verification instruction is required before add_claim.")]
    MissingEd25519Instruction = 6027,
    #[msg("The provided instructions sysvar account is invalid.")]
    InvalidInstructionsSysvar = 6028,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow = 6029,
    #[msg("Claim account does not belong to the provided FID.")]
    ClaimFidMismatch = 6030,
    #[msg("Claim signature is invalid.")]
    InvalidClaimSignature = 6008,
    #[msg("FID already exists for this wallet.")]
    FidAlreadyExists = 6012,
    #[msg("Country code is invalid.")]
    InvalidCountryCode = 6017,
}

fn validate_country(is_issuer: bool, country: u16) -> Result<()> {
    if is_issuer {
        require!(country <= COUNTRY_MAX, FracksFidError::InvalidCountryCode);
    } else {
        require!(
            country > 0 && country <= COUNTRY_MAX,
            FracksFidError::InvalidCountryCode
        );
    }

    Ok(())
}
