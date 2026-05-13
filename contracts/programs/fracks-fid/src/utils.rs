use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use solana_program::{
    ed25519_program,
    hash::hash,
    sysvar::instructions::{load_current_index_checked, load_instruction_at_checked},
};

use crate::FracksFidError;

const ED25519_SERIALIZED_OFFSETS_START: usize = 2;
const ED25519_OFFSETS_SIZE: usize = 14;
const ED25519_HEADER_SIZE: usize = ED25519_SERIALIZED_OFFSETS_START + ED25519_OFFSETS_SIZE;
const ED25519_SIGNATURE_SIZE: usize = 64;
const ED25519_PUBKEY_SIZE: usize = 32;

pub fn construct_claim_message(
    issuer_fid: &Pubkey,
    holder_fid: &Pubkey,
    topic: u64,
    data_hash: &[u8; 32],
    expires_at: i64,
) -> [u8; 32] {
    let mut payload = Vec::with_capacity(112);
    payload.extend_from_slice(issuer_fid.as_ref());
    payload.extend_from_slice(holder_fid.as_ref());
    payload.extend_from_slice(&topic.to_le_bytes());
    payload.extend_from_slice(data_hash);
    payload.extend_from_slice(&expires_at.to_le_bytes());
    hash(&payload).to_bytes()
}

pub fn verify_ed25519_instruction(
    instructions_sysvar: &AccountInfo,
    expected_pubkey: &Pubkey,
    expected_message: &[u8; 32],
    expected_signature: &[u8; 64],
) -> Result<()> {
    require_keys_eq!(
        instructions_sysvar.key(),
        solana_program::sysvar::instructions::id(),
        FracksFidError::InvalidInstructionsSysvar
    );

    let current_index = load_current_index_checked(instructions_sysvar)? as usize;
    require!(current_index > 0, FracksFidError::MissingEd25519Instruction);

    for ix_index in (0..current_index).rev() {
        let instruction = load_instruction_at_checked(ix_index, instructions_sysvar)?;
        if instruction.program_id != ed25519_program::id() {
            continue;
        }

        return verify_ed25519_data(
            &instruction,
            expected_pubkey,
            expected_message,
            expected_signature,
        );
    }

    err!(FracksFidError::MissingEd25519Instruction)
}

fn verify_ed25519_data(
    instruction: &Instruction,
    expected_pubkey: &Pubkey,
    expected_message: &[u8; 32],
    expected_signature: &[u8; 64],
) -> Result<()> {
    let data = instruction.data.as_slice();

    require!(data.len() >= ED25519_HEADER_SIZE, FracksFidError::InvalidClaimSignature);
    require!(data[0] == 1, FracksFidError::InvalidClaimSignature);

    let signature_offset = read_u16(data, 2)? as usize;
    let signature_instruction_index = read_u16(data, 4)?;
    let public_key_offset = read_u16(data, 6)? as usize;
    let public_key_instruction_index = read_u16(data, 8)?;
    let message_data_offset = read_u16(data, 10)? as usize;
    let message_data_size = read_u16(data, 12)? as usize;
    let message_instruction_index = read_u16(data, 14)?;

    require!(
        signature_instruction_index == u16::MAX
            && public_key_instruction_index == u16::MAX
            && message_instruction_index == u16::MAX,
        FracksFidError::InvalidClaimSignature
    );
    require!(
        message_data_size == expected_message.len(),
        FracksFidError::InvalidClaimSignature
    );

    let public_key = slice(data, public_key_offset, ED25519_PUBKEY_SIZE)?;
    let signature = slice(data, signature_offset, ED25519_SIGNATURE_SIZE)?;
    let message = slice(data, message_data_offset, message_data_size)?;

    require!(public_key == expected_pubkey.as_ref(), FracksFidError::InvalidClaimSignature);
    require!(
        signature == expected_signature.as_slice(),
        FracksFidError::InvalidClaimSignature
    );
    require!(
        message == expected_message.as_slice(),
        FracksFidError::InvalidClaimSignature
    );

    Ok(())
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = slice(data, offset, 2)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn slice(data: &[u8], offset: usize, len: usize) -> Result<&[u8]> {
    data.get(offset..offset.saturating_add(len))
        .ok_or_else(|| error!(FracksFidError::InvalidClaimSignature))
}
