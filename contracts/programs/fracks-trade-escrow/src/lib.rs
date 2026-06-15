use anchor_lang::prelude::*;

declare_id!("8W8ghNUHsMkeLZjwi6dNk99ij5kbxPSXGGuDnpxv5h44");

const TRADE_ESCROW_SPACE: usize = 8 + 384;
const INSTITUTION_ROLE_SPACE: usize = 8 + 160;

#[program]
pub mod fracks_trade_escrow {
    use super::*;

    pub fn grant_institution_role(
        ctx: Context<GrantInstitutionRole>,
        token_mint: Pubkey,
        institution_wallet: Pubkey,
        max_balance_override: u64,
    ) -> Result<()> {
        let role = &mut ctx.accounts.institution_role;
        role.token_mint = token_mint;
        role.owner = ctx.accounts.owner.key();
        role.institution_wallet = institution_wallet;
        role.max_balance_override = max_balance_override;
        role.is_active = true;
        role.created_at = Clock::get()?.unix_timestamp;
        role.bump = ctx.bumps.institution_role;

        emit!(InstitutionRoleGranted {
            token_mint,
            owner: role.owner,
            institution_wallet,
            max_balance_override,
        });

        Ok(())
    }

    pub fn revoke_institution_role(ctx: Context<RevokeInstitutionRole>) -> Result<()> {
        require_keys_eq!(ctx.accounts.owner.key(), ctx.accounts.institution_role.owner, FracksTradeEscrowError::UnauthorizedOwner);
        ctx.accounts.institution_role.is_active = false;

        emit!(InstitutionRoleRevoked {
            token_mint: ctx.accounts.institution_role.token_mint,
            institution_wallet: ctx.accounts.institution_role.institution_wallet,
            owner: ctx.accounts.owner.key(),
        });

        Ok(())
    }

    pub fn initiate_trade(
        ctx: Context<InitiateTrade>,
        args: InitiateTradeArgs,
    ) -> Result<()> {
        require!(args.token_amount > 0, FracksTradeEscrowError::InvalidTokenAmount);
        require!(args.price_per_token > 0, FracksTradeEscrowError::InvalidPrice);

        let escrow = &mut ctx.accounts.trade_escrow;
        escrow.trade_id = args.trade_id;
        escrow.token_mint = args.token_mint;
        escrow.seller = ctx.accounts.seller.key();
        escrow.buyer = args.buyer;
        escrow.token_amount = args.token_amount;
        escrow.price_per_token = args.price_per_token;
        escrow.payment_reference_hash = args.payment_reference_hash;
        escrow.quick_exit = args.quick_exit;
        escrow.status = TradeStatus::Initiated as u8;
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.locked_at = 0;
        escrow.payment_confirmed_at = 0;
        escrow.settled_at = 0;
        escrow.cancelled_at = 0;
        escrow.bump = ctx.bumps.trade_escrow;

        emit!(TradeInitiated {
            trade: escrow.key(),
            trade_id: escrow.trade_id,
            token_mint: escrow.token_mint,
            seller: escrow.seller,
            buyer: escrow.buyer,
            token_amount: escrow.token_amount,
            price_per_token: escrow.price_per_token,
            quick_exit: escrow.quick_exit,
        });

        Ok(())
    }

    pub fn lock_tokens(ctx: Context<MutateTrade>) -> Result<()> {
        let escrow = &mut ctx.accounts.trade_escrow;
        require_keys_eq!(ctx.accounts.authority.key(), escrow.seller, FracksTradeEscrowError::UnauthorizedSeller);
        require!(escrow.status == TradeStatus::Initiated as u8, FracksTradeEscrowError::InvalidTradeStatus);
        escrow.status = TradeStatus::TokensLocked as u8;
        escrow.locked_at = Clock::get()?.unix_timestamp;

        emit!(TradeTokensLocked {
            trade: escrow.key(),
            trade_id: escrow.trade_id,
            seller: escrow.seller,
        });

        Ok(())
    }

    pub fn confirm_buyer_payment(ctx: Context<MutateTrade>, payment_reference_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.trade_escrow;
        require!(escrow.status == TradeStatus::TokensLocked as u8, FracksTradeEscrowError::InvalidTradeStatus);
        let signer = ctx.accounts.authority.key();
        require!(
            escrow.buyer == Pubkey::default() || signer == escrow.buyer || signer == escrow.seller,
            FracksTradeEscrowError::UnauthorizedPaymentConfirmer
        );
        escrow.payment_reference_hash = payment_reference_hash;
        escrow.status = TradeStatus::PaymentConfirmed as u8;
        escrow.payment_confirmed_at = Clock::get()?.unix_timestamp;

        emit!(TradePaymentConfirmed {
            trade: escrow.key(),
            trade_id: escrow.trade_id,
            authority: signer,
            payment_reference_hash,
        });

        Ok(())
    }

    pub fn settle_trade(ctx: Context<MutateTrade>, settlement_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.trade_escrow;
        require!(escrow.status == TradeStatus::PaymentConfirmed as u8, FracksTradeEscrowError::InvalidTradeStatus);
        let signer = ctx.accounts.authority.key();
        require!(
            signer == escrow.seller || escrow.buyer == Pubkey::default() || signer == escrow.buyer,
            FracksTradeEscrowError::UnauthorizedSettlement
        );
        escrow.settlement_hash = settlement_hash;
        escrow.status = TradeStatus::Settled as u8;
        escrow.settled_at = Clock::get()?.unix_timestamp;

        emit!(TradeSettled {
            trade: escrow.key(),
            trade_id: escrow.trade_id,
            authority: signer,
            settlement_hash,
        });

        Ok(())
    }

    pub fn cancel_trade(ctx: Context<MutateTrade>, reason_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.trade_escrow;
        require!(
            escrow.status == TradeStatus::Initiated as u8 || escrow.status == TradeStatus::TokensLocked as u8,
            FracksTradeEscrowError::InvalidTradeStatus
        );
        let signer = ctx.accounts.authority.key();
        require!(
            signer == escrow.seller || escrow.buyer == Pubkey::default() || signer == escrow.buyer,
            FracksTradeEscrowError::UnauthorizedCancellation
        );
        escrow.cancellation_reason_hash = reason_hash;
        escrow.status = TradeStatus::Cancelled as u8;
        escrow.cancelled_at = Clock::get()?.unix_timestamp;

        emit!(TradeCancelled {
            trade: escrow.key(),
            trade_id: escrow.trade_id,
            authority: signer,
            reason_hash,
        });

        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitiateTradeArgs {
    pub trade_id: u64,
    pub token_mint: Pubkey,
    pub buyer: Pubkey,
    pub token_amount: u64,
    pub price_per_token: u64,
    pub payment_reference_hash: [u8; 32],
    pub quick_exit: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TradeStatus {
    Initiated = 1,
    TokensLocked = 2,
    PaymentConfirmed = 3,
    Settled = 4,
    Cancelled = 5,
}

#[derive(Accounts)]
#[instruction(token_mint: Pubkey, institution_wallet: Pubkey)]
pub struct GrantInstitutionRole<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = INSTITUTION_ROLE_SPACE,
        seeds = [b"institution", token_mint.as_ref(), institution_wallet.as_ref()],
        bump
    )]
    pub institution_role: Account<'info, InstitutionRole>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeInstitutionRole<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub institution_role: Account<'info, InstitutionRole>,
}

#[derive(Accounts)]
#[instruction(args: InitiateTradeArgs)]
pub struct InitiateTrade<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        init,
        payer = seller,
        space = TRADE_ESCROW_SPACE,
        seeds = [b"trade_escrow", args.trade_id.to_le_bytes().as_ref()],
        bump
    )]
    pub trade_escrow: Account<'info, TradeEscrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateTrade<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"trade_escrow", &trade_escrow.trade_id.to_le_bytes()],
        bump = trade_escrow.bump
    )]
    pub trade_escrow: Account<'info, TradeEscrow>,
}

#[account]
pub struct InstitutionRole {
    pub token_mint: Pubkey,
    pub owner: Pubkey,
    pub institution_wallet: Pubkey,
    pub max_balance_override: u64,
    pub is_active: bool,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
pub struct TradeEscrow {
    pub trade_id: u64,
    pub token_mint: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub token_amount: u64,
    pub price_per_token: u64,
    pub payment_reference_hash: [u8; 32],
    pub settlement_hash: [u8; 32],
    pub cancellation_reason_hash: [u8; 32],
    pub quick_exit: bool,
    pub status: u8,
    pub created_at: i64,
    pub locked_at: i64,
    pub payment_confirmed_at: i64,
    pub settled_at: i64,
    pub cancelled_at: i64,
    pub bump: u8,
}

#[event]
pub struct InstitutionRoleGranted {
    pub token_mint: Pubkey,
    pub owner: Pubkey,
    pub institution_wallet: Pubkey,
    pub max_balance_override: u64,
}

#[event]
pub struct InstitutionRoleRevoked {
    pub token_mint: Pubkey,
    pub institution_wallet: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct TradeInitiated {
    pub trade: Pubkey,
    pub trade_id: u64,
    pub token_mint: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub token_amount: u64,
    pub price_per_token: u64,
    pub quick_exit: bool,
}

#[event]
pub struct TradeTokensLocked {
    pub trade: Pubkey,
    pub trade_id: u64,
    pub seller: Pubkey,
}

#[event]
pub struct TradePaymentConfirmed {
    pub trade: Pubkey,
    pub trade_id: u64,
    pub authority: Pubkey,
    pub payment_reference_hash: [u8; 32],
}

#[event]
pub struct TradeSettled {
    pub trade: Pubkey,
    pub trade_id: u64,
    pub authority: Pubkey,
    pub settlement_hash: [u8; 32],
}

#[event]
pub struct TradeCancelled {
    pub trade: Pubkey,
    pub trade_id: u64,
    pub authority: Pubkey,
    pub reason_hash: [u8; 32],
}

#[error_code(offset = 7800)]
pub enum FracksTradeEscrowError {
    #[msg("Signer is not the token owner.")]
    UnauthorizedOwner,
    #[msg("Token amount must be greater than zero.")]
    InvalidTokenAmount,
    #[msg("Price per token must be greater than zero.")]
    InvalidPrice,
    #[msg("Signer is not the seller.")]
    UnauthorizedSeller,
    #[msg("Trade is not in the required status.")]
    InvalidTradeStatus,
    #[msg("Signer cannot confirm buyer payment.")]
    UnauthorizedPaymentConfirmer,
    #[msg("Signer cannot settle this trade.")]
    UnauthorizedSettlement,
    #[msg("Signer cannot cancel this trade.")]
    UnauthorizedCancellation,
}
