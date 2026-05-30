import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import nacl from "tweetnacl";
import { createHash } from "crypto";
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferHookInstruction,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from "@solana/spl-token";

describe("fracks-token-hook red team", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const BN = (anchor as any).BN ?? (anchor as any).default?.BN;

  const fidProgram = anchor.workspace.FracksFid as Program<any>;
  const irsProgram = anchor.workspace.FracksIrs as Program<any>;
  const tirProgram = anchor.workspace.FracksTir as Program<any>;
  const ctrProgram = anchor.workspace.FracksCtr as Program<any>;
  const irpProgram = anchor.workspace.FracksIrp as Program<any>;
  const complianceProgram = anchor.workspace.FracksCompliance as Program<any>;
  const tokenProgram = anchor.workspace.FracksToken as Program<any>;
  const tokenHookProgram = anchor.workspace.FracksTokenHook as Program<any>;
  const maxTransferProgram = anchor.workspace.ModMaxTransfer as Program<any>;
  const maxBalanceProgram = anchor.workspace.ModMaxBalance as Program<any>;

  const airdrop = async (pubkey: PublicKey) => {
    const sig = await provider.connection.requestAirdrop(pubkey, 4 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  const parseError = (error: any) => {
    const anchorError = error?.error ?? error;
    return {
      code: anchorError?.errorCode?.code ?? anchorError?.errorCode?.errorCode ?? anchorError?.errorName,
      number: anchorError?.errorCode?.number ?? anchorError?.errorNumber,
      logs: error?.logs ?? anchorError?.logs ?? [],
      message: error?.message ?? anchorError?.errorMessage ?? String(error),
    };
  };

  const expectFailure = async (promise: Promise<any>, pattern: RegExp, label: string) => {
    try {
      await promise;
      expect.fail(`expected failure: ${label}`);
    } catch (error: any) {
      const details = parseError(error);
      expect(`${details.code ?? ""} ${details.message}`.trim()).to.match(pattern);
    }
  };

  const findFidPda = (wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("fid"), wallet.toBuffer()], fidProgram.programId);
  const findClaimPda = (fid: PublicKey, claimId: number) => {
    const claimIdLe = Buffer.alloc(4);
    claimIdLe.writeUInt32LE(claimId, 0);
    return PublicKey.findProgramAddressSync([Buffer.from("claim"), fid.toBuffer(), claimIdLe], fidProgram.programId);
  };
  const findIrsPda = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("irs_state"), owner.toBuffer()], irsProgram.programId);
  const findWalletIdentityPda = (irs: PublicKey, wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("wallet_identity"), irs.toBuffer(), wallet.toBuffer()], irsProgram.programId);
  const findTirPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("tir_state"), mint.toBuffer()], tirProgram.programId);
  const findIssuerEntryPda = (tir: PublicKey, issuerFid: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("issuer_entry"), tir.toBuffer(), issuerFid.toBuffer()], tirProgram.programId);
  const findCtrPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("ctr_state"), mint.toBuffer()], ctrProgram.programId);
  const findIrpPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("irp_state"), mint.toBuffer()], irpProgram.programId);
  const findCompliancePda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("compliance_state"), mint.toBuffer()], complianceProgram.programId);
  const findTokenStatePda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("token_state"), mint.toBuffer()], tokenProgram.programId);
  const findOwnerStatePda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("owner"), mint.toBuffer()], tokenProgram.programId);
  const findAgentRolePda = (mint: PublicKey, agent: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("agent"), mint.toBuffer(), agent.toBuffer()], tokenProgram.programId);
  const findFrozenWalletPda = (mint: PublicKey, wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("frozen"), mint.toBuffer(), wallet.toBuffer()], tokenProgram.programId);
  const findPartialFreezePda = (mint: PublicKey, wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("partial_freeze"), mint.toBuffer(), wallet.toBuffer()], tokenProgram.programId);
  const findMaxTransferPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_max_transfer"), mint.toBuffer()], maxTransferProgram.programId);
  const findMaxBalancePda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_max_balance"), mint.toBuffer()], maxBalanceProgram.programId);
  const findExtraAccountMetasPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("extra-account-metas"), mint.toBuffer()], tokenHookProgram.programId);
  const findTransferApprovalPda = (source: PublicKey, destination: PublicKey, authority: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("transfer_approval"), source.toBuffer(), destination.toBuffer(), authority.toBuffer()],
      tokenHookProgram.programId,
    );

  const claimMessage = (
    issuerFid: PublicKey,
    holderFid: PublicKey,
    topic: any,
    dataHash: Uint8Array,
    expiresAt: any,
  ) =>
    createHash("sha256")
      .update(
        Buffer.concat([
          issuerFid.toBuffer(),
          holderFid.toBuffer(),
          topic.toArrayLike(Buffer, "le", 8),
          Buffer.from(dataHash),
          expiresAt.toArrayLike(Buffer, "le", 8),
        ]),
      )
      .digest();

  const createToken2022Mint = async (
    mint: anchor.web3.Keypair,
    payer: anchor.web3.Keypair,
    mintAuthority: PublicKey,
    decimals = 6,
  ) => {
    const mintLen = getMintLen([ExtensionType.TransferHook, ExtensionType.PermanentDelegate]);
    const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mint.publicKey,
        payer.publicKey,
        tokenHookProgram.programId,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializePermanentDelegateInstruction(
        mint.publicKey,
        mintAuthority,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMintInstruction(
        mint.publicKey,
        decimals,
        mintAuthority,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await provider.sendAndConfirm(tx, [payer, mint]);
  };

  const createToken2022Ata = async (
    payer: anchor.web3.Keypair,
    mint: PublicKey,
    owner: PublicKey,
  ) => {
    const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
    const info = await provider.connection.getAccountInfo(ata);
    if (info === null) {
      await provider.sendAndConfirm(
        new anchor.web3.Transaction().add(
          createAssociatedTokenAccountInstruction(
            payer.publicKey,
            ata,
            owner,
            mint,
            TOKEN_2022_PROGRAM_ID,
          ),
        ),
        [payer],
      );
    }
    return ata;
  };

  const setupScenario = async (maxTransferAmount = 50, includeMaxBalance = false) => {
    const owner = anchor.web3.Keypair.generate();
    const agent = anchor.web3.Keypair.generate();
    const issuer = anchor.web3.Keypair.generate();
    const sender = anchor.web3.Keypair.generate();
    const receiver = anchor.web3.Keypair.generate();
    const unverified = anchor.web3.Keypair.generate();
    const tokenMintKeypair = anchor.web3.Keypair.generate();
    const tokenMint = tokenMintKeypair.publicKey;
    const issuerSigner = nacl.sign.keyPair();

    for (const wallet of [owner.publicKey, agent.publicKey, issuer.publicKey, sender.publicKey, receiver.publicKey, unverified.publicKey]) {
      await airdrop(wallet);
    }

    const [issuerFid] = findFidPda(issuer.publicKey);
    const [senderFid] = findFidPda(sender.publicKey);
    const [receiverFid] = findFidPda(receiver.publicKey);
    const [unverifiedFid] = findFidPda(unverified.publicKey);
    const [irsState] = findIrsPda(owner.publicKey);
    const [tirState] = findTirPda(tokenMint);
    const [ctrState] = findCtrPda(tokenMint);
    const [irpState] = findIrpPda(tokenMint);
    const [complianceState] = findCompliancePda(tokenMint);
    const [tokenState] = findTokenStatePda(tokenMint);
    const [ownerState] = findOwnerStatePda(tokenMint);
    const [agentRole] = findAgentRolePda(tokenMint, agent.publicKey);
    const [senderIdentity] = findWalletIdentityPda(irsState, sender.publicKey);
    const [receiverIdentity] = findWalletIdentityPda(irsState, receiver.publicKey);
    const [unverifiedIdentity] = findWalletIdentityPda(irsState, unverified.publicKey);
    const [issuerEntry] = findIssuerEntryPda(tirState, issuerFid);
    const [senderClaim] = findClaimPda(senderFid, 0);
    const [claim] = findClaimPda(receiverFid, 0);
    const [maxTransferState] = findMaxTransferPda(tokenMint);
    const [maxBalanceState] = findMaxBalancePda(tokenMint);
    const [partialFreeze] = findPartialFreezePda(tokenMint, sender.publicKey);
    const [extraAccountMetas] = findExtraAccountMetasPda(tokenMint);
    await createToken2022Mint(tokenMintKeypair, owner, tokenState);

    const senderTokenAccount = await createToken2022Ata(owner, tokenMint, sender.publicKey);
    const receiverTokenAccount = await createToken2022Ata(owner, tokenMint, receiver.publicKey);
    const unverifiedTokenAccount = await createToken2022Ata(owner, tokenMint, unverified.publicKey);

    await fidProgram.methods.createFid(true, 840).accounts({
      owner: issuer.publicKey,
      fid: issuerFid,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([issuer]).rpc();

    await fidProgram.methods.setSignerKey(new PublicKey(issuerSigner.publicKey)).accounts({
      authority: issuer.publicKey,
      fid: issuerFid,
    }).signers([issuer]).rpc();

    for (const [wallet, fid, country] of [
      [sender, senderFid, 840],
      [receiver, receiverFid, 826],
      [unverified, unverifiedFid, 356],
    ] as const) {
      await fidProgram.methods.createFid(false, country).accounts({
        owner: wallet.publicKey,
        fid,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([wallet]).rpc();
    }

    await irsProgram.methods.initializeIrs().accounts({
      owner: owner.publicKey,
      irsState,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([owner]).rpc();

    await tirProgram.methods.initializeTir(tokenMint).accounts({
      owner: owner.publicKey,
      tirState,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([owner]).rpc();

    await ctrProgram.methods.initializeCtr(tokenMint).accounts({
      owner: owner.publicKey,
      ctrState,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([owner]).rpc();

    await irpProgram.methods.initializeRegistry(tokenMint, irsState, tirState, ctrState).accounts({
      owner: owner.publicKey,
      registryState: irpState,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([owner]).rpc();

    await irpProgram.methods.addIdentityAgent(agent.publicKey).accounts({
      owner: owner.publicKey,
      registryState: irpState,
    }).signers([owner]).rpc();

    await irsProgram.methods.bindRegistry(irpState).accounts({
      owner: owner.publicKey,
      irsState,
    }).signers([owner]).rpc();

    await complianceProgram.methods.initializeCompliance(tokenMint).accounts({
      owner: owner.publicKey,
      complianceState,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([owner]).rpc();

    await tokenProgram.methods.initializeToken(tokenMint, "FRACKS Token", "FRK", 6, "US0000000001", irpState, complianceState).accounts({
      owner: owner.publicKey,
      tokenState,
      ownerState,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([owner]).rpc();

    await tokenProgram.methods.addAgent(agent.publicKey).accounts({
      owner: owner.publicKey,
      tokenState,
      ownerState,
      agentRole,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([owner]).rpc();

    await ctrProgram.methods.addClaimTopic(new BN(1)).accounts({
      owner: owner.publicKey,
      ctrState,
    }).signers([owner]).rpc();

    await tirProgram.methods.addTrustedIssuer(issuerFid, [new BN(1)], "Primary KYC").accounts({
      owner: owner.publicKey,
      tirState,
      issuerEntry,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([owner]).rpc();

    for (const [wallet, fid, country, identity] of [
      [sender.publicKey, senderFid, 840, senderIdentity],
      [receiver.publicKey, receiverFid, 826, receiverIdentity],
      [unverified.publicKey, unverifiedFid, 356, unverifiedIdentity],
    ] as const) {
      await irsProgram.methods.registerIdentity(wallet, fid, country).accounts({
        authority: owner.publicKey,
        irsState,
        registryState: anchor.web3.SystemProgram.programId,
        walletIdentity: identity,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([owner]).rpc();
    }

    const topic = new BN(1);
    const expiresAt = new BN(Math.floor(Date.now() / 1000) + 3600);
    const issueClaim = async (targetFid: PublicKey, claimPda: PublicKey, label: string) => {
      const dataHash = createHash("sha256").update(label).digest();
      const message = claimMessage(issuerFid, targetFid, topic, dataHash, expiresAt);
      const signature = nacl.sign.detached(message, issuerSigner.secretKey);
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: issuerSigner.publicKey,
        message,
        signature,
      });

      await fidProgram.methods.addClaim(topic, [...dataHash], [...signature], expiresAt).accounts({
        issuerOwner: issuer.publicKey,
        issuerFid,
        targetFid,
        claim: claimPda,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).preInstructions([ed25519Ix]).signers([issuer]).rpc();
    };

    await issueClaim(senderFid, senderClaim, "token-test-sender-kyc");
    await issueClaim(receiverFid, claim, "token-test-receiver-kyc");

    await maxTransferProgram.methods.initializeModule(tokenMint, new BN(maxTransferAmount)).accounts({
      owner: owner.publicKey,
      moduleState: maxTransferState,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([owner]).rpc();

    if (includeMaxBalance) {
      await maxBalanceProgram.methods.initializeModule(tokenMint, new BN(500)).accounts({
        owner: owner.publicKey,
        moduleState: maxBalanceState,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([owner]).rpc();
    }

    await complianceProgram.methods.bindModule(maxTransferState).accounts({
      owner: owner.publicKey,
      complianceState,
    }).signers([owner]).rpc();

    if (includeMaxBalance) {
      await complianceProgram.methods.bindModule(maxBalanceState).accounts({
        owner: owner.publicKey,
        complianceState,
      }).signers([owner]).rpc();
    }

    await tokenHookProgram.methods.initializeExtraAccountMetas().accounts({
      payer: owner.publicKey,
      tokenState,
      ownerState,
      complianceState,
      tokenMintAccount: tokenMint,
      extraAccountMetas,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).remainingAccounts([
      { pubkey: maxTransferState, isSigner: false, isWritable: false },
      ...(includeMaxBalance ? [{ pubkey: maxBalanceState, isSigner: false, isWritable: false }] : []),
    ]).signers([owner]).rpc();

    await tokenProgram.methods.mint(sender.publicKey, new BN(100), new BN(100)).accounts({
      agent: agent.publicKey,
      tokenState,
      agentRole,
      irpState,
      irsState,
      tirState,
      ctrState,
      complianceState,
      complianceProgram: complianceProgram.programId,
      walletIdentity: senderIdentity,
      toFrozen: empty,
      tokenMintAccount: tokenMint,
      destinationTokenAccount: senderTokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).remainingAccounts([
      { pubkey: senderClaim, isSigner: false, isWritable: false },
      { pubkey: issuerEntry, isSigner: false, isWritable: false },
      { pubkey: issuerFid, isSigner: false, isWritable: false },
      { pubkey: maxTransferState, isSigner: false, isWritable: false },
      ...(includeMaxBalance ? [{ pubkey: maxBalanceState, isSigner: false, isWritable: false }] : []),
    ]).signers([agent]).rpc();

    return {
      owner,
      agent,
      sender,
      receiver,
      unverified,
      tokenMint,
      irsState,
      tirState,
      ctrState,
      irpState,
      complianceState,
      tokenState,
      ownerState,
      agentRole,
      senderFid,
      senderClaim,
      senderIdentity,
      receiverIdentity,
      unverifiedIdentity,
      senderTokenAccount,
      receiverTokenAccount,
      unverifiedTokenAccount,
      extraAccountMetas,
      issuerFid,
      issuerEntry,
      claim,
      maxTransferState,
      maxBalanceState,
      partialFreeze,
    };
  };

  const empty = anchor.web3.SystemProgram.programId;
  const transferAccounts = (
    s: any,
    toWallet: PublicKey,
    toWalletIdentity: PublicKey,
    destinationTokenAccount: PublicKey,
    toFrozen: PublicKey = empty,
    fromPartialFreeze: PublicKey = empty,
    extraAccountMetas: PublicKey = s.extraAccountMetas,
    transferApprovalOverride?: PublicKey,
  ) => {
    const [transferApproval] = findTransferApprovalPda(
      s.senderTokenAccount,
      destinationTokenAccount,
      s.sender.publicKey,
    );
    return {
      tokenState: s.tokenState,
      sourceTokenAccount: s.senderTokenAccount,
      tokenMintAccount: s.tokenMint,
      destinationTokenAccount,
      fromWallet: s.sender.publicKey,
      toWallet,
      extraAccountMetas,
      hookProgram: tokenHookProgram.programId,
      transferApproval: transferApprovalOverride ?? transferApproval,
      systemProgram: anchor.web3.SystemProgram.programId,
      irpState: s.irpState,
      irsState: s.irsState,
      tirState: s.tirState,
      ctrState: s.ctrState,
      complianceState: s.complianceState,
      complianceProgram: complianceProgram.programId,
      fromWalletIdentity: s.senderIdentity,
      toWalletIdentity,
      fromFrozen: empty,
      toFrozen,
      fromPartialFreeze,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    };
  };

  const transferHookRemaining = (s: any, moduleAccounts: PublicKey[] = []) => [
    { pubkey: s.complianceState, isSigner: false, isWritable: false },
    { pubkey: complianceProgram.programId, isSigner: false, isWritable: false },
    ...moduleAccounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
  ];

  const sendAuthorizedTransfer = async (
    s: any,
    amount: number,
    fromBalance: number,
    toBalance: number,
    toWallet: PublicKey,
    toWalletIdentity: PublicKey,
    destinationTokenAccount: PublicKey,
    approvalRemaining: any[],
    hookRemaining: any[],
    toFrozen = empty,
    fromPartialFreeze = empty,
    extraAccountMetas: PublicKey = s.extraAccountMetas,
  ) => {
    const approveIx = await tokenProgram.methods.transfer(new BN(amount), new BN(fromBalance), new BN(toBalance)).accounts(
      transferAccounts(s, toWallet, toWalletIdentity, destinationTokenAccount, toFrozen, fromPartialFreeze, extraAccountMetas),
    ).remainingAccounts(approvalRemaining).instruction();
    const transferIx = createTransferCheckedInstruction(
      s.senderTokenAccount,
      s.tokenMint,
      destinationTokenAccount,
      s.sender.publicKey,
      BigInt(amount),
      6,
      [],
      TOKEN_2022_PROGRAM_ID,
    );
    const [transferApproval] = findTransferApprovalPda(
      s.senderTokenAccount,
      destinationTokenAccount,
      s.sender.publicKey,
    );
    const hookKeys = [
      { pubkey: extraAccountMetas, isSigner: false, isWritable: false },
      { pubkey: tokenProgram.programId, isSigner: false, isWritable: false },
      { pubkey: s.tokenState, isSigner: false, isWritable: false },
      { pubkey: transferApproval, isSigner: false, isWritable: true },
      ...hookRemaining,
      { pubkey: tokenHookProgram.programId, isSigner: false, isWritable: false },
    ];
    transferIx.keys = transferIx.keys.slice(0, 4);
    for (const meta of hookKeys) {
      if (!transferIx.keys.some((existing) => existing.pubkey.equals(meta.pubkey))) {
        transferIx.keys.push(meta);
      }
    }
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(approveIx, transferIx),
      [s.sender],
    );
  };

  it("rejects direct Token-2022 transfer without approval", async () => {
    const s = await setupScenario();

    const transferIx = createTransferCheckedInstruction(
      s.senderTokenAccount,
      s.tokenMint,
      s.receiverTokenAccount,
      s.sender.publicKey,
      BigInt(10),
      6,
      [],
      TOKEN_2022_PROGRAM_ID,
    );
    transferIx.keys = transferIx.keys.slice(0, 4);
    for (const meta of [
      { pubkey: s.extraAccountMetas, isSigner: false, isWritable: false },
      { pubkey: tokenProgram.programId, isSigner: false, isWritable: false },
      { pubkey: s.tokenState, isSigner: false, isWritable: false },
      { pubkey: findTransferApprovalPda(s.senderTokenAccount, s.receiverTokenAccount, s.sender.publicKey)[0], isSigner: false, isWritable: true },
      ...transferHookRemaining(s, [s.maxTransferState]),
      { pubkey: tokenHookProgram.programId, isSigner: false, isWritable: false },
    ]) {
      if (!transferIx.keys.some((existing) => existing.pubkey.equals(meta.pubkey))) {
        transferIx.keys.push(meta);
      }
    }

    await expectFailure(
      provider.sendAndConfirm(new anchor.web3.Transaction().add(transferIx), [s.sender]),
      /MissingTransferApproval|transfer approval|custom program error/i,
      "missing approval",
    );
  });

  it("rejects execute_transfer_hook outside a Token-2022 transfer", async () => {
    const s = await setupScenario();
    const [transferApproval] = findTransferApprovalPda(
      s.senderTokenAccount,
      s.receiverTokenAccount,
      s.sender.publicKey,
    );
    await tokenProgram.methods.transfer(new BN(1), new BN(100), new BN(0)).accounts(
      transferAccounts(s, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount),
    ).remainingAccounts([
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: false },
    ]).signers([s.sender]).rpc();

    await expectFailure(
      tokenHookProgram.methods.executeTransferHook(new BN(1)).accounts({
        sourceTokenAccount: s.senderTokenAccount,
        tokenMintAccount: s.tokenMint,
        destinationTokenAccount: s.receiverTokenAccount,
        authority: s.sender.publicKey,
        extraAccountMetas: s.extraAccountMetas,
        controllerProgram: tokenProgram.programId,
        tokenState: s.tokenState,
        transferApproval,
        complianceState: s.complianceState,
        complianceProgram: complianceProgram.programId,
      }).remainingAccounts([
        { pubkey: s.maxTransferState, isSigner: false, isWritable: false },
      ]).rpc(),
      /ProgramCalledOutsideTransfer|outside an active Token-2022 transfer|custom program error/i,
      "hook outside transfer",
    );
  });

  it("rejects malformed extra-account-metas", async () => {
    const s = await setupScenario();
    const other = await setupScenario();
    await tokenProgram.methods.transfer(new BN(1), new BN(100), new BN(0)).accounts(
      transferAccounts(s, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount),
    ).remainingAccounts([
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: false },
    ]).signers([s.sender]).rpc();

    await expectFailure(
      tokenHookProgram.methods.executeTransferHook(new BN(1)).accounts({
        sourceTokenAccount: s.senderTokenAccount,
        tokenMintAccount: s.tokenMint,
        destinationTokenAccount: s.receiverTokenAccount,
        authority: s.sender.publicKey,
        extraAccountMetas: other.extraAccountMetas,
        controllerProgram: tokenProgram.programId,
        tokenState: s.tokenState,
        transferApproval: findTransferApprovalPda(s.senderTokenAccount, s.receiverTokenAccount, s.sender.publicKey)[0],
        complianceState: s.complianceState,
        complianceProgram: complianceProgram.programId,
      }).remainingAccounts([
        { pubkey: s.maxTransferState, isSigner: false, isWritable: false },
      ]).rpc(),
      /InvalidExtraAccountMetas|extra-account-metas|custom program error/i,
      "malformed extra account metas",
    );
  });

  it("rejects replayed approvals after successful transfer", async () => {
    const s = await setupScenario();

    await sendAuthorizedTransfer(
      s,
      10,
      100,
      0,
      s.receiver.publicKey,
      s.receiverIdentity,
      s.receiverTokenAccount,
      [
        { pubkey: s.claim, isSigner: false, isWritable: false },
        { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
        { pubkey: s.issuerFid, isSigner: false, isWritable: false },
        { pubkey: s.maxTransferState, isSigner: false, isWritable: false },
      ],
      transferHookRemaining(s, [s.maxTransferState]),
    );

    const transferIx = createTransferCheckedInstruction(
      s.senderTokenAccount,
      s.tokenMint,
      s.receiverTokenAccount,
      s.sender.publicKey,
      BigInt(5),
      6,
      [],
      TOKEN_2022_PROGRAM_ID,
    );
    transferIx.keys = transferIx.keys.slice(0, 4);
    for (const meta of [
      { pubkey: s.extraAccountMetas, isSigner: false, isWritable: false },
      { pubkey: tokenProgram.programId, isSigner: false, isWritable: false },
      { pubkey: s.tokenState, isSigner: false, isWritable: false },
      { pubkey: findTransferApprovalPda(s.senderTokenAccount, s.receiverTokenAccount, s.sender.publicKey)[0], isSigner: false, isWritable: true },
      ...transferHookRemaining(s, [s.maxTransferState]),
      { pubkey: tokenHookProgram.programId, isSigner: false, isWritable: false },
    ]) {
      if (!transferIx.keys.some((existing) => existing.pubkey.equals(meta.pubkey))) {
        transferIx.keys.push(meta);
      }
    }

    await expectFailure(
      provider.sendAndConfirm(new anchor.web3.Transaction().add(transferIx), [s.sender]),
      /MissingTransferApproval|transfer approval|custom program error/i,
      "replayed approval",
    );
  });

  it("rejects fake compliance state", async () => {
    const s = await setupScenario();
    const fakeCompliance = anchor.web3.Keypair.generate().publicKey;

    await expectFailure(
      tokenProgram.methods.transfer(new BN(10), new BN(100), new BN(0)).accounts({
        ...transferAccounts(s, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount),
        complianceState: fakeCompliance,
      }).remainingAccounts([
        { pubkey: s.claim, isSigner: false, isWritable: false },
        { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
        { pubkey: s.issuerFid, isSigner: false, isWritable: false },
        { pubkey: s.maxTransferState, isSigner: false, isWritable: false },
      ]).signers([s.sender]).rpc(),
      /InvalidCompliance|InvalidRegistryReference|compliance|custom program error/i,
      "fake compliance state",
    );
  });

  it("rejects fake compliance module PDAs", async () => {
    const s = await setupScenario();
    const fakeModule = anchor.web3.Keypair.generate().publicKey;

    await expectFailure(
      tokenProgram.methods.transfer(new BN(10), new BN(100), new BN(0)).accounts(
        transferAccounts(s, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount),
      ).remainingAccounts([
        { pubkey: s.claim, isSigner: false, isWritable: false },
        { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
        { pubkey: s.issuerFid, isSigner: false, isWritable: false },
        { pubkey: fakeModule, isSigner: false, isWritable: false },
      ]).signers([s.sender]).rpc(),
      /InvalidComplianceModule|ComplianceCheckFailed|custom program error/i,
      "fake module PDA",
    );
  });

  it("keeps canonical hook resolution independent from reordered controller remaining accounts", async () => {
    const s = await setupScenario(50, true);

    await sendAuthorizedTransfer(
      s,
      10,
      100,
      0,
      s.receiver.publicKey,
      s.receiverIdentity,
      s.receiverTokenAccount,
      [
        { pubkey: s.claim, isSigner: false, isWritable: false },
        { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
        { pubkey: s.issuerFid, isSigner: false, isWritable: false },
        { pubkey: s.maxBalanceState, isSigner: false, isWritable: false },
        { pubkey: s.maxTransferState, isSigner: false, isWritable: false },
      ],
      transferHookRemaining(s, [s.maxTransferState, s.maxBalanceState]),
    );
  });

  it("rejects cross-mint transfer approvals", async () => {
    const s1 = await setupScenario();
    const s2 = await setupScenario();
    const [approvalFromMintOne] = findTransferApprovalPda(
      s1.senderTokenAccount,
      s1.receiverTokenAccount,
      s1.sender.publicKey,
    );

    await expectFailure(
      tokenProgram.methods.transfer(new BN(10), new BN(100), new BN(0)).accounts(
        transferAccounts(
          s2,
          s2.receiver.publicKey,
          s2.receiverIdentity,
          s2.receiverTokenAccount,
          empty,
          empty,
          s2.extraAccountMetas,
          approvalFromMintOne,
        ),
      ).remainingAccounts([
        { pubkey: s2.claim, isSigner: false, isWritable: false },
        { pubkey: s2.issuerEntry, isSigner: false, isWritable: false },
        { pubkey: s2.issuerFid, isSigner: false, isWritable: false },
        { pubkey: s2.maxTransferState, isSigner: false, isWritable: false },
      ]).signers([s2.sender]).rpc(),
      /MissingTransferApproval|InvalidTokenAccount|ConstraintSeeds|custom program error/i,
      "cross-mint approval",
    );
  });
});
