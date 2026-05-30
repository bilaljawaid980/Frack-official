// ─── Transfer Service ─────────────────────────────────────────────────────────
//
// Handles simulating and executing Token-2022 transfers for FRACKS tokens,
// including pre-approval creation required by the transfer hook.
// ─────────────────────────────────────────────────────────────────────────────

import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID as SPL_TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  COMPLIANCE_PROGRAM_ID,
  CTR_PROGRAM_ID,
  FID_PROGRAM_ID,
  IRS_PROGRAM_ID,
  MOD_DAILY_LIMIT,
  MOD_COUNTRY_CAP,
  MOD_COUNTRY_RESTRICT,
  MOD_LOCKUP,
  MOD_MAX_BALANCE,
  MOD_MAX_INVESTORS,
  MOD_MAX_TRANSFER,
  MOD_SUPPLY_CAP,
  TIR_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_HOOK_PROGRAM_ID,
  SEED_EXTRA_ACCOUNT_METAS,
  SEED_TRANSFER_APPROVAL,
  SEED_WALLET_IDENTITY,
} from "@/lib/constants";
import { fetchFactoryStateAccount, type FactoryStateAccount } from "@/lib/solana";
import { formatTransactionError, decodeTransferHookError } from "@/lib/errors";
import type { SimulationResult, TransferResult } from "@/types";
import TokenIdl from "@/idl/fracks_token.json";
import FidIdl from "@/idl/fracks_fid.json";
import ComplianceIdl from "@/idl/fracks_compliance.json";
import CtrIdl from "@/idl/fracks_ctr.json";
import ModDailyLimitIdl from "@/idl/mod_daily_limit.json";

type RemainingAccount = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };
type TransferInstructions = {
  approveIx: TransactionInstruction;
  transferIx: TransactionInstruction;
};
type TransferProgramIds = {
  token: PublicKey;
  fid: PublicKey;
  irs: PublicKey;
  tir: PublicKey;
  ctr: PublicKey;
  compliance: PublicKey;
};
type WalletTransferEligibility = {
  wallet: string;
  walletIdentity: string;
  identityExists: boolean;
  identityActive: boolean;
  fid?: string;
  country?: number;
  blockers: string[];
};
type ClaimCheckResult = { ok: true } | { ok: false; reason: string };
export type TransferPreflightResult = {
  ok: boolean;
  status: string;
  blockers: string[];
  sender: WalletTransferEligibility;
  recipient: WalletTransferEligibility;
  requiredClaimTopics: string[];
  sourceAta: string;
  destinationAta: string;
  destinationAtaExists: boolean;
  sourceBalance: string;
  transferableBalance: string;
  simulation?: SimulationResult;
};
export type SellerListingCapacity = {
  ok: boolean;
  sourceAta: string;
  sourceBalance: string;
  transferableBalance: string;
  requestedAmount: string;
  blockers: string[];
};
export type TransferBuildSimulationResult = SimulationResult & {
  destinationAta: string;
  destinationAtaExists: boolean;
  destinationAtaCreatedInSimulation: boolean;
  instructionCount: number;
  transactionSize: number | null;
  approvalOnlySimulation: boolean;
};

const CLAIM_ACCOUNT_DISCRIMINATOR = Buffer.from([113, 109, 47, 96, 242, 219, 61, 165]);
const RECIPIENT_ATA_NOTICE =
  "Recipient Token-2022 account does not exist yet. Send Transfer will create it first, then run the compliant transfer.";
const OVERSIZED_SIMULATION_NOTICE =
  "Transfer needs address lookup table compression because of compliance accounts. Simulation packet is too large, but Send Transfer will create the lookup table and submit the compliant transfer.";
const MODULE_PROGRAM_IDS = new Set([
  MOD_MAX_INVESTORS.toBase58(),
  MOD_COUNTRY_RESTRICT.toBase58(),
  MOD_MAX_BALANCE.toBase58(),
  MOD_MAX_TRANSFER.toBase58(),
  MOD_LOCKUP.toBase58(),
  MOD_DAILY_LIMIT.toBase58(),
  MOD_SUPPLY_CAP.toBase58(),
  MOD_COUNTRY_CAP.toBase58(),
]);

function parseCtrTopics(data: Buffer): bigint[] {
  if (data.length < 8 + 32 + 32 + 4) return [];
  let offset = 8 + 32 + 32;
  const topicCount = data.readUInt32LE(offset);
  offset += 4;
  const topics: bigint[] = [];
  for (let index = 0; index < topicCount; index += 1) {
    if (data.length < offset + 8) break;
    topics.push(data.readBigUInt64LE(offset));
    offset += 8;
  }
  return topics;
}

function parseIssuerEntryForTopic(data: Buffer, topic: bigint): boolean {
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return false;
  const topicCount = data.readUInt32LE(offset);
  offset += 4;
  let hasTopic = false;
  for (let index = 0; index < topicCount; index += 1) {
    if (data.length < offset + 8) return false;
    if (data.readBigUInt64LE(offset) === topic) hasTopic = true;
    offset += 8;
  }
  if (data.length < offset + 1) return false;
  return data.readUInt8(offset) === 1 && hasTopic;
}

function parseClaimAccount(data: Buffer): {
  topic: bigint;
  issuerFid: PublicKey;
  signerKey: PublicKey;
  revoked: boolean;
  expiresAt: bigint;
} | null {
  if (data.length < CLAIM_ACCOUNT_SIZE || !data.subarray(0, 8).equals(CLAIM_ACCOUNT_DISCRIMINATOR)) {
    return null;
  }
  let offset = 8 + 32 + 4;
  const topic = data.readBigUInt64LE(offset);
  offset += 8;
  const issuerFid = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32 + 32;
  const signerKey = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32 + 64 + 8;
  const expiresAt = data.readBigInt64LE(offset);
  offset += 8;
  const revoked = data.readUInt8(offset) === 1;
  return { topic, issuerFid, signerKey, revoked, expiresAt };
}

function parseFidIsIssuerAndSigner(data: Buffer, expectedSigner: PublicKey): boolean {
  if (data.length < 8 + 32 + 32 + 32 + 4 + 1) return false;
  const signerKey = new PublicKey(data.subarray(8 + 32 + 32, 8 + 32 + 32 + 32));
  const isIssuer = data.readUInt8(8 + 32 + 32 + 32 + 4) === 1;
  return isIssuer && signerKey.equals(expectedSigner);
}

function parseWalletIdentity(data: Buffer): { fid: PublicKey; country: number; isActive: boolean } | null {
  if (data.length < 8 + 32 + 32 + 2 + 32 + 1) return null;
  const fid = new PublicKey(data.subarray(8 + 32, 8 + 64));
  const country = data.readUInt16LE(8 + 64);
  const isActive = data.readUInt8(8 + 64 + 2 + 32) === 1;
  return { fid, country, isActive };
}

const CLAIM_ACCOUNT_SIZE = 230;

// ─── TransferService ──────────────────────────────────────────────────────────

export class TransferService {
  private connection: Connection;
  private provider: AnchorProvider;
  private tokenProgram: Program<Idl>;
  private factoryStatePromise: Promise<FactoryStateAccount | null> | null = null;

  constructor(connection: Connection, provider: AnchorProvider) {
    this.connection = connection;
    this.provider = provider;
    this.tokenProgram = new Program(TokenIdl as unknown as Idl, provider);
  }

  private async getFactoryState(): Promise<FactoryStateAccount | null> {
    if (!this.factoryStatePromise) {
      this.factoryStatePromise = fetchFactoryStateAccount().catch(() => null);
    }
    return this.factoryStatePromise;
  }

  private async getProgramIds(): Promise<TransferProgramIds> {
    const state = await this.getFactoryState();
    return {
      token: state?.tokenProgramId ?? TOKEN_PROGRAM_ID,
      fid: state?.fidProgramId ?? FID_PROGRAM_ID,
      irs: state?.irsProgramId ?? IRS_PROGRAM_ID,
      tir: state?.tirProgramId ?? TIR_PROGRAM_ID,
      ctr: state?.ctrProgramId ?? CTR_PROGRAM_ID,
      compliance: state?.complianceProgramId ?? COMPLIANCE_PROGRAM_ID,
    };
  }

  private getTokenProgram(programId: PublicKey): Program<Idl> {
    return new Program(
      {
        ...(TokenIdl as unknown as Record<string, unknown>),
        address: programId.toBase58(),
      } as Idl,
      this.provider,
    );
  }

  // ── PDA Helpers ───────────────────────────────────────────────────────────────

  private getExtraAccountMetasPda(
    mint: PublicKey,
    hookProgramId: PublicKey = TOKEN_HOOK_PROGRAM_ID
  ): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [SEED_EXTRA_ACCOUNT_METAS, mint.toBuffer()],
      hookProgramId
    );
    return pda;
  }

  private getTransferApprovalPda(
    sourceTa: PublicKey,
    destinationTa: PublicKey,
    authority: PublicKey,
    hookProgramId: PublicKey = TOKEN_HOOK_PROGRAM_ID
  ): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        SEED_TRANSFER_APPROVAL,
        sourceTa.toBuffer(),
        destinationTa.toBuffer(),
        authority.toBuffer(),
      ],
      hookProgramId
    );
    return pda;
  }

  private getTokenStatePda(
    mint: PublicKey,
    tokenProgramId: PublicKey = TOKEN_PROGRAM_ID
  ): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_state"), mint.toBuffer()],
      tokenProgramId
    );
    return pda;
  }

  // ── Public Methods ────────────────────────────────────────────────────────────

  /**
   * Simulates a transfer without submitting it to the network.
   * Decodes any simulation errors from transaction logs.
   *
   * @param mint     - Token-2022 mint address
   * @param from     - Sender wallet
   * @param to       - Recipient wallet
   * @param amount   - Amount in base units
   * @param decimals - Token decimals (for createTransferCheckedInstruction)
   */
  async simulateTransfer(
    mint: PublicKey,
    from: PublicKey,
    to: PublicKey,
    amount: bigint,
    decimals: number
  ): Promise<SimulationResult> {
    try {
      return await this.buildAndSimulateTransfer(mint, from, to, amount, decimals);
    } catch (err) {
      return {
        success: false,
        error: formatTransactionError(err),
        logs: [],
      };
    }
  }

  async checkSellerListingCapacity(
    mint: PublicKey,
    seller: PublicKey,
    amount: bigint
  ): Promise<SellerListingCapacity> {
    const ids = await this.getProgramIds();
    const sourceAta = this.getTokenAccountAddress(mint, seller);
    const sourceBalance = await this.getRawTokenBalance(sourceAta).catch(() => 0n);
    const partialFreeze = await this.getPartialFreezeAmount(mint, seller, ids.token);
    const transferableBalance = sourceBalance > partialFreeze ? sourceBalance - partialFreeze : 0n;
    const blockers: string[] = [];
    if (amount <= 0n) blockers.push("Listing amount must be greater than zero.");
    if (sourceBalance < amount) blockers.push("Listing amount exceeds current token balance.");
    if (transferableBalance < amount) {
      blockers.push("Listing amount exceeds transferable balance after partial freeze.");
    }
    return {
      ok: blockers.length === 0,
      sourceAta: sourceAta.toBase58(),
      sourceBalance: sourceBalance.toString(),
      transferableBalance: transferableBalance.toString(),
      requestedAmount: amount.toString(),
      blockers,
    };
  }

  async buildAndSimulateTransfer(
    mint: PublicKey,
    from: PublicKey,
    to: PublicKey,
    amount: bigint,
    decimals: number
  ): Promise<TransferBuildSimulationResult> {
    const ids = await this.getProgramIds();
    const destinationAta = this.getTokenAccountAddress(mint, to);
    const destinationInfo = await this.connection.getAccountInfo(destinationAta, "confirmed");
    if (destinationInfo) this.assertToken2022Account(destinationInfo.owner);

    const setupIxs = destinationInfo
      ? []
      : [this.createRecipientAtaInstruction(mint, from, to)];
    const { approveIx, transferIx } = await this._buildTransferInstructions(
      mint,
      from,
      to,
      amount,
      decimals,
      ids,
      { allowMissingDestinationAta: !destinationInfo }
    );

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const fullInstructions = [...setupIxs, approveIx, transferIx];
    const fullVtx = this.compileVersionedTransaction(from, blockhash, fullInstructions);
    const fullTxSize = this.getSerializedTransactionSize(fullVtx);
    let simulationTarget = fullVtx;
    let approvalOnlySimulation = false;

    if (fullTxSize === null || fullTxSize > 1232) {
      simulationTarget = this.compileVersionedTransaction(from, blockhash, [...setupIxs, approveIx]);
      approvalOnlySimulation = true;
    }

    const simulationTargetSize = this.getSerializedTransactionSize(simulationTarget);
    if (simulationTargetSize === null || simulationTargetSize > 1232) {
      return {
        success: true,
        notice: OVERSIZED_SIMULATION_NOTICE,
        logs: [],
        destinationAta: destinationAta.toBase58(),
        destinationAtaExists: Boolean(destinationInfo),
        destinationAtaCreatedInSimulation: !destinationInfo,
        instructionCount: fullInstructions.length,
        transactionSize: simulationTargetSize,
        approvalOnlySimulation,
      };
    }

    const simulation = await this.connection.simulateTransaction(simulationTarget, {
      sigVerify: false,
      commitment: "confirmed",
    });
    const logs = simulation.value.logs ?? [];

    if (simulation.value.err) {
      return {
        success: false,
        error: this._decodeSimulationError(simulation.value.err, logs),
        logs,
        destinationAta: destinationAta.toBase58(),
        destinationAtaExists: Boolean(destinationInfo),
        destinationAtaCreatedInSimulation: !destinationInfo,
        instructionCount: fullInstructions.length,
        transactionSize: simulationTargetSize,
        approvalOnlySimulation,
      };
    }

    return {
      success: true,
      logs,
      destinationAta: destinationAta.toBase58(),
      destinationAtaExists: Boolean(destinationInfo),
      destinationAtaCreatedInSimulation: !destinationInfo,
      instructionCount: fullInstructions.length,
      transactionSize: simulationTargetSize,
      approvalOnlySimulation,
    };
  }

  /**
   * Executes a transfer: simulates first, then submits if simulation passes.
   *
   * @param mint     - Token-2022 mint address
   * @param from     - Sender wallet (must be connected provider wallet)
   * @param to       - Recipient wallet
   * @param amount   - Amount in base units
   * @param decimals - Token decimals
   */
  async executeTransfer(
    mint: PublicKey,
    from: PublicKey,
    to: PublicKey,
    amount: bigint,
    decimals: number
  ): Promise<TransferResult> {
    try {
      const ids = await this.getProgramIds();
      await this.prepareRecipientTokenAccount(mint, from, to);
      await this.prepareTransferSupportAccounts(mint, from, ids);

      const { approveIx, transferIx } = await this._buildTransferInstructions(
        mint,
        from,
        to,
        amount,
        decimals,
        ids
      );

      await this.sendVersionedInstructions(from, [approveIx]);
      const signature = await this.sendVersionedInstructions(from, [transferIx]);

      return { signature, success: true };
    } catch (err) {
      return {
        signature: "",
        success: false,
        error: formatTransactionError(err),
      };
    }
  }

  async preflightTransfer(
    mint: PublicKey,
    from: PublicKey,
    to: PublicKey,
    amount: bigint,
    decimals: number
  ): Promise<TransferPreflightResult> {
    const ids = await this.getProgramIds();
    const tokenProgram = this.getTokenProgram(ids.token);
    const sourceAta = this.getTokenAccountAddress(mint, from);
    const destinationAta = this.getTokenAccountAddress(mint, to);
    const tokenState = this.getTokenStatePda(mint, ids.token);
    const tokenStateAccount = await (tokenProgram.account as any).tokenState.fetch(tokenState);
    const irpState = tokenStateAccount.identityRegistry as PublicKey;
    const complianceState = tokenStateAccount.compliance as PublicKey;
    const irsState = await this.deriveIrsStateFromIrp(irpState);
    const [ctrState] = PublicKey.findProgramAddressSync(
      [Buffer.from("ctr_state"), mint.toBuffer()],
      ids.ctr
    );
    const [tirState] = PublicKey.findProgramAddressSync(
      [Buffer.from("tir_state"), mint.toBuffer()],
      ids.tir
    );
    const requiredClaimTopics = await this.fetchRequiredTopics(ctrState, ids.ctr);
    const sourceBalance = await this.getRawTokenBalance(sourceAta).catch(() => 0n);
    const partialFreeze = await this.getPartialFreezeAmount(mint, from, ids.token);
    const transferableBalance = sourceBalance > partialFreeze ? sourceBalance - partialFreeze : 0n;
    const destinationInfo = await this.connection.getAccountInfo(destinationAta, "confirmed");

    const sender = await this.checkWalletEligibility(mint, from, irsState, tirState, requiredClaimTopics, ids);
    const recipient = await this.checkWalletEligibility(mint, to, irsState, tirState, requiredClaimTopics, ids);
    const blockers = [...sender.blockers.map((item) => `Sender: ${item}`), ...recipient.blockers.map((item) => `Recipient: ${item}`)];

    if (sourceBalance < amount) blockers.push("Insufficient token balance.");
    if (transferableBalance < amount) blockers.push("Insufficient transferable balance after partial freeze.");

    let simulation: SimulationResult | undefined;
    if (blockers.length === 0 && destinationInfo) {
      simulation = await this.simulateTransfer(mint, from, to, amount, decimals);
      if (!simulation.success) blockers.push(simulation.error || "Transfer simulation failed.");
    }

    const recipientMissingKyc = recipient.blockers.some((item) => item.includes("topic 1"));
    const recipientMissingAml = recipient.blockers.some((item) => item.includes("topic 2"));

    let status = "READY_TO_TRANSFER";
    if (sender.blockers.length > 0) status = this.senderStatusFromBlockers(sender.blockers);
    else if (sourceBalance < amount) status = "INSUFFICIENT_TRANSFERABLE_BALANCE";
    else if (transferableBalance < amount) status = "INSUFFICIENT_TRANSFERABLE_BALANCE";
    else if (!recipient.identityExists && recipient.blockers.some((item) => item.includes("FID"))) status = "ACTION_REQUIRED_RECIPIENT_FID";
    else if (recipientMissingKyc) status = "PENDING_KYC";
    else if (recipientMissingAml) status = "PENDING_AML";
    else if (!recipient.identityExists) status = "PENDING_ISSUER_WHITELIST";
    else if (!recipient.identityActive) status = "PENDING_ISSUER_ACTIVATION";
    else if (simulation && !simulation.success) status = "TRANSFER_SIMULATION_FAILED";

    return {
      ok: blockers.length === 0,
      status,
      blockers,
      sender,
      recipient,
      requiredClaimTopics,
      sourceAta: sourceAta.toBase58(),
      destinationAta: destinationAta.toBase58(),
      destinationAtaExists: Boolean(destinationInfo),
      sourceBalance: sourceBalance.toString(),
      transferableBalance: transferableBalance.toString(),
      simulation,
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────────────────

  /**
   * Builds a FRACKS-compatible Token-2022 transferChecked transaction.
   * Includes the extra-account-metas account required by the transfer hook.
   */
  private async _buildTransferTransaction(
    mint: PublicKey,
    from: PublicKey,
    to: PublicKey,
    amount: bigint,
    decimals: number
  ): Promise<Transaction> {
    const ids = await this.getProgramIds();
    const { approveIx, transferIx } = await this._buildTransferInstructions(
      mint,
      from,
      to,
      amount,
      decimals,
      ids
    );
    return new Transaction().add(approveIx, transferIx);
  }

  private async _buildTransferInstructions(
    mint: PublicKey,
    from: PublicKey,
    to: PublicKey,
    amount: bigint,
    decimals: number,
    ids: TransferProgramIds,
    options: { allowMissingDestinationAta?: boolean } = {}
  ): Promise<TransferInstructions> {
    const tokenProgram = this.getTokenProgram(ids.token);
    const sourceTa = this.getTokenAccountAddress(mint, from);
    const destinationTa = this.getTokenAccountAddress(mint, to);
    const extraAccountMetas = this.getExtraAccountMetasPda(mint);
    const tokenState = this.getTokenStatePda(mint, ids.token);
    const transferApproval = this.getTransferApprovalPda(
      sourceTa,
      destinationTa,
      from
    );

    const sourceBalance = await this.getRawTokenBalance(sourceTa);
    const destinationInfo = await this.connection.getAccountInfo(destinationTa, "confirmed");
    if (!destinationInfo) {
      if (!options.allowMissingDestinationAta) {
        throw new Error(RECIPIENT_ATA_NOTICE);
      }
    } else {
      this.assertToken2022Account(destinationInfo.owner);
    }
    const destinationBalance = destinationInfo ? await this.getRawTokenBalance(destinationTa) : BigInt(0);

    if (sourceBalance < amount) {
      throw new Error("Insufficient token balance.");
    }

    const tokenStateAccount = await (tokenProgram.account as any).tokenState.fetch(tokenState);
    const irpState = tokenStateAccount.identityRegistry as PublicKey;
    const complianceState = tokenStateAccount.compliance as PublicKey;
    const irsState = await this.deriveIrsStateFromIrp(irpState);
    const [tirState] = PublicKey.findProgramAddressSync(
      [Buffer.from("tir_state"), mint.toBuffer()],
      ids.tir
    );
    const [ctrState] = PublicKey.findProgramAddressSync(
      [Buffer.from("ctr_state"), mint.toBuffer()],
      ids.ctr
    );
    const [fromWalletIdentity] = PublicKey.findProgramAddressSync(
      [SEED_WALLET_IDENTITY, irsState.toBuffer(), from.toBuffer()],
      ids.irs
    );
    const [toWalletIdentity] = PublicKey.findProgramAddressSync(
      [SEED_WALLET_IDENTITY, irsState.toBuffer(), to.toBuffer()],
      ids.irs
    );
    const [fromWalletIdentityInfo, toWalletIdentityInfo] =
      await this.connection.getMultipleAccountsInfo(
        [fromWalletIdentity, toWalletIdentity],
        "confirmed"
      );
    const fromIdentity = fromWalletIdentityInfo
      ? parseWalletIdentity(fromWalletIdentityInfo.data)
      : null;
    const toIdentity = toWalletIdentityInfo
      ? parseWalletIdentity(toWalletIdentityInfo.data)
      : null;
    const [fromFrozen] = PublicKey.findProgramAddressSync(
      [Buffer.from("frozen"), mint.toBuffer(), from.toBuffer()],
      ids.token
    );
    const [toFrozen] = PublicKey.findProgramAddressSync(
      [Buffer.from("frozen"), mint.toBuffer(), to.toBuffer()],
      ids.token
    );
    const [fromPartialFreeze] = PublicKey.findProgramAddressSync(
      [Buffer.from("partial_freeze"), mint.toBuffer(), from.toBuffer()],
      ids.token
    );
    const approvalRemainingAccounts =
      await this.getTransferApprovalRemainingAccounts(
        from,
        to,
        mint,
        tirState,
        complianceState,
        ids,
        fromIdentity?.country ?? null,
        toIdentity?.country ?? null
      );

    const approveIx = await tokenProgram.methods
      .transfer(
        new BN(amount.toString()),
        new BN(sourceBalance.toString()),
        new BN(destinationBalance.toString())
      )
      .accounts({
        tokenState,
        sourceTokenAccount: sourceTa,
        tokenMintAccount: mint,
        destinationTokenAccount: destinationTa,
        fromWallet: from,
        toWallet: to,
        extraAccountMetas,
        controllerProgram: ids.token,
        hookProgram: TOKEN_HOOK_PROGRAM_ID,
        transferApproval,
        systemProgram: SystemProgram.programId,
        irpState,
        irsState,
        tirState,
        ctrState,
        complianceState,
        complianceProgram: ids.compliance,
        fromWalletIdentity,
        toWalletIdentity,
        fromFrozen,
        toFrozen,
        fromPartialFreeze,
        tokenProgram: SPL_TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts(approvalRemainingAccounts)
      .instruction();

    const transferIx = createTransferCheckedInstruction(
      sourceTa,
      mint,
      destinationTa,
      from,
      amount,
      decimals,
      [],
      SPL_TOKEN_2022_PROGRAM_ID
    );

    await this.appendTransferHookAccounts(
      transferIx,
      extraAccountMetas,
      tokenState,
      transferApproval,
      complianceState,
      from,
      fromIdentity?.country ?? null,
      toIdentity?.country ?? null,
      ids
    );

    return { approveIx, transferIx };
  }

  private compileVersionedTransaction(
    payerKey: PublicKey,
    recentBlockhash: string,
    instructions: TransactionInstruction[],
    lookupTables: AddressLookupTableAccount[] = []
  ): VersionedTransaction {
    const message = new TransactionMessage({
      payerKey,
      recentBlockhash,
      instructions,
    }).compileToV0Message(lookupTables);
    return new VersionedTransaction(message);
  }

  private getSerializedTransactionSize(transaction: VersionedTransaction): number | null {
    try {
      return transaction.serialize().length;
    } catch {
      return null;
    }
  }

  private async sendVersionedInstructions(
    payerKey: PublicKey,
    instructions: TransactionInstruction[]
  ): Promise<string> {
    let { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("confirmed");
    let tx = this.compileVersionedTransaction(payerKey, blockhash, instructions);
    const txSize = this.getSerializedTransactionSize(tx);
    if (txSize === null || txSize > 1232) {
      const lookupTable = await this.createLookupTableForInstructions(payerKey, instructions);
      ({ blockhash, lastValidBlockHeight } =
        await this.connection.getLatestBlockhash("confirmed"));
      tx = this.compileVersionedTransaction(payerKey, blockhash, instructions, [lookupTable]);

      const lutTxSize = this.getSerializedTransactionSize(tx);
      if (lutTxSize === null || lutTxSize > 1232) {
        throw new Error(
          `Transfer transaction is ${lutTxSize ?? "too large to serialize"} bytes, above Solana's 1232-byte limit even with an address lookup table.`
        );
      }
    }

    const signed = await this.provider.wallet.signTransaction(tx);
    let signature: string;
    try {
      signature = await this.connection.sendRawTransaction(
        signed.serialize(),
        { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }
      );
    } catch (err) {
      throw new Error(await this.formatSendError(err));
    }

    await this.confirmSubmittedTransaction(signature, blockhash, lastValidBlockHeight);
    return signature;
  }

  private async createLookupTableForInstructions(
    payerKey: PublicKey,
    instructions: TransactionInstruction[]
  ): Promise<AddressLookupTableAccount> {
    const slot = await this.connection.getSlot("confirmed");
    const [createLookupTableIx, lookupTableAddress] =
      AddressLookupTableProgram.createLookupTable({
        authority: payerKey,
        payer: payerKey,
        recentSlot: slot - 1,
      });

    const lookupAddresses = this.collectLookupTableAddresses(payerKey, instructions);
    for (let index = 0; index < lookupAddresses.length; index += 24) {
      const chunk = lookupAddresses.slice(index, index + 24);
      const extendLookupTableIx = AddressLookupTableProgram.extendLookupTable({
        payer: payerKey,
        authority: payerKey,
        lookupTable: lookupTableAddress,
        addresses: chunk,
      });
      const transaction = new Transaction();
      if (index === 0) {
        transaction.add(createLookupTableIx);
      }
      transaction.add(extendLookupTableIx);
      await this.sendLegacyTransaction(payerKey, transaction);
    }

    return this.waitForLookupTableActivation(lookupTableAddress, lookupAddresses.length);
  }

  private async waitForLookupTableActivation(
    lookupTableAddress: PublicKey,
    expectedAddressCount: number
  ): Promise<AddressLookupTableAccount> {
    const deadline = Date.now() + 20_000;
    let lastLookupTable: AddressLookupTableAccount | null = null;

    while (Date.now() < deadline) {
      const lookupTable = await this.connection.getAddressLookupTable(
        lookupTableAddress,
        { commitment: "confirmed" }
      );
      lastLookupTable = lookupTable.value;

      if (
        lookupTable.value &&
        lookupTable.value.state.addresses.length >= expectedAddressCount
      ) {
        const currentSlot = await this.connection.getSlot("confirmed");
        const lastExtendedSlot = Number(lookupTable.value.state.lastExtendedSlot);
        if (currentSlot > lastExtendedSlot) {
          return lookupTable.value;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (lastLookupTable) {
      throw new Error("Address lookup table was created but was not ready for this slot. Please retry the transfer.");
    }
    throw new Error("Address lookup table was not available after creation.");
  }

  private collectLookupTableAddresses(
    payerKey: PublicKey,
    instructions: TransactionInstruction[]
  ): PublicKey[] {
    const seen = new Set<string>();
    const addresses: PublicKey[] = [];
    const pushAddress = (pubkey: PublicKey) => {
      const key = pubkey.toBase58();
      if (key === payerKey.toBase58() || seen.has(key)) {
        return;
      }
      seen.add(key);
      addresses.push(pubkey);
    };

    for (const instruction of instructions) {
      pushAddress(instruction.programId);
      for (const account of instruction.keys) {
        if (!account.isSigner) {
          pushAddress(account.pubkey);
        }
      }
    }
    return addresses;
  }

  private async sendLegacyTransaction(
    payerKey: PublicKey,
    transaction: Transaction
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payerKey;
    const signed = await this.provider.wallet.signTransaction(transaction);
    const signature = await this.connection.sendRawTransaction(
      signed.serialize(),
      { skipPreflight: false, preflightCommitment: "confirmed" }
    );
    await this.confirmSubmittedTransaction(signature, blockhash, lastValidBlockHeight);
    return signature;
  }

  private async confirmSubmittedTransaction(
    signature: string,
    blockhash: string,
    lastValidBlockHeight: number
  ): Promise<void> {
    try {
      const result = await this.connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      if (result.value.err) {
        throw new Error(decodeTransferHookError(result.value.err));
      }
      return;
    } catch (err) {
      const message = formatTransactionError(err);
      if (!message.includes("Transaction expired")) {
        throw err;
      }

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const status = await this.connection.getSignatureStatus(signature, {
          searchTransactionHistory: true,
        });
        if (status.value?.err) {
          throw new Error(decodeTransferHookError(status.value.err));
        }
        if (
          status.value?.confirmationStatus === "confirmed" ||
          status.value?.confirmationStatus === "finalized"
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }

      throw new Error(
        "Transaction was submitted but confirmation is delayed on devnet. Check history/explorer, then retry only if it does not appear."
      );
    }
  }

  private async formatSendError(err: unknown): Promise<string> {
    const maybeLogGetter = err as {
      getLogs?: (connection: Connection) => Promise<string[] | null>;
      logs?: string[];
    };

    try {
      const logs = maybeLogGetter.logs ?? (await maybeLogGetter.getLogs?.(this.connection));
      if (logs?.length) {
        return this._decodeSimulationError(err, logs);
      }
    } catch {
      // Fall through to the normal formatter.
    }

    return formatTransactionError(err);
  }

  private async appendTransferHookAccounts(
    instruction: TransactionInstruction,
    extraAccountMetas: PublicKey,
    tokenState: PublicKey,
    transferApproval: PublicKey,
    complianceState: PublicKey,
    fromWallet: PublicKey,
    fromCountry: number | null,
    toCountry: number | null,
    ids: TransferProgramIds
  ): Promise<void> {
    const complianceProgram = new Program(
      {
        ...(ComplianceIdl as unknown as Record<string, unknown>),
        address: ids.compliance.toBase58(),
      } as Idl,
      this.provider
    );
    const compliance = await (complianceProgram.account as any).complianceState.fetch(
      complianceState
    );
    const moduleAccounts = compliance.modules as PublicKey[];
    const appended: RemainingAccount[] = [
      { pubkey: extraAccountMetas, isSigner: false, isWritable: false },
      { pubkey: ids.token, isSigner: false, isWritable: false },
      { pubkey: tokenState, isSigner: false, isWritable: false },
      { pubkey: transferApproval, isSigner: false, isWritable: true },
      { pubkey: complianceState, isSigner: false, isWritable: false },
      { pubkey: ids.compliance, isSigner: false, isWritable: false },
    ];

    const moduleInfos =
      moduleAccounts.length > 0
        ? await this.connection.getMultipleAccountsInfo(moduleAccounts, "confirmed")
        : [];

    moduleAccounts.forEach((moduleAccount, index) => {
      const info = moduleInfos[index];
      if (!info) {
        return;
      }

      appended.push({
        pubkey: moduleAccount,
        isSigner: false,
        isWritable: true,
      });

      this.appendModuleProgramAccount(appended, info.owner);

      if (info.owner.equals(MOD_DAILY_LIMIT)) {
        const [dailyUsage] = PublicKey.findProgramAddressSync(
          [Buffer.from("daily_usage"), moduleAccount.toBuffer(), fromWallet.toBuffer()],
          MOD_DAILY_LIMIT
        );
        appended.push({
          pubkey: dailyUsage,
          isSigner: false,
          isWritable: true,
        });
      }

      if (info.owner.equals(MOD_COUNTRY_CAP)) {
        for (const country of [fromCountry, toCountry]) {
          if (country === null) continue;
          const countryBytes = Buffer.alloc(2);
          countryBytes.writeUInt16LE(country);
          const [countryCount] = PublicKey.findProgramAddressSync(
            [Buffer.from("country_count"), moduleAccount.toBuffer(), countryBytes],
            MOD_COUNTRY_CAP
          );
          appended.push({
            pubkey: countryCount,
            isSigner: false,
            isWritable: true,
          });
        }
      }
    });

    appended.push({
      pubkey: TOKEN_HOOK_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    });

    const baseKeys = instruction.keys.slice(0, 4);
    const existing = new Set(baseKeys.map((meta) => meta.pubkey.toBase58()));
    const hookKeys = appended
      .filter((meta) => {
        const key = meta.pubkey.toBase58();
        if (existing.has(key)) {
          return false;
        }
        existing.add(key);
        return true;
      })
      .map((meta) => ({
        pubkey: meta.pubkey,
        isSigner: meta.isSigner,
        isWritable: meta.isWritable,
      }));

    instruction.keys = [...baseKeys, ...hookKeys];
  }

  private appendModuleProgramAccount(
    accounts: RemainingAccount[],
    moduleProgramId: PublicKey
  ): void {
    if (!MODULE_PROGRAM_IDS.has(moduleProgramId.toBase58())) {
      return;
    }
    accounts.push({
      pubkey: moduleProgramId,
      isSigner: false,
      isWritable: false,
    });
  }

  private getTokenAccountAddress(mint: PublicKey, owner: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      SPL_TOKEN_2022_PROGRAM_ID
    );
  }

  private assertToken2022Account(owner: PublicKey): void {
    if (!owner.equals(SPL_TOKEN_2022_PROGRAM_ID)) {
      throw new Error("Recipient associated token account exists but is not owned by Token-2022.");
    }
  }

  private createRecipientAtaInstruction(
    mint: PublicKey,
    payer: PublicKey,
    recipient: PublicKey
  ): TransactionInstruction {
    return createAssociatedTokenAccountInstruction(
      payer,
      this.getTokenAccountAddress(mint, recipient),
      recipient,
      mint,
      SPL_TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  }

  private async prepareRecipientTokenAccount(
    mint: PublicKey,
    payer: PublicKey,
    recipient: PublicKey
  ): Promise<string | null> {
    const destinationTa = this.getTokenAccountAddress(mint, recipient);
    const destinationInfo = await this.connection.getAccountInfo(
      destinationTa,
      "confirmed"
    );
    if (destinationInfo) {
      this.assertToken2022Account(destinationInfo.owner);
      return null;
    }

    const tx = new Transaction().add(
      this.createRecipientAtaInstruction(mint, payer, recipient)
    );
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;

    const signed = await this.provider.wallet.signTransaction(tx);
    const signature = await this.connection.sendRawTransaction(
      signed.serialize(),
      { skipPreflight: false, preflightCommitment: "confirmed" }
    );

    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    return signature;
  }

  private async prepareTransferSupportAccounts(
    mint: PublicKey,
    sender: PublicKey,
    ids: TransferProgramIds
  ): Promise<void> {
    const tokenProgram = this.getTokenProgram(ids.token);
    const tokenState = this.getTokenStatePda(mint, ids.token);
    const tokenStateAccount = await (tokenProgram.account as any).tokenState.fetch(
      tokenState
    );
    const complianceState = tokenStateAccount.compliance as PublicKey;
    const complianceProgram = new Program(ComplianceIdl as unknown as Idl, this.provider);
    const dailyProgram = new Program(ModDailyLimitIdl as unknown as Idl, this.provider);
    const compliance = await (complianceProgram.account as any).complianceState.fetch(
      complianceState
    );
    const moduleAccounts = compliance.modules as PublicKey[];
    const moduleInfos = await this.connection.getMultipleAccountsInfo(
      moduleAccounts,
      "confirmed"
    );

    for (const [index, moduleAccount] of moduleAccounts.entries()) {
      const moduleInfo = moduleInfos[index];
      if (!moduleInfo?.owner.equals(MOD_DAILY_LIMIT)) {
        continue;
      }

      const [dailyUsage] = PublicKey.findProgramAddressSync(
        [Buffer.from("daily_usage"), moduleAccount.toBuffer(), sender.toBuffer()],
        MOD_DAILY_LIMIT
      );
      const existingUsage = await this.connection.getAccountInfo(dailyUsage, "confirmed");
      if (existingUsage) {
        continue;
      }

      const module = await (dailyProgram.account as any).dailyTransferLimitModule.fetch(
        moduleAccount
      );
      const moduleOwner = module.owner as PublicKey;
      if (!moduleOwner.equals(this.provider.wallet.publicKey)) {
        // Some legacy suites have module state owned by the platform admin
        // while investors sign transfers themselves. Do not block the transfer;
        // the compliance program handles missing usage PDAs without failing.
        continue;
      }

      await (dailyProgram.methods as any)
        .initializeWalletUsage(sender)
        .accounts({
          owner: this.provider.wallet.publicKey,
          moduleState: moduleAccount,
          walletUsage: dailyUsage,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
    }
  }

  private async getRawTokenBalance(tokenAccount: PublicKey): Promise<bigint> {
    const balance = await this.connection.getTokenAccountBalance(tokenAccount, "confirmed");
    return BigInt(balance.value.amount);
  }

  private async fetchRequiredTopics(ctrState: PublicKey, ctrProgramId: PublicKey): Promise<string[]> {
    const info = await this.connection.getAccountInfo(ctrState, "confirmed");
    if (!info) return [];
    return parseCtrTopics(info.data).map((topic) => topic.toString());
  }

  private async getPartialFreezeAmount(
    mint: PublicKey,
    wallet: PublicKey,
    tokenProgramId: PublicKey
  ): Promise<bigint> {
    const [partialFreeze] = PublicKey.findProgramAddressSync(
      [Buffer.from("partial_freeze"), mint.toBuffer(), wallet.toBuffer()],
      tokenProgramId
    );
    const info = await this.connection.getAccountInfo(partialFreeze, "confirmed");
    if (!info || info.data.length < 8 + 32 + 32 + 8) return 0n;
    return info.data.readBigUInt64LE(8 + 32 + 32);
  }

  private async checkWalletEligibility(
    mint: PublicKey,
    wallet: PublicKey,
    irsState: PublicKey,
    tirState: PublicKey,
    requiredClaimTopics: string[],
    ids: TransferProgramIds
  ): Promise<WalletTransferEligibility> {
    const [walletIdentity] = PublicKey.findProgramAddressSync(
      [SEED_WALLET_IDENTITY, irsState.toBuffer(), wallet.toBuffer()],
      ids.irs
    );
    const blockers: string[] = [];
    const identityInfo = await this.connection.getAccountInfo(walletIdentity, "confirmed");

    const [fidPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fid"), wallet.toBuffer()],
      ids.fid
    );
    const fidInfo = await this.connection.getAccountInfo(fidPda, "confirmed");
    if (!fidInfo) {
      blockers.push("FID is not registered.");
    }

    const parsedIdentity = identityInfo ? parseWalletIdentity(identityInfo.data) : null;
    if (!parsedIdentity) {
      blockers.push("Wallet is not registered in this token's IRS.");
    } else if (!parsedIdentity.isActive) {
      blockers.push("Wallet identity is registered but inactive in this token's IRS.");
    }

    const [frozen] = PublicKey.findProgramAddressSync(
      [Buffer.from("frozen"), mint.toBuffer(), wallet.toBuffer()],
      ids.token
    );
    const frozenInfo = await this.connection.getAccountInfo(frozen, "confirmed");
    if (frozenInfo && frozenInfo.owner.equals(ids.token) && frozenInfo.data.length > 0) {
      blockers.push("Wallet is frozen for this token.");
    }

    for (const topic of requiredClaimTopics) {
      const claimCheck = parsedIdentity
        ? await this.hasValidTrustedClaim(parsedIdentity.fid, BigInt(topic), tirState, ids)
        : { ok: false, reason: `Missing valid trusted claim for required topic ${topic}.` };
      if (!claimCheck.ok) {
        blockers.push(claimCheck.reason);
      }
    }

    return {
      wallet: wallet.toBase58(),
      walletIdentity: walletIdentity.toBase58(),
      identityExists: Boolean(parsedIdentity),
      identityActive: Boolean(parsedIdentity?.isActive),
      fid: parsedIdentity?.fid.toBase58() ?? (fidInfo ? fidPda.toBase58() : undefined),
      country: parsedIdentity?.country,
      blockers,
    };
  }

  private async hasValidTrustedClaim(
    targetFid: PublicKey,
    topic: bigint,
    tirState: PublicKey,
    ids: TransferProgramIds
  ): Promise<ClaimCheckResult> {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const claimAccounts = await this.connection.getProgramAccounts(ids.fid, {
      commitment: "confirmed",
      filters: [
        { dataSize: CLAIM_ACCOUNT_SIZE },
        { memcmp: { offset: 8, bytes: targetFid.toBase58() } },
      ],
    });

    let sawTopic = false;
    let sawUnrevoked = false;
    let sawUnexpired = false;
    let sawTrusted = false;

    for (const { account } of claimAccounts) {
      const parsed = parseClaimAccount(account.data);
      if (!parsed || parsed.topic !== topic) continue;
      sawTopic = true;
      if (parsed.revoked) continue;
      sawUnrevoked = true;
      if (parsed.expiresAt !== 0n && parsed.expiresAt < now) continue;
      sawUnexpired = true;

      const [issuerEntry] = PublicKey.findProgramAddressSync(
        [Buffer.from("issuer_entry"), tirState.toBuffer(), parsed.issuerFid.toBuffer()],
        ids.tir
      );
      const [issuerEntryInfo, issuerFidInfo] = await this.connection.getMultipleAccountsInfo(
        [issuerEntry, parsed.issuerFid],
        "confirmed"
      );
      if (!issuerEntryInfo || !parseIssuerEntryForTopic(issuerEntryInfo.data, parsed.topic)) {
        continue;
      }
      sawTrusted = true;
      if (!issuerFidInfo || !parseFidIsIssuerAndSigner(issuerFidInfo.data, parsed.signerKey)) {
        continue;
      }
      return { ok: true };
    }

    const topicText = topic.toString();
    if (!sawTopic) {
      return { ok: false, reason: `Missing valid trusted claim for required topic ${topicText}.` };
    }
    if (!sawUnrevoked) {
      return { ok: false, reason: `Claim for required topic ${topicText} is revoked.` };
    }
    if (!sawUnexpired) {
      return { ok: false, reason: `Claim for required topic ${topicText} has expired.` };
    }
    if (!sawTrusted) {
      return { ok: false, reason: `Claim exists for required topic ${topicText}, but its issuer is not trusted in this token's TIR.` };
    }
    return { ok: false, reason: `Claim for required topic ${topicText} has an invalid issuer FID signer.` };
  }

  private senderStatusFromBlockers(blockers: string[]): string {
    if (blockers.some((item) => item.includes("frozen"))) return "SENDER_FROZEN";
    if (blockers.some((item) => item.includes("expired"))) return "SENDER_CLAIM_EXPIRED";
    return "SENDER_NOT_ELIGIBLE";
  }

  private async deriveIrsStateFromIrp(irpState: PublicKey): Promise<PublicKey> {
    const irpRaw = await this.connection.getAccountInfo(irpState, "confirmed");
    if (!irpRaw) {
      throw new Error("Identity registry protocol account was not found.");
    }
    return new PublicKey(irpRaw.data.slice(72, 104));
  }

  private async getTransferApprovalRemainingAccounts(
    sender: PublicKey,
    recipient: PublicKey,
    mint: PublicKey,
    tirState: PublicKey,
    complianceState: PublicKey,
    ids: TransferProgramIds,
    senderCountry: number | null,
    recipientCountry: number | null
  ): Promise<RemainingAccount[]> {
    const approvalRemainingAccounts: RemainingAccount[] = [];
    const approvalSeen = new Set<string>();
    const pushApproval = (pubkey: PublicKey, isWritable = false) => {
      const key = pubkey.toBase58();
      if (approvalSeen.has(key)) return;
      approvalSeen.add(key);
      approvalRemainingAccounts.push({ pubkey, isSigner: false, isWritable });
    };

    const fidProgram = new Program(
      { ...(FidIdl as unknown as Record<string, unknown>), address: ids.fid.toBase58() } as Idl,
      this.provider
    );
    const ctrProgram = new Program(
      { ...(CtrIdl as unknown as Record<string, unknown>), address: ids.ctr.toBase58() } as Idl,
      this.provider
    );
    const requiredTopics = new Set<string>();
    try {
      const ctr = await (ctrProgram.account as any).claimTopicsState.fetch(
        PublicKey.findProgramAddressSync(
          [Buffer.from("ctr_state"), mint.toBuffer()],
          ids.ctr
        )[0]
      );
      for (const topic of ctr.topics as Array<{ toString(): string }>) {
        requiredTopics.add(topic.toString());
      }
    } catch {
      // If the CTR cannot be read, fall back to no claim filtering.
    }

    const now = BigInt(Math.floor(Date.now() / 1000));

    const appendClaimsForWallet = async (wallet: PublicKey) => {
      const [targetFid] = PublicKey.findProgramAddressSync(
        [Buffer.from("fid"), wallet.toBuffer()],
        ids.fid
      );
      const claimAccounts = await this.connection.getProgramAccounts(ids.fid, {
        commitment: "confirmed",
        filters: [
          { dataSize: CLAIM_ACCOUNT_SIZE },
          { memcmp: { offset: 8, bytes: targetFid.toBase58() } },
        ],
      });
      const selectedTopics = new Set<string>();
      const trustedIssuerEntryCache = new Map<string, boolean>();
      const signerValidCache = new Map<string, boolean>();

      const isTrustedIssuerForTopic = async (issuerFid: PublicKey, claimTopic: bigint) => {
        const cacheKey = `${issuerFid.toBase58()}:${claimTopic.toString()}`;
        if (trustedIssuerEntryCache.has(cacheKey)) {
          return trustedIssuerEntryCache.get(cacheKey) ?? false;
        }
        const [issuerEntry] = PublicKey.findProgramAddressSync(
          [Buffer.from("issuer_entry"), tirState.toBuffer(), issuerFid.toBuffer()],
          ids.tir
        );
        const issuerEntryInfo = await this.connection.getAccountInfo(issuerEntry, "confirmed");
        const trusted = Boolean(
          issuerEntryInfo && parseIssuerEntryForTopic(issuerEntryInfo.data, claimTopic)
        );
        trustedIssuerEntryCache.set(cacheKey, trusted);
        return trusted;
      };

      const issuerSignerMatchesClaim = async (issuerFid: PublicKey, signerKey: PublicKey) => {
        const cacheKey = `${issuerFid.toBase58()}:${signerKey.toBase58()}`;
        if (signerValidCache.has(cacheKey)) {
          return signerValidCache.get(cacheKey) ?? false;
        }
        const issuerFidInfo = await this.connection.getAccountInfo(issuerFid, "confirmed");
        const matches = Boolean(
          issuerFidInfo && parseFidIsIssuerAndSigner(issuerFidInfo.data, signerKey)
        );
        signerValidCache.set(cacheKey, matches);
        return matches;
      };

      for (const { pubkey, account } of claimAccounts) {
        try {
          const claim = fidProgram.coder.accounts.decode("claimAccount", account.data);
          const claimTopic = claim.topic.toString();
          const claimTopicValue = BigInt(claimTopic);
          const expiresAt = BigInt(claim.expiresAt.toString());
          if (requiredTopics.size > 0 && !requiredTopics.has(claimTopic)) {
            continue;
          }
          if (selectedTopics.has(claimTopic)) {
            continue;
          }
          if (claim.revoked) {
            continue;
          }
          if (expiresAt !== BigInt(0) && expiresAt < now) {
            continue;
          }

          const issuerFid = claim.issuerFid as PublicKey;
          const signerKey = claim.signerKey as PublicKey;
          if (!(await isTrustedIssuerForTopic(issuerFid, claimTopicValue))) {
            continue;
          }
          if (!(await issuerSignerMatchesClaim(issuerFid, signerKey))) {
            continue;
          }
          const [issuerEntry] = PublicKey.findProgramAddressSync(
            [Buffer.from("issuer_entry"), tirState.toBuffer(), issuerFid.toBuffer()],
            ids.tir
          );
          pushApproval(pubkey);
          pushApproval(issuerEntry);
          pushApproval(issuerFid);
          selectedTopics.add(claimTopic);
          if (requiredTopics.size > 0 && selectedTopics.size >= requiredTopics.size) {
            break;
          }
        } catch {
          // Ignore malformed accounts; on-chain verification rejects missing required claims.
        }
      }
    };

    await appendClaimsForWallet(sender);
    await appendClaimsForWallet(recipient);

    const complianceProgram = new Program(
      { ...(ComplianceIdl as unknown as Record<string, unknown>), address: ids.compliance.toBase58() } as Idl,
      this.provider
    );
    try {
      const compliance = await (complianceProgram.account as any).complianceState.fetch(complianceState);
      const moduleAccounts = compliance.modules as PublicKey[];
      await this.assertComplianceModuleAccountsExist(moduleAccounts, mint);
      const moduleInfos = await this.connection.getMultipleAccountsInfo(
        moduleAccounts,
        "confirmed"
      );
      for (const [index, moduleAccount] of moduleAccounts.entries()) {
        pushApproval(moduleAccount, true);
        const moduleInfo = moduleInfos[index];
        if (!moduleInfo) {
          continue;
        }
        pushApproval(moduleInfo.owner);
        if (moduleInfo.owner.equals(MOD_DAILY_LIMIT)) {
          const [dailyUsage] = PublicKey.findProgramAddressSync(
            [Buffer.from("daily_usage"), moduleAccount.toBuffer(), sender.toBuffer()],
            MOD_DAILY_LIMIT
          );
          pushApproval(dailyUsage, true);
        }
        if (moduleInfo.owner.equals(MOD_COUNTRY_CAP)) {
          for (const country of [senderCountry, recipientCountry]) {
            if (country === null) continue;
            const countryBytes = Buffer.alloc(2);
            countryBytes.writeUInt16LE(country);
            const [countryCount] = PublicKey.findProgramAddressSync(
              [Buffer.from("country_count"), moduleAccount.toBuffer(), countryBytes],
              MOD_COUNTRY_CAP
            );
            pushApproval(countryCount, true);
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("compliance configuration is broken on-chain")) {
        throw error;
      }
      // On-chain compliance evaluation remains authoritative.
    }

    return approvalRemainingAccounts;
  }

  private async assertComplianceModuleAccountsExist(
    moduleAccounts: PublicKey[],
    mint: PublicKey
  ): Promise<void> {
    if (moduleAccounts.length === 0) {
      return;
    }

    const accountInfos = await this.connection.getMultipleAccountsInfo(
      moduleAccounts,
      "confirmed"
    );
    const missingModules = moduleAccounts.filter((_, index) => !accountInfos[index]);

    if (missingModules.length === 0) {
      return;
    }

    const listedModules = missingModules
      .slice(0, 3)
      .map((pubkey) => pubkey.toBase58())
      .join(", ");
    const suffix = missingModules.length > 3 ? ", ..." : "";

    throw new Error(
      `This token's compliance configuration is broken on-chain for mint ${mint.toBase58()}. ` +
        `${missingModules.length} bound module account(s) are missing: ${listedModules}${suffix}. ` +
        "The token issuer must repair or rebind those compliance modules before transfers can succeed."
    );
  }

  /**
   * Decodes a simulation error into a user-friendly string.
   */
  private _decodeSimulationError(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    err: any,
    logs: string[]
  ): string {
    // Try to extract the error from logs first (most informative)
    const logStr = logs.join("\n");

    // Check for known compliance check failure patterns in logs
    const compliancePatterns = [
      "ComplianceCheckFailed",
      "DailyLimitExceeded",
      "MaxBalanceExceeded",
      "MaxTransferExceeded",
      "LockupActive",
      "SupplyCapExceeded",
      "MaxInvestorsExceeded",
      "CountryRestricted",
      "CountryCapExceeded",
    ];
    for (const pattern of compliancePatterns) {
      if (logStr.includes(pattern)) {
        return decodeTransferHookError(new Error(pattern));
      }
    }

    const anchorNameMatch = logStr.match(/Error Code:\s*([A-Za-z0-9_]+)/i);
    if (anchorNameMatch) {
      return decodeTransferHookError(new Error(`Error Code: ${anchorNameMatch[1]}`));
    }

    // Try Anchor error code extraction from logs
    const hexMatch = logStr.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
    if (hexMatch) {
      const code = parseInt(hexMatch[1], 16);
      return decodeTransferHookError({ code });
    }

    // Fall back to the raw error object
    if (typeof err === "object" && err !== null) {
      if ("InstructionError" in err) {
        const [, innerErr] = err.InstructionError as [number, unknown];
        return decodeTransferHookError(innerErr);
      }
    }

    return formatTransactionError(err);
  }
}
