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

// ─── TransferService ──────────────────────────────────────────────────────────

export class TransferService {
  private connection: Connection;
  private provider: AnchorProvider;
  private tokenProgram: Program<Idl>;

  constructor(connection: Connection, provider: AnchorProvider) {
    this.connection = connection;
    this.provider = provider;
    this.tokenProgram = new Program(TokenIdl as unknown as Idl, provider);
  }

  // ── PDA Helpers ───────────────────────────────────────────────────────────────

  private getExtraAccountMetasPda(mint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [SEED_EXTRA_ACCOUNT_METAS, mint.toBuffer()],
      TOKEN_HOOK_PROGRAM_ID
    );
    return pda;
  }

  private getTransferApprovalPda(
    sourceTa: PublicKey,
    destinationTa: PublicKey,
    authority: PublicKey
  ): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        SEED_TRANSFER_APPROVAL,
        sourceTa.toBuffer(),
        destinationTa.toBuffer(),
        authority.toBuffer(),
      ],
      TOKEN_HOOK_PROGRAM_ID
    );
    return pda;
  }

  private getTokenStatePda(mint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_state"), mint.toBuffer()],
      TOKEN_PROGRAM_ID
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
      const destinationTa = this.getTokenAccountAddress(mint, to);
      const destinationInfo = await this.connection.getAccountInfo(
        destinationTa,
        "confirmed"
      );
      if (!destinationInfo) {
        return {
          success: true,
          notice: RECIPIENT_ATA_NOTICE,
          logs: [],
        };
      }
      this.assertToken2022Account(destinationInfo.owner);

      const { approveIx, transferIx } = await this._buildTransferInstructions(
        mint,
        from,
        to,
        amount,
        decimals
      );

      const { blockhash } =
        await this.connection.getLatestBlockhash("confirmed");

      const fullVtx = this.compileVersionedTransaction(
        from,
        blockhash,
        [approveIx, transferIx]
      );
      const fullTxSize = this.getSerializedTransactionSize(fullVtx);
      const simulationTarget =
        fullTxSize !== null && fullTxSize <= 1232
          ? fullVtx
          : this.compileVersionedTransaction(from, blockhash, [approveIx]);
      const simulationTargetSize = this.getSerializedTransactionSize(simulationTarget);
      if (simulationTargetSize === null || simulationTargetSize > 1232) {
        return {
          success: true,
          notice: OVERSIZED_SIMULATION_NOTICE,
          logs: [],
        };
      }

      const simulation = await this.connection.simulateTransaction(simulationTarget, {
        sigVerify: false,
        commitment: "confirmed",
      });

      const logs = simulation.value.logs ?? [];

      if (simulation.value.err) {
        const errMsg = this._decodeSimulationError(simulation.value.err, logs);
        return { success: false, error: errMsg, logs };
      }

      return { success: true, logs };
    } catch (err) {
      return {
        success: false,
        error: formatTransactionError(err),
        logs: [],
      };
    }
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
      await this.prepareRecipientTokenAccount(mint, from, to);
      await this.prepareTransferSupportAccounts(mint, from);

      const { approveIx, transferIx } = await this._buildTransferInstructions(
        mint,
        from,
        to,
        amount,
        decimals
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
    const { approveIx, transferIx } = await this._buildTransferInstructions(
      mint,
      from,
      to,
      amount,
      decimals
    );
    return new Transaction().add(approveIx, transferIx);
  }

  private async _buildTransferInstructions(
    mint: PublicKey,
    from: PublicKey,
    to: PublicKey,
    amount: bigint,
    decimals: number
  ): Promise<TransferInstructions> {
    const sourceTa = this.getTokenAccountAddress(mint, from);
    const destinationTa = this.getTokenAccountAddress(mint, to);
    const extraAccountMetas = this.getExtraAccountMetasPda(mint);
    const tokenState = this.getTokenStatePda(mint);
    const transferApproval = this.getTransferApprovalPda(
      sourceTa,
      destinationTa,
      from
    );

    const sourceBalance = await this.getRawTokenBalance(sourceTa);
    const destinationInfo = await this.connection.getAccountInfo(destinationTa, "confirmed");
    if (!destinationInfo) {
      throw new Error(RECIPIENT_ATA_NOTICE);
    }
    this.assertToken2022Account(destinationInfo.owner);
    const destinationBalance = destinationInfo ? await this.getRawTokenBalance(destinationTa) : BigInt(0);

    if (sourceBalance < amount) {
      throw new Error("Insufficient token balance.");
    }

    const tokenStateAccount = await (this.tokenProgram.account as any).tokenState.fetch(tokenState);
    const irpState = tokenStateAccount.identityRegistry as PublicKey;
    const complianceState = tokenStateAccount.compliance as PublicKey;
    const irsState = await this.deriveIrsStateFromIrp(irpState);
    const [tirState] = PublicKey.findProgramAddressSync(
      [Buffer.from("tir_state"), mint.toBuffer()],
      TIR_PROGRAM_ID
    );
    const [ctrState] = PublicKey.findProgramAddressSync(
      [Buffer.from("ctr_state"), mint.toBuffer()],
      CTR_PROGRAM_ID
    );
    const [fromWalletIdentity] = PublicKey.findProgramAddressSync(
      [SEED_WALLET_IDENTITY, irsState.toBuffer(), from.toBuffer()],
      IRS_PROGRAM_ID
    );
    const [toWalletIdentity] = PublicKey.findProgramAddressSync(
      [SEED_WALLET_IDENTITY, irsState.toBuffer(), to.toBuffer()],
      IRS_PROGRAM_ID
    );
    const [fromFrozen] = PublicKey.findProgramAddressSync(
      [Buffer.from("frozen"), mint.toBuffer(), from.toBuffer()],
      TOKEN_PROGRAM_ID
    );
    const [toFrozen] = PublicKey.findProgramAddressSync(
      [Buffer.from("frozen"), mint.toBuffer(), to.toBuffer()],
      TOKEN_PROGRAM_ID
    );
    const [fromPartialFreeze] = PublicKey.findProgramAddressSync(
      [Buffer.from("partial_freeze"), mint.toBuffer(), from.toBuffer()],
      TOKEN_PROGRAM_ID
    );
    const approvalRemainingAccounts =
      await this.getTransferApprovalRemainingAccounts(from, to, mint, tirState, complianceState);

    const approveIx = await this.tokenProgram.methods
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
        controllerProgram: TOKEN_PROGRAM_ID,
        hookProgram: TOKEN_HOOK_PROGRAM_ID,
        transferApproval,
        systemProgram: SystemProgram.programId,
        irpState,
        irsState,
        tirState,
        ctrState,
        complianceState,
        complianceProgram: COMPLIANCE_PROGRAM_ID,
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
      from
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
        "Transaction was submitted but confirmation is delayed on testnet. Check history/explorer, then retry only if it does not appear."
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
    fromWallet: PublicKey
  ): Promise<void> {
    const complianceProgram = new Program(ComplianceIdl as unknown as Idl, this.provider);
    const compliance = await (complianceProgram.account as any).complianceState.fetch(
      complianceState
    );
    const moduleAccounts = compliance.modules as PublicKey[];
    if (moduleAccounts.length === 0) {
      return;
    }

    const moduleInfos = await this.connection.getMultipleAccountsInfo(
      moduleAccounts,
      "confirmed"
    );
    const appended: RemainingAccount[] = [
      { pubkey: extraAccountMetas, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: tokenState, isSigner: false, isWritable: false },
      { pubkey: transferApproval, isSigner: false, isWritable: true },
      { pubkey: complianceState, isSigner: false, isWritable: false },
      { pubkey: COMPLIANCE_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

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
    sender: PublicKey
  ): Promise<void> {
    const tokenState = this.getTokenStatePda(mint);
    const tokenStateAccount = await (this.tokenProgram.account as any).tokenState.fetch(
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
    complianceState: PublicKey
  ): Promise<RemainingAccount[]> {
    const approvalRemainingAccounts: RemainingAccount[] = [];
    const approvalSeen = new Set<string>();
    const pushApproval = (pubkey: PublicKey, isWritable = false) => {
      const key = pubkey.toBase58();
      if (approvalSeen.has(key)) return;
      approvalSeen.add(key);
      approvalRemainingAccounts.push({ pubkey, isSigner: false, isWritable });
    };

    const fidProgram = new Program(FidIdl as unknown as Idl, this.provider);
    const ctrProgram = new Program(CtrIdl as unknown as Idl, this.provider);
    const requiredTopics = new Set<string>();
    try {
      const ctr = await (ctrProgram.account as any).claimTopicsState.fetch(
        PublicKey.findProgramAddressSync(
          [Buffer.from("ctr_state"), mint.toBuffer()],
          CTR_PROGRAM_ID
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
        FID_PROGRAM_ID
      );
      const claimAccounts = await this.connection.getProgramAccounts(FID_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: CLAIM_ACCOUNT_DISCRIMINATOR.toString("base64"),
              encoding: "base64",
            },
          },
          { memcmp: { offset: 8, bytes: targetFid.toBase58() } },
        ],
      });
      const selectedTopics = new Set<string>();

      for (const { pubkey, account } of claimAccounts) {
        try {
          const claim = fidProgram.coder.accounts.decode("claimAccount", account.data);
          const claimTopic = claim.topic.toString();
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
          const [issuerEntry] = PublicKey.findProgramAddressSync(
            [Buffer.from("issuer_entry"), tirState.toBuffer(), issuerFid.toBuffer()],
            TIR_PROGRAM_ID
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

    const complianceProgram = new Program(ComplianceIdl as unknown as Idl, this.provider);
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
