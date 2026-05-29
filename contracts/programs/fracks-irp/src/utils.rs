use anchor_lang::prelude::*;

use crate::{
    ClaimAccountView, FracksIrpError, IdentityRegistryStorageStateView, IssuerEntryView,
    WalletIdentityView,
};

const CLAIM_ACCOUNT_DISCRIMINATOR: [u8; 8] = [113, 109, 47, 96, 242, 219, 61, 165];
const ISSUER_ENTRY_DISCRIMINATOR: [u8; 8] = [11, 211, 245, 253, 249, 156, 104, 93];

pub fn deserialize_view<T: AnchorDeserialize>(account: &AccountInfo) -> Result<T> {
    let data = account.try_borrow_data()?;
    require!(data.len() >= 8, FracksIrpError::InvalidRegistryReference);
    let mut slice: &[u8] = &data[8..];
    T::deserialize(&mut slice).map_err(|_| error!(FracksIrpError::InvalidRegistryReference))
}

fn has_account_discriminator(account: &AccountInfo, discriminator: &[u8; 8]) -> Result<bool> {
    let data = account.try_borrow_data()?;
    if data.len() < 8 {
        return Ok(false);
    }
    Ok(data[..8] == discriminator[..])
}

pub fn find_wallet_identity<'info>(
    wallet: &Pubkey,
    irs: &Pubkey,
    wallet_identity_info: &AccountInfo<'info>,
) -> Result<Option<WalletIdentityView>> {
    if wallet_identity_info.owner == &System::id() {
        return Ok(None);
    }

    let expected_wallet_identity = Pubkey::find_program_address(
        &[b"wallet_identity", irs.as_ref(), wallet.as_ref()],
        &fracks_irs::id(),
    )
    .0;
    if wallet_identity_info.key() != expected_wallet_identity {
        return Ok(None);
    }

    let identity = deserialize_view::<WalletIdentityView>(wallet_identity_info)?;
    if identity.wallet != *wallet || identity.irs != *irs {
        return Ok(None);
    }
    Ok(Some(identity))
}

pub fn verify_claim_for_topic(
    holder_fid: Pubkey,
    topic: u64,
    tir_state: &Pubkey,
    remaining_accounts: &[AccountInfo],
    now: i64,
) -> Result<bool> {
    for account in remaining_accounts {
        if account.owner != &fracks_fid::id()
            || !has_account_discriminator(account, &CLAIM_ACCOUNT_DISCRIMINATOR)?
        {
            continue;
        }
        let claim = match deserialize_view::<ClaimAccountView>(account) {
            Ok(claim) => claim,
            Err(_) => continue,
        };

        let expected_claim = Pubkey::find_program_address(
            &[b"claim", claim.fid.as_ref(), &claim.claim_id.to_le_bytes()],
            &fracks_fid::id(),
        )
        .0;
        if account.key() != expected_claim {
            continue;
        }

        if claim.fid != holder_fid
            || claim.topic != topic
            || claim.revoked
            || (claim.expires_at != 0 && claim.expires_at < now)
        {
            continue;
        }

        let issuer_entry = match find_issuer_entry(remaining_accounts, tir_state, &claim.issuer_fid) {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !issuer_entry.is_active || !issuer_entry.allowed_topics.contains(&topic) {
            continue;
        }
        let expected_issuer_fid = Pubkey::find_program_address(
            &[b"fid", claim.signer_key.as_ref()],
            &fracks_fid::id(),
        )
        .0;
        if claim.issuer_fid == expected_issuer_fid {
            return Ok(true);
        }
    }

    Ok(false)
}

fn find_issuer_entry(
    accounts: &[AccountInfo],
    tir_state: &Pubkey,
    issuer_fid: &Pubkey,
) -> Result<IssuerEntryView> {
    for account in accounts {
        if account.owner != &fracks_tir::id()
            || !has_account_discriminator(account, &ISSUER_ENTRY_DISCRIMINATOR)?
        {
            continue;
        }
        if let Ok(entry) = deserialize_view::<IssuerEntryView>(account) {
            let expected_entry = Pubkey::find_program_address(
                &[b"issuer_entry", tir_state.as_ref(), issuer_fid.as_ref()],
                &fracks_tir::id(),
            )
            .0;
            if account.key() == expected_entry && entry.tir == *tir_state && entry.issuer_fid == *issuer_fid {
                return Ok(entry);
            }
        }
    }

    err!(FracksIrpError::TrustedIssuerNotFound)
}

pub fn ensure_bound_registry(irs_state: &IdentityRegistryStorageStateView, irp: &Pubkey) -> Result<()> {
    require!(
        irs_state.bound_registries.contains(irp),
        FracksIrpError::InvalidRegistryReference
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::AnchorSerialize;
    use anchor_lang::solana_program::clock::Epoch;

    fn account_info_with_data(key: Pubkey, owner: Pubkey, payload: Vec<u8>) -> AccountInfo<'static> {
        let key = Box::leak(Box::new(key));
        let owner = Box::leak(Box::new(owner));
        let lamports = Box::leak(Box::new(0u64));
        let data = Box::leak(payload.into_boxed_slice());
        AccountInfo::new(key, false, false, lamports, data, owner, false, Epoch::default())
    }

    fn serialize_account<T: AnchorSerialize>(value: &T) -> Vec<u8> {
        let mut data = vec![0u8; 8];
        value.serialize(&mut data).expect("serialize");
        data
    }

    #[test]
    fn rejects_wallet_identity_on_wrong_pda() {
        let wallet = Pubkey::new_unique();
        let irs = Pubkey::new_unique();
        let wrong_key = Pubkey::new_unique();
        let identity = WalletIdentityView {
            wallet,
            fid: Pubkey::new_unique(),
            country: 840,
            irs,
            is_active: true,
            activated_by: Pubkey::new_unique(),
            activated_at: 1,
            bump: 0,
        };
        let account = account_info_with_data(wrong_key, fracks_irs::id(), serialize_account(&identity));

        let resolved = find_wallet_identity(&wallet, &irs, &account).expect("find_wallet_identity");
        assert!(resolved.is_none());
    }

    #[test]
    fn rejects_claim_remaining_account_on_wrong_pda() {
        let holder_fid = Pubkey::new_unique();
        let fake_claim_key = Pubkey::new_unique();
        let claim = ClaimAccountView {
            fid: holder_fid,
            claim_id: 0,
            topic: 1,
            issuer_fid: Pubkey::new_unique(),
            data_hash: [7u8; 32],
            signer_key: Pubkey::new_unique(),
            signature: [9u8; 64],
            issued_at: 1,
            expires_at: 0,
            revoked: false,
            bump: 0,
        };
        let fake_claim = account_info_with_data(fake_claim_key, fracks_fid::id(), serialize_account(&claim));

        let verified = verify_claim_for_topic(holder_fid, 1, &Pubkey::new_unique(), &[fake_claim], 10)
            .expect("verify_claim_for_topic");
        assert!(!verified);
    }
}
