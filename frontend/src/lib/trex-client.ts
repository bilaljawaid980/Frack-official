/**
 * TREX Solana Client
 * MIGRATED: was legacy chain SDK flow; now Solana-based with compatible frontend API.
 */

import type { AnchorWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  Ed25519Program,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  type AccountInfo,
  type AccountMeta,
} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {
  createInitializeMint2Instruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferHookInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  getMint,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import {
  TREX_CONTRACTS,
  getZigChainConfig,
} from './zigchain-config';
import {
  PROGRAM_IDS,
  connection,
  deriveAgentRolePDA,
  deriveClaimPDA,
  deriveComplianceStatePDA,
  deriveCtrStatePDA,
  deriveDeploymentPDA,
  deriveExtraAccountMetasPDA,
  deriveFactoryStatePDA,
  deriveFidPDA,
  deriveFrozenWalletPDA,
  deriveIrpStatePDA,
  deriveIssuerEntryPDA,
  deriveIrsStatePDA,
  deriveOwnerStatePDA,
  derivePartialFreezePDA,
  deriveTirStatePDA,
  deriveTokenStatePDA,
  deriveWalletIdentityPDA,
  buildCreateTokenMintInstruction,
  buildDeployTokenSuiteInstruction,
  buildMintInstruction,
  fetchDeploymentAccount,
  fetchFactoryStateAccount,
  encodePubkey,
  encodeString,
  encodeI64,
  encodeU16,
  encodeU64,
  buildInstructionData,
} from './solana';
import {
  detectClaimSignerMode,
  signClaimWithBackendProviderWallet,
} from '@/lib/claim-signer';
import type {
  TokenInfo,
  IsVerifiedResponse,
  IdentityResponse,
  IRConfigResponse,
  AllIssuersResponse,
  RequiredTopicsResponse,
  ComplianceConfigResponse,
  ClaimResponse,
  CanTransferResponse,
  TrexToken,
  UserIdentity,
  TrexCompliance,
  FactoryConfig,
  TokenInfoFromFactory,
} from '@/types/trex-contracts';

export interface AssetInfo {
  id: number;
  assetId: number;
  referenceId: string;
  asset_id: number;
  reference_id: string;
  description: string;
  legal_owner: string;
  metadata?: string;
  total_tokenized: string;
}

export interface RedemptionRequest {
  id: number;
  assetId: number;
  requester: string;
  amount: string;
  approved?: boolean;
  reason?: string;
}

interface CreateAssetParams {
  referenceId: string;
  description: string;
  legalOwner: string;
  name: string;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  type: string;
  location: string;
  underlyingValue: number;
  currency: string;
  mintingCap: string;
  claimDetails: {
    claim_topics: number[];
    issuers: string[];
    issuer_claims: number[][];
  };
}

type ParsedClaim = {
  fid: string;
  claim_id: number;
  topic: number;
  issuer_fid: string;
  data_hash: string;
  signer_key: string;
  signature: string;
  issued_at: number;
  expires_at: number;
  revoked: boolean;
};

type TrexWallet = AnchorWallet & {
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
};

function toPublicKeyOrNull(value?: string | null): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function toU64String(value: bigint | number): string {
  return (typeof value === 'bigint' ? value : BigInt(value)).toString();
}

async function sha256(input: Uint8Array): Promise<Uint8Array> {
  const bytes = new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  return new Uint8Array(digest);
}

function getStoredLocalClaimSigner(owner: PublicKey): Keypair | null {
  const storageKey = `fracks:claim-signer:${owner.toBase58()}`;
  const existing = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
  if (existing) {
    try {
      const arr = JSON.parse(existing) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeCountry(country?: string | number | null): number {
  const ISO2_TO_NUMERIC: Record<string, number> = {
    US: 840,
    GB: 826,
    CA: 124,
    AU: 36,
    DE: 276,
    FR: 250,
    JP: 392,
    SG: 702,
    AE: 784,
    PK: 586,
  };

  if (typeof country === 'string') {
    const trimmed = country.trim().toUpperCase();
    if (trimmed in ISO2_TO_NUMERIC) {
      return ISO2_TO_NUMERIC[trimmed];
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      const clamped = Math.floor(parsed);
      if (clamped >= 1 && clamped <= 999) return clamped;
    }
    return 840;
  }

  if (typeof country === 'number' && Number.isFinite(country)) {
    const clamped = Math.floor(country);
    if (clamped >= 1 && clamped <= 999) return clamped;
  }

  return 840;
}

async function resolveIssuerFid(issuer: PublicKey): Promise<PublicKey> {
  const [fid] = deriveFidPDA(issuer);
  let info: AccountInfo<Buffer> | null = null;
  for (let i = 0; i < 3; i += 1) {
    try {
      info = await connection.getAccountInfo(fid, 'confirmed');
      break;
    } catch (error: any) {
      if (!String(error?.message || '').includes('429') || i === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  if (info) return fid;
  return issuer;
}

function parseCtrTopics(info: AccountInfo<Buffer> | null): number[] {
  if (!info) return [];
  const data = info.data;
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return [];
  const len = data.readUInt32LE(offset);
  offset += 4;
  const topics: number[] = [];
  for (let i = 0; i < len; i += 1) {
    if (data.length < offset + 8) break;
    topics.push(Number(data.readBigUInt64LE(offset)));
    offset += 8;
  }
  return topics;
}

function parseIssuerEntry(info: AccountInfo<Buffer> | null) {
  if (!info) return null;
  const data = info.data;
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return null;
  const len = data.readUInt32LE(offset);
  offset += 4;
  const topics: number[] = [];
  for (let i = 0; i < len; i += 1) {
    if (data.length < offset + 8) break;
    topics.push(Number(data.readBigUInt64LE(offset)));
    offset += 8;
  }
  if (data.length < offset + 1) return null;
  const isActive = data.readUInt8(offset) === 1;
  return { isActive, topics };
}

function parseClaimAccount(info: AccountInfo<Buffer>): ParsedClaim | null {
  const data = info.data;
  // ClaimAccount layout from fracks-fid:
  // 8 disc + 32 fid + 4 claim_id + 8 topic + 32 issuer_fid + 32 data_hash
  // + 32 signer_key + 64 signature + 8 issued_at + 8 expires_at + 1 revoked + 1 bump
  if (data.length < 230) return null;
  const fid = new PublicKey(data.subarray(8, 40)).toBase58();
  const claim_id = data.readUInt32LE(40);
  const topic = Number(data.readBigUInt64LE(44));
  const issuer_fid = new PublicKey(data.subarray(52, 84)).toBase58();
  const data_hash = Buffer.from(data.subarray(84, 116)).toString('hex');
  const signer_key = new PublicKey(data.subarray(116, 148)).toBase58();
  const signature = Buffer.from(data.subarray(148, 212)).toString('hex');
  const issued_at = Number(data.readBigInt64LE(212));
  const expires_at = Number(data.readBigInt64LE(220));
  const revoked = data.readUInt8(228) === 1;
  return {
    fid,
    claim_id,
    topic,
    issuer_fid,
    data_hash,
    signer_key,
    signature,
    issued_at,
    expires_at,
    revoked,
  };
}

export class TrexClient {
  private wallet?: TrexWallet;
  private walletAddress?: string;

  constructor(wallet?: TrexWallet, walletAddress?: string) {
    this.wallet = wallet;
    this.walletAddress = walletAddress;
  }

  static async connectReadOnly(): Promise<TrexClient> {
    return new TrexClient();
  }

  static async connectWithWallet(
    wallet: TrexWallet,
    walletAddress: string,
  ): Promise<TrexClient> {
    return new TrexClient(wallet, walletAddress);
  }

  static async connectWithSigner(_signer: any, walletAddress: string): Promise<TrexClient> {
    // MIGRATED: signer-based constructor replaced by adapter wallet flow.
    return new TrexClient(undefined, walletAddress);
  }

  private ensureSigner() {
    if (!this.wallet || !this.wallet.publicKey) {
      throw new Error('Wallet signer not available');
    }
  }

  private resolveTokenMint(tokenContract?: string): PublicKey | null {
    const fromArg = toPublicKeyOrNull(tokenContract);
    if (fromArg) return fromArg;
    const fromConfig = toPublicKeyOrNull(TREX_CONTRACTS.token);
    if (fromConfig) return fromConfig;
    const fromEnv = toPublicKeyOrNull(process.env.NEXT_PUBLIC_FRACKS_TOKEN_MINT || null);
    if (fromEnv) return fromEnv;
    return null;
  }

  private async sendInstruction(
    programId: PublicKey,
    keys: AccountMeta[],
    data: Buffer,
  ): Promise<string> {
    this.ensureSigner();
    const ix = new TransactionInstruction({ programId, keys, data });
    const tx = new Transaction().add(ix);
    tx.feePayer = this.wallet!.publicKey;
    const latest = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = latest.blockhash;
    const signed = await this.wallet!.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
    return sig;
  }

  private async fetchOwnerFromOwnerState(tokenMint: PublicKey): Promise<string> {
    const [ownerState] = deriveOwnerStatePDA(tokenMint);
    let info: AccountInfo<Buffer> | null = null;
    for (let i = 0; i < 4; i += 1) {
      try {
        info = await connection.getAccountInfo(ownerState, 'confirmed');
        break;
      } catch (error: any) {
        const message = String(error?.message || '');
        if (!message.includes('429') || i === 3) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
      }
    }
    if (!info || info.data.length < 72) return '';
    const owner = new PublicKey(info.data.subarray(8, 40));
    return owner.toBase58();
  }

  async getTokenInfo(tokenContract?: string): Promise<TokenInfo> {
    const tokenMint = this.resolveTokenMint(tokenContract);
    if (!tokenMint) {
      return {
        name: 'FRACKS',
        symbol: 'FRK',
        decimals: 6,
        total_supply: '0',
      };
    }

    try {
      const mint = await getMint(connection, tokenMint, 'confirmed', TOKEN_2022_PROGRAM_ID);
      const [tokenState] = deriveTokenStatePDA(tokenMint);
      const tokenStateInfo = await connection.getAccountInfo(tokenState, 'confirmed');

      let name = 'FRACKS Token';
      let symbol = 'FRK';
      if (tokenStateInfo && tokenStateInfo.data.length > 110) {
        // account discriminator(8) + pubkeys(96) + paused(1) + decimals(1)
        let offset = 106;
        const nameLen = tokenStateInfo.data.readUInt32LE(offset);
        offset += 4;
        name = tokenStateInfo.data.subarray(offset, offset + nameLen).toString('utf8') || name;
        offset += nameLen;
        const symbolLen = tokenStateInfo.data.readUInt32LE(offset);
        offset += 4;
        symbol = tokenStateInfo.data.subarray(offset, offset + symbolLen).toString('utf8') || symbol;
      }

      return {
        name,
        symbol,
        decimals: mint.decimals,
        total_supply: mint.supply.toString(),
      };
    } catch {
      return {
        name: 'FRACKS',
        symbol: 'FRK',
        decimals: 6,
        total_supply: '0',
      };
    }
  }

  async getBalance(address: string, tokenContract?: string): Promise<string> {
    const tokenMint = this.resolveTokenMint(tokenContract);
    const owner = toPublicKeyOrNull(address);
    if (!tokenMint || !owner) return '0';

    try {
      const ata = getAssociatedTokenAddressSync(tokenMint, owner, false, TOKEN_2022_PROGRAM_ID);
      const account = await getAccount(connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
      return account.amount.toString();
    } catch {
      return '0';
    }
  }

  async getNativeBalance(address: string): Promise<string> {
    const pk = toPublicKeyOrNull(address);
    if (!pk) return '0';
    try {
      const lamports = await connection.getBalance(pk, 'confirmed');
      return lamports.toString();
    } catch {
      return '0';
    }
  }

  async getTokenData(tokenContract?: string): Promise<TrexToken> {
    const info = await this.getTokenInfo(tokenContract);
    return {
      address: tokenContract || TREX_CONTRACTS.token,
      name: info.name,
      symbol: info.symbol,
      decimals: info.decimals,
      totalSupply: info.total_supply,
      isPaused: false,
    };
  }

  async isFrozen(address: string, tokenContract?: string): Promise<boolean> {
    const tokenMint = this.resolveTokenMint(tokenContract);
    const wallet = toPublicKeyOrNull(address);
    if (!tokenMint || !wallet) return false;
    const [frozen] = deriveFrozenWalletPDA(tokenMint, wallet);
    const info = await connection.getAccountInfo(frozen, 'confirmed');
    return !!info;
  }

  async transfer(recipient: string, amount: string, _memo?: string): Promise<string> {
    return this.transferFromToken(TREX_CONTRACTS.token, recipient, amount);
  }

  async mint(_recipient: string, _amount: string, _tokenContract?: string): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint(_tokenContract);
    const recipient = toPublicKeyOrNull(_recipient);
    if (!tokenMint || !recipient) {
      throw new Error('Invalid token mint or recipient');
    }

    try {
      const amount = BigInt(_amount);
      if (amount <= 0n) throw new Error('Amount must be greater than zero');

      const [tokenState] = deriveTokenStatePDA(tokenMint);
      const [agentRole] = deriveAgentRolePDA(tokenMint, this.wallet!.publicKey);
      const [irpState] = deriveIrpStatePDA(tokenMint);
      const [tirState] = deriveTirStatePDA(tokenMint);
      const [ctrState] = deriveCtrStatePDA(tokenMint);
      const [complianceState] = deriveComplianceStatePDA(tokenMint);

      const irpInfo = await connection.getAccountInfo(irpState, 'confirmed');
      if (!irpInfo || irpInfo.data.length < 104) {
        throw new Error('IRP state missing for this token');
      }
      const irsState = new PublicKey(irpInfo.data.subarray(72, 104));
      const [walletIdentity] = deriveWalletIdentityPDA(irsState, recipient);
      const [toFrozen] = deriveFrozenWalletPDA(tokenMint, recipient);
      const walletIdentityInfo = await connection.getAccountInfo(walletIdentity, 'confirmed');
      if (!walletIdentityInfo || walletIdentityInfo.data.length < 74) {
        throw new Error(
          `Recipient ${recipient.toBase58()} is not registered in identity registry for this token.`,
        );
      }
      const holderFid = new PublicKey(walletIdentityInfo.data.subarray(40, 72));

      const agentRoleInfo = await connection.getAccountInfo(agentRole, 'confirmed');
      if (!agentRoleInfo) {
        throw new Error(
          `Mint permission missing for ${this.wallet!.publicKey.toBase58()}. ` +
            `Add this wallet as token agent first from Token Admin -> Agents.`
        );
      }

      const ctrInfo = await connection.getAccountInfo(ctrState, 'confirmed');
      const requiredTopics = parseCtrTopics(ctrInfo);
      const now = Math.floor(Date.now() / 1000);
      const remainingAccountMetas: AccountMeta[] = [];
      if (requiredTopics.length > 0) {
        const holderFidInfo = await connection.getAccountInfo(holderFid, 'confirmed');
        if (!holderFidInfo || holderFidInfo.data.length < 108) {
          throw new Error(
            `Recipient FID account missing or invalid for ${recipient.toBase58()}.`,
          );
        }
        const claimCount = holderFidInfo.data.readUInt32LE(104);
        const claimPdas = Array.from({ length: claimCount }, (_, idx) => deriveClaimPDA(holderFid, idx)[0]);
        const claimInfos = claimPdas.length
          ? await connection.getMultipleAccountsInfo(claimPdas, 'confirmed')
          : [];
        const parsedClaims = claimInfos
          .map((info, idx) => {
            const parsed = info ? parseClaimAccount(info) : null;
            return parsed ? { ...parsed, pda: claimPdas[idx] } : null;
          })
          .filter((row): row is ParsedClaim & { pda: PublicKey } => !!row)
          .filter(
            (row) =>
              !row.revoked &&
              (row.expires_at === 0 || row.expires_at >= now) &&
              requiredTopics.includes(row.topic),
          );

        const trustedIssuerEntryCache = new Map<string, { isActive: boolean; topics: number[] } | null>();
        const resolveIssuerEntry = async (issuerFid: PublicKey) => {
          const cacheKey = issuerFid.toBase58();
          if (trustedIssuerEntryCache.has(cacheKey)) {
            return trustedIssuerEntryCache.get(cacheKey) || null;
          }
          const [issuerEntry] = deriveIssuerEntryPDA(tirState, issuerFid);
          const issuerEntryInfo = await connection.getAccountInfo(issuerEntry, 'confirmed');
          const parsed = parseIssuerEntry(issuerEntryInfo);
          trustedIssuerEntryCache.set(cacheKey, parsed);
          return parsed;
        };

        const selectedByTopic = new Map<
          number,
          { claim: ParsedClaim & { pda: PublicKey }; issuerFid: PublicKey; issuerEntry: PublicKey }
        >();
        for (const topic of requiredTopics) {
          const topicCandidates = parsedClaims
            .filter((row) => row.topic === topic)
            .sort((a, b) => b.issued_at - a.issued_at);
          if (topicCandidates.length === 0) {
            throw new Error(
              `Recipient ${recipient.toBase58()} is missing an active claim for required topic ${topic}.`,
            );
          }

          let selected:
            | { claim: ParsedClaim & { pda: PublicKey }; issuerFid: PublicKey; issuerEntry: PublicKey }
            | null = null;

          for (const candidate of topicCandidates) {
            const issuerFid = new PublicKey(candidate.issuer_fid);
            const [issuerEntry] = deriveIssuerEntryPDA(tirState, issuerFid);
            const issuerParsed = await resolveIssuerEntry(issuerFid);
            if (issuerParsed?.isActive && issuerParsed.topics.includes(topic)) {
              selected = { claim: candidate, issuerFid, issuerEntry };
              break;
            }
          }

          if (!selected) {
            // UX automation: if claims exist but none are trusted for this topic,
            // attempt to auto-register the newest claim issuer FID in TIR.
            // This only succeeds when connected wallet has TIR owner authority.
            const newest = topicCandidates[0];
            const newestIssuerFid = new PublicKey(newest.issuer_fid);
            try {
              await this.addTrustedIssuer(newestIssuerFid.toBase58(), [topic], tokenMint.toBase58());
              trustedIssuerEntryCache.delete(newestIssuerFid.toBase58());
              const [issuerEntry] = deriveIssuerEntryPDA(tirState, newestIssuerFid);
              const repaired = await resolveIssuerEntry(newestIssuerFid);
              if (repaired?.isActive && repaired.topics.includes(topic)) {
                selected = { claim: newest, issuerFid: newestIssuerFid, issuerEntry };
              }
            } catch {
              // ignore and fall through to actionable error below
            }
          }

          if (!selected) {
            const tirOwner = await this.getTirOwner(tokenMint.toBase58()).catch(() => null);
            const candidateIssuerFids = Array.from(
              new Set(topicCandidates.map((c) => c.issuer_fid)),
            );
            throw new Error(
              `No active trusted issuer claim found for topic ${topic} on ${recipient.toBase58()}. ` +
                `Auto-repair could not add issuer FID to TIR (missing owner permission or policy mismatch). ` +
                `Token=${tokenMint.toBase58()} TIR owner=${tirOwner || 'unknown'} ` +
                `candidate issuer FIDs=${candidateIssuerFids.join(',') || 'none'}.`,
            );
          }

          selectedByTopic.set(topic, selected);
        }

        const seen = new Set<string>();
        const pushRemaining = (pubkey: PublicKey) => {
          const key = pubkey.toBase58();
          if (seen.has(key)) return;
          seen.add(key);
          remainingAccountMetas.push({ pubkey, isSigner: false, isWritable: false });
        };

        for (const selected of selectedByTopic.values()) {
          pushRemaining(selected.claim.pda);
          pushRemaining(selected.issuerEntry);
          pushRemaining(selected.issuerFid);
        }
      }

      const destinationAta = getAssociatedTokenAddressSync(
        tokenMint,
        recipient,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      let currentBalance = 0n;
      try {
        const ata = await getAccount(connection, destinationAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
        currentBalance = ata.amount;
      } catch {
        currentBalance = 0n;
      }
      const toBalanceAfter = currentBalance + amount;

      const ixes: TransactionInstruction[] = [];
      ixes.push(
        createAssociatedTokenAccountIdempotentInstruction(
          this.wallet!.publicKey,
          destinationAta,
          recipient,
          tokenMint,
          TOKEN_2022_PROGRAM_ID,
        ),
      );
      ixes.push(
        buildMintInstruction(
          [
            { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
            { pubkey: tokenState, isSigner: false, isWritable: false },
            { pubkey: agentRole, isSigner: false, isWritable: false },
            { pubkey: irpState, isSigner: false, isWritable: false },
            { pubkey: irsState, isSigner: false, isWritable: false },
            { pubkey: tirState, isSigner: false, isWritable: false },
            { pubkey: ctrState, isSigner: false, isWritable: false },
            { pubkey: complianceState, isSigner: false, isWritable: false },
            { pubkey: PROGRAM_IDS.compliance, isSigner: false, isWritable: false },
            { pubkey: walletIdentity, isSigner: false, isWritable: false },
            { pubkey: toFrozen, isSigner: false, isWritable: false },
            { pubkey: tokenMint, isSigner: false, isWritable: true },
            { pubkey: destinationAta, isSigner: false, isWritable: true },
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            ...remainingAccountMetas,
          ],
          { to: recipient, amount, toBalanceAfter },
        ),
      );

      const tx = new Transaction().add(...ixes);
      tx.feePayer = this.wallet!.publicKey;
      const latest = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = latest.blockhash;
      const signed = await this.wallet!.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');

      return sig;
    } catch (error: any) {
      const msg = String(error?.message || 'Failed to mint tokens');
      if (msg.toLowerCase().includes('unauthorized')) {
        let owner = '';
        try {
          owner = await this.fetchOwnerFromOwnerState(tokenMint);
        } catch {
          owner = '';
        }
        const connected = this.wallet?.publicKey?.toBase58() || this.walletAddress || '';
        throw new Error(
          `Unauthorized mint. Connected wallet: ${connected || 'unknown'}. ` +
            `Token owner: ${owner || 'unavailable (RPC rate-limited)'}. ` +
            `Mint requires token owner/authorized agent on backend path.`
        );
      }
      throw new Error(msg);
    }
  }

  async burn(_amount: string, _tokenContract?: string): Promise<string> {
    throw new Error('MIGRATED: burn now requires full Solana compliance account bundle and is handled via dedicated admin flows.');
  }

  async freezeAddress(address: string, tokenContract?: string): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint(tokenContract);
    const wallet = toPublicKeyOrNull(address);
    if (!tokenMint || !wallet) throw new Error('Invalid token mint or wallet address');

    const [tokenState] = deriveTokenStatePDA(tokenMint);
    const [agentRole] = deriveAgentRolePDA(tokenMint, this.wallet!.publicKey);
    const [frozenWallet] = deriveFrozenWalletPDA(tokenMint, wallet);

    const data = buildInstructionData('freeze_wallet');
    return this.sendInstruction(
      PROGRAM_IDS.token,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: tokenState, isSigner: false, isWritable: false },
        { pubkey: agentRole, isSigner: false, isWritable: false },
        { pubkey: wallet, isSigner: false, isWritable: false },
        { pubkey: frozenWallet, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    );
  }

  async unfreezeAddress(address: string, tokenContract?: string): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint(tokenContract);
    const wallet = toPublicKeyOrNull(address);
    if (!tokenMint || !wallet) throw new Error('Invalid token mint or wallet address');

    const [tokenState] = deriveTokenStatePDA(tokenMint);
    const [agentRole] = deriveAgentRolePDA(tokenMint, this.wallet!.publicKey);
    const [frozenWallet] = deriveFrozenWalletPDA(tokenMint, wallet);

    const data = buildInstructionData('unfreeze_wallet');
    return this.sendInstruction(
      PROGRAM_IDS.token,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: tokenState, isSigner: false, isWritable: false },
        { pubkey: agentRole, isSigner: false, isWritable: false },
        { pubkey: frozenWallet, isSigner: false, isWritable: true },
      ],
      data,
    );
  }

  async pauseToken(tokenContract?: string): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint(tokenContract);
    if (!tokenMint) throw new Error('Invalid token mint');

    const [tokenState] = deriveTokenStatePDA(tokenMint);
    const [ownerState] = deriveOwnerStatePDA(tokenMint);

    const data = buildInstructionData('pause');
    return this.sendInstruction(
      PROGRAM_IDS.token,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: tokenState, isSigner: false, isWritable: true },
        { pubkey: ownerState, isSigner: false, isWritable: true },
      ],
      data,
    );
  }

  async unpauseToken(tokenContract?: string): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint(tokenContract);
    if (!tokenMint) throw new Error('Invalid token mint');

    const [tokenState] = deriveTokenStatePDA(tokenMint);
    const [ownerState] = deriveOwnerStatePDA(tokenMint);

    const data = buildInstructionData('unpause');
    return this.sendInstruction(
      PROGRAM_IDS.token,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: tokenState, isSigner: false, isWritable: true },
        { pubkey: ownerState, isSigner: false, isWritable: true },
      ],
      data,
    );
  }

  async batchSetKyc(
    _updates?: Array<{ address: string; status: string }>,
    _tokenContract?: string,
  ): Promise<string> {
    throw new Error('MIGRATED: batch_set_kyc replaced by Solana identity + claims flows.');
  }

  async setAddressTransferLimit(
    _address?: string,
    _limit?: string,
  ): Promise<string> {
    throw new Error('MIGRATED: transfer limits now enforced via compliance modules.');
  }

  async setAllowedCountries(_countries?: string[]): Promise<string> {
    throw new Error('MIGRATED: country restrictions now enforced via compliance modules.');
  }

  async isVerified(wallet: string): Promise<IsVerifiedResponse> {
    const target = toPublicKeyOrNull(wallet);
    if (!target) return { verified: false, reason: 'Invalid wallet' };

    const tokenMint = this.resolveTokenMint();
    if (!tokenMint) return { verified: false, reason: 'Missing token mint' };

    const [irpState] = deriveIrpStatePDA(tokenMint);
    const [tirState] = deriveTirStatePDA(tokenMint);
    const [ctrState] = deriveCtrStatePDA(tokenMint);
    const irpInfo = await connection.getAccountInfo(irpState, 'confirmed');
    if (!irpInfo || irpInfo.data.length < 104) {
      return { verified: false, reason: 'Registry accounts missing' };
    }
    const irsState = new PublicKey(irpInfo.data.subarray(72, 104));
    const [walletIdentity] = deriveWalletIdentityPDA(irsState, target);
    const identityInfo = await connection.getAccountInfo(walletIdentity, 'confirmed');
    if (!identityInfo || identityInfo.data.length < 74) {
      return { verified: false, reason: 'No wallet identity account' };
    }

    const tirInfo = await connection.getAccountInfo(tirState, 'confirmed');
    const ctrInfo = await connection.getAccountInfo(ctrState, 'confirmed');
    if (!tirInfo || !ctrInfo) {
      return { verified: false, reason: 'Registry accounts missing' };
    }

    const requiredTopics = parseCtrTopics(ctrInfo);
    if (requiredTopics.length === 0) {
      return { verified: true, reason: undefined };
    }

    const holderFid = new PublicKey(identityInfo.data.subarray(40, 72));
    const fidInfo = await connection.getAccountInfo(holderFid, 'confirmed');
    if (!fidInfo || fidInfo.data.length < 109) {
      return { verified: false, reason: 'OnChainID account missing' };
    }

    const claimCount = fidInfo.data.readUInt32LE(104);
    if (claimCount === 0) {
      return { verified: false, reason: 'No claims on OnChainID' };
    }

    const claimPdas = Array.from({ length: claimCount }, (_, idx) => deriveClaimPDA(holderFid, idx)[0]);
    const claimInfos = await connection.getMultipleAccountsInfo(claimPdas, 'confirmed');
    const now = Math.floor(Date.now() / 1000);
    const claims = claimInfos
      .map((info) => (info ? parseClaimAccount(info) : null))
      .filter((c): c is ParsedClaim => !!c)
      .filter((c) => !c.revoked && (c.expires_at === 0 || c.expires_at >= now));

    for (const topic of requiredTopics) {
      const topicClaims = claims
        .filter((claim) => claim.topic === topic)
        .sort((a, b) => b.issued_at - a.issued_at);

      if (topicClaims.length === 0) {
        return { verified: false, reason: `Missing required claim topic ${topic}` };
      }

      let trusted = false;
      for (const claim of topicClaims) {
        const issuerFid = new PublicKey(claim.issuer_fid);
        const [issuerEntry] = deriveIssuerEntryPDA(tirState, issuerFid);
        const issuerEntryInfo = await connection.getAccountInfo(issuerEntry, 'confirmed');
        const parsed = parseIssuerEntry(issuerEntryInfo);
        if (parsed?.isActive && parsed.topics.includes(topic)) {
          trusted = true;
          break;
        }
      }

      if (!trusted) {
        return { verified: false, reason: `No trusted issuer claim for topic ${topic}` };
      }
    }

    return { verified: true, reason: undefined };
  }

  async getIdentity(wallet: string): Promise<IdentityResponse> {
    const target = toPublicKeyOrNull(wallet);
    if (!target) return { wallet, identity_addr: undefined, country: undefined };

    const tokenMint = this.resolveTokenMint();
    if (!tokenMint) return { wallet, identity_addr: undefined, country: undefined };

    const [irpState] = deriveIrpStatePDA(tokenMint);
    const irpInfo = await connection.getAccountInfo(irpState, 'confirmed');

    if (irpInfo && irpInfo.data.length >= 104) {
      const irsState = new PublicKey(irpInfo.data.subarray(72, 104));
      const [walletIdentity] = deriveWalletIdentityPDA(irsState, target);
      const identityInfo = await connection.getAccountInfo(walletIdentity, 'confirmed');
      if (identityInfo && identityInfo.data.length >= 74) {
        const fid = new PublicKey(identityInfo.data.subarray(40, 72)).toBase58();
        const country = identityInfo.data.readUInt16LE(72).toString();
        return {
          wallet,
          identity_addr: fid,
          country,
        };
      }
    }

    // Fallback: detect raw wallet-owned FID even if not yet linked in IRS.
    const [fidPda] = deriveFidPDA(target);
    const fidInfo = await connection.getAccountInfo(fidPda, 'confirmed');
    if (!fidInfo || fidInfo.data.length < 111) {
      return { wallet, identity_addr: undefined, country: undefined };
    }

    const country = fidInfo.data.readUInt16LE(109).toString();

    return {
      wallet,
      identity_addr: fidPda.toBase58(),
      country,
    };
  }

  async isWalletIdentityRegistered(wallet: string): Promise<boolean> {
    const target = toPublicKeyOrNull(wallet);
    const tokenMint = this.resolveTokenMint();
    if (!target || !tokenMint) return false;

    const [irpState] = deriveIrpStatePDA(tokenMint);
    const irpInfo = await connection.getAccountInfo(irpState, 'confirmed');
    if (!irpInfo || irpInfo.data.length < 104) return false;

    const irsState = new PublicKey(irpInfo.data.subarray(72, 104));
    const [walletIdentity] = deriveWalletIdentityPDA(irsState, target);
    return !!(await connection.getAccountInfo(walletIdentity, 'confirmed'));
  }

  async getUserIdentity(wallet: string): Promise<UserIdentity> {
    const [verified, identity] = await Promise.all([
      this.isVerified(wallet),
      this.getIdentity(wallet),
    ]);

    let claims: any[] = [];
    const fid = toPublicKeyOrNull(identity.identity_addr || null);
    if (fid) {
      const fidInfo = await connection.getAccountInfo(fid, 'confirmed').catch(() => null);
      if (fidInfo && fidInfo.data.length >= 109) {
        const claimCount = fidInfo.data.readUInt32LE(104);
        if (claimCount > 0) {
          const claimPdas = Array.from({ length: claimCount }, (_, idx) => deriveClaimPDA(fid, idx)[0]);
          const claimInfos = await connection.getMultipleAccountsInfo(claimPdas, 'confirmed');
          claims = claimInfos
            .map((info) => (info ? parseClaimAccount(info) : null))
            .filter((c): c is ParsedClaim => !!c)
            .map((c) => ({
              topic: c.topic,
              issuer: c.issuer_fid,
              data: c.data_hash,
              issued_at: c.issued_at,
              expires_at: c.expires_at,
              revoked: c.revoked,
            }));
        }
      }
    }

    return {
      wallet,
      onchainIdAddress: identity.identity_addr,
      country: identity.country,
      isVerified: verified.verified,
      verificationReason: verified.reason,
      claims,
    };
  }

  async registerIdentity(
    wallet: string,
    identityAddr: string,
    country?: string,
  ): Promise<string> {
    this.ensureSigner();

    const walletPk = toPublicKeyOrNull(wallet);
    const fidPk = toPublicKeyOrNull(identityAddr);
    if (!walletPk || !fidPk) throw new Error('Invalid wallet or identity address');

    const [irsState] = deriveIrsStatePDA(this.wallet!.publicKey);
    const [walletIdentity] = deriveWalletIdentityPDA(irsState, walletPk);

    const data = buildInstructionData(
      'register_identity',
      encodePubkey(walletPk),
      encodePubkey(fidPk),
      encodeU16(normalizeCountry(country)),
    );

    return this.sendInstruction(
      PROGRAM_IDS.irs,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: irsState, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: false },
        { pubkey: walletIdentity, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    );
  }

  async unregisterIdentity(wallet: string): Promise<string> {
    this.ensureSigner();
    const walletPk = toPublicKeyOrNull(wallet);
    if (!walletPk) throw new Error('Invalid wallet');

    const [irsState] = deriveIrsStatePDA(this.wallet!.publicKey);
    const [walletIdentity] = deriveWalletIdentityPDA(irsState, walletPk);

    const data = buildInstructionData('remove_identity');
    return this.sendInstruction(
      PROGRAM_IDS.irs,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: irsState, isSigner: false, isWritable: true },
        { pubkey: PublicKey.default, isSigner: false, isWritable: false },
        { pubkey: walletIdentity, isSigner: false, isWritable: true },
      ],
      data,
    );
  }

  async createOnChainIdForInvestor(investorWallet: string, _label?: string, country?: string | number): Promise<string> {
    return this.createOnChainId(investorWallet, _label, country, false);
  }

  async createOnChainId(owner: string, _label?: string, country?: string | number, isIssuer = false): Promise<string> {
    this.ensureSigner();
    const ownerPk = toPublicKeyOrNull(owner);
    if (!ownerPk) throw new Error('Invalid owner wallet');

    const [fid] = deriveFidPDA(ownerPk);
    const data = buildInstructionData(
      'create_fid',
      Buffer.from([isIssuer ? 1 : 0]),
      encodeU16(normalizeCountry(country)),
    );

    await this.sendInstruction(
      PROGRAM_IDS.fid,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: fid, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    );

    return fid.toBase58();
  }

  async addClaim(
    identityAddr: string,
    topic: number,
    data?: string,
    expiresAt?: number,
  ): Promise<string> {
    this.ensureSigner();

    const targetFid = toPublicKeyOrNull(identityAddr);
    if (!targetFid) throw new Error('Invalid identity address');

    const [issuerFid] = deriveFidPDA(this.wallet!.publicKey);
    let issuerInfo = await connection.getAccountInfo(issuerFid, 'confirmed');
    if (!issuerInfo) {
      // Fresh provider wallet path: create issuer FID automatically.
      await this.createOnChainId(
        this.wallet!.publicKey.toBase58(),
        `PROVIDER-${this.wallet!.publicKey.toBase58().slice(0, 8)}`,
        'US',
        true,
      );
      issuerInfo = await connection.getAccountInfo(issuerFid, 'confirmed');
      if (!issuerInfo) {
        throw new Error(
          `Issuer FID creation failed for wallet ${this.wallet!.publicKey.toBase58()}.`
        );
      }
    }
    const isIssuerFid = issuerInfo.data.length > 108 && issuerInfo.data.readUInt8(108) === 1;
    if (!isIssuerFid) {
      throw new Error(
        `Wallet ${this.wallet!.publicKey.toBase58()} has FID ${issuerFid.toBase58()} with is_issuer=false. ` +
          `This cannot be upgraded in-place. Use a fresh provider wallet (no existing FID), create issuer FID, then add it to TIR topic 2.`
      );
    }
    const targetInfo = await connection.getAccountInfo(targetFid, 'confirmed');
    if (!targetInfo || targetInfo.data.length < 108) {
      throw new Error('Target OnChainID not found or invalid');
    }

    const claimCount = targetInfo.data.readUInt32LE(104);
    const [claim] = deriveClaimPDA(targetFid, claimCount);
    const expiry = BigInt(expiresAt || 0);
    const currentSignerKey = new PublicKey(issuerInfo.data.subarray(72, 104));

    const dataHash = new Uint8Array(32);
    dataHash.set(await sha256(new TextEncoder().encode(data || '')));

    // Mirror fracks-fid::construct_claim_message exactly:
    // hash(issuer_fid || holder_fid || topic_le || data_hash || expires_at_le)
    const claimPayload = new Uint8Array(32 + 32 + 8 + 32 + 8);
    claimPayload.set(issuerFid.toBytes(), 0);
    claimPayload.set(targetFid.toBytes(), 32);
    claimPayload.set(encodeU64(topic), 64);
    claimPayload.set(dataHash, 72);
    claimPayload.set(encodeI64(expiry), 104);
    const message = await sha256(claimPayload);
    let signature: Uint8Array;
    let claimSignerPubkey = currentSignerKey;
    const localSigner = getStoredLocalClaimSigner(this.wallet!.publicKey);
    const signerMode = detectClaimSignerMode({
      onChainSignerKey: currentSignerKey,
      connectedWallet: this.wallet!.publicKey,
      localSigner,
    });

    if (signerMode === 'wallet-backed') {
      try {
        if (!this.wallet!.signMessage) {
          throw new Error('Wallet does not support signMessage.');
        }
        signature = await this.wallet!.signMessage(message);
      } catch {
        const backend = await signClaimWithBackendProviderWallet({
          providerWallet: this.wallet!.publicKey.toBase58(),
          providerFid: issuerFid.toBase58(),
          targetFid: targetFid.toBase58(),
          topic: topic.toString(),
          expiresAt: expiry.toString(),
          dataHash,
          message,
        });
        if (backend.signerPublicKey !== currentSignerKey.toBase58()) {
          throw new Error(
            `Backend provider signer returned ${backend.signerPublicKey}, but the on-chain issuer FID signer key is ${currentSignerKey.toBase58()}. ` +
            `For this deployed FID program, backend signing must use the same provider wallet keypair.`,
          );
        }
        if (!Buffer.from(backend.message).equals(Buffer.from(message))) {
          throw new Error(
            'Backend provider signer returned a different claim message than the frontend constructed.',
          );
        }
        signature = backend.signature;
      }
    } else if (signerMode === 'browser-local') {
      if (!localSigner) {
        throw new Error(
          `This browser/profile does not hold the provider's current local claim signer. ` +
          `On-chain issuer FID signer key: ${currentSignerKey.toBase58()}. ` +
          `Local stored signer key: none. ` +
          `Do not issue this claim from this browser. Use the original browser/profile that holds the current signer, or explicitly rotate the signer key in Identity Manager only if you intend to invalidate existing claims signed under the current key.`,
        );
      }
      if (!currentSignerKey.equals(localSigner.publicKey)) {
        throw new Error(
          `This browser/profile does not hold the provider's current local claim signer. ` +
          `On-chain issuer FID signer key: ${currentSignerKey.toBase58()}. ` +
          `Local stored signer key: ${localSigner.publicKey.toBase58()}. ` +
          `Do not issue this claim from this browser. Use the original browser/profile that holds the current signer, or explicitly rotate the signer key in Identity Manager only if you intend to invalidate existing claims signed under the current key.`,
        );
      }
      signature = nacl.sign.detached(message, localSigner.secretKey);
    } else {
      throw new Error(
        `Current provider signer is not available. On-chain issuer FID signer key: ${currentSignerKey.toBase58()}. ` +
          `Connected wallet: ${this.wallet!.publicKey.toBase58()}. ` +
          `For this deployed FID program, the signer key must remain aligned with the provider wallet keypair.`,
      );
    }

    const edIx = Ed25519Program.createInstructionWithPublicKey({
      publicKey: claimSignerPubkey.toBytes(),
      message,
      signature,
    });

    const [claimTopicIndex] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('claim_topic_index'),
        targetFid.toBuffer(),
        issuerFid.toBuffer(),
        Buffer.from(encodeU64(topic)),
      ],
      PROGRAM_IDS.fid,
    );

    const addClaimIx = new TransactionInstruction({
      programId: PROGRAM_IDS.fid,
      keys: [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: targetFid, isSigner: false, isWritable: true },
        { pubkey: claim, isSigner: false, isWritable: true },
        { pubkey: claimTopicIndex, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: buildInstructionData(
        'add_claim',
        encodeU64(topic),
        issuerFid.toBuffer(),
        Buffer.from(dataHash),
        Buffer.from(signature).subarray(0, 64),
        encodeI64(expiry),
      ),
    });

    const tx = new Transaction().add(edIx, addClaimIx);
    tx.feePayer = this.wallet!.publicKey;
    const latest = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = latest.blockhash;
    const signed = await this.wallet!.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      preflightCommitment: 'confirmed',
      skipPreflight: false,
    });
    await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
    return sig;
  }

  async revokeClaim(identityAddr: string, topic: number, claimRef?: string | number): Promise<string> {
    this.ensureSigner();
    const fid = toPublicKeyOrNull(identityAddr);
    if (!fid) throw new Error('Invalid identity address');

    let claimId = typeof claimRef === 'number' ? claimRef : Number(claimRef);
    if (!Number.isInteger(claimId) || claimId < 0) {
      const candidateClaims = await this.getClaimsByTopic(identityAddr, topic);
      const activeClaim = candidateClaims.find((row) => !row.revoked) || candidateClaims[0];
      if (!activeClaim) {
        throw new Error(`No claim found for topic ${topic} on ${identityAddr}`);
      }
      claimId = Number(activeClaim.claim_id);
    }

    const [claim] = deriveClaimPDA(fid, claimId);
    const [claimInfo, fidInfo] = await Promise.all([
      connection.getAccountInfo(claim, 'confirmed'),
      connection.getAccountInfo(fid, 'confirmed'),
    ]);
    if (!claimInfo) {
      throw new Error(`Claim account not found for claim_id ${claimId} on ${identityAddr}`);
    }
    if (!fidInfo || fidInfo.data.length < 72) {
      throw new Error(`FID account ${identityAddr} not found or invalid`);
    }

    const parsedClaim = parseClaimAccount(claimInfo);
    if (!parsedClaim) {
      throw new Error(`Claim account ${claim.toBase58()} is not a valid ClaimAccount`);
    }

    const [claimTopicIndex] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('claim_topic_index'),
        new PublicKey(parsedClaim.fid).toBuffer(),
        new PublicKey(parsedClaim.issuer_fid).toBuffer(),
        Buffer.from(encodeU64(BigInt(parsedClaim.topic))),
      ],
      PROGRAM_IDS.fid,
    );

    const fidOwner = new PublicKey(fidInfo.data.subarray(8, 40));
    const fidManagementKey = new PublicKey(fidInfo.data.subarray(40, 72));
    const connectedWallet = this.wallet!.publicKey;

    // Investor/FID owner path: remove the stale claim entirely, which also clears the topic index.
    if (connectedWallet.equals(fidOwner) || connectedWallet.equals(fidManagementKey)) {
      return this.sendInstruction(
        PROGRAM_IDS.fid,
        [
          { pubkey: connectedWallet, isSigner: true, isWritable: true },
          { pubkey: fid, isSigner: false, isWritable: false },
          { pubkey: claim, isSigner: false, isWritable: true },
          { pubkey: claimTopicIndex, isSigner: false, isWritable: true },
        ],
        buildInstructionData('remove_claim'),
      );
    }

    const [issuerFid] = deriveFidPDA(connectedWallet);
    if (issuerFid.toBase58() !== parsedClaim.issuer_fid) {
      throw new Error(
        `Connected wallet ${connectedWallet.toBase58()} is neither the investor FID owner/manager nor the claim issuer owner for claim ${claim.toBase58()}.`,
      );
    }

    return this.sendInstruction(
      PROGRAM_IDS.fid,
      [
        { pubkey: connectedWallet, isSigner: true, isWritable: true },
        { pubkey: issuerFid, isSigner: false, isWritable: false },
        { pubkey: claim, isSigner: false, isWritable: true },
        { pubkey: claimTopicIndex, isSigner: false, isWritable: true },
      ],
      buildInstructionData('revoke_claim'),
    );
  }

  async getClaim(_identityAddr: string, _topic: number, _issuer: string): Promise<ClaimResponse> {
    const fid = toPublicKeyOrNull(_identityAddr);
    const issuerPk = toPublicKeyOrNull(_issuer);
    if (!fid) return { claim: undefined };

    const issuerFid = issuerPk ? await resolveIssuerFid(issuerPk) : null;
    const claims = await this.getClaimsByTopic(_identityAddr, _topic);
    const claim = claims.find((c) => !issuerFid || c.issuer === issuerFid.toBase58());
    if (!claim) return { claim: undefined };
    return {
      claim: {
        topic: claim.topic,
        issuer: claim.issuer,
        revoked: claim.revoked,
        issued_at: claim.issued_at,
        expires_at: claim.expires_at,
      } as any,
    };
  }

  async getClaimsByTopic(_identityAddr: string, _topic: number): Promise<any[]> {
    const fid = toPublicKeyOrNull(_identityAddr);
    if (!fid) return [];
    const topic = Number(_topic);
    const fidFilter = { memcmp: { offset: 8, bytes: fid.toBase58() } };
    const sizeFilter = { dataSize: 230 };

    const accounts = await connection.getProgramAccounts(PROGRAM_IDS.fid, {
      commitment: 'confirmed',
      filters: [sizeFilter, fidFilter],
    });

    return accounts
      .map(({ account, pubkey }) => {
        const parsed = parseClaimAccount(account);
        if (!parsed) return null;
        return {
          claim_address: pubkey.toBase58(),
          topic: parsed.topic,
          issuer: parsed.issuer_fid,
          data_hash: parsed.data_hash,
          signer_key: parsed.signer_key,
          issued_at: parsed.issued_at,
          expires_at: parsed.expires_at,
          revoked: parsed.revoked,
          claim_id: parsed.claim_id,
        };
      })
      .filter((row) => !!row && row.topic === topic);
  }

  async canTransfer(
    _token: string,
    _from: string,
    _to: string,
    _amount: string,
  ): Promise<CanTransferResponse> {
    // MIGRATED: can_transfer now enforced during Token-2022 transfer hook execution.
    return { allowed: true };
  }

  async getComplianceData(): Promise<TrexCompliance> {
    return {
      canTransfer: true,
      requiredTopics: (await this.getRequiredTopics()).topics,
      trustedIssuers: (await this.getTrustedIssuers()).issuers,
    };
  }

  async getTrustedIssuers(): Promise<AllIssuersResponse> {
    return { issuers: [] };
  }

  async getIssuerTopics(_issuer: string, tokenContract?: string): Promise<number[] | null> {
    const tokenMint = this.resolveTokenMint(tokenContract);
    const issuer = toPublicKeyOrNull(_issuer);
    if (!tokenMint || !issuer) return null;

    const [tirState] = deriveTirStatePDA(tokenMint);
    const issuerFid = await resolveIssuerFid(issuer);
    const [issuerEntry] = deriveIssuerEntryPDA(tirState, issuerFid);
    let info: AccountInfo<Buffer> | null = null;
    for (let i = 0; i < 3; i += 1) {
      try {
        info = await connection.getAccountInfo(issuerEntry, 'confirmed');
        break;
      } catch (error: any) {
        if (!String(error?.message || '').includes('429') || i === 2) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
      }
    }
    const parsed = parseIssuerEntry(info);
    if (!parsed || !parsed.isActive) return null;
    return parsed.topics;
  }

  async isIssuerForTopic(issuer: string, topic: number, tokenContract?: string): Promise<boolean> {
    const topics = await this.getIssuerTopics(issuer, tokenContract);
    return !!topics?.includes(topic);
  }

  async addTrustedIssuer(issuer: string, topics: number[], tokenContract?: string): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint(tokenContract);
    const issuerPk = toPublicKeyOrNull(issuer);
    if (!tokenMint || !issuerPk) throw new Error('Invalid token mint or issuer wallet');

    const [tirState] = deriveTirStatePDA(tokenMint);
    const issuerFid = await resolveIssuerFid(issuerPk);
    const [issuerEntry] = deriveIssuerEntryPDA(tirState, issuerFid);

    const label = `issuer-${issuer.slice(0, 8)}`;
    const topicVecLen = Buffer.alloc(4);
    topicVecLen.writeUInt32LE(topics.length, 0);
    const topicBytes = topics.map((t) => encodeU64(t));

    const data = buildInstructionData(
      'add_trusted_issuer',
      encodePubkey(issuerFid),
      topicVecLen,
      ...topicBytes,
      encodeString(label),
    );

    try {
      return await this.sendInstruction(
        PROGRAM_IDS.tir,
        [
          { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
          { pubkey: tirState, isSigner: false, isWritable: true },
          { pubkey: issuerEntry, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      );
    } catch (error: any) {
      const msg = String(error?.message || error);
      // Upsert behavior: if entry already exists, remove then recreate with merged topics.
      if (msg.includes('already in use') || msg.includes('custom program error: 0x0')) {
        const existingInfo = await connection.getAccountInfo(issuerEntry, 'confirmed');
        const existing = parseIssuerEntry(existingInfo);
        const merged = Array.from(new Set([...(existing?.topics || []), ...topics]));
        await this.removeTrustedIssuer(issuer, tokenMint.toBase58());
        const mergedVecLen = Buffer.alloc(4);
        mergedVecLen.writeUInt32LE(merged.length, 0);
        const mergedBytes = merged.map((t) => encodeU64(t));
        const mergedData = buildInstructionData(
          'add_trusted_issuer',
          encodePubkey(issuerFid),
          mergedVecLen,
          ...mergedBytes,
          encodeString(label),
        );
        return this.sendInstruction(
          PROGRAM_IDS.tir,
          [
            { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
            { pubkey: tirState, isSigner: false, isWritable: true },
            { pubkey: issuerEntry, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          mergedData,
        );
      }
      throw error;
    }
  }

  async removeTrustedIssuer(issuer: string, tokenContract?: string): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint(tokenContract);
    const issuerPk = toPublicKeyOrNull(issuer);
    if (!tokenMint || !issuerPk) throw new Error('Invalid token mint or issuer wallet');

    const [tirState] = deriveTirStatePDA(tokenMint);
    const issuerFid = await resolveIssuerFid(issuerPk);
    const [issuerEntry] = deriveIssuerEntryPDA(tirState, issuerFid);

    return this.sendInstruction(
      PROGRAM_IDS.tir,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: tirState, isSigner: false, isWritable: true },
        { pubkey: issuerEntry, isSigner: false, isWritable: true },
      ],
      buildInstructionData('remove_trusted_issuer'),
    );
  }

  async updateTirOwner(_owner: string): Promise<string> {
    throw new Error('MIGRATED: TIR owner update uses transfer_registry_ownership/admin owner operations.');
  }

  async getRequiredTopics(): Promise<RequiredTopicsResponse> {
    const tokenMint = this.resolveTokenMint();
    if (!tokenMint) return { topics: [] };
    const [ctrState] = deriveCtrStatePDA(tokenMint);
    const info = await connection.getAccountInfo(ctrState, 'confirmed');
    return { topics: parseCtrTopics(info) };
  }

  async setRequiredTopics(_topics: number[]): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint();
    if (!tokenMint) throw new Error('Invalid token mint');

    const [ctrState] = deriveCtrStatePDA(tokenMint);
    const info = await connection.getAccountInfo(ctrState, 'confirmed');
    const current = new Set(parseCtrTopics(info));
    const desired = new Set(_topics);

    const toAdd = _topics.filter((topic) => !current.has(topic));
    const toRemove = Array.from(current).filter((topic) => !desired.has(topic));

    if (toAdd.length === 0 && toRemove.length === 0) {
      return '';
    }

    const instructions: TransactionInstruction[] = [];
    for (const topic of toAdd) {
      instructions.push(
        new TransactionInstruction({
          programId: PROGRAM_IDS.ctr,
          keys: [
            { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
            { pubkey: ctrState, isSigner: false, isWritable: true },
          ],
          data: buildInstructionData('add_claim_topic', encodeU64(topic)),
        }),
      );
    }

    for (const topic of toRemove) {
      instructions.push(
        new TransactionInstruction({
          programId: PROGRAM_IDS.ctr,
          keys: [
            { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
            { pubkey: ctrState, isSigner: false, isWritable: true },
          ],
          data: buildInstructionData('remove_claim_topic', encodeU64(topic)),
        }),
      );
    }

    const tx = new Transaction().add(...instructions);
    tx.feePayer = this.wallet!.publicKey;
    const latest = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = latest.blockhash;
    const signed = await this.wallet!.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      preflightCommitment: 'confirmed',
      skipPreflight: false,
    });
    await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
    return sig;
  }

  async getIdentityRegistryConfig(): Promise<IRConfigResponse> {
    const tokenMint = this.resolveTokenMint();
    if (!tokenMint) {
      return { owner: '', trusted_issuers: '', claim_topics: '' };
    }

    const [irpState] = deriveIrpStatePDA(tokenMint);
    const info = await connection.getAccountInfo(irpState, 'confirmed');
    if (!info || info.data.length < 168) {
      return { owner: '', trusted_issuers: '', claim_topics: '' };
    }

    const owner = new PublicKey(info.data.subarray(40, 72)).toBase58();
    const irs = new PublicKey(info.data.subarray(72, 104)).toBase58();
    const tir = new PublicKey(info.data.subarray(104, 136)).toBase58();
    const ctr = new PublicKey(info.data.subarray(136, 168)).toBase58();

    return {
      owner,
      trusted_issuers: tir,
      claim_topics: ctr,
      identity_storage: irs,
    } as any;
  }

  async getClaimTopicsOwner(): Promise<string> {
    const tokenMint = this.resolveTokenMint();
    if (!tokenMint) return '';
    const [ctrState] = deriveCtrStatePDA(tokenMint);
    const info = await connection.getAccountInfo(ctrState, 'confirmed');
    if (!info || info.data.length < 40) return '';
    return new PublicKey(info.data.subarray(8, 40)).toBase58();
  }

  async getComplianceConfig(): Promise<ComplianceConfigResponse> {
    const tokenMint = this.resolveTokenMint();
    if (!tokenMint) return { owner: '' };
    const [compliance] = deriveComplianceStatePDA(tokenMint);
    const info = await connection.getAccountInfo(compliance, 'confirmed');
    if (!info || info.data.length < 40) return { owner: '' };
    return {
      owner: new PublicKey(info.data.subarray(8, 40)).toBase58(),
      module_count: info.data.readUInt32LE(72),
    };
  }

  async getTirOwner(tokenContract?: string): Promise<string | null> {
    const tokenMint = this.resolveTokenMint(tokenContract);
    if (!tokenMint) return null;
    const [tirState] = deriveTirStatePDA(tokenMint);
    const info = await connection.getAccountInfo(tirState, 'confirmed');
    if (!info || info.data.length < 40) return null;
    return new PublicKey(info.data.subarray(8, 40)).toBase58();
  }

  async getRoles(tokenContract?: string): Promise<{ owner: string; issuer: string; controller: string }> {
    const tokenMint = this.resolveTokenMint(tokenContract);
    if (!tokenMint) return { owner: '', issuer: '', controller: '' };

    let owner = '';
    try {
      owner = await this.fetchOwnerFromOwnerState(tokenMint);
    } catch {
      owner = '';
    }

    // MIGRATED: distinct owner/issuer/controller replaced by Solana owner + agent roles.
    return {
      owner,
      issuer: owner,
      controller: owner,
    };
  }

  async isAgent(address: string, tokenContract?: string): Promise<boolean> {
    const tokenMint = this.resolveTokenMint(tokenContract);
    const agent = toPublicKeyOrNull(address);
    if (!tokenMint || !agent) return false;
    const [agentRole] = deriveAgentRolePDA(tokenMint, agent);
    return !!(await connection.getAccountInfo(agentRole, 'confirmed'));
  }

  async getAgents(_tokenContract?: string): Promise<{ agents: string[] }> {
    return { agents: [] };
  }

  async updateOwner(newOwner: string, tokenContract?: string): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint(tokenContract);
    const ownerPk = toPublicKeyOrNull(newOwner);
    if (!tokenMint || !ownerPk) throw new Error('Invalid owner/token mint');

    const [tokenState] = deriveTokenStatePDA(tokenMint);
    const [ownerState] = deriveOwnerStatePDA(tokenMint);

    const data = buildInstructionData('transfer_ownership', encodePubkey(ownerPk));
    return this.sendInstruction(
      PROGRAM_IDS.token,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: tokenState, isSigner: false, isWritable: true },
        { pubkey: ownerState, isSigner: false, isWritable: true },
      ],
      data,
    );
  }

  async updateIssuer(_newIssuer: string, _tokenContract?: string): Promise<string> {
    throw new Error('MIGRATED: separate issuer role removed; use addAgent/removeAgent on Solana token program.');
  }

  async updateController(_newController: string, _tokenContract?: string): Promise<string> {
    throw new Error('MIGRATED: separate controller role removed; use addAgent/removeAgent on Solana token program.');
  }

  async addAgent(agent: string, tokenContract?: string): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint(tokenContract);
    const agentPk = toPublicKeyOrNull(agent);
    if (!tokenMint || !agentPk) throw new Error('Invalid agent/token mint');

    const [tokenState] = deriveTokenStatePDA(tokenMint);
    const [ownerState] = deriveOwnerStatePDA(tokenMint);
    const [agentRole] = deriveAgentRolePDA(tokenMint, agentPk);

    return this.sendInstruction(
      PROGRAM_IDS.token,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: tokenState, isSigner: false, isWritable: false },
        { pubkey: ownerState, isSigner: false, isWritable: false },
        { pubkey: agentRole, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      buildInstructionData('add_agent', encodePubkey(agentPk)),
    );
  }

  async removeAgent(agent: string, tokenContract?: string): Promise<string> {
    this.ensureSigner();
    const tokenMint = this.resolveTokenMint(tokenContract);
    const agentPk = toPublicKeyOrNull(agent);
    if (!tokenMint || !agentPk) throw new Error('Invalid agent/token mint');

    const [tokenState] = deriveTokenStatePDA(tokenMint);
    const [ownerState] = deriveOwnerStatePDA(tokenMint);
    const [agentRole] = deriveAgentRolePDA(tokenMint, agentPk);

    return this.sendInstruction(
      PROGRAM_IDS.token,
      [
        { pubkey: this.wallet!.publicKey, isSigner: true, isWritable: true },
        { pubkey: tokenState, isSigner: false, isWritable: false },
        { pubkey: ownerState, isSigner: false, isWritable: false },
        { pubkey: agentRole, isSigner: false, isWritable: true },
      ],
      buildInstructionData('remove_agent'),
    );
  }

  async getAllAssets(
    _startAfter?: number,
    _limit: number = 50,
    _tokenContract?: string,
  ): Promise<AssetInfo[]> {
    return [];
  }

  async getAssetInfo(_assetId: number, _tokenContract?: string): Promise<AssetInfo> {
    return {
      id: 0,
      assetId: 0,
      referenceId: '',
      asset_id: 0,
      reference_id: '',
      description: '',
      legal_owner: '',
      total_tokenized: '0',
    };
  }

  async createAsset(
    _assetData?: Record<string, any>,
    _tokenContract?: string,
  ): Promise<{ assetId: number; txHash: string }> {
    throw new Error('MIGRATED: createAsset replaced by factory deployTokenSuite/createAssetToken.');
  }

  async issueAsset(
    _assetId?: number,
    _recipient?: string,
    _amount?: string,
    _tokenContract?: string,
  ): Promise<{ requestId: number; txHash: string }> {
    throw new Error('MIGRATED: issueAsset replaced by token mint/issuer flows on Solana.');
  }

  async approveIssue(_requestId: number, _tokenContract?: string): Promise<string> {
    throw new Error('MIGRATED: approveIssue queue removed; use direct issuance governance flow.');
  }

  async requestRedemption(
    _assetId: number,
    _amount: string,
    _reason?: string,
    _tokenContract?: string,
  ): Promise<{ requestId: number; txHash: string }> {
    throw new Error('MIGRATED: redemption queue removed; use token burn/recovery governance flow.');
  }

  async approveRedemption(_requestId: number, _tokenContract?: string): Promise<string> {
    throw new Error('MIGRATED: approveRedemption queue removed; use direct burn governance flow.');
  }

  async getRedemptionRequests(
    _startAfter?: number,
    _limit: number = 50,
    _tokenContract?: string,
  ): Promise<RedemptionRequest[]> {
    return [];
  }

  async getFactoryConfig(): Promise<FactoryConfig> {
    const [factoryState] = deriveFactoryStatePDA();
    const info = await connection.getAccountInfo(factoryState, 'confirmed');
    const wallet = this.walletAddress || this.wallet?.publicKey?.toBase58() || '';

    if (!info || info.data.length < 40) {
      return {
        admin: wallet,
        token_code_id: 0,
        ctr_code_id: 0,
        tir_code_id: 0,
        compliance_code_id: 0,
        ir_code_id: 0,
        identity_registry_storage: '',
        onchainid_code_id: 0,
        default_owner: wallet,
        default_issuer: wallet,
        default_controller: wallet,
      };
    }

    const admin = new PublicKey(info.data.subarray(8, 40)).toBase58();
    return {
      admin,
      token_code_id: 0,
      ctr_code_id: 0,
      tir_code_id: 0,
      compliance_code_id: 0,
      ir_code_id: 0,
      identity_registry_storage: '',
      onchainid_code_id: 0,
      default_owner: admin,
      default_issuer: admin,
      default_controller: admin,
    };
  }

  async updateFactoryConfig(_config?: Partial<FactoryConfig>): Promise<string> {
    return '';
  }

  async getTokenByAssetId(_assetId: number): Promise<TokenInfoFromFactory> {
    throw new Error('MIGRATED: per-asset token lookup should come from indexed backend token deployments.');
  }

  async getAllFactoryTokens(_startAfter?: number, _limit?: number): Promise<TokenInfoFromFactory[]> {
    return [];
  }

  async getAssetIdByContract(_contract: string): Promise<number> {
    return 0;
  }

async createAssetToken(params: CreateAssetParams): Promise<{ assetId: number; tokenContract: string; txHash: string }> {
  this.ensureSigner();
  const issuer = this.wallet!.publicKey;
  const decimals = Math.max(0, Math.min(255, Number(params.decimals || 6)));
  const claimTopics = params.claimDetails?.claim_topics?.length
    ? params.claimDetails.claim_topics
    : [1, 2];

  const factoryState = await fetchFactoryStateAccount();
  if (!factoryState) {
    throw new Error("Factory state not found. Ensure factory is initialized on this cluster.");
  }

  const tokenMint = Keypair.generate();
  const [tokenState] = deriveTokenStatePDA(tokenMint.publicKey);
  const [ownerState] = deriveOwnerStatePDA(tokenMint.publicKey);
  const [irpState] = deriveIrpStatePDA(tokenMint.publicKey);
  const [tirState] = deriveTirStatePDA(tokenMint.publicKey);
  const [ctrState] = deriveCtrStatePDA(tokenMint.publicKey);
  const [complianceState] = deriveComplianceStatePDA(tokenMint.publicKey);
  const [extraAccountMetas] = deriveExtraAccountMetasPDA(tokenMint.publicKey);
  const [irsState] = deriveIrsStatePDA(issuer);
  const irsStateInfo = await connection.getAccountInfo(irsState, 'confirmed').catch(() => null);
  const sharedIrs = irsStateInfo ? irsState : null;

  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  const saltBuf = Buffer.from(salt);
  const [deployment] = deriveDeploymentPDA(issuer, saltBuf);
  const [factoryStatePda] = deriveFactoryStatePDA();
  const [offeringTerms] = PublicKey.findProgramAddressSync(
    [Buffer.from('offering_terms'), tokenMint.publicKey.toBuffer()],
    PROGRAM_IDS.factory,
  );

  const trustedIssuers: Array<{ issuerFid: PublicKey; topics: number[]; label: string }> = [];
  const issuerWallets = params.claimDetails?.issuers || [];
  for (let idx = 0; idx < issuerWallets.length; idx += 1) {
    const wallet = toPublicKeyOrNull(issuerWallets[idx]);
    if (!wallet) continue;
    const [fid] = deriveFidPDA(wallet);
    const fidInfo = await connection.getAccountInfo(fid, "confirmed").catch(() => null);
    const isIssuerFid = !!fidInfo && fidInfo.data.length > 108 && fidInfo.data.readUInt8(108) === 1;
    if (!isIssuerFid) continue;
    const topics = params.claimDetails?.issuer_claims?.[idx]?.length
      ? params.claimDetails.issuer_claims[idx]
      : claimTopics;
    trustedIssuers.push({
      issuerFid: fid,
      topics,
      label: `issuer-${wallet.toBase58().slice(0, 8)}`,
    });
  }

  const moduleList = (process.env.NEXT_PUBLIC_FRACKS_COMPLIANCE_MODULES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => toPublicKeyOrNull(v))
    .filter((v): v is PublicKey => !!v);

  const mintLen = getMintLen([ExtensionType.TransferHook, ExtensionType.PermanentDelegate]);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen, 'confirmed');
  const tx1 = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: issuer,
      newAccountPubkey: tokenMint.publicKey,
      lamports: mintRent,
      space: mintLen,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferHookInstruction(
      tokenMint.publicKey,
      issuer,
      PROGRAM_IDS.tokenHook,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializePermanentDelegateInstruction(
      tokenMint.publicKey,
      tokenState,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMint2Instruction(
      tokenMint.publicKey,
      decimals,
      tokenState,
      null,
      TOKEN_2022_PROGRAM_ID,
    ),
  );
  tx1.feePayer = issuer;
  const latest1 = await connection.getLatestBlockhash("confirmed");
  tx1.recentBlockhash = latest1.blockhash;
  tx1.partialSign(tokenMint);
  const signed1 = await this.wallet!.signTransaction(tx1);
  const mintTx = await connection.sendRawTransaction(signed1.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction({ signature: mintTx, ...latest1 }, "confirmed");

  const issuerEntryMetas = trustedIssuers.map((entry) => {
    const [issuerEntry] = deriveIssuerEntryPDA(tirState, entry.issuerFid);
    return { pubkey: issuerEntry, isSigner: false, isWritable: true as const };
  });
  const moduleMetas = moduleList.map((modulePk) => ({
    pubkey: modulePk,
    isSigner: false,
    isWritable: false as const,
  }));

  const deployArgs = {
    issuer,
    tokenMint: tokenMint.publicKey,
    tokenName: params.tokenName,
    tokenSymbol: params.tokenSymbol,
    decimals,
    isin: params.referenceId,
    claimTopics,
    trustedIssuers,
    complianceModules: moduleList,
    sharedIrs,
    pricePerToken: BigInt(Math.max(0, Math.round(Number(params.underlyingValue || 0) * 10 ** decimals))),
    priceDecimals: decimals,
    paymentMint: null,
    salt: saltBuf,
  };

  const deployKeys: AccountMeta[] = [
    { pubkey: issuer, isSigner: true, isWritable: true },
    { pubkey: factoryStatePda, isSigner: false, isWritable: true },
    { pubkey: issuer, isSigner: false, isWritable: false },
    { pubkey: deployment, isSigner: false, isWritable: true },
    { pubkey: offeringTerms, isSigner: false, isWritable: true },
    { pubkey: tokenState, isSigner: false, isWritable: true },
    { pubkey: ownerState, isSigner: false, isWritable: true },
    { pubkey: irsState, isSigner: false, isWritable: true },
    { pubkey: tirState, isSigner: false, isWritable: true },
    { pubkey: ctrState, isSigner: false, isWritable: true },
    { pubkey: irpState, isSigner: false, isWritable: true },
    { pubkey: complianceState, isSigner: false, isWritable: true },
    { pubkey: tokenMint.publicKey, isSigner: false, isWritable: false },
    { pubkey: extraAccountMetas, isSigner: false, isWritable: true },
    { pubkey: PROGRAM_IDS.token, isSigner: false, isWritable: false },
    { pubkey: PROGRAM_IDS.tokenHook, isSigner: false, isWritable: false },
    { pubkey: PROGRAM_IDS.irp, isSigner: false, isWritable: false },
    { pubkey: PROGRAM_IDS.irs, isSigner: false, isWritable: false },
    { pubkey: PROGRAM_IDS.tir, isSigner: false, isWritable: false },
    { pubkey: PROGRAM_IDS.ctr, isSigner: false, isWritable: false },
    { pubkey: PROGRAM_IDS.compliance, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ...issuerEntryMetas,
    ...moduleMetas,
  ];

  const sendDeploy = async (keys: AccountMeta[]) => {
    const deployIx = buildDeployTokenSuiteInstruction(keys, deployArgs);
    const tx2 = new Transaction().add(deployIx);
    tx2.feePayer = issuer;
    const latest2 = await connection.getLatestBlockhash("confirmed");
    tx2.recentBlockhash = latest2.blockhash;
    const signed2 = await this.wallet!.signTransaction(tx2);
    const deployTx = await connection.sendRawTransaction(signed2.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction({ signature: deployTx, ...latest2 }, "confirmed");
    return deployTx;
  };

  const deployTx = await sendDeploy(deployKeys);

  const deploymentState = await fetchDeploymentAccount(issuer, saltBuf);
  const assetId = deploymentState ? Number(deploymentState.deploymentId) : Number(factoryState.deploymentCount);

  return {
    assetId,
    tokenContract: tokenMint.publicKey.toBase58(),
    txHash: deployTx,
  };
}

  async getTokenInfoForContract(tokenContract: string): Promise<TokenInfo> {
    return this.getTokenInfo(tokenContract);
  }

  async getBalanceForToken(tokenContract: string, address: string): Promise<string> {
    return this.getBalance(address, tokenContract);
  }

  async transferFromToken(tokenContract: string, recipient: string, amount: string): Promise<string> {
    this.ensureSigner();
    const mint = this.resolveTokenMint(tokenContract);
    const from = this.wallet!.publicKey;
    const to = toPublicKeyOrNull(recipient);
    if (!mint || !to) throw new Error('Invalid token mint or recipient');

    const fromAta = getAssociatedTokenAddressSync(mint, from, false, TOKEN_2022_PROGRAM_ID);
    const toAta = getAssociatedTokenAddressSync(mint, to, false, TOKEN_2022_PROGRAM_ID);

    const ixData = Buffer.from([3, ...encodeU64(BigInt(amount)), 0]); // Token-2022 TransferChecked discriminator variant is not compatible here.
    const ix = new TransactionInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      keys: [
        { pubkey: fromAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: toAta, isSigner: false, isWritable: true },
        { pubkey: from, isSigner: true, isWritable: false },
      ],
      data: ixData,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = this.wallet!.publicKey;
    const latest = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = latest.blockhash;
    const signed = await this.wallet!.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      preflightCommitment: 'confirmed',
      skipPreflight: false,
    });
    await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
    return sig;
  }

  async getChainInfo() {
    const config = getZigChainConfig();
    return {
      chainId: config.chainId,
      rpcEndpoint: config.rpcEndpoint,
      prefix: 'solana',
      tokenSymbol: 'SOL',
    };
  }
}
