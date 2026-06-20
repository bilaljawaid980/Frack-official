import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { FACTORY_PROGRAM_ID, FID_PROGRAM_ID, SEED_FACTORY_STATE, SEED_FID } from '@/lib/constants';
import { recordBlockchainTransactionWithSolBalanceImpact } from '@/lib/blockchain-transactions';

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

const TOPIC_CUSTODIAN_AUTHORITY = new BN(4);
const DISCRIMINATOR_APPROVE_PLATFORM_AUTHORITY = Buffer.from([140, 146, 189, 4, 101, 222, 84, 131]);
const DISCRIMINATOR_CREATE_CUSTODY_MANDATE = Buffer.from([121, 225, 189, 63, 105, 0, 147, 72]);
const DISCRIMINATOR_ACCEPT_CUSTODY_MANDATE = Buffer.from([42, 105, 124, 166, 212, 48, 135, 19]);
const DISCRIMINATOR_ATTEST_CUSTODY = Buffer.from([254, 29, 125, 248, 142, 129, 59, 82]);

function u64Le(value: BN | number | string | bigint) {
  return new BN(value.toString()).toArrayLike(Buffer, 'le', 8);
}

function i64Le(value: BN | number | string | bigint) {
  return new BN(value.toString()).toArrayLike(Buffer, 'le', 8);
}

function pubkeyBytes(value: PublicKey | string) {
  return new PublicKey(value).toBuffer();
}

function hexToBytes32(value: string, label: string) {
  const clean = value.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`${label} must be a 32-byte SHA-256 hex string.`);
  }
  return Buffer.from(clean, 'hex');
}

function normalizeAssetId(value: string | number | bigint) {
  const assetId = new BN(value.toString());
  if (assetId.isNeg() || assetId.bitLength() > 64) {
    throw new Error('Factory asset id must fit in u64.');
  }
  return assetId;
}

export function deriveFidFromWallet(walletAddress: string, fidProgramId = FID_PROGRAM_ID) {
  const wallet = new PublicKey(walletAddress);
  const [fid] = PublicKey.findProgramAddressSync([SEED_FID, wallet.toBuffer()], fidProgramId);
  return fid;
}

export function deriveCustodyMandate(assetId: string | number | bigint) {
  const normalized = normalizeAssetId(assetId);
  const [mandate] = PublicKey.findProgramAddressSync(
    [Buffer.from('custody_mandate'), u64Le(normalized)],
    FACTORY_PROGRAM_ID,
  );
  return mandate;
}

export function deriveCustodyAttestation(custodyMandate: PublicKey | string) {
  const [attestation] = PublicKey.findProgramAddressSync(
    [Buffer.from('custody_attestation'), new PublicKey(custodyMandate).toBuffer()],
    FACTORY_PROGRAM_ID,
  );
  return attestation;
}

export function derivePlatformAuthority(authorityFid: PublicKey | string, topic: BN = TOPIC_CUSTODIAN_AUTHORITY) {
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('platform_authority'), new PublicKey(authorityFid).toBuffer(), u64Le(topic)],
    FACTORY_PROGRAM_ID,
  );
  return authority;
}

export async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256TextHex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export class CustodyChainService {
  constructor(
    private readonly provider: AnchorProvider,
    private readonly sendTransaction?: SendWalletTransaction,
  ) {}

  private get payer() {
    const publicKey = this.provider.wallet.publicKey;
    if (!publicKey) throw new Error('Wallet not connected.');
    return publicKey;
  }

  private deriveFactoryState() {
    const [factoryState] = PublicKey.findProgramAddressSync([SEED_FACTORY_STATE], FACTORY_PROGRAM_ID);
    return factoryState;
  }

  private async send(ix: TransactionInstruction, actionType: string, metadata: Record<string, unknown>) {
    if (!this.sendTransaction) throw new Error('Wallet cannot send transactions.');
    const transaction = new Transaction().add(ix);
    transaction.feePayer = this.payer;
    const signature = await this.sendTransaction(transaction, this.provider.connection, {
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });
    await this.provider.connection.confirmTransaction(signature, 'confirmed');
    await recordBlockchainTransactionWithSolBalanceImpact(
      {
        txHash: signature,
        actionType,
        actorWallet: this.payer.toBase58(),
        entityType: 'CustodyMandate',
        entityId: String(metadata.mandateId || ''),
        assetId: metadata.assetId ? String(metadata.assetId) : null,
        metadata,
      },
      this.provider.connection,
      this.payer.toBase58(),
    ).catch((error) => console.error('Failed to record custody transaction:', error));
    return signature;
  }

  async approveCustodianAuthority(custodianFid: string) {
    const authorityFid = new PublicKey(custodianFid);
    const platformAuthority = derivePlatformAuthority(authorityFid);
    const data = Buffer.concat([
      DISCRIMINATOR_APPROVE_PLATFORM_AUTHORITY,
      authorityFid.toBuffer(),
      u64Le(TOPIC_CUSTODIAN_AUTHORITY),
    ]);
    const ix = new TransactionInstruction({
      programId: FACTORY_PROGRAM_ID,
      keys: [
        { pubkey: this.payer, isSigner: true, isWritable: true },
        { pubkey: this.deriveFactoryState(), isSigner: false, isWritable: false },
        { pubkey: platformAuthority, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const signature = await this.send(ix, 'CUSTODIAN_AUTHORITY_APPROVED', {
      custodianFid,
      platformAuthority: platformAuthority.toBase58(),
      topic: TOPIC_CUSTODIAN_AUTHORITY.toString(),
    });
    return { signature, platformAuthority: platformAuthority.toBase58() };
  }

  async createCustodyMandate(input: {
    mandateId?: string;
    assetId: string | number | bigint;
    issuerWallet: string;
    issuerFid: string;
    custodianWallet: string;
    custodianFid: string;
  }) {
    const assetId = normalizeAssetId(input.assetId);
    const mandate = deriveCustodyMandate(assetId.toString());
    const custodianAuthority = derivePlatformAuthority(input.custodianFid);
    const data = Buffer.concat([
      DISCRIMINATOR_CREATE_CUSTODY_MANDATE,
      u64Le(assetId),
      pubkeyBytes(input.issuerFid),
      pubkeyBytes(input.custodianWallet),
      pubkeyBytes(input.custodianFid),
    ]);
    const ix = new TransactionInstruction({
      programId: FACTORY_PROGRAM_ID,
      keys: [
        { pubkey: this.payer, isSigner: true, isWritable: true },
        { pubkey: this.deriveFactoryState(), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(input.issuerWallet), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(input.issuerFid), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(input.custodianFid), isSigner: false, isWritable: false },
        { pubkey: custodianAuthority, isSigner: false, isWritable: false },
        { pubkey: mandate, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const signature = await this.send(ix, 'CUSTODY_MANDATE_CREATED', {
      mandateId: input.mandateId,
      assetId: assetId.toString(),
      mandateAddress: mandate.toBase58(),
      issuerWallet: input.issuerWallet,
      issuerFid: input.issuerFid,
      custodianWallet: input.custodianWallet,
      custodianFid: input.custodianFid,
      custodianAuthority: custodianAuthority.toBase58(),
    });
    return { signature, mandateAddress: mandate.toBase58() };
  }

  async acceptCustodyMandate(input: {
    mandateId?: string;
    assetId: string | number | bigint;
    custodianFid: string;
  }) {
    const mandate = deriveCustodyMandate(input.assetId);
    const data = DISCRIMINATOR_ACCEPT_CUSTODY_MANDATE;
    const ix = new TransactionInstruction({
      programId: FACTORY_PROGRAM_ID,
      keys: [
        { pubkey: this.payer, isSigner: true, isWritable: true },
        { pubkey: mandate, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(input.custodianFid), isSigner: false, isWritable: false },
      ],
      data,
    });
    const signature = await this.send(ix, 'CUSTODY_MANDATE_ACCEPTED', {
      mandateId: input.mandateId,
      assetId: String(input.assetId),
      mandateAddress: mandate.toBase58(),
      custodianFid: input.custodianFid,
    });
    return { signature };
  }

  async attestCustody(input: {
    mandateId?: string;
    assetId: string | number | bigint;
    documentHash: string;
    attestationHash: string;
    validitySeconds: string | number | bigint;
  }) {
    const mandate = deriveCustodyMandate(input.assetId);
    const attestation = deriveCustodyAttestation(mandate);
    const data = Buffer.concat([
      DISCRIMINATOR_ATTEST_CUSTODY,
      hexToBytes32(input.documentHash, 'documentHash'),
      hexToBytes32(input.attestationHash, 'attestationHash'),
      i64Le(input.validitySeconds),
    ]);
    const ix = new TransactionInstruction({
      programId: FACTORY_PROGRAM_ID,
      keys: [
        { pubkey: this.payer, isSigner: true, isWritable: true },
        { pubkey: mandate, isSigner: false, isWritable: false },
        { pubkey: attestation, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const signature = await this.send(ix, 'CUSTODY_ATTESTED', {
      mandateId: input.mandateId,
      assetId: String(input.assetId),
      mandateAddress: mandate.toBase58(),
      attestationAddress: attestation.toBase58(),
      documentHash: input.documentHash,
      attestationHash: input.attestationHash,
      validitySeconds: String(input.validitySeconds),
    });
    return { signature, attestationAddress: attestation.toBase58() };
  }
}
