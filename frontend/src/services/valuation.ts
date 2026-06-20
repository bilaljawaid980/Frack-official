import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ASSET_REGISTRY_PROGRAM_ID, FID_PROGRAM_ID, TIR_PROGRAM_ID } from '@/lib/constants';
import {
  buildInstructionData,
  encodePubkey,
  encodeString,
  encodeU16,
  encodeVecU64,
  fetchIssuerEntryAccount,
  fetchTirStateAccount,
} from '@/lib/solana';
import { recordBlockchainTransactionSafely } from '@/lib/blockchain-transactions';

const TOPIC_VALUATION = 5;
const INITIALIZE_ASSET_REGISTRY_DISCRIMINATOR = Buffer.from([9, 159, 48, 18, 28, 225, 108, 176]);
const ATTEST_VALUATION_DISCRIMINATOR = Buffer.from([159, 133, 54, 104, 148, 203, 2, 179]);
const ZERO_HASH_HEX = '0'.repeat(64);

type WalletSendOptions = {
  skipPreflight?: boolean;
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
  maxRetries?: number;
};

type SendWalletTransaction = (
  transaction: Transaction,
  connection: AnchorProvider['connection'],
  options?: WalletSendOptions,
) => Promise<string>;

function u64Le(value: string | number | bigint | BN) {
  return new BN(value.toString()).toArrayLike(Buffer, 'le', 8);
}

function hexToBytes32(value: string, label: string) {
  const clean = value.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error(`${label} must be a 32-byte SHA-256 hex string.`);
  return Buffer.from(clean, 'hex');
}

function registryText(value: string | undefined, fallback: string, maxBytes: number, label: string) {
  const text = (value || fallback).trim();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`${label} must be ${maxBytes} bytes or less.`);
  return text;
}

export function deriveValuerFid(walletAddress: string) {
  const wallet = new PublicKey(walletAddress);
  return PublicKey.findProgramAddressSync([Buffer.from('fid'), wallet.toBuffer()], FID_PROGRAM_ID)[0];
}

export function deriveAssetRegistry(factoryAssetId: string | number | bigint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('asset_registry'), u64Le(factoryAssetId)],
    ASSET_REGISTRY_PROGRAM_ID,
  )[0];
}

export function deriveTirState(tokenContract: string | PublicKey) {
  const mint = new PublicKey(tokenContract);
  return PublicKey.findProgramAddressSync([Buffer.from('tir_state'), mint.toBuffer()], TIR_PROGRAM_ID)[0];
}

export function deriveIssuerEntry(tirState: string | PublicKey, issuerFid: string | PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('issuer_entry'), new PublicKey(tirState).toBuffer(), new PublicKey(issuerFid).toBuffer()],
    TIR_PROGRAM_ID,
  )[0];
}

export class ValuationChainService {
  constructor(
    private readonly provider: AnchorProvider,
    private readonly sendTransaction?: SendWalletTransaction,
  ) {}

  private get payer() {
    const publicKey = this.provider.wallet.publicKey;
    if (!publicKey) throw new Error('Wallet not connected.');
    return publicKey;
  }

  private async send(ix: TransactionInstruction, actionType: string, metadata: Record<string, unknown>) {
    if (!this.sendTransaction) throw new Error('Wallet cannot send transactions.');
    const tx = new Transaction().add(ix);
    tx.feePayer = this.payer;
    const { blockhash, lastValidBlockHeight } = await this.provider.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;

    const simulation = await this.provider.connection.simulateTransaction(tx, undefined, true);
    if (simulation.value.err) {
      const logs = simulation.value.logs?.join('\n') || 'No simulation logs returned.';
      const label =
        actionType === 'ASSET_VALUATION_ATTESTED'
          ? 'Valuation attestation'
          : actionType === 'VALUER_TIR_TRUSTED'
            ? 'Trust Topic 5'
            : actionType;
      throw new Error(`${label} preflight failed: ${JSON.stringify(simulation.value.err)}\n${logs}`);
    }

    const signature = await this.sendTransaction(tx, this.provider.connection, {
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });
    await this.provider.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    recordBlockchainTransactionSafely({
      txHash: signature,
      actionType,
      actorWallet: this.payer.toBase58(),
      entityType: String(metadata.entityType || 'AssetValuerAssignment'),
      entityId: metadata.entityId ? String(metadata.entityId) : undefined,
      assetId: metadata.assetId ? String(metadata.assetId) : undefined,
      tokenContract: metadata.tokenContract ? String(metadata.tokenContract) : undefined,
      metadata,
    });
    return signature;
  }

  async isAssetRegistryInitialized(input: {
    factoryAssetId: string | number | bigint;
    assetRegistryAddress?: string;
  }) {
    const assetRegistry = input.assetRegistryAddress
      ? new PublicKey(input.assetRegistryAddress)
      : deriveAssetRegistry(input.factoryAssetId);
    const info = await this.provider.connection.getAccountInfo(assetRegistry, 'confirmed');
    return { initialized: Boolean(info), assetRegistry: assetRegistry.toBase58() };
  }

  async initializeAssetRegistry(input: {
    assignmentId?: string;
    factoryAssetId: string | number | bigint;
    assetRegistryAddress?: string;
    tokenContract: string;
    issuerFid: string;
    custodianFid: string;
    fardRef?: string;
    spvSecpReg?: string;
    province?: number;
    whitepaperHash?: string;
    legalOpinionHash?: string;
    insurancePolicyHash?: string;
    beneficialOwnerHash?: string;
    navValidityDays?: number;
    encumbranceFlag?: boolean;
  }) {
    const assetRegistry = input.assetRegistryAddress
      ? new PublicKey(input.assetRegistryAddress)
      : deriveAssetRegistry(input.factoryAssetId);
    const existing = await this.provider.connection.getAccountInfo(assetRegistry, 'confirmed');
    if (existing) return { signature: null, assetRegistry: assetRegistry.toBase58(), alreadyInitialized: true };

    const issuerFid = new PublicKey(input.issuerFid);
    const custodianFid = new PublicKey(input.custodianFid);
    const tokenMint = new PublicKey(input.tokenContract);
    const province = Number.isInteger(input.province) && input.province !== undefined ? input.province : 0;
    const navValidityDays = Number.isInteger(input.navValidityDays) && input.navValidityDays ? input.navValidityDays : 365;
    const data = Buffer.concat([
      INITIALIZE_ASSET_REGISTRY_DISCRIMINATOR,
      u64Le(input.factoryAssetId),
      encodePubkey(tokenMint),
      encodePubkey(issuerFid),
      encodePubkey(custodianFid),
      encodeString(registryText(input.fardRef, String(input.factoryAssetId), 64, 'FARD reference')),
      encodeString(registryText(input.spvSecpReg, String(input.factoryAssetId), 64, 'SPV SECP registration')),
      encodeU16(province),
      hexToBytes32(input.whitepaperHash || ZERO_HASH_HEX, 'whitepaperHash'),
      hexToBytes32(input.legalOpinionHash || ZERO_HASH_HEX, 'legalOpinionHash'),
      hexToBytes32(input.insurancePolicyHash || ZERO_HASH_HEX, 'insurancePolicyHash'),
      hexToBytes32(input.beneficialOwnerHash || ZERO_HASH_HEX, 'beneficialOwnerHash'),
      encodeU16(navValidityDays),
      Buffer.from([input.encumbranceFlag ? 1 : 0]),
    ]);
    const ix = new TransactionInstruction({
      programId: ASSET_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: this.payer, isSigner: true, isWritable: true },
        { pubkey: assetRegistry, isSigner: false, isWritable: true },
        { pubkey: issuerFid, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const signature = await this.send(ix, 'ASSET_REGISTRY_INITIALIZED', {
      assignmentId: input.assignmentId,
      entityId: input.assignmentId,
      assetId: String(input.factoryAssetId),
      tokenContract: input.tokenContract,
      assetRegistry: assetRegistry.toBase58(),
      issuerFid: input.issuerFid,
      custodianFid: input.custodianFid,
      navValidityDays,
    });
    return { signature, assetRegistry: assetRegistry.toBase58(), alreadyInitialized: false };
  }
  async trustValuerInTokenTir(input: {
    assignmentId?: string;
    tokenContract: string;
    valuerFid: string;
    label?: string;
  }) {
    const tirState = deriveTirState(input.tokenContract);
    const tir = await fetchTirStateAccount(new PublicKey(input.tokenContract));
    if (!tir) {
      throw new Error(`Token TIR state does not exist for ${input.tokenContract}. Confirm this token was deployed with the current TIR program.`);
    }
    if (!tir.owner.equals(this.payer)) {
      throw new Error(`Connected wallet ${this.payer.toBase58()} is not the owner of this token TIR. Switch to TIR owner ${tir.owner.toBase58()} to trust the valuer for topic 5.`);
    }
    const valuerFid = new PublicKey(input.valuerFid);
    const issuerEntry = deriveIssuerEntry(tirState, valuerFid);
    const existing = await fetchIssuerEntryAccount(tirState, valuerFid);
    const topics = Array.from(new Set([...(existing?.allowedTopics || []).map((topic) => Number(topic)), TOPIC_VALUATION]));
    const data = existing
      ? buildInstructionData('update_issuer_topics', encodeVecU64(topics))
      : buildInstructionData('add_trusted_issuer', encodePubkey(valuerFid), encodeVecU64(topics), encodeString(input.label || 'Valuer'));
    const keys = existing
      ? [
          { pubkey: this.payer, isSigner: true, isWritable: true },
          { pubkey: tirState, isSigner: false, isWritable: false },
          { pubkey: issuerEntry, isSigner: false, isWritable: true },
        ]
      : [
          { pubkey: this.payer, isSigner: true, isWritable: true },
          { pubkey: tirState, isSigner: false, isWritable: true },
          { pubkey: issuerEntry, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ];
    const ix = new TransactionInstruction({ programId: TIR_PROGRAM_ID, keys, data });
    const signature = await this.send(ix, 'VALUER_TIR_TRUSTED', {
      assignmentId: input.assignmentId,
      entityId: input.assignmentId,
      tokenContract: input.tokenContract,
      tirState: tirState.toBase58(),
      issuerEntry: issuerEntry.toBase58(),
      valuerFid: input.valuerFid,
      topics,
    });
    return { signature, issuerEntry: issuerEntry.toBase58(), tirState: tirState.toBase58() };
  }

  async attestValuation(input: {
    assignmentId?: string;
    factoryAssetId: string | number | bigint;
    tokenContract: string;
    valuerFid: string;
    assetRegistryAddress?: string;
    navRaw: string | number | bigint;
    methodologyHash: string;
    navValidityDays: number;
  }) {
    const assetRegistry = input.assetRegistryAddress
      ? new PublicKey(input.assetRegistryAddress)
      : deriveAssetRegistry(input.factoryAssetId);
    const assetRegistryInfo = await this.provider.connection.getAccountInfo(assetRegistry, 'confirmed');
    if (!assetRegistryInfo) {
      throw new Error(`Asset registry account ${assetRegistry.toBase58()} is not initialized for asset ${input.factoryAssetId}. Confirm this token was deployed with the current asset registry program before submitting a valuation attestation.`);
    }
    const tirState = deriveTirState(input.tokenContract);

    const valuerFid = new PublicKey(input.valuerFid);
    const issuerEntry = deriveIssuerEntry(tirState, valuerFid);
    const data = Buffer.concat([
      ATTEST_VALUATION_DISCRIMINATOR,
      u64Le(input.navRaw),
      hexToBytes32(input.methodologyHash, 'methodologyHash'),
      encodeU16(input.navValidityDays),
    ]);
    const ix = new TransactionInstruction({
      programId: ASSET_REGISTRY_PROGRAM_ID,
      keys: [
        { pubkey: this.payer, isSigner: true, isWritable: true },
        { pubkey: assetRegistry, isSigner: false, isWritable: true },
        { pubkey: valuerFid, isSigner: false, isWritable: false },
        { pubkey: tirState, isSigner: false, isWritable: false },
        { pubkey: issuerEntry, isSigner: false, isWritable: false },
      ],
      data,
    });
    const signature = await this.send(ix, 'ASSET_VALUATION_ATTESTED', {
      assignmentId: input.assignmentId,
      entityId: input.assignmentId,
      assetId: String(input.factoryAssetId),
      tokenContract: input.tokenContract,
      assetRegistry: assetRegistry.toBase58(),
      valuerFid: input.valuerFid,
      navRaw: String(input.navRaw),
      navValidityDays: input.navValidityDays,
      methodologyHash: input.methodologyHash,
    });
    return { signature, assetRegistry: assetRegistry.toBase58(), issuerEntry: issuerEntry.toBase58(), tirState: tirState.toBase58() };
  }
}


