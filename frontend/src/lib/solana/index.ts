import {
  Connection,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
  type AccountMeta,
} from '@solana/web3.js';
import { AnchorProvider, Program, setProvider, type Idl } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import factoryIdl from '@/lib/solana/idl/fracks_factory.json';
import tokenIdl from '@/lib/solana/idl/fracks_token.json';
import irpIdl from '@/lib/solana/idl/fracks_irp.json';
import irsIdl from '@/lib/solana/idl/fracks_irs.json';
import tirIdl from '@/lib/solana/idl/fracks_tir.json';
import ctrIdl from '@/lib/solana/idl/fracks_ctr.json';
import complianceIdl from '@/lib/solana/idl/fracks_compliance.json';
import fidIdl from '@/lib/solana/idl/fracks_fid.json';
import { RPC_URL } from '@/lib/constants';

// 1) Program constants (verified from ERC-3436/programs/*/src/lib.rs declare_id! macros)
export const PROGRAM_IDS = {
  factory: new PublicKey(process.env.NEXT_PUBLIC_FACTORY_PROGRAM_ID || '6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe'),
  token: new PublicKey(process.env.NEXT_PUBLIC_TOKEN_PROGRAM_ID || '92MCTz2KpWqhSD7LWay97LmZbdmpAj4fJ3FXtV7rbW9s'),
  tokenHook: new PublicKey(process.env.NEXT_PUBLIC_TOKEN_HOOK_PROGRAM_ID || '4sLPqAViuzo1yJJExKn2TfP42enBQPhvAUZq5japm85m'),
  irp: new PublicKey(process.env.NEXT_PUBLIC_IRP_PROGRAM_ID || 'C8jtErJYtuu7pSZczfSm1JvDmv254Nmmw1KLX6rBdY8o'),
  irs: new PublicKey(process.env.NEXT_PUBLIC_IRS_PROGRAM_ID || 'GSLErK4bEfF6ZozTWfjYikWfnBitMYrdbbgfXubJBgVJ'),
  tir: new PublicKey(process.env.NEXT_PUBLIC_TIR_PROGRAM_ID || '8KDYYPx74w6ZLKZgcvVWrj1mCv1gcULdTh2jbxcJwGMJ'),
  ctr: new PublicKey(process.env.NEXT_PUBLIC_CTR_PROGRAM_ID || '12rCF9fuSth8T3o6sfpfWdGyaDEQ1jNsxe1ZvKH7q2tS'),
  compliance: new PublicKey(process.env.NEXT_PUBLIC_COMPLIANCE_PROGRAM_ID || 'FhMXw2VmYYksR4VcjQCUNWYrhzba1rmfiU1EDvaTsxHj'),
  fid: new PublicKey(process.env.NEXT_PUBLIC_FID_PROGRAM_ID || 'EoENMXgL9GZBEVfjhn5KU4SkfjZeyoTEdd8NHAcMQsEB'),
} as const;

export const PROGRAM_ID = PROGRAM_IDS.token;
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export const connection = new Connection(
  RPC_URL,
  'confirmed',
);

// 2) Provider factory
export function getProvider(wallet: AnchorWallet): AnchorProvider {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  setProvider(provider);
  return provider;
}

// 3) Program factories
export function getProgram<T extends Idl>(wallet: AnchorWallet, idl: T, programId: PublicKey = PROGRAM_ID): Program<T> {
  const idlWithAddress = { ...(idl as Record<string, unknown>), address: programId.toBase58() } as T;
  return new Program(idlWithAddress, getProvider(wallet));
}

export function getProgramById<T extends Idl>(wallet: AnchorWallet, programId: PublicKey, idl: T): Program<T> {
  const idlWithAddress = { ...(idl as Record<string, unknown>), address: programId.toBase58() } as T;
  return new Program(idlWithAddress, getProvider(wallet));
}

// Named program getters (use these in hooks/components instead of raw getProgram)
export const getFactoryProgram = (wallet: AnchorWallet) =>
  getProgram(wallet, factoryIdl as Idl, PROGRAM_IDS.factory);
export const getTokenProgram = (wallet: AnchorWallet) =>
  getProgram(wallet, tokenIdl as Idl, PROGRAM_IDS.token);
export const getIrpProgram = (wallet: AnchorWallet) =>
  getProgram(wallet, irpIdl as Idl, PROGRAM_IDS.irp);
export const getIrsProgram = (wallet: AnchorWallet) =>
  getProgram(wallet, irsIdl as Idl, PROGRAM_IDS.irs);
export const getTirProgram = (wallet: AnchorWallet) =>
  getProgram(wallet, tirIdl as Idl, PROGRAM_IDS.tir);
export const getCtrProgram = (wallet: AnchorWallet) =>
  getProgram(wallet, ctrIdl as Idl, PROGRAM_IDS.ctr);
export const getComplianceProgram = (wallet: AnchorWallet) =>
  getProgram(wallet, complianceIdl as Idl, PROGRAM_IDS.compliance);
export const getFidProgram = (wallet: AnchorWallet) =>
  getProgram(wallet, fidIdl as Idl, PROGRAM_IDS.fid);

// 4) PDA derivations (verified from seeds = [...] in Rust account constraints)
export function deriveTokenStatePDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('token_state'), tokenMint.toBuffer()], PROGRAM_IDS.token);
}

export function deriveOwnerStatePDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('owner'), tokenMint.toBuffer()], PROGRAM_IDS.token);
}

export function deriveAgentRolePDA(tokenMint: PublicKey, agent: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), tokenMint.toBuffer(), agent.toBuffer()],
    PROGRAM_IDS.token,
  );
}

export function deriveFrozenWalletPDA(tokenMint: PublicKey, wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('frozen'), tokenMint.toBuffer(), wallet.toBuffer()],
    PROGRAM_IDS.token,
  );
}

export function derivePartialFreezePDA(tokenMint: PublicKey, wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('partial_freeze'), tokenMint.toBuffer(), wallet.toBuffer()],
    PROGRAM_IDS.token,
  );
}

export function deriveTransferApprovalPDA(
  sourceTokenAccount: PublicKey,
  destinationTokenAccount: PublicKey,
  authoritySeed: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('transfer_approval'),
      sourceTokenAccount.toBuffer(),
      destinationTokenAccount.toBuffer(),
      authoritySeed.toBuffer(),
    ],
    PROGRAM_IDS.tokenHook,
  );
}

export function deriveExtraAccountMetasPDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), tokenMint.toBuffer()],
    PROGRAM_IDS.tokenHook,
  );
}

export function deriveIrpStatePDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('irp_state'), tokenMint.toBuffer()], PROGRAM_IDS.irp);
}

export function deriveIrsStatePDA(authoritySeed: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('irs_state'), authoritySeed.toBuffer()], PROGRAM_IDS.irs);
}

export function deriveWalletIdentityPDA(irsState: PublicKey, wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('wallet_identity'), irsState.toBuffer(), wallet.toBuffer()],
    PROGRAM_IDS.irs,
  );
}

export function deriveTirStatePDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('tir_state'), tokenMint.toBuffer()], PROGRAM_IDS.tir);
}

export function deriveIssuerEntryPDA(tirState: PublicKey, issuerFid: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('issuer_entry'), tirState.toBuffer(), issuerFid.toBuffer()],
    PROGRAM_IDS.tir,
  );
}

export function deriveCtrStatePDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('ctr_state'), tokenMint.toBuffer()], PROGRAM_IDS.ctr);
}

export function deriveComplianceStatePDA(tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('compliance_state'), tokenMint.toBuffer()],
    PROGRAM_IDS.compliance,
  );
}

export function deriveFidPDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('fid'), owner.toBuffer()], PROGRAM_IDS.fid);
}

export function deriveClaimPDA(fid: PublicKey, claimId: number): [PublicKey, number] {
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(claimId, 0);
  return PublicKey.findProgramAddressSync([Buffer.from('claim'), fid.toBuffer(), idBuf], PROGRAM_IDS.fid);
}

export function deriveFactoryStatePDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('factory_state')], PROGRAM_IDS.factory);
}

export function deriveDeploymentPDA(issuer: PublicKey, salt32: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('deployment'), issuer.toBuffer(), salt32], PROGRAM_IDS.factory);
}

// 5) Instruction data encoders/builders
const INSTRUCTION_DISCRIMINATORS: Record<string, number[]> = {
  initialize_token: [38, 209, 150, 50, 190, 117, 16, 54],
  transfer: [163, 52, 200, 231, 140, 3, 69, 186],
  mint: [51, 57, 225, 47, 182, 146, 137, 166],
  burn: [116, 110, 29, 56, 107, 219, 42, 93],
  forced_transfer: [60, 52, 242, 236, 23, 136, 230, 190],
  recovery: [248, 90, 255, 146, 157, 182, 171, 170],
  finalize_recovery: [180, 175, 56, 254, 138, 101, 151, 219],
  pause: [211, 22, 221, 251, 74, 121, 193, 47],
  unpause: [169, 144, 4, 38, 10, 141, 188, 255],
  set_identity_registry: [166, 159, 194, 134, 36, 79, 162, 255],
  set_compliance: [46, 128, 120, 26, 105, 175, 165, 6],
  add_agent: [214, 206, 14, 110, 178, 131, 218, 45],
  remove_agent: [126, 25, 90, 199, 104, 237, 225, 130],
  transfer_ownership: [65, 177, 215, 73, 53, 45, 99, 47],
  accept_ownership: [172, 23, 43, 13, 238, 213, 85, 150],
  freeze_wallet: [93, 202, 159, 167, 22, 246, 255, 211],
  unfreeze_wallet: [246, 148, 196, 60, 209, 142, 99, 68],
  freeze_partial: [19, 13, 72, 194, 88, 59, 68, 51],
  unfreeze_partial: [90, 232, 228, 78, 237, 178, 102, 144],
  initialize_extra_account_metas: [22, 213, 130, 114, 1, 174, 121, 36],
  approve_transfer: [198, 217, 247, 150, 208, 60, 169, 244],
  execute_transfer_hook: [120, 157, 67, 141, 88, 144, 143, 220],
  initialize_registry: [189, 181, 20, 17, 174, 57, 249, 59],
  add_identity_agent: [244, 250, 152, 218, 162, 27, 164, 214],
  remove_identity_agent: [212, 220, 16, 202, 67, 181, 224, 234],
  update_irs_reference: [20, 149, 161, 98, 151, 20, 113, 239],
  update_tir_reference: [145, 204, 216, 68, 163, 1, 119, 61],
  update_ctr_reference: [94, 88, 135, 53, 9, 209, 48, 89],
  transfer_registry_ownership: [15, 209, 120, 148, 23, 37, 97, 28],
  is_verified: [142, 197, 107, 116, 247, 60, 229, 238],
  initialize_irs: [52, 219, 31, 53, 202, 226, 171, 52],
  bind_registry: [173, 242, 89, 1, 153, 173, 129, 108],
  unbind_registry: [114, 46, 163, 242, 212, 25, 179, 186],
  register_identity: [164, 118, 227, 177, 47, 176, 187, 248],
  update_identity: [130, 54, 88, 104, 222, 124, 238, 252],
  update_country: [142, 211, 229, 157, 37, 199, 79, 194],
  remove_identity: [146, 93, 160, 7, 61, 138, 181, 113],
  initialize_tir: [208, 51, 155, 69, 110, 179, 90, 141],
  add_trusted_issuer: [172, 111, 139, 169, 229, 89, 73, 214],
  update_issuer_topics: [22, 245, 20, 152, 126, 159, 240, 85],
  deactivate_issuer: [52, 10, 163, 187, 247, 22, 150, 37],
  reactivate_issuer: [174, 162, 75, 94, 50, 88, 97, 99],
  remove_trusted_issuer: [249, 241, 232, 207, 37, 38, 64, 221],
  is_trusted_for_topic: [17, 100, 173, 213, 91, 86, 32, 102],
  initialize_ctr: [42, 126, 125, 199, 230, 35, 174, 167],
  add_claim_topic: [161, 108, 94, 222, 8, 165, 138, 97],
  remove_claim_topic: [227, 165, 23, 147, 154, 68, 26, 221],
  initialize_compliance: [77, 93, 116, 221, 108, 121, 232, 145],
  bind_module: [204, 76, 224, 62, 21, 167, 210, 117],
  unbind_module: [111, 182, 247, 190, 48, 145, 187, 67],
  set_modules_paused: [12, 128, 245, 18, 209, 111, 131, 155],
  call_module_function: [128, 194, 221, 247, 80, 181, 107, 234],
  can_transfer: [233, 153, 157, 96, 140, 58, 200, 137],
  transferred: [234, 216, 64, 126, 163, 136, 73, 206],
  created: [181, 154, 183, 237, 76, 88, 131, 92],
  destroyed: [212, 251, 145, 156, 56, 131, 108, 36],
  create_fid: [170, 229, 98, 240, 20, 109, 122, 238],
  set_management_key: [218, 115, 203, 190, 29, 167, 60, 248],
  set_signer_key: [3, 33, 201, 254, 15, 8, 55, 21],
  add_claim: [70, 114, 85, 106, 66, 244, 46, 99],
  revoke_claim: [182, 1, 142, 33, 207, 153, 37, 132],
  remove_claim: [4, 246, 59, 78, 67, 11, 210, 12],
  initialize_factory: [179, 64, 75, 250, 39, 254, 240, 178],
  update_program_ids: [64, 125, 148, 202, 2, 202, 189, 189],
  transfer_factory_ownership: [134, 88, 151, 250, 30, 237, 59, 180],
  create_token_mint: [35, 109, 237, 196, 54, 218, 33, 119],
  deploy_token_suite: [133, 32, 158, 211, 16, 63, 187, 87],
};

export function getInstructionDiscriminator(name: string): Buffer {
  const value = INSTRUCTION_DISCRIMINATORS[name];
  if (!value) throw new Error(`Missing discriminator for instruction: ${name}`);
  return Buffer.from(value);
}

export function encodeU8(value: number): Buffer {
  return Buffer.from([value & 0xff]);
}

export function encodeU16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

export function encodeU32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

export function encodeU64(value: bigint | number): Buffer {
  const v = typeof value === 'number' ? BigInt(value) : value;
  const out = new ArrayBuffer(8);
  const view = new DataView(out);
  view.setBigUint64(0, v, true);
  return Buffer.from(out);
}

export function encodeI64(value: bigint | number): Buffer {
  const v = typeof value === 'number' ? BigInt(value) : value;
  const out = new ArrayBuffer(8);
  const view = new DataView(out);
  view.setBigInt64(0, v, true);
  return Buffer.from(out);
}

export function encodeBool(value: boolean): Buffer {
  return Buffer.from([value ? 1 : 0]);
}

export function encodePubkey(value: PublicKey): Buffer {
  return value.toBuffer();
}

export function encodeString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([encodeU32(bytes.length), bytes]);
}

export function encodeBytes(bytes: Buffer | Uint8Array): Buffer {
  const buf = Buffer.from(bytes);
  return Buffer.concat([encodeU32(buf.length), buf]);
}

export function encodeFixedBytes(bytes: Buffer | Uint8Array, len: number): Buffer {
  const buf = Buffer.from(bytes);
  if (buf.length !== len) throw new Error(`Expected ${len} bytes, got ${buf.length}`);
  return buf;
}

export function encodeVecU64(values: number[]): Buffer {
  return Buffer.concat([encodeU32(values.length), ...values.map((v) => encodeU64(v))]);
}

export function encodeVecPubkey(values: PublicKey[]): Buffer {
  return Buffer.concat([encodeU32(values.length), ...values.map((v) => encodePubkey(v))]);
}

export function encodeOptionPubkey(value: PublicKey | null | undefined): Buffer {
  if (!value) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), value.toBuffer()]);
}

export function buildInstructionData(name: string, ...parts: Buffer[]): Buffer {
  return Buffer.concat([getInstructionDiscriminator(name), ...parts]);
}

export function buildInstruction(programId: PublicKey, keys: AccountMeta[], data: Buffer): TransactionInstruction {
  return new TransactionInstruction({ programId, keys, data });
}

// Program-specific instruction builders (all verified pub fn signatures)

// fracks-token
export function buildInitializeTokenInstruction(
  keys: AccountMeta[],
  args: {
    tokenMint: PublicKey;
    name: string;
    symbol: string;
    decimals: number;
    isin: string;
    identityRegistry: PublicKey;
    compliance: PublicKey;
  },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.token,
    keys,
    buildInstructionData(
      'initialize_token',
      encodePubkey(args.tokenMint),
      encodeString(args.name),
      encodeString(args.symbol),
      encodeU8(args.decimals),
      encodeString(args.isin),
      encodePubkey(args.identityRegistry),
      encodePubkey(args.compliance),
    ),
  );
}

export function buildTransferInstruction(
  keys: AccountMeta[],
  args: { amount: bigint | number; fromBalance: bigint | number; toBalance: bigint | number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.token,
    keys,
    buildInstructionData('transfer', encodeU64(args.amount), encodeU64(args.fromBalance), encodeU64(args.toBalance)),
  );
}

export function buildMintInstruction(
  keys: AccountMeta[],
  args: { to: PublicKey; amount: bigint | number; toBalanceAfter: bigint | number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.token,
    keys,
    buildInstructionData('mint', encodePubkey(args.to), encodeU64(args.amount), encodeU64(args.toBalanceAfter)),
  );
}

export function buildBurnInstruction(
  keys: AccountMeta[],
  args: { from: PublicKey; amount: bigint | number; fromBalanceAfter: bigint | number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.token,
    keys,
    buildInstructionData('burn', encodePubkey(args.from), encodeU64(args.amount), encodeU64(args.fromBalanceAfter)),
  );
}

export function buildForcedTransferInstruction(
  keys: AccountMeta[],
  args: {
    from: PublicKey;
    to: PublicKey;
    amount: bigint | number;
    fromBalance: bigint | number;
    toBalance: bigint | number;
  },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.token,
    keys,
    buildInstructionData(
      'forced_transfer',
      encodePubkey(args.from),
      encodePubkey(args.to),
      encodeU64(args.amount),
      encodeU64(args.fromBalance),
      encodeU64(args.toBalance),
    ),
  );
}

export function buildRecoveryInstruction(
  keys: AccountMeta[],
  args: { lostWallet: PublicKey; newWallet: PublicKey; amount: bigint | number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.token,
    keys,
    buildInstructionData('recovery', encodePubkey(args.lostWallet), encodePubkey(args.newWallet), encodeU64(args.amount)),
  );
}

export function buildFinalizeRecoveryInstruction(
  keys: AccountMeta[],
  args: { lostWallet: PublicKey; newWallet: PublicKey; amount: bigint | number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.token,
    keys,
    buildInstructionData(
      'finalize_recovery',
      encodePubkey(args.lostWallet),
      encodePubkey(args.newWallet),
      encodeU64(args.amount),
    ),
  );
}

export function buildPauseInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.token, keys, buildInstructionData('pause'));
}

export function buildUnpauseInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.token, keys, buildInstructionData('unpause'));
}

export function buildSetIdentityRegistryInstruction(
  keys: AccountMeta[],
  args: { newIdentityRegistry: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.token,
    keys,
    buildInstructionData('set_identity_registry', encodePubkey(args.newIdentityRegistry)),
  );
}

export function buildSetComplianceInstruction(
  keys: AccountMeta[],
  args: { newCompliance: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.token,
    keys,
    buildInstructionData('set_compliance', encodePubkey(args.newCompliance)),
  );
}

export function buildAddAgentInstruction(keys: AccountMeta[], args: { agent: PublicKey }): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.token, keys, buildInstructionData('add_agent', encodePubkey(args.agent)));
}

export function buildRemoveAgentInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.token, keys, buildInstructionData('remove_agent'));
}

export function buildTransferOwnershipInstruction(
  keys: AccountMeta[],
  args: { newOwner: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.token,
    keys,
    buildInstructionData('transfer_ownership', encodePubkey(args.newOwner)),
  );
}

export function buildAcceptOwnershipInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.token, keys, buildInstructionData('accept_ownership'));
}

export function buildFreezeWalletInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.token, keys, buildInstructionData('freeze_wallet'));
}

export function buildUnfreezeWalletInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.token, keys, buildInstructionData('unfreeze_wallet'));
}

export function buildFreezePartialInstruction(
  keys: AccountMeta[],
  args: { amount: bigint | number },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.token, keys, buildInstructionData('freeze_partial', encodeU64(args.amount)));
}

export function buildUnfreezePartialInstruction(
  keys: AccountMeta[],
  args: { amount: bigint | number },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.token, keys, buildInstructionData('unfreeze_partial', encodeU64(args.amount)));
}

// fracks-token-hook
export function buildInitializeExtraAccountMetasInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.tokenHook, keys, buildInstructionData('initialize_extra_account_metas'));
}

export function buildApproveTransferInstruction(
  keys: AccountMeta[],
  args: {
    sourceWallet: PublicKey;
    destinationWallet: PublicKey;
    authority: PublicKey;
    amount: bigint | number;
    fromBalance: bigint | number;
    toBalance: bigint | number;
    fromCountry: number;
    toCountry: number;
    kind: number;
  },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.tokenHook,
    keys,
    buildInstructionData(
      'approve_transfer',
      encodePubkey(args.sourceWallet),
      encodePubkey(args.destinationWallet),
      encodePubkey(args.authority),
      encodeU64(args.amount),
      encodeU64(args.fromBalance),
      encodeU64(args.toBalance),
      encodeU16(args.fromCountry),
      encodeU16(args.toCountry),
      encodeU8(args.kind),
    ),
  );
}

export function buildExecuteTransferHookInstruction(
  keys: AccountMeta[],
  args: { amount: bigint | number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.tokenHook,
    keys,
    buildInstructionData('execute_transfer_hook', encodeU64(args.amount)),
  );
}

// fracks-irp
export function buildInitializeRegistryInstruction(
  keys: AccountMeta[],
  args: { tokenMint: PublicKey; irs: PublicKey; tir: PublicKey; ctr: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.irp,
    keys,
    buildInstructionData(
      'initialize_registry',
      encodePubkey(args.tokenMint),
      encodePubkey(args.irs),
      encodePubkey(args.tir),
      encodePubkey(args.ctr),
    ),
  );
}

export function buildAddIdentityAgentInstruction(keys: AccountMeta[], args: { agent: PublicKey }): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.irp, keys, buildInstructionData('add_identity_agent', encodePubkey(args.agent)));
}

export function buildRemoveIdentityAgentInstruction(
  keys: AccountMeta[],
  args: { agent: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.irp,
    keys,
    buildInstructionData('remove_identity_agent', encodePubkey(args.agent)),
  );
}

export function buildUpdateIrsReferenceInstruction(
  keys: AccountMeta[],
  args: { newIrs: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.irp,
    keys,
    buildInstructionData('update_irs_reference', encodePubkey(args.newIrs)),
  );
}

export function buildUpdateTirReferenceInstruction(
  keys: AccountMeta[],
  args: { newTir: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.irp,
    keys,
    buildInstructionData('update_tir_reference', encodePubkey(args.newTir)),
  );
}

export function buildUpdateCtrReferenceInstruction(
  keys: AccountMeta[],
  args: { newCtr: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.irp,
    keys,
    buildInstructionData('update_ctr_reference', encodePubkey(args.newCtr)),
  );
}

export function buildTransferRegistryOwnershipInstruction(
  keys: AccountMeta[],
  args: { newOwner: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.irp,
    keys,
    buildInstructionData('transfer_registry_ownership', encodePubkey(args.newOwner)),
  );
}

export function buildIsVerifiedInstruction(keys: AccountMeta[], args: { wallet: PublicKey }): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.irp, keys, buildInstructionData('is_verified', encodePubkey(args.wallet)));
}

// fracks-irs
export function buildInitializeIrsInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.irs, keys, buildInstructionData('initialize_irs'));
}

export function buildBindRegistryInstruction(keys: AccountMeta[], args: { irpPubkey: PublicKey }): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.irs, keys, buildInstructionData('bind_registry', encodePubkey(args.irpPubkey)));
}

export function buildUnbindRegistryInstruction(
  keys: AccountMeta[],
  args: { irpPubkey: PublicKey },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.irs, keys, buildInstructionData('unbind_registry', encodePubkey(args.irpPubkey)));
}

export function buildRegisterIdentityInstruction(
  keys: AccountMeta[],
  args: { wallet: PublicKey; fid: PublicKey; country: number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.irs,
    keys,
    buildInstructionData(
      'register_identity',
      encodePubkey(args.wallet),
      encodePubkey(args.fid),
      encodeU16(args.country),
    ),
  );
}

export function buildUpdateIdentityInstruction(
  keys: AccountMeta[],
  args: { newFid: PublicKey },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.irs, keys, buildInstructionData('update_identity', encodePubkey(args.newFid)));
}

export function buildUpdateCountryInstruction(
  keys: AccountMeta[],
  args: { newCountry: number },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.irs, keys, buildInstructionData('update_country', encodeU16(args.newCountry)));
}

export function buildRemoveIdentityInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.irs, keys, buildInstructionData('remove_identity'));
}

// fracks-tir
export function buildInitializeTirInstruction(
  keys: AccountMeta[],
  args: { tokenMint: PublicKey },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.tir, keys, buildInstructionData('initialize_tir', encodePubkey(args.tokenMint)));
}

export function buildAddTrustedIssuerInstruction(
  keys: AccountMeta[],
  args: { issuerFid: PublicKey; topics: number[]; label: string },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.tir,
    keys,
    buildInstructionData(
      'add_trusted_issuer',
      encodePubkey(args.issuerFid),
      encodeVecU64(args.topics),
      encodeString(args.label),
    ),
  );
}

export function buildUpdateIssuerTopicsInstruction(
  keys: AccountMeta[],
  args: { newTopics: number[] },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.tir, keys, buildInstructionData('update_issuer_topics', encodeVecU64(args.newTopics)));
}

export function buildDeactivateIssuerInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.tir, keys, buildInstructionData('deactivate_issuer'));
}

export function buildReactivateIssuerInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.tir, keys, buildInstructionData('reactivate_issuer'));
}

export function buildRemoveTrustedIssuerInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.tir, keys, buildInstructionData('remove_trusted_issuer'));
}

export function buildIsTrustedForTopicInstruction(
  keys: AccountMeta[],
  args: { issuerFid: PublicKey; topic: bigint | number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.tir,
    keys,
    buildInstructionData('is_trusted_for_topic', encodePubkey(args.issuerFid), encodeU64(args.topic)),
  );
}

// fracks-ctr
export function buildInitializeCtrInstruction(
  keys: AccountMeta[],
  args: { tokenMint: PublicKey },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.ctr, keys, buildInstructionData('initialize_ctr', encodePubkey(args.tokenMint)));
}

export function buildAddClaimTopicInstruction(
  keys: AccountMeta[],
  args: { topicId: bigint | number },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.ctr, keys, buildInstructionData('add_claim_topic', encodeU64(args.topicId)));
}

export function buildRemoveClaimTopicInstruction(
  keys: AccountMeta[],
  args: { topicId: bigint | number },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.ctr, keys, buildInstructionData('remove_claim_topic', encodeU64(args.topicId)));
}

// fracks-compliance
export function buildInitializeComplianceInstruction(
  keys: AccountMeta[],
  args: { tokenMint: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.compliance,
    keys,
    buildInstructionData('initialize_compliance', encodePubkey(args.tokenMint)),
  );
}

export function buildBindModuleInstruction(
  keys: AccountMeta[],
  args: { modulePubkey: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.compliance,
    keys,
    buildInstructionData('bind_module', encodePubkey(args.modulePubkey)),
  );
}

export function buildUnbindModuleInstruction(
  keys: AccountMeta[],
  args: { modulePubkey: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.compliance,
    keys,
    buildInstructionData('unbind_module', encodePubkey(args.modulePubkey)),
  );
}

export function buildSetModulesPausedInstruction(
  keys: AccountMeta[],
  args: { paused: boolean },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.compliance,
    keys,
    buildInstructionData('set_modules_paused', encodeBool(args.paused)),
  );
}

export function buildCallModuleFunctionInstruction(
  keys: AccountMeta[],
  args: { data: Buffer | Uint8Array },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.compliance,
    keys,
    buildInstructionData('call_module_function', encodeBytes(args.data)),
  );
}

export function buildCanTransferInstruction(
  keys: AccountMeta[],
  args: {
    from: PublicKey;
    to: PublicKey;
    amount: bigint | number;
    fromBalance: bigint | number;
    toBalance: bigint | number;
    fromCountry: number;
    toCountry: number;
  },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.compliance,
    keys,
    buildInstructionData(
      'can_transfer',
      encodePubkey(args.from),
      encodePubkey(args.to),
      encodeU64(args.amount),
      encodeU64(args.fromBalance),
      encodeU64(args.toBalance),
      encodeU16(args.fromCountry),
      encodeU16(args.toCountry),
    ),
  );
}

export function buildTransferredInstruction(
  keys: AccountMeta[],
  args: {
    from: PublicKey;
    to: PublicKey;
    amount: bigint | number;
    fromBalanceAfter: bigint | number;
    toBalanceAfter: bigint | number;
    fromCountry: number;
    toCountry: number;
  },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.compliance,
    keys,
    buildInstructionData(
      'transferred',
      encodePubkey(args.from),
      encodePubkey(args.to),
      encodeU64(args.amount),
      encodeU64(args.fromBalanceAfter),
      encodeU64(args.toBalanceAfter),
      encodeU16(args.fromCountry),
      encodeU16(args.toCountry),
    ),
  );
}

export function buildCreatedInstruction(
  keys: AccountMeta[],
  args: { to: PublicKey; amount: bigint | number; toBalanceAfter: bigint | number; toCountry: number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.compliance,
    keys,
    buildInstructionData(
      'created',
      encodePubkey(args.to),
      encodeU64(args.amount),
      encodeU64(args.toBalanceAfter),
      encodeU16(args.toCountry),
    ),
  );
}

export function buildDestroyedInstruction(
  keys: AccountMeta[],
  args: { from: PublicKey; amount: bigint | number; fromBalanceAfter: bigint | number; fromCountry: number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.compliance,
    keys,
    buildInstructionData(
      'destroyed',
      encodePubkey(args.from),
      encodeU64(args.amount),
      encodeU64(args.fromBalanceAfter),
      encodeU16(args.fromCountry),
    ),
  );
}

// fracks-fid
export function buildCreateFidInstruction(
  keys: AccountMeta[],
  args: { isIssuer: boolean; country: number },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.fid,
    keys,
    buildInstructionData('create_fid', encodeBool(args.isIssuer), encodeU16(args.country)),
  );
}

export function buildSetManagementKeyInstruction(
  keys: AccountMeta[],
  args: { newKey: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.fid,
    keys,
    buildInstructionData('set_management_key', encodePubkey(args.newKey)),
  );
}

export function buildSetSignerKeyInstruction(
  keys: AccountMeta[],
  args: { newKey: PublicKey },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.fid, keys, buildInstructionData('set_signer_key', encodePubkey(args.newKey)));
}

export function buildAddClaimInstruction(
  keys: AccountMeta[],
  args: {
    topic: bigint | number;
    dataHash32: Buffer | Uint8Array;
    signature64: Buffer | Uint8Array;
    expiresAt: bigint | number;
  },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.fid,
    keys,
    buildInstructionData(
      'add_claim',
      encodeU64(args.topic),
      encodeFixedBytes(args.dataHash32, 32),
      encodeFixedBytes(args.signature64, 64),
      encodeI64(args.expiresAt),
    ),
  );
}

export function buildRevokeClaimInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.fid, keys, buildInstructionData('revoke_claim'));
}

export function buildRemoveClaimInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.fid, keys, buildInstructionData('remove_claim'));
}

// fracks-factory
export interface ProgramIdsArg {
  tokenProgramId: PublicKey;
  fidProgramId: PublicKey;
  irpProgramId: PublicKey;
  irsProgramId: PublicKey;
  tirProgramId: PublicKey;
  ctrProgramId: PublicKey;
  complianceProgramId: PublicKey;
}

export interface TrustedIssuerInputArg {
  issuerFid: PublicKey;
  topics: number[];
  label: string;
}

export interface DeployTokenSuiteArgsArg {
  issuer: PublicKey;
  tokenMint: PublicKey;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  isin: string;
  claimTopics: number[];
  trustedIssuers: TrustedIssuerInputArg[];
  complianceModules: PublicKey[];
  sharedIrs?: PublicKey | null;
  pricePerToken: bigint | number;
  priceDecimals: number;
  paymentMint?: PublicKey | null;
  salt: Buffer | Uint8Array;
}

function encodeProgramIdsArg(arg: ProgramIdsArg): Buffer {
  return Buffer.concat([
    encodePubkey(arg.tokenProgramId),
    encodePubkey(arg.fidProgramId),
    encodePubkey(arg.irpProgramId),
    encodePubkey(arg.irsProgramId),
    encodePubkey(arg.tirProgramId),
    encodePubkey(arg.ctrProgramId),
    encodePubkey(arg.complianceProgramId),
  ]);
}

function encodeTrustedIssuerInput(arg: TrustedIssuerInputArg): Buffer {
  return Buffer.concat([encodePubkey(arg.issuerFid), encodeVecU64(arg.topics), encodeString(arg.label)]);
}

function encodeDeployTokenSuiteArgsArg(arg: DeployTokenSuiteArgsArg): Buffer {
  const salt = encodeFixedBytes(arg.salt, 32);
  return Buffer.concat([
    encodePubkey(arg.issuer),
    encodePubkey(arg.tokenMint),
    encodeString(arg.tokenName),
    encodeString(arg.tokenSymbol),
    encodeU8(arg.decimals),
    encodeString(arg.isin),
    encodeVecU64(arg.claimTopics),
    encodeU32(arg.trustedIssuers.length),
    ...arg.trustedIssuers.map(encodeTrustedIssuerInput),
    encodeVecPubkey(arg.complianceModules),
    encodeOptionPubkey(arg.sharedIrs),
    encodeU64(arg.pricePerToken),
    encodeU8(arg.priceDecimals),
    encodeOptionPubkey(arg.paymentMint),
    salt,
  ]);
}

export function buildInitializeFactoryInstruction(keys: AccountMeta[]): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.factory, keys, buildInstructionData('initialize_factory'));
}

export function buildUpdateProgramIdsInstruction(
  keys: AccountMeta[],
  args: { programIds: ProgramIdsArg },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.factory,
    keys,
    buildInstructionData('update_program_ids', encodeProgramIdsArg(args.programIds)),
  );
}

export function buildTransferFactoryOwnershipInstruction(
  keys: AccountMeta[],
  args: { newOwner: PublicKey },
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.factory,
    keys,
    buildInstructionData('transfer_factory_ownership', encodePubkey(args.newOwner)),
  );
}

export function buildCreateTokenMintInstruction(
  keys: AccountMeta[],
  args: { decimals: number },
): TransactionInstruction {
  return buildInstruction(PROGRAM_IDS.factory, keys, buildInstructionData('create_token_mint', encodeU8(args.decimals)));
}

export function buildDeployTokenSuiteInstruction(
  keys: AccountMeta[],
  args: DeployTokenSuiteArgsArg,
): TransactionInstruction {
  return buildInstruction(
    PROGRAM_IDS.factory,
    keys,
    buildInstructionData('deploy_token_suite', encodeDeployTokenSuiteArgsArg(args)),
  );
}

export async function sendSignedInstruction(
  wallet: AnchorWallet,
  instruction: TransactionInstruction,
): Promise<string> {
  const tx = new Transaction().add(instruction);
  tx.feePayer = wallet.publicKey;
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = latest.blockhash;
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
  return sig;
}

export const SOLANA_SYSTEM_PROGRAM = SystemProgram.programId;
export const SOLANA_INSTRUCTIONS_SYSVAR = SYSVAR_INSTRUCTIONS_PUBKEY;

// 6) Account fetchers/decoders (one per on-chain account type)

export interface TokenStateAccount {
  tokenMint: PublicKey;
  identityRegistry: PublicKey;
  compliance: PublicKey;
  paused: boolean;
  decimals: number;
  name: string;
  symbol: string;
  isin: string;
  bump: number;
}

export interface OwnerStateAccount {
  owner: PublicKey;
  pendingOwner: PublicKey;
  tokenMint: PublicKey;
  bump: number;
}

export interface AgentRoleAccount {
  agent: PublicKey;
  tokenMint: PublicKey;
  isActive: boolean;
  bump: number;
}

export interface FrozenWalletAccount {
  wallet: PublicKey;
  tokenMint: PublicKey;
  frozenBy: PublicKey;
  frozenAt: bigint;
  bump: number;
}

export interface PartialFreezeAccount {
  wallet: PublicKey;
  tokenMint: PublicKey;
  frozenAmount: bigint;
  frozenBy: PublicKey;
  bump: number;
}

export interface IdentityRegistryStateAccount {
  tokenMint: PublicKey;
  owner: PublicKey;
  irsAccount: PublicKey;
  tirAccount: PublicKey;
  ctrAccount: PublicKey;
  identityAgents: PublicKey[];
  registeredCount: bigint;
  bump: number;
}

export interface IdentityRegistryStorageStateAccount {
  owner: PublicKey;
  boundRegistries: PublicKey[];
  registeredCount: bigint;
  bump: number;
}

export interface WalletIdentityAccount {
  wallet: PublicKey;
  fid: PublicKey;
  country: number;
  irs: PublicKey;
  bump: number;
}

export interface TrustedIssuersStateAccount {
  owner: PublicKey;
  tokenMint: PublicKey;
  issuerCount: number;
  bump: number;
}

export interface IssuerEntryAccount {
  issuerFid: PublicKey;
  tir: PublicKey;
  allowedTopics: bigint[];
  isActive: boolean;
  label: string;
  bump: number;
}

export interface ClaimTopicsStateAccount {
  owner: PublicKey;
  tokenMint: PublicKey;
  topics: bigint[];
  bump: number;
}

export interface ComplianceStateAccount {
  owner: PublicKey;
  tokenMint: PublicKey;
  modules: PublicKey[];
  modulesPaused: boolean;
  bump: number;
}

export interface FidAccountData {
  owner: PublicKey;
  managementKey: PublicKey;
  signerKey: PublicKey;
  claimCount: number;
  isIssuer: boolean;
  country: number;
  bump: number;
}

export interface ClaimAccountData {
  fid: PublicKey;
  claimId: number;
  topic: bigint;
  issuerFid: PublicKey;
  dataHash: Buffer;
  signerKey: PublicKey;
  signature: Buffer;
  issuedAt: bigint;
  expiresAt: bigint;
  revoked: boolean;
  bump: number;
}

export interface FactoryStateAccount {
  owner: PublicKey;
  tokenProgramId: PublicKey;
  fidProgramId: PublicKey;
  irpProgramId: PublicKey;
  irsProgramId: PublicKey;
  tirProgramId: PublicKey;
  ctrProgramId: PublicKey;
  complianceProgramId: PublicKey;
  deploymentCount: bigint;
  bump: number;
}

export interface TokenDeploymentAccount {
  deploymentId: bigint;
  issuer: PublicKey;
  salt: Buffer;
  tokenMint: PublicKey;
  tokenState: PublicKey;
  ownerState: PublicKey;
  irpState: PublicKey;
  irsState: PublicKey;
  tirState: PublicKey;
  ctrState: PublicKey;
  complianceState: PublicKey;
  deployedAt: bigint;
  bump: number;
}

export interface TransferApprovalAccount {
  tokenState: PublicKey;
  sourceTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
  authority: PublicKey;
  sourceWallet: PublicKey;
  destinationWallet: PublicKey;
  amount: bigint;
  fromBalance: bigint;
  toBalance: bigint;
  fromCountry: number;
  toCountry: number;
  kind: number;
  consumed: boolean;
  finalized: boolean;
  bump: number;
}

export interface ExtraAccountMetasRawAccount {
  tokenMint: PublicKey;
  pda: PublicKey;
  data: Buffer;
}

export async function fetchRawAccount(address: PublicKey): Promise<AccountInfo<Buffer> | null> {
  return connection.getAccountInfo(address, 'confirmed');
}

async function fetchDecodedAccount<T>(address: PublicKey, decoder: (data: Buffer) => T): Promise<T | null> {
  const info = await fetchRawAccount(address);
  if (!info) return null;
  return decoder(info.data);
}

export function readPubkey(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

export function readU8(data: Buffer, offset: number): number {
  return data.readUInt8(offset);
}

export function readU16(data: Buffer, offset: number): number {
  return data.readUInt16LE(offset);
}

export function readU32(data: Buffer, offset: number): number {
  return data.readUInt32LE(offset);
}

export function readU64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

export function readI64(data: Buffer, offset: number): bigint {
  return data.readBigInt64LE(offset);
}

export function readString(data: Buffer, offset: number): { value: string; nextOffset: number } {
  const size = readU32(data, offset);
  const start = offset + 4;
  const end = start + size;
  return { value: data.subarray(start, end).toString('utf8'), nextOffset: end };
}

function readVecPubkey(data: Buffer, offset: number): { value: PublicKey[]; nextOffset: number } {
  const size = readU32(data, offset);
  let cursor = offset + 4;
  const out: PublicKey[] = [];
  for (let i = 0; i < size; i += 1) {
    out.push(readPubkey(data, cursor));
    cursor += 32;
  }
  return { value: out, nextOffset: cursor };
}

function readVecU64(data: Buffer, offset: number): { value: bigint[]; nextOffset: number } {
  const size = readU32(data, offset);
  let cursor = offset + 4;
  const out: bigint[] = [];
  for (let i = 0; i < size; i += 1) {
    out.push(readU64(data, cursor));
    cursor += 8;
  }
  return { value: out, nextOffset: cursor };
}

function decodeTokenState(data: Buffer): TokenStateAccount {
  let o = 8;
  const tokenMint = readPubkey(data, o); o += 32;
  const identityRegistry = readPubkey(data, o); o += 32;
  const compliance = readPubkey(data, o); o += 32;
  const paused = readU8(data, o) === 1; o += 1;
  const decimals = readU8(data, o); o += 1;
  const name = readString(data, o); o = name.nextOffset;
  const symbol = readString(data, o); o = symbol.nextOffset;
  const isin = readString(data, o); o = isin.nextOffset;
  const bump = readU8(data, o);
  return { tokenMint, identityRegistry, compliance, paused, decimals, name: name.value, symbol: symbol.value, isin: isin.value, bump };
}

function decodeOwnerState(data: Buffer): OwnerStateAccount {
  let o = 8;
  const owner = readPubkey(data, o); o += 32;
  const pendingOwner = readPubkey(data, o); o += 32;
  const tokenMint = readPubkey(data, o); o += 32;
  const bump = readU8(data, o);
  return { owner, pendingOwner, tokenMint, bump };
}

function decodeAgentRole(data: Buffer): AgentRoleAccount {
  let o = 8;
  const agent = readPubkey(data, o); o += 32;
  const tokenMint = readPubkey(data, o); o += 32;
  const isActive = readU8(data, o) === 1; o += 1;
  const bump = readU8(data, o);
  return { agent, tokenMint, isActive, bump };
}

function decodeFrozenWallet(data: Buffer): FrozenWalletAccount {
  let o = 8;
  const wallet = readPubkey(data, o); o += 32;
  const tokenMint = readPubkey(data, o); o += 32;
  const frozenBy = readPubkey(data, o); o += 32;
  const frozenAt = readI64(data, o); o += 8;
  const bump = readU8(data, o);
  return { wallet, tokenMint, frozenBy, frozenAt, bump };
}

function decodePartialFreeze(data: Buffer): PartialFreezeAccount {
  let o = 8;
  const wallet = readPubkey(data, o); o += 32;
  const tokenMint = readPubkey(data, o); o += 32;
  const frozenAmount = readU64(data, o); o += 8;
  const frozenBy = readPubkey(data, o); o += 32;
  const bump = readU8(data, o);
  return { wallet, tokenMint, frozenAmount, frozenBy, bump };
}

function decodeIdentityRegistryState(data: Buffer): IdentityRegistryStateAccount {
  let o = 8;
  const tokenMint = readPubkey(data, o); o += 32;
  const owner = readPubkey(data, o); o += 32;
  const irsAccount = readPubkey(data, o); o += 32;
  const tirAccount = readPubkey(data, o); o += 32;
  const ctrAccount = readPubkey(data, o); o += 32;
  const identityAgents = readVecPubkey(data, o); o = identityAgents.nextOffset;
  const registeredCount = readU64(data, o); o += 8;
  const bump = readU8(data, o);
  return { tokenMint, owner, irsAccount, tirAccount, ctrAccount, identityAgents: identityAgents.value, registeredCount, bump };
}

function decodeIdentityRegistryStorageState(data: Buffer): IdentityRegistryStorageStateAccount {
  let o = 8;
  const owner = readPubkey(data, o); o += 32;
  const bound = readVecPubkey(data, o); o = bound.nextOffset;
  const registeredCount = readU64(data, o); o += 8;
  const bump = readU8(data, o);
  return { owner, boundRegistries: bound.value, registeredCount, bump };
}

function decodeWalletIdentity(data: Buffer): WalletIdentityAccount {
  let o = 8;
  const wallet = readPubkey(data, o); o += 32;
  const fid = readPubkey(data, o); o += 32;
  const country = readU16(data, o); o += 2;
  const irs = readPubkey(data, o); o += 32;
  const bump = readU8(data, o);
  return { wallet, fid, country, irs, bump };
}

function decodeTrustedIssuersState(data: Buffer): TrustedIssuersStateAccount {
  let o = 8;
  const owner = readPubkey(data, o); o += 32;
  const tokenMint = readPubkey(data, o); o += 32;
  const issuerCount = readU32(data, o); o += 4;
  const bump = readU8(data, o);
  return { owner, tokenMint, issuerCount, bump };
}

function decodeIssuerEntry(data: Buffer): IssuerEntryAccount {
  let o = 8;
  const issuerFid = readPubkey(data, o); o += 32;
  const tir = readPubkey(data, o); o += 32;
  const topics = readVecU64(data, o); o = topics.nextOffset;
  const isActive = readU8(data, o) === 1; o += 1;
  const label = readString(data, o); o = label.nextOffset;
  const bump = readU8(data, o);
  return { issuerFid, tir, allowedTopics: topics.value, isActive, label: label.value, bump };
}

function decodeClaimTopicsState(data: Buffer): ClaimTopicsStateAccount {
  let o = 8;
  const owner = readPubkey(data, o); o += 32;
  const tokenMint = readPubkey(data, o); o += 32;
  const topics = readVecU64(data, o); o = topics.nextOffset;
  const bump = readU8(data, o);
  return { owner, tokenMint, topics: topics.value, bump };
}

function decodeComplianceState(data: Buffer): ComplianceStateAccount {
  let o = 8;
  const owner = readPubkey(data, o); o += 32;
  const tokenMint = readPubkey(data, o); o += 32;
  const modules = readVecPubkey(data, o); o = modules.nextOffset;
  const modulesPaused = readU8(data, o) === 1; o += 1;
  const bump = readU8(data, o);
  return { owner, tokenMint, modules: modules.value, modulesPaused, bump };
}

function decodeFidAccount(data: Buffer): FidAccountData {
  let o = 8;
  const owner = readPubkey(data, o); o += 32;
  const managementKey = readPubkey(data, o); o += 32;
  const signerKey = readPubkey(data, o); o += 32;
  const claimCount = readU32(data, o); o += 4;
  const isIssuer = readU8(data, o) === 1; o += 1;
  const country = readU16(data, o); o += 2;
  const bump = readU8(data, o);
  return { owner, managementKey, signerKey, claimCount, isIssuer, country, bump };
}

function decodeClaimAccount(data: Buffer): ClaimAccountData {
  let o = 8;
  const fid = readPubkey(data, o); o += 32;
  const claimId = readU32(data, o); o += 4;
  const topic = readU64(data, o); o += 8;
  const issuerFid = readPubkey(data, o); o += 32;
  const dataHash = Buffer.from(data.subarray(o, o + 32)); o += 32;
  const signerKey = readPubkey(data, o); o += 32;
  const signature = Buffer.from(data.subarray(o, o + 64)); o += 64;
  const issuedAt = readI64(data, o); o += 8;
  const expiresAt = readI64(data, o); o += 8;
  const revoked = readU8(data, o) === 1; o += 1;
  const bump = readU8(data, o);
  return { fid, claimId, topic, issuerFid, dataHash, signerKey, signature, issuedAt, expiresAt, revoked, bump };
}

function decodeFactoryState(data: Buffer): FactoryStateAccount {
  let o = 8;
  const owner = readPubkey(data, o); o += 32;
  const tokenProgramId = readPubkey(data, o); o += 32;
  const fidProgramId = readPubkey(data, o); o += 32;
  const irpProgramId = readPubkey(data, o); o += 32;
  const irsProgramId = readPubkey(data, o); o += 32;
  const tirProgramId = readPubkey(data, o); o += 32;
  const ctrProgramId = readPubkey(data, o); o += 32;
  const complianceProgramId = readPubkey(data, o); o += 32;
  const deploymentCount = readU64(data, o); o += 8;
  const bump = readU8(data, o);
  return {
    owner,
    tokenProgramId,
    fidProgramId,
    irpProgramId,
    irsProgramId,
    tirProgramId,
    ctrProgramId,
    complianceProgramId,
    deploymentCount,
    bump,
  };
}

function decodeTokenDeployment(data: Buffer): TokenDeploymentAccount {
  let o = 8;
  const deploymentId = readU64(data, o); o += 8;
  const issuer = readPubkey(data, o); o += 32;
  const salt = Buffer.from(data.subarray(o, o + 32)); o += 32;
  const tokenMint = readPubkey(data, o); o += 32;
  const tokenState = readPubkey(data, o); o += 32;
  const ownerState = readPubkey(data, o); o += 32;
  const irpState = readPubkey(data, o); o += 32;
  const irsState = readPubkey(data, o); o += 32;
  const tirState = readPubkey(data, o); o += 32;
  const ctrState = readPubkey(data, o); o += 32;
  const complianceState = readPubkey(data, o); o += 32;
  const deployedAt = readI64(data, o); o += 8;
  const bump = readU8(data, o);
  return {
    deploymentId,
    issuer,
    salt,
    tokenMint,
    tokenState,
    ownerState,
    irpState,
    irsState,
    tirState,
    ctrState,
    complianceState,
    deployedAt,
    bump,
  };
}

function decodeTransferApproval(data: Buffer): TransferApprovalAccount {
  let o = 8;
  const tokenState = readPubkey(data, o); o += 32;
  const sourceTokenAccount = readPubkey(data, o); o += 32;
  const destinationTokenAccount = readPubkey(data, o); o += 32;
  const authority = readPubkey(data, o); o += 32;
  const sourceWallet = readPubkey(data, o); o += 32;
  const destinationWallet = readPubkey(data, o); o += 32;
  const amount = readU64(data, o); o += 8;
  const fromBalance = readU64(data, o); o += 8;
  const toBalance = readU64(data, o); o += 8;
  const fromCountry = readU16(data, o); o += 2;
  const toCountry = readU16(data, o); o += 2;
  const kind = readU8(data, o); o += 1;
  const consumed = readU8(data, o) === 1; o += 1;
  const finalized = readU8(data, o) === 1; o += 1;
  const bump = readU8(data, o);
  return {
    tokenState,
    sourceTokenAccount,
    destinationTokenAccount,
    authority,
    sourceWallet,
    destinationWallet,
    amount,
    fromBalance,
    toBalance,
    fromCountry,
    toCountry,
    kind,
    consumed,
    finalized,
    bump,
  };
}

export async function fetchTokenStateAccount(tokenMint: PublicKey): Promise<TokenStateAccount | null> {
  const [pda] = deriveTokenStatePDA(tokenMint);
  return fetchDecodedAccount(pda, decodeTokenState);
}

export async function fetchOwnerStateAccount(tokenMint: PublicKey): Promise<OwnerStateAccount | null> {
  const [pda] = deriveOwnerStatePDA(tokenMint);
  return fetchDecodedAccount(pda, decodeOwnerState);
}

export async function fetchAgentRoleAccount(tokenMint: PublicKey, agent: PublicKey): Promise<AgentRoleAccount | null> {
  const [pda] = deriveAgentRolePDA(tokenMint, agent);
  return fetchDecodedAccount(pda, decodeAgentRole);
}

export async function fetchFrozenWalletAccount(tokenMint: PublicKey, wallet: PublicKey): Promise<FrozenWalletAccount | null> {
  const [pda] = deriveFrozenWalletPDA(tokenMint, wallet);
  return fetchDecodedAccount(pda, decodeFrozenWallet);
}

export async function fetchPartialFreezeAccount(tokenMint: PublicKey, wallet: PublicKey): Promise<PartialFreezeAccount | null> {
  const [pda] = derivePartialFreezePDA(tokenMint, wallet);
  return fetchDecodedAccount(pda, decodePartialFreeze);
}

export async function fetchTransferApprovalAccount(
  sourceTokenAccount: PublicKey,
  destinationTokenAccount: PublicKey,
  authoritySeed: PublicKey,
): Promise<TransferApprovalAccount | null> {
  const [pda] = deriveTransferApprovalPDA(sourceTokenAccount, destinationTokenAccount, authoritySeed);
  return fetchDecodedAccount(pda, decodeTransferApproval);
}

export async function fetchExtraAccountMetasAccount(tokenMint: PublicKey): Promise<ExtraAccountMetasRawAccount | null> {
  const [pda] = deriveExtraAccountMetasPDA(tokenMint);
  const info = await fetchRawAccount(pda);
  if (!info) return null;
  return { tokenMint, pda, data: info.data };
}

export async function fetchIrpStateAccount(tokenMint: PublicKey): Promise<IdentityRegistryStateAccount | null> {
  const [pda] = deriveIrpStatePDA(tokenMint);
  return fetchDecodedAccount(pda, decodeIdentityRegistryState);
}

export async function fetchIrsStateAccount(authoritySeed: PublicKey): Promise<IdentityRegistryStorageStateAccount | null> {
  const [pda] = deriveIrsStatePDA(authoritySeed);
  return fetchDecodedAccount(pda, decodeIdentityRegistryStorageState);
}

export async function fetchWalletIdentityAccount(
  irsState: PublicKey,
  wallet: PublicKey,
): Promise<WalletIdentityAccount | null> {
  const [pda] = deriveWalletIdentityPDA(irsState, wallet);
  return fetchDecodedAccount(pda, decodeWalletIdentity);
}

export async function fetchTirStateAccount(tokenMint: PublicKey): Promise<TrustedIssuersStateAccount | null> {
  const [pda] = deriveTirStatePDA(tokenMint);
  return fetchDecodedAccount(pda, decodeTrustedIssuersState);
}

export async function fetchIssuerEntryAccount(tirState: PublicKey, issuerFid: PublicKey): Promise<IssuerEntryAccount | null> {
  const [pda] = deriveIssuerEntryPDA(tirState, issuerFid);
  return fetchDecodedAccount(pda, decodeIssuerEntry);
}

export async function fetchCtrStateAccount(tokenMint: PublicKey): Promise<ClaimTopicsStateAccount | null> {
  const [pda] = deriveCtrStatePDA(tokenMint);
  return fetchDecodedAccount(pda, decodeClaimTopicsState);
}

export async function fetchComplianceStateAccount(tokenMint: PublicKey): Promise<ComplianceStateAccount | null> {
  const [pda] = deriveComplianceStatePDA(tokenMint);
  return fetchDecodedAccount(pda, decodeComplianceState);
}

export async function fetchFidAccount(owner: PublicKey): Promise<FidAccountData | null> {
  const [pda] = deriveFidPDA(owner);
  return fetchDecodedAccount(pda, decodeFidAccount);
}

export async function fetchClaimAccount(fid: PublicKey, claimId: number): Promise<ClaimAccountData | null> {
  const [pda] = deriveClaimPDA(fid, claimId);
  return fetchDecodedAccount(pda, decodeClaimAccount);
}

export async function fetchFactoryStateAccount(): Promise<FactoryStateAccount | null> {
  const [pda] = deriveFactoryStatePDA();
  return fetchDecodedAccount(pda, decodeFactoryState);
}

export async function fetchDeploymentAccount(issuer: PublicKey, salt32: Buffer): Promise<TokenDeploymentAccount | null> {
  const [pda] = deriveDeploymentPDA(issuer, salt32);
  return fetchDecodedAccount(pda, decodeTokenDeployment);
}
