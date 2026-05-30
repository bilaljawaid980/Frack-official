use anchor_lang::prelude::*;

declare_id!("8MuWrtbZ1zPzrDhSKPjDd78SMQAMtBuprPnc1Zam1Gig");

const MAX_TOPICS: usize = 20;
const CTR_SPACE: usize = 8 + 32 + 32 + 4 + (8 * MAX_TOPICS) + 1;

#[program]
pub mod fracks_ctr {
    use super::*;

    pub fn initialize_ctr(ctx: Context<InitializeCtr>, token_mint: Pubkey) -> Result<()> {
        let ctr_state = &mut ctx.accounts.ctr_state;
        ctr_state.owner = ctx.accounts.owner.key();
        ctr_state.token_mint = token_mint;
        ctr_state.topics = Vec::new();
        ctr_state.bump = ctx.bumps.ctr_state;
        Ok(())
    }

    pub fn add_claim_topic(ctx: Context<MutateCtr>, topic_id: u64) -> Result<()> {
        let ctr_state = &mut ctx.accounts.ctr_state;
        require!(
            !ctr_state.topics.contains(&topic_id),
            FracksCtrError::TopicAlreadyExists
        );
        require!(ctr_state.topics.len() < MAX_TOPICS, FracksCtrError::MaxTopicsReached);

        ctr_state.topics.push(topic_id);

        emit!(ClaimTopicAdded {
            topic_id,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn remove_claim_topic(ctx: Context<MutateCtr>, topic_id: u64) -> Result<()> {
        let ctr_state = &mut ctx.accounts.ctr_state;
        let index = ctr_state
            .topics
            .iter()
            .position(|topic| *topic == topic_id)
            .ok_or_else(|| error!(FracksCtrError::TopicNotFound))?;

        ctr_state.topics.remove(index);

        emit!(ClaimTopicRemoved {
            topic_id,
            by_owner: ctx.accounts.owner.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn transfer_ownership(ctx: Context<MutateCtr>, new_owner: Pubkey) -> Result<()> {
        require_keys_neq!(new_owner, Pubkey::default(), FracksCtrError::InvalidOwner);
        ctx.accounts.ctr_state.owner = new_owner;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey)]
pub struct InitializeCtr<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = CTR_SPACE,
        seeds = [b"ctr_state", token_mint.as_ref()],
        bump
    )]
    pub ctr_state: Account<'info, ClaimTopicsState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateCtr<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"ctr_state", ctr_state.token_mint.as_ref()],
        bump = ctr_state.bump,
        has_one = owner @ FracksCtrError::NotOwner
    )]
    pub ctr_state: Account<'info, ClaimTopicsState>,
}

#[account]
pub struct ClaimTopicsState {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub topics: Vec<u64>,
    pub bump: u8,
}

#[event]
pub struct ClaimTopicAdded {
    pub topic_id: u64,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ClaimTopicRemoved {
    pub topic_id: u64,
    pub by_owner: Pubkey,
    pub timestamp: i64,
}

#[error_code(offset = 0)]
pub enum FracksCtrError {
    #[msg("Signer is not the owner.")]
    NotOwner = 6000,
    #[msg("Maximum topics reached.")]
    MaxTopicsReached = 6039,
    #[msg("Topic already exists.")]
    TopicAlreadyExists = 6040,
    #[msg("Topic not found.")]
    TopicNotFound = 6041,
    #[msg("Owner address is invalid.")]
    InvalidOwner = 6042,
}
