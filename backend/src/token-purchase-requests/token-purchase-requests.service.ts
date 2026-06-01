import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTokenPurchaseRequestDto } from './dto/create-token-purchase-request.dto';
import { UpdateTokenPurchaseRequestDto } from './dto/update-token-purchase-request.dto';
import { BlockchainTransactionsService } from '../blockchain-transactions/blockchain-transactions.service';
import { getIndexerConfig } from '../indexer/indexer.config';

const CLOSED_STATUSES = ['REJECTED', 'CANCELLED', 'MINTED'];
const ACTIVE_STATUSES = [
  'SUBMITTED',
  'PENDING_KYC',
  'PENDING_AML',
  'PENDING_ISSUER_REVIEW',
  'APPROVED_FOR_MINT',
  'ACTION_REQUIRED_INVESTOR_IDENTITY',
];
const VALID_STATUSES = new Set([
  'SUBMITTED',
  'PENDING_KYC',
  'PENDING_AML',
  'PENDING_ISSUER_REVIEW',
  'APPROVED_FOR_MINT',
  'ACTION_REQUIRED_INVESTOR_IDENTITY',
  'REJECTED',
  'CANCELLED',
  'MINTED',
]);

type MetadataRecord = Record<string, unknown>;

function asRecord(value: unknown): MetadataRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as MetadataRecord)
    : {};
}

function decimalsFromMetadata(metadata: MetadataRecord) {
  const decimals = Number(metadata.decimals);
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? decimals : 6;
}

function decimalToBaseUnits(value: unknown, decimals: number): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;

  const [whole, fraction = ''] = raw.split('.');
  const paddedFraction = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(paddedFraction || '0');
}

function baseUnitsToDecimal(value: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

function minBigInt(values: Array<bigint | null>) {
  const concrete = values.filter((value): value is bigint => value !== null);
  if (concrete.length === 0) return null;
  return concrete.reduce((min, value) => (value < min ? value : min));
}

function parsePositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseCountryList(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(parseCountryList);
  if (typeof value === 'number' && Number.isFinite(value)) return [Math.trunc(value)];
  if (typeof value !== 'string') return [];

  return value
    .split(/[,\s]+/)
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Math.trunc(entry));
}

function parseCountryCaps(value: unknown): Array<{ country: number; cap: number }> {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const record = asRecord(entry);
        const country = Number(record.country);
        const cap = Number(record.cap);
        if (!Number.isFinite(country) || !Number.isFinite(cap)) return null;
        return { country: Math.trunc(country), cap: Math.trunc(cap) };
      })
      .filter(Boolean) as Array<{ country: number; cap: number }>;
  }

  if (typeof value !== 'string') return [];

  return value
    .split(/[,\s]+/)
    .map((entry) => {
      const [countryRaw, capRaw] = entry.split(':').map((part) => part.trim());
      const country = Number(countryRaw);
      const cap = Number(capRaw);
      if (!Number.isFinite(country) || !Number.isFinite(cap)) return null;
      return { country: Math.trunc(country), cap: Math.trunc(cap) };
    })
    .filter(Boolean) as Array<{ country: number; cap: number }>;
}

@Injectable()
export class TokenPurchaseRequestsService {
  private readonly connection = new Connection(getIndexerConfig().rpcEndpoint, 'confirmed');
  private readonly maxInvestorsProgram = new PublicKey(
    process.env.MOD_MAX_INVESTORS || '2zfQv7RxmL5BAgXXFagZXBNby4Q41YGH6hnSJAcsXQeU',
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainTransactions: BlockchainTransactionsService,
  ) {}

  private getInitialStatus(data: CreateTokenPurchaseRequestDto) {
    if (data.investorFidRegistered === false) {
      return 'ACTION_REQUIRED_INVESTOR_IDENTITY';
    }

    const topics = new Set((data.requiredClaimTopics || []).map(String));
    if (topics.has('1') && data.kycProvider) return 'PENDING_KYC';
    if (topics.has('2') && data.amlProvider) return 'PENDING_AML';
    return 'PENDING_ISSUER_REVIEW';
  }

  private getResumeStatus(request: Record<string, unknown>) {
    const topics = new Set(
      (Array.isArray(request.requiredClaimTopics)
        ? request.requiredClaimTopics
        : []
      ).map(String),
    );

    if (topics.has('1') && request.kycProvider) return 'PENDING_KYC';
    if (topics.has('2') && request.amlProvider) return 'PENDING_AML';
    return 'PENDING_ISSUER_REVIEW';
  }

  private rowSelect() {
    return Prisma.sql`
      id,
      asset_id as "assetId",
      "tokenContract",
      "investorWallet",
      amount,
      "fullName",
      email,
      nationality,
      country,
      "idDocumentUrl",
      "proofOfAddressUrl",
      "kycProvider",
      "amlProvider",
      "issuerWallet",
      required_claim_topics as "requiredClaimTopics",
      documents,
      status,
      "kycApprovedAt",
      "kycApprovedBy",
      "kycClaimTxHash",
      "amlApprovedAt",
      "amlApprovedBy",
      "amlClaimTxHash",
      "issuerApprovedAt",
      "issuerApprovedBy",
      "whitelistTxHash",
      "whitelistedAt",
      "activationTxHash",
      "activatedAt",
      "mintTxHash",
      "mintedAt",
      "rejectionReason",
      "rejectedAt",
      "rejectedBy",
      "createdAt",
      "updatedAt"
    `;
  }

  private getComplianceParamSets(metadata: MetadataRecord) {
    const paramsByModule = asRecord(metadata.complianceModuleParams);
    return Object.values(paramsByModule)
      .map(asRecord)
      .filter((params) => Object.keys(params).length > 0);
  }

  private getParamValue(paramSets: MetadataRecord[], key: string) {
    for (const params of paramSets) {
      if (Object.prototype.hasOwnProperty.call(params, key)) return params[key];
    }
    return undefined;
  }

  private async getWalletBalanceBaseUnits(tokenContract: string, walletAddress: string) {
    const balance = await this.prisma.tokenBalance.findUnique({
      where: {
        tokenContract_walletAddress: {
          tokenContract,
          walletAddress,
        },
      },
    });

    try {
      return balance?.balance ? BigInt(balance.balance) : 0n;
    } catch {
      return 0n;
    }
  }

  private async getLiveWalletBalanceBaseUnits(tokenContract: string, walletAddress: string) {
    const mint = new PublicKey(tokenContract);
    const wallet = new PublicKey(walletAddress);
    const ata = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID);
    const account = await this.connection.getAccountInfo(ata, 'confirmed');
    if (!account) return 0n;
    if (!account.owner.equals(TOKEN_2022_PROGRAM_ID) || account.data.length < 72) {
      throw new Error(`Token account ${ata.toBase58()} is malformed.`);
    }
    return account.data.readBigUInt64LE(64);
  }

  private async getLiveMaxInvestorsState(tokenContract: string) {
    const mint = new PublicKey(tokenContract);
    const [moduleState] = PublicKey.findProgramAddressSync(
      [Buffer.from('mod_max_investors'), mint.toBuffer()],
      this.maxInvestorsProgram,
    );
    const account = await this.connection.getAccountInfo(moduleState, 'confirmed');
    if (!account) {
      throw new Error(`Max Investors module account ${moduleState.toBase58()} is missing.`);
    }
    if (!account.owner.equals(this.maxInvestorsProgram) || account.data.length < 120) {
      throw new Error(`Max Investors module account ${moduleState.toBase58()} is malformed.`);
    }
    return {
      maxInvestors: account.data.readBigUInt64LE(104),
      holderCount: account.data.readBigUInt64LE(112),
    };
  }

  private async getActiveRequests(tokenContract: string) {
    return this.prisma.$queryRaw<Array<{ investorWallet: string; amount: number | null; country: string | null }>>`
      SELECT "investorWallet", amount, country
      FROM "TokenPurchaseRequest"
      WHERE "tokenContract" = ${tokenContract}
        AND status IN (${Prisma.join(ACTIVE_STATUSES)})
    `;
  }

  private async getCountryRequestWallets(tokenContract: string, country: number) {
    const rows = await this.prisma.$queryRaw<Array<{ investorWallet: string }>>`
      SELECT DISTINCT "investorWallet"
      FROM "TokenPurchaseRequest"
      WHERE "tokenContract" = ${tokenContract}
        AND country = ${String(country)}
        AND status IN (${Prisma.join([...ACTIVE_STATUSES, 'MINTED'])})
    `;

    return rows.map((row) => row.investorWallet.toLowerCase());
  }

  private async getActiveRequestForInvestor(tokenContract: string, investorWallet: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "TokenPurchaseRequest"
      WHERE "tokenContract" = ${tokenContract}
        AND "investorWallet" = ${investorWallet}
        AND status NOT IN (${Prisma.join(CLOSED_STATUSES)})
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  private async calculateCompliance(data: {
    tokenContract: string;
    investorWallet: string;
    country?: string | number | null;
    amount?: string | number | null;
  }) {
    const asset = await this.prisma.asset.findUnique({
      where: { tokenContract: data.tokenContract },
      select: { metadata: true },
    });

    const metadata = asRecord(asset?.metadata);
    const paramSets = this.getComplianceParamSets(metadata);
    const decimals = decimalsFromMetadata(metadata);
    const amountBaseUnits =
      data.amount === undefined || data.amount === null || data.amount === ''
        ? null
        : decimalToBaseUnits(data.amount, decimals);
    const investorCountry =
      data.country === undefined || data.country === null || data.country === ''
        ? null
        : Number(data.country);

    const blockingReasons: string[] = [];
    let amountError: string | null = null;
    let countryAllowed = true;
    let investorCapReached = false;
    let countryCapReached = false;
    let supplyCapReached = false;
    let duplicateActiveRequest = false;

    const duplicate = await this.getActiveRequestForInvestor(
      data.tokenContract,
      data.investorWallet,
    );
    if (duplicate) {
      duplicateActiveRequest = true;
      blockingReasons.push('An open purchase request already exists for this investor and token.');
    }

    const allowedCountries = parseCountryList(this.getParamValue(paramSets, 'allowed_countries'));
    if (allowedCountries.length > 0) {
      if (!Number.isFinite(investorCountry)) {
        countryAllowed = false;
        blockingReasons.push('Investor country is required for this token.');
      } else if (!allowedCountries.includes(Math.trunc(investorCountry as number))) {
        countryAllowed = false;
        blockingReasons.push(`Investor country ${investorCountry} is not allowed by this token.`);
      }
    }

    if (amountBaseUnits !== null && amountBaseUnits <= 0n) {
      amountError = 'Enter a positive token amount.';
    }

    const indexedCurrentBalance = await this.getWalletBalanceBaseUnits(
      data.tokenContract,
      data.investorWallet,
    );
    let currentBalance = indexedCurrentBalance;
    const activeRequests = await this.getActiveRequests(data.tokenContract);
    const configuredMaxInvestors = Number(this.getParamValue(paramSets, 'max_investors'));
    let liveHolderCount: bigint | null = null;
    let liveMaxInvestors: bigint | null = null;
    if (Number.isFinite(configuredMaxInvestors) && configuredMaxInvestors > 0) {
      try {
        currentBalance = await this.getLiveWalletBalanceBaseUnits(
          data.tokenContract,
          data.investorWallet,
        );
        const liveState = await this.getLiveMaxInvestorsState(data.tokenContract);
        liveHolderCount = liveState.holderCount;
        liveMaxInvestors = liveState.maxInvestors;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        blockingReasons.push(
          `Unable to verify the live Max Investors compliance module: ${message}`,
        );
      }
    }

    const maxAmount = decimalToBaseUnits(this.getParamValue(paramSets, 'max_amount'), decimals);
    if (maxAmount !== null && amountBaseUnits !== null && amountBaseUnits > maxAmount) {
      amountError = `Requested amount exceeds this token's maximum mint/transfer amount of ${baseUnitsToDecimal(maxAmount, decimals)} tokens.`;
    }

    const maxBalance = decimalToBaseUnits(this.getParamValue(paramSets, 'max_balance'), decimals);
    const maxBalanceRemaining =
      maxBalance === null ? null : maxBalance > currentBalance ? maxBalance - currentBalance : 0n;
    if (
      maxBalanceRemaining !== null &&
      amountBaseUnits !== null &&
      amountBaseUnits > maxBalanceRemaining
    ) {
      amountError = `Requested amount would exceed this token's maximum wallet balance. You can request up to ${baseUnitsToDecimal(maxBalanceRemaining, decimals)} tokens.`;
    }

    const lockupEnd = this.getParamValue(paramSets, 'lockup_end');
    if (lockupEnd !== undefined) {
      const lockupEndSeconds = Number(lockupEnd);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (Number.isFinite(lockupEndSeconds) && nowSeconds < lockupEndSeconds) {
        blockingReasons.push(`This token is locked until Unix time ${Math.trunc(lockupEndSeconds)}.`);
      }
    }

    const holders = await this.prisma.tokenBalance.findMany({
      where: {
        tokenContract: data.tokenContract,
        balance: { not: '0' },
      },
      select: { walletAddress: true },
    });
    const holderWallets = new Set(holders.map((holder) => holder.walletAddress.toLowerCase()));

    if (liveHolderCount !== null && liveMaxInvestors !== null && currentBalance === 0n) {
      const activeNewInvestors = new Set(
        activeRequests
          .map((request) => request.investorWallet)
          .filter(
            (wallet) =>
              wallet.toLowerCase() !== data.investorWallet.toLowerCase() &&
              !holderWallets.has(wallet.toLowerCase()),
          )
          .map((wallet) => wallet.toLowerCase()),
      );
      if (liveHolderCount + BigInt(activeNewInvestors.size) >= liveMaxInvestors) {
        investorCapReached = true;
        blockingReasons.push(
          `This token has reached its maximum investor count of ${liveMaxInvestors.toString()}.`,
        );
      }
    }

    const countryCaps = parseCountryCaps(this.getParamValue(paramSets, 'country_caps'));
    if (countryCaps.length > 0 && currentBalance === 0n && Number.isFinite(investorCountry)) {
      const country = Math.trunc(investorCountry as number);
      const cap = countryCaps.find((entry) => entry.country === country);
      if (cap) {
        const reservedWallets = new Set(
          await this.getCountryRequestWallets(data.tokenContract, country),
        );
        if (!reservedWallets.has(data.investorWallet.toLowerCase())) {
          reservedWallets.add(data.investorWallet.toLowerCase());
        }
        if (reservedWallets.size > cap.cap) {
          countryCapReached = true;
          blockingReasons.push(`This token has reached its investor cap for country ${country}.`);
        }
      }
    }

    const maxSupply = decimalToBaseUnits(this.getParamValue(paramSets, 'max_supply'), decimals);
    const tokenState = await this.prisma.tokenState.findUnique({
      where: { tokenContract: data.tokenContract },
      select: { totalSupply: true },
    });
    const currentSupply = tokenState?.totalSupply ? BigInt(tokenState.totalSupply) : 0n;
    const reservedSupply = activeRequests.reduce((sum, request) => {
      const value = decimalToBaseUnits(request.amount ?? 0, decimals);
      return value === null ? sum : sum + value;
    }, 0n);
    const supplyRemaining =
      maxSupply === null
        ? null
        : maxSupply > currentSupply + reservedSupply
          ? maxSupply - currentSupply - reservedSupply
          : 0n;
    if (supplyRemaining !== null && supplyRemaining <= 0n) {
      supplyCapReached = true;
      blockingReasons.push('This token has reached its supply cap.');
    }
    if (supplyRemaining !== null && amountBaseUnits !== null && amountBaseUnits > supplyRemaining) {
      amountError = `Only ${baseUnitsToDecimal(supplyRemaining, decimals)} tokens remain available for request.`;
    }

    const maxRequestableBaseUnits = minBigInt([
      supplyRemaining,
      maxAmount,
      maxBalanceRemaining,
    ]);

    return {
      ok: blockingReasons.length === 0 && !amountError,
      canOpenForm: countryAllowed && !investorCapReached && !countryCapReached && !supplyCapReached,
      amountOk: amountBaseUnits !== null && amountBaseUnits > 0n && !amountError,
      amountError,
      blockingReasons,
      countryAllowed,
      investorCapReached,
      countryCapReached,
      supplyCapReached,
      duplicateActiveRequest,
      decimals,
      currentSupply: baseUnitsToDecimal(currentSupply, decimals),
      reservedSupply: baseUnitsToDecimal(reservedSupply, decimals),
      supplyRemaining:
        supplyRemaining === null ? null : baseUnitsToDecimal(supplyRemaining, decimals),
      maxRequestableTokens:
        maxRequestableBaseUnits === null
          ? null
          : baseUnitsToDecimal(maxRequestableBaseUnits, decimals),
    };
  }

  async preflight(data: {
    tokenContract: string;
    investorWallet: string;
    country?: string | number | null;
    amount?: string | number | null;
  }) {
    if (!data.tokenContract || !data.investorWallet) {
      throw new BadRequestException('tokenContract and investorWallet are required.');
    }
    return this.calculateCompliance(data);
  }

  private async validateCompliance(data: CreateTokenPurchaseRequestDto) {
    const result = await this.calculateCompliance({
      tokenContract: data.tokenContract,
      investorWallet: data.investorWallet,
      country: data.country,
      amount: data.amount,
    });

    if (result.blockingReasons.length > 0 || result.amountError) {
      throw new BadRequestException(result.amountError || result.blockingReasons[0]);
    }
  }

  async create(data: CreateTokenPurchaseRequestDto) {
    await this.validateCompliance(data);

    const duplicate = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "TokenPurchaseRequest"
      WHERE "tokenContract" = ${data.tokenContract}
        AND "investorWallet" = ${data.investorWallet}
        AND status NOT IN (${Prisma.join(CLOSED_STATUSES)})
      LIMIT 1
    `;

    if (duplicate.length > 0) {
      throw new ConflictException(
        'An open purchase request already exists for this investor and token.',
      );
    }

    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      INSERT INTO "TokenPurchaseRequest" (
        id,
        asset_id,
        "tokenContract",
        "investorWallet",
        "issuerWallet",
        "kycProvider",
        "amlProvider",
        amount,
        "fullName",
        email,
        nationality,
        country,
        "idDocumentUrl",
        "proofOfAddressUrl",
        required_claim_topics,
        documents,
        status,
        "updatedAt"
      )
      VALUES (
        ${id},
        ${data.assetId || null},
        ${data.tokenContract},
        ${data.investorWallet},
        ${data.issuerWallet},
        ${data.kycProvider || null},
        ${data.amlProvider || null},
        ${data.amount},
        ${data.fullName || null},
        ${data.email || null},
        ${data.nationality || null},
        ${data.country || null},
        ${data.idDocumentUrl || null},
        ${data.proofOfAddressUrl || null},
        ${data.requiredClaimTopics || []},
        ${data.documents ? JSON.stringify(data.documents) : null}::jsonb,
        ${this.getInitialStatus(data)},
        NOW()
      )
      RETURNING ${this.rowSelect()}
    `;

    return rows[0];
  }

  async findAll(query: {
    investorWallet?: string;
    kycProvider?: string;
    amlProvider?: string;
    issuerWallet?: string;
    status?: string;
    tokenContract?: string;
  }) {
    const filters: Prisma.Sql[] = [];
    if (query.investorWallet) filters.push(Prisma.sql`"investorWallet" = ${query.investorWallet}`);
    if (query.kycProvider) filters.push(Prisma.sql`"kycProvider" = ${query.kycProvider}`);
    if (query.amlProvider) filters.push(Prisma.sql`"amlProvider" = ${query.amlProvider}`);
    if (query.issuerWallet) filters.push(Prisma.sql`"issuerWallet" = ${query.issuerWallet}`);
    if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
    if (query.tokenContract) filters.push(Prisma.sql`"tokenContract" = ${query.tokenContract}`);

    const where =
      filters.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
        : Prisma.empty;

    return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${this.rowSelect()}
      FROM "TokenPurchaseRequest"
      ${where}
      ORDER BY "createdAt" DESC
    `;
  }

  async findOne(id: string) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${this.rowSelect()}
      FROM "TokenPurchaseRequest"
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException('Token purchase request not found');
    return rows[0];
  }

  async update(id: string, data: UpdateTokenPurchaseRequestDto) {
    const status = data.status;
    if (status) return this.updateStatus(id, data);
    await this.findOne(id);
    return this.findOne(id);
  }

  async updateStatus(id: string, data: UpdateTokenPurchaseRequestDto) {
    const existing = await this.findOne(id);
    const currentStatus = String(existing.status);
    const status = data.status;
    if (!status || !VALID_STATUSES.has(status)) {
      throw new ConflictException('Invalid token purchase request status.');
    }

    const now = new Date();
    const updateFragments: Prisma.Sql[] = [
      Prisma.sql`status = ${status}`,
      Prisma.sql`"updatedAt" = NOW()`,
    ];

    if (status === 'PENDING_AML') {
      updateFragments.push(Prisma.sql`"kycApprovedAt" = ${now}`);
      updateFragments.push(Prisma.sql`"kycApprovedBy" = ${data.reviewerWallet || null}`);
      updateFragments.push(Prisma.sql`"kycClaimTxHash" = ${data.claimTxHash || null}`);
    }

    if (status === 'PENDING_ISSUER_REVIEW') {
      if (currentStatus === 'PENDING_KYC') {
        updateFragments.push(Prisma.sql`"kycApprovedAt" = ${now}`);
        updateFragments.push(Prisma.sql`"kycApprovedBy" = ${data.reviewerWallet || null}`);
        updateFragments.push(Prisma.sql`"kycClaimTxHash" = ${data.claimTxHash || null}`);
      }
      if (currentStatus === 'PENDING_AML') {
        updateFragments.push(Prisma.sql`"amlApprovedAt" = ${now}`);
        updateFragments.push(Prisma.sql`"amlApprovedBy" = ${data.reviewerWallet || null}`);
        updateFragments.push(Prisma.sql`"amlClaimTxHash" = ${data.claimTxHash || null}`);
      }
    }

    if (status === 'APPROVED_FOR_MINT') {
      updateFragments.push(Prisma.sql`"issuerApprovedAt" = ${now}`);
      updateFragments.push(Prisma.sql`"issuerApprovedBy" = ${data.reviewerWallet || null}`);
    }

    if (data.whitelistTxHash) {
      updateFragments.push(Prisma.sql`"whitelistTxHash" = ${data.whitelistTxHash}`);
      updateFragments.push(Prisma.sql`"whitelistedAt" = ${now}`);
    }

    if (data.activationTxHash) {
      updateFragments.push(Prisma.sql`"activationTxHash" = ${data.activationTxHash}`);
      updateFragments.push(Prisma.sql`"activatedAt" = ${now}`);
    }

    if (status === 'MINTED') {
      updateFragments.push(Prisma.sql`"mintedAt" = ${now}`);
      updateFragments.push(Prisma.sql`"mintTxHash" = ${data.mintTxHash || null}`);
      updateFragments.push(Prisma.sql`"issuerApprovedBy" = ${data.reviewerWallet || null}`);
    }

    if (status === 'REJECTED') {
      updateFragments.push(Prisma.sql`"rejectedAt" = ${now}`);
      updateFragments.push(Prisma.sql`"rejectedBy" = ${data.reviewerWallet || null}`);
      updateFragments.push(Prisma.sql`"rejectionReason" = ${data.rejectionReason || 'Rejected'}`);
    }

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      UPDATE "TokenPurchaseRequest"
      SET ${Prisma.join(updateFragments)}
      WHERE id = ${id}
      RETURNING ${this.rowSelect()}
    `;

    const ledgerBase = {
      actorWallet: data.reviewerWallet || null,
      entityType: 'token_purchase_request',
      entityId: id,
      assetId: String(existing.assetId || '') || undefined,
      tokenContract: String(existing.tokenContract),
    };
    const ledgerEntries = [
      data.claimTxHash && currentStatus === 'PENDING_KYC'
        ? { ...ledgerBase, txHash: data.claimTxHash, actionType: 'PURCHASE_KYC_CLAIM' }
        : null,
      data.claimTxHash && currentStatus === 'PENDING_AML'
        ? { ...ledgerBase, txHash: data.claimTxHash, actionType: 'PURCHASE_AML_CLAIM' }
        : null,
      data.whitelistTxHash
        ? { ...ledgerBase, txHash: data.whitelistTxHash, actionType: 'INVESTOR_WHITELISTED' }
        : null,
      data.activationTxHash
        ? { ...ledgerBase, txHash: data.activationTxHash, actionType: 'IDENTITY_ACTIVATED' }
        : null,
      data.mintTxHash
        ? { ...ledgerBase, txHash: data.mintTxHash, actionType: 'TOKENS_MINTED' }
        : null,
    ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    await Promise.all(ledgerEntries.map((entry) => this.blockchainTransactions.record(entry)));

    return rows[0];
  }

  async resumeAfterIdentity(id: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'ACTION_REQUIRED_INVESTOR_IDENTITY') {
      return existing;
    }

    const nextStatus = this.getResumeStatus(existing);
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      UPDATE "TokenPurchaseRequest"
      SET status = ${nextStatus}, "updatedAt" = NOW()
      WHERE id = ${id}
      RETURNING ${this.rowSelect()}
    `;

    return rows[0];
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.tokenPurchaseRequest.delete({
      where: { id },
    });
  }
}
