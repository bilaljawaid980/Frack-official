use anchor_lang::prelude::*;

declare_id!("4zh7CCxi31GZ48kX2owTUfYvJam18N6rjGS6q7qRgdMP");

const GOVERNANCE_STATE_SPACE: usize = 8 + 256;
const PROPOSAL_SPACE: usize = 8 + 384;
const VOTE_RECORD_SPACE: usize = 8 + 160;

#[program]
pub mod fracks_governance {
    use super::*;

    pub fn initialize_governance(
        ctx: Context<InitializeGovernance>,
        token_mint: Pubkey,
        quorum_bps: u16,
        default_threshold_bps: u16,
    ) -> Result<()> {
        validate_bps(quorum_bps)?;
        validate_bps(default_threshold_bps)?;

        let state = &mut ctx.accounts.governance_state;
        state.token_mint = token_mint;
        state.owner = ctx.accounts.owner.key();
        state.quorum_bps = quorum_bps;
        state.default_threshold_bps = default_threshold_bps;
        state.proposal_count = 0;
        state.created_at = Clock::get()?.unix_timestamp;
        state.bump = ctx.bumps.governance_state;

        emit!(GovernanceInitialized {
            governance_state: state.key(),
            token_mint,
            owner: state.owner,
            quorum_bps,
            default_threshold_bps,
        });

        Ok(())
    }

    pub fn create_proposal(
        ctx: Context<CreateProposal>,
        description_hash: [u8; 32],
        proposal_type: ProposalType,
        threshold_bps: Option<u16>,
        quorum_bps: Option<u16>,
        end_slot: u64,
        snapshot_slot: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        require!(end_slot > clock.slot, FracksGovernanceError::InvalidVotingWindow);
        if let Some(threshold) = threshold_bps {
            validate_bps(threshold)?;
        }
        if let Some(quorum) = quorum_bps {
            validate_bps(quorum)?;
        }

        let state = &mut ctx.accounts.governance_state;
        let proposal_id = state
            .proposal_count
            .checked_add(1)
            .ok_or_else(|| error!(FracksGovernanceError::ArithmeticOverflow))?;
        state.proposal_count = proposal_id;

        let proposal = &mut ctx.accounts.proposal;
        proposal.governance_state = state.key();
        proposal.proposal_id = proposal_id;
        proposal.creator = ctx.accounts.creator.key();
        proposal.description_hash = description_hash;
        proposal.proposal_type = proposal_type as u8;
        proposal.threshold_bps = threshold_bps.unwrap_or(state.default_threshold_bps);
        proposal.quorum_bps = quorum_bps.unwrap_or(state.quorum_bps);
        proposal.snapshot_slot = snapshot_slot;
        proposal.start_slot = clock.slot;
        proposal.end_slot = end_slot;
        proposal.yes_votes = 0;
        proposal.no_votes = 0;
        proposal.abstain_votes = 0;
        proposal.status = ProposalStatus::Active as u8;
        proposal.created_at = clock.unix_timestamp;
        proposal.executed_at = 0;
        proposal.bump = ctx.bumps.proposal;

        emit!(ProposalCreated {
            governance_state: state.key(),
            proposal: proposal.key(),
            proposal_id,
            creator: proposal.creator,
            proposal_type: proposal.proposal_type,
            snapshot_slot,
            end_slot,
        });

        Ok(())
    }

    pub fn cast_vote(ctx: Context<CastVote>, choice: VoteChoice, weight: u64) -> Result<()> {
        require!(weight > 0, FracksGovernanceError::ZeroVoteWeight);
        let clock = Clock::get()?;
        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.status == ProposalStatus::Active as u8, FracksGovernanceError::ProposalNotActive);
        require!(clock.slot <= proposal.end_slot, FracksGovernanceError::VotingClosed);

        match choice {
            VoteChoice::Yes => proposal.yes_votes = proposal.yes_votes.checked_add(weight).ok_or_else(|| error!(FracksGovernanceError::ArithmeticOverflow))?,
            VoteChoice::No => proposal.no_votes = proposal.no_votes.checked_add(weight).ok_or_else(|| error!(FracksGovernanceError::ArithmeticOverflow))?,
            VoteChoice::Abstain => proposal.abstain_votes = proposal.abstain_votes.checked_add(weight).ok_or_else(|| error!(FracksGovernanceError::ArithmeticOverflow))?,
        }

        let record = &mut ctx.accounts.vote_record;
        record.proposal = proposal.key();
        record.voter = ctx.accounts.voter.key();
        record.choice = choice as u8;
        record.weight = weight;
        record.voted_at_slot = clock.slot;
        record.bump = ctx.bumps.vote_record;

        emit!(VoteCast {
            proposal: proposal.key(),
            voter: record.voter,
            choice: record.choice,
            weight,
        });

        Ok(())
    }

    pub fn execute_proposal(ctx: Context<ExecuteProposal>, total_snapshot_weight: u64) -> Result<()> {
        require!(total_snapshot_weight > 0, FracksGovernanceError::ZeroSnapshotWeight);
        let clock = Clock::get()?;
        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.status == ProposalStatus::Active as u8, FracksGovernanceError::ProposalNotActive);
        require!(clock.slot > proposal.end_slot, FracksGovernanceError::VotingStillOpen);

        let votes_cast = proposal
            .yes_votes
            .checked_add(proposal.no_votes)
            .and_then(|value| value.checked_add(proposal.abstain_votes))
            .ok_or_else(|| error!(FracksGovernanceError::ArithmeticOverflow))?;
        let quorum_votes = bps_amount(total_snapshot_weight, proposal.quorum_bps)?;
        require!(votes_cast >= quorum_votes, FracksGovernanceError::QuorumNotMet);

        let decisive_votes = proposal
            .yes_votes
            .checked_add(proposal.no_votes)
            .ok_or_else(|| error!(FracksGovernanceError::ArithmeticOverflow))?;
        require!(decisive_votes > 0, FracksGovernanceError::NoDecisiveVotes);
        let required_yes = bps_amount(decisive_votes, proposal.threshold_bps)?;
        require!(proposal.yes_votes >= required_yes, FracksGovernanceError::ThresholdNotMet);

        proposal.status = ProposalStatus::Executed as u8;
        proposal.executed_at = clock.unix_timestamp;

        emit!(ProposalExecuted {
            proposal: proposal.key(),
            proposal_id: proposal.proposal_id,
            total_snapshot_weight,
            yes_votes: proposal.yes_votes,
            no_votes: proposal.no_votes,
            abstain_votes: proposal.abstain_votes,
        });

        Ok(())
    }

    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        require!(proposal.status == ProposalStatus::Active as u8, FracksGovernanceError::ProposalNotActive);
        require!(
            ctx.accounts.authority.key() == proposal.creator
                || ctx.accounts.authority.key() == ctx.accounts.governance_state.owner,
            FracksGovernanceError::UnauthorizedGovernanceAction
        );
        proposal.status = ProposalStatus::Cancelled as u8;

        emit!(ProposalCancelled {
            proposal: proposal.key(),
            proposal_id: proposal.proposal_id,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ProposalType {
    Ordinary = 0,
    SaleOrMajorDecision = 1,
    CustodianReplacement = 2,
    Emergency = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VoteChoice {
    Yes = 1,
    No = 2,
    Abstain = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ProposalStatus {
    Active = 1,
    Executed = 2,
    Cancelled = 3,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct InitializeGovernance<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = GOVERNANCE_STATE_SPACE,
        seeds = [b"gov", token_mint.as_ref()],
        bump
    )]
    pub governance_state: Account<'info, GovernanceState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut)]
    pub governance_state: Account<'info, GovernanceState>,
    #[account(
        init,
        payer = creator,
        space = PROPOSAL_SPACE,
        seeds = [b"proposal", governance_state.key().as_ref(), &(governance_state.proposal_count + 1).to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = voter,
        space = VOTE_RECORD_SPACE,
        seeds = [b"vote", proposal.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    pub executor: Signer<'info>,
    pub governance_state: Account<'info, GovernanceState>,
    #[account(
        mut,
        constraint = proposal.governance_state == governance_state.key() @ FracksGovernanceError::InvalidGovernanceReference
    )]
    pub proposal: Account<'info, Proposal>,
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    pub authority: Signer<'info>,
    pub governance_state: Account<'info, GovernanceState>,
    #[account(
        mut,
        constraint = proposal.governance_state == governance_state.key() @ FracksGovernanceError::InvalidGovernanceReference
    )]
    pub proposal: Account<'info, Proposal>,
}

#[account]
pub struct GovernanceState {
    pub token_mint: Pubkey,
    pub owner: Pubkey,
    pub quorum_bps: u16,
    pub default_threshold_bps: u16,
    pub proposal_count: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
pub struct Proposal {
    pub governance_state: Pubkey,
    pub proposal_id: u64,
    pub creator: Pubkey,
    pub description_hash: [u8; 32],
    pub proposal_type: u8,
    pub threshold_bps: u16,
    pub quorum_bps: u16,
    pub snapshot_slot: u64,
    pub start_slot: u64,
    pub end_slot: u64,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub abstain_votes: u64,
    pub status: u8,
    pub created_at: i64,
    pub executed_at: i64,
    pub bump: u8,
}

#[account]
pub struct VoteRecord {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub choice: u8,
    pub weight: u64,
    pub voted_at_slot: u64,
    pub bump: u8,
}

#[event]
pub struct GovernanceInitialized {
    pub governance_state: Pubkey,
    pub token_mint: Pubkey,
    pub owner: Pubkey,
    pub quorum_bps: u16,
    pub default_threshold_bps: u16,
}

#[event]
pub struct ProposalCreated {
    pub governance_state: Pubkey,
    pub proposal: Pubkey,
    pub proposal_id: u64,
    pub creator: Pubkey,
    pub proposal_type: u8,
    pub snapshot_slot: u64,
    pub end_slot: u64,
}

#[event]
pub struct VoteCast {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub choice: u8,
    pub weight: u64,
}

#[event]
pub struct ProposalExecuted {
    pub proposal: Pubkey,
    pub proposal_id: u64,
    pub total_snapshot_weight: u64,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub abstain_votes: u64,
}

#[event]
pub struct ProposalCancelled {
    pub proposal: Pubkey,
    pub proposal_id: u64,
    pub authority: Pubkey,
}

fn validate_bps(value: u16) -> Result<()> {
    require!(value <= 10_000, FracksGovernanceError::InvalidBps);
    Ok(())
}

fn bps_amount(value: u64, bps: u16) -> Result<u64> {
    let numerator = value
        .checked_mul(bps as u64)
        .ok_or_else(|| error!(FracksGovernanceError::ArithmeticOverflow))?;
    Ok(numerator.checked_add(9_999).ok_or_else(|| error!(FracksGovernanceError::ArithmeticOverflow))? / 10_000)
}

#[error_code(offset = 7600)]
pub enum FracksGovernanceError {
    #[msg("Basis points must be <= 10000.")]
    InvalidBps,
    #[msg("Voting window is invalid.")]
    InvalidVotingWindow,
    #[msg("Proposal is not active.")]
    ProposalNotActive,
    #[msg("Voting is closed.")]
    VotingClosed,
    #[msg("Voting is still open.")]
    VotingStillOpen,
    #[msg("Vote weight must be greater than zero.")]
    ZeroVoteWeight,
    #[msg("Snapshot weight must be greater than zero.")]
    ZeroSnapshotWeight,
    #[msg("Quorum was not met.")]
    QuorumNotMet,
    #[msg("No decisive yes/no votes were cast.")]
    NoDecisiveVotes,
    #[msg("Approval threshold was not met.")]
    ThresholdNotMet,
    #[msg("Invalid governance reference.")]
    InvalidGovernanceReference,
    #[msg("Signer is not authorized for this governance action.")]
    UnauthorizedGovernanceAction,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow,
}
