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

describe("fracks-token phase 4 hardening", () => {
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
  const dailyLimitProgram = anchor.workspace.ModDailyLimit as Program<any>;
  const countryCapProgram = anchor.workspace.ModCountryCap as Program<any>;

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
  const findDailyLimitPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_daily_limit"), mint.toBuffer()], dailyLimitProgram.programId);
  const findDailyUsagePda = (module: PublicKey, wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("daily_usage"), module.toBuffer(), wallet.toBuffer()], dailyLimitProgram.programId);
  const findCountryCapPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_country_cap"), mint.toBuffer()], countryCapProgram.programId);
  const findCountryCountPda = (module: PublicKey, country: number) => {
    const countryLe = Buffer.alloc(2);
    countryLe.writeUInt16LE(country, 0);
    return PublicKey.findProgramAddressSync([Buffer.from("country_count"), module.toBuffer(), countryLe], countryCapProgram.programId);
  };
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

  const setupScenario = async (
    maxTransferAmount = 50,
    options: { skipExtraAccountMetas?: boolean } = {},
  ) => {
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
    const [dailyLimitState] = findDailyLimitPda(tokenMint);
    const [senderDailyUsage] = findDailyUsagePda(dailyLimitState, sender.publicKey);
    const [countryCapState] = findCountryCapPda(tokenMint);
    const [senderCountryCount] = findCountryCountPda(countryCapState, 840);
    const [receiverCountryCount] = findCountryCountPda(countryCapState, 826);
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

    await complianceProgram.methods.bindModule(maxTransferState).accounts({
      owner: owner.publicKey,
      complianceState,
    }).signers([owner]).rpc();

    if (!options.skipExtraAccountMetas) {
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
      ]).signers([owner]).rpc();
    }

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
      dailyLimitState,
      senderDailyUsage,
      countryCapState,
      senderCountryCount,
      receiverCountryCount,
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
      extraAccountMetas: s.extraAccountMetas,
      hookProgram: tokenHookProgram.programId,
      transferApproval,
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
    splitTransactions = false,
  ) => {
    const approveIx = await tokenProgram.methods.transfer(new BN(amount), new BN(fromBalance), new BN(toBalance)).accounts(
      transferAccounts(s, toWallet, toWalletIdentity, destinationTokenAccount, toFrozen, fromPartialFreeze),
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
    if (splitTransactions) {
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(approveIx), [s.sender]);
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(transferIx), [s.sender]);
      return;
    }

    await provider.sendAndConfirm(new anchor.web3.Transaction().add(approveIx, transferIx), [s.sender]);
  };

  it("derives verification and compliance from on-chain accounts instead of caller-provided flags", async () => {
    const s = await setupScenario();

    await tokenProgram.methods.transfer(new BN(60), new BN(100), new BN(0)).accounts(
      transferAccounts(s, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount),
    ).remainingAccounts([
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
    ]).signers([s.sender]).rpc().then(
      () => expect.fail("expected compliance failure"),
      (error: any) => {
        const details = parseError(error);
        expect(`${details.code ?? ""} ${details.message}`.trim()).to.match(
          /ComplianceCheckFailed|Compliance check failed|custom program error/i,
        );
      },
    );

    await sendAuthorizedTransfer(s, 40, 100, 0, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount, [
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
    ], transferHookRemaining(s, [s.maxTransferState]));

    await tokenProgram.methods.transfer(new BN(10), new BN(60), new BN(0)).accounts(
      transferAccounts(s, s.unverified.publicKey, s.unverifiedIdentity, s.unverifiedTokenAccount),
    ).remainingAccounts([
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
    ]).signers([s.sender]).rpc().then(
      () => expect.fail("expected verification failure"),
      (error: any) => {
        const details = parseError(error);
        expect(`${details.code ?? ""} ${details.message}`.trim()).to.match(
          /WalletNotVerified|Wallet is not verified|custom program error/i,
        );
      },
    );
  });

  it("uses the stored partial freeze amount and blocks minting while paused", async () => {
    const s = await setupScenario(200);

    await tokenProgram.methods.freezePartial(new BN(30)).accounts({
      agent: s.agent.publicKey,
      tokenState: s.tokenState,
      agentRole: s.agentRole,
      wallet: s.sender.publicKey,
      partialFreeze: s.partialFreeze,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([s.agent]).rpc();

    await tokenProgram.methods.transfer(new BN(80), new BN(100), new BN(0)).accounts(
      transferAccounts(s, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount, empty, s.partialFreeze),
    ).remainingAccounts([
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
    ]).signers([s.sender]).rpc().then(
      () => expect.fail("expected unfrozen-balance failure"),
      (error: any) => {
        const details = parseError(error);
        expect(`${details.code ?? ""} ${details.message}`.trim()).to.match(
          /InsufficientBalance|Insufficient transferable balance|custom program error/i,
        );
      },
    );

    await sendAuthorizedTransfer(s, 70, 100, 0, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount, [
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
    ], transferHookRemaining(s, [s.maxTransferState]), empty, s.partialFreeze);

    await tokenProgram.methods.pause().accounts({
      owner: s.owner.publicKey,
      tokenState: s.tokenState,
      ownerState: s.ownerState,
    }).signers([s.owner]).rpc();

    await tokenProgram.methods.mint(s.receiver.publicKey, new BN(25), new BN(25)).accounts({
      agent: s.agent.publicKey,
      tokenState: s.tokenState,
      agentRole: s.agentRole,
      irpState: s.irpState,
      irsState: s.irsState,
      tirState: s.tirState,
      ctrState: s.ctrState,
      complianceState: s.complianceState,
      complianceProgram: complianceProgram.programId,
      walletIdentity: s.receiverIdentity,
      toFrozen: empty,
      tokenMintAccount: s.tokenMint,
      destinationTokenAccount: s.receiverTokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).remainingAccounts([
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
    ]).signers([s.agent]).rpc().then(
      () => expect.fail("expected paused mint failure"),
      (error: any) => {
        const details = parseError(error);
        expect(`${details.code ?? ""} ${details.message}`.trim()).to.match(
          /TokenPaused|Token is paused|custom program error/i,
        );
      },
    );
  });

  it("supports owner controls and wallet freeze lifecycle", async () => {
    const s = await setupScenario(200);
    const newRegistry = anchor.web3.Keypair.generate().publicKey;
    const newCompliance = anchor.web3.Keypair.generate().publicKey;
    const pendingOwner = anchor.web3.Keypair.generate();
    const [receiverFrozen] = findFrozenWalletPda(s.tokenMint, s.receiver.publicKey);

    await airdrop(pendingOwner.publicKey);

    await tokenProgram.methods.setIdentityRegistry(newRegistry).accounts({
      owner: s.owner.publicKey,
      tokenState: s.tokenState,
      ownerState: s.ownerState,
    }).signers([s.owner]).rpc();

    await tokenProgram.methods.setCompliance(newCompliance).accounts({
      owner: s.owner.publicKey,
      tokenState: s.tokenState,
      ownerState: s.ownerState,
    }).signers([s.owner]).rpc();

    let tokenState = await tokenProgram.account.tokenState.fetch(s.tokenState);
    expect(tokenState.identityRegistry.toBase58()).to.equal(newRegistry.toBase58());
    expect(tokenState.compliance.toBase58()).to.equal(newCompliance.toBase58());

    await tokenProgram.methods.setIdentityRegistry(s.irpState).accounts({
      owner: s.owner.publicKey,
      tokenState: s.tokenState,
      ownerState: s.ownerState,
    }).signers([s.owner]).rpc();

    await tokenProgram.methods.setCompliance(s.complianceState).accounts({
      owner: s.owner.publicKey,
      tokenState: s.tokenState,
      ownerState: s.ownerState,
    }).signers([s.owner]).rpc();

    await tokenProgram.methods.transferOwnership(pendingOwner.publicKey).accounts({
      owner: s.owner.publicKey,
      tokenState: s.tokenState,
      ownerState: s.ownerState,
    }).signers([s.owner]).rpc();

    await tokenProgram.methods.acceptOwnership().accounts({
      pendingOwner: pendingOwner.publicKey,
      ownerState: s.ownerState,
    }).signers([pendingOwner]).rpc();

    const ownerState = await tokenProgram.account.ownerState.fetch(s.ownerState);
    expect(ownerState.owner.toBase58()).to.equal(pendingOwner.publicKey.toBase58());

    await tokenProgram.methods.freezeWallet().accounts({
      agent: s.agent.publicKey,
      tokenState: s.tokenState,
      agentRole: s.agentRole,
      wallet: s.receiver.publicKey,
      frozenWallet: receiverFrozen,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([s.agent]).rpc();

    await tokenProgram.methods.transfer(new BN(10), new BN(100), new BN(0)).accounts(
      transferAccounts(s, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount, receiverFrozen),
    ).remainingAccounts([
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
    ]).signers([s.sender]).rpc().then(
      () => expect.fail("expected frozen-wallet failure"),
      (error: any) => {
        const details = parseError(error);
        expect(`${details.code ?? ""} ${details.message}`.trim()).to.match(
          /WalletFrozen|Wallet is frozen|custom program error/i,
        );
      },
    );

    await tokenProgram.methods.unfreezeWallet().accounts({
      agent: s.agent.publicKey,
      tokenState: s.tokenState,
      agentRole: s.agentRole,
      frozenWallet: receiverFrozen,
    }).signers([s.agent]).rpc();

    await sendAuthorizedTransfer(s, 10, 100, 0, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount, [
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
    ], transferHookRemaining(s, [s.maxTransferState]));
  });

  it("maintains daily-limit and country-cap support accounts through the canonical Token-2022 hook", async () => {
    const s = await setupScenario(200, { skipExtraAccountMetas: true });

    await dailyLimitProgram.methods.initializeModule(s.tokenMint, new BN(30)).accounts({
      owner: s.owner.publicKey,
      moduleState: s.dailyLimitState,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([s.owner]).rpc();

    await dailyLimitProgram.methods.initializeWalletUsage(s.sender.publicKey).accounts({
      owner: s.owner.publicKey,
      moduleState: s.dailyLimitState,
      walletUsage: s.senderDailyUsage,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([s.owner]).rpc();

    await dailyLimitProgram.methods.setHookAuthority(s.complianceState).accounts({
      owner: s.owner.publicKey,
      moduleState: s.dailyLimitState,
    }).signers([s.owner]).rpc();

    await countryCapProgram.methods.initializeModule(s.tokenMint, [{ country: 826, cap: new BN(2) }]).accounts({
      owner: s.owner.publicKey,
      moduleState: s.countryCapState,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([s.owner]).rpc();

    for (const [country, countryCount] of [[840, s.senderCountryCount], [826, s.receiverCountryCount]] as const) {
      await countryCapProgram.methods.initializeCountryCount(country).accounts({
        owner: s.owner.publicKey,
        moduleState: s.countryCapState,
        countryCount,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([s.owner]).rpc();
    }

    await countryCapProgram.methods.setHookAuthority(s.complianceState).accounts({
      owner: s.owner.publicKey,
      moduleState: s.countryCapState,
    }).signers([s.owner]).rpc();

    for (const moduleState of [s.dailyLimitState, s.countryCapState]) {
      await complianceProgram.methods.bindModule(moduleState).accounts({
        owner: s.owner.publicKey,
        complianceState: s.complianceState,
      }).signers([s.owner]).rpc();
    }

    await tokenHookProgram.methods.initializeExtraAccountMetas().accounts({
      payer: s.owner.publicKey,
      tokenState: s.tokenState,
      ownerState: s.ownerState,
      complianceState: s.complianceState,
      tokenMintAccount: s.tokenMint,
      extraAccountMetas: s.extraAccountMetas,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).remainingAccounts([
      { pubkey: s.maxTransferState, isSigner: false, isWritable: false },
      { pubkey: s.dailyLimitState, isSigner: false, isWritable: false },
      { pubkey: s.countryCapState, isSigner: false, isWritable: false },
    ]).signers([s.owner]).rpc();

    const dailyCountryHookRemaining = [
      { pubkey: s.complianceState, isSigner: false, isWritable: false },
      { pubkey: complianceProgram.programId, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
      { pubkey: s.dailyLimitState, isSigner: false, isWritable: true },
      { pubkey: dailyLimitProgram.programId, isSigner: false, isWritable: false },
      { pubkey: s.senderDailyUsage, isSigner: false, isWritable: true },
      { pubkey: s.countryCapState, isSigner: false, isWritable: true },
      { pubkey: countryCapProgram.programId, isSigner: false, isWritable: false },
      { pubkey: s.senderCountryCount, isSigner: false, isWritable: true },
      { pubkey: s.receiverCountryCount, isSigner: false, isWritable: true },
    ];

    await sendAuthorizedTransfer(s, 25, 100, 0, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount, [
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
      { pubkey: s.dailyLimitState, isSigner: false, isWritable: true },
      { pubkey: s.senderDailyUsage, isSigner: false, isWritable: true },
      { pubkey: s.countryCapState, isSigner: false, isWritable: true },
      { pubkey: s.receiverCountryCount, isSigner: false, isWritable: true },
    ], dailyCountryHookRemaining, empty, empty, s.extraAccountMetas, true);

    const usage = await dailyLimitProgram.account.dailyWalletUsage.fetch(s.senderDailyUsage);
    expect(usage.volume.toNumber()).to.equal(25);

    const receiverCount = await countryCapProgram.account.countryInvestorCount.fetch(s.receiverCountryCount);
    expect(receiverCount.count.toNumber()).to.equal(1);

    await tokenProgram.methods.transfer(new BN(10), new BN(75), new BN(25)).accounts(
      transferAccounts(s, s.receiver.publicKey, s.receiverIdentity, s.receiverTokenAccount),
    ).remainingAccounts([
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
      { pubkey: s.dailyLimitState, isSigner: false, isWritable: true },
      { pubkey: s.senderDailyUsage, isSigner: false, isWritable: true },
      { pubkey: s.countryCapState, isSigner: false, isWritable: true },
      { pubkey: s.receiverCountryCount, isSigner: false, isWritable: true },
    ]).signers([s.sender]).rpc().then(
      () => expect.fail("expected daily-limit failure"),
      (error: any) => {
        const details = parseError(error);
        expect(`${details.code ?? ""} ${details.message}`.trim()).to.match(
          /ComplianceCheckFailed|Compliance check failed|custom program error/i,
        );
      },
    );
  });

  it("supports burn, forced transfer, and recovery agent flows", async () => {
    const s = await setupScenario(200);

    await tokenProgram.methods.burn(s.sender.publicKey, new BN(10), new BN(90)).accounts({
      agent: s.agent.publicKey,
      tokenState: s.tokenState,
      agentRole: s.agentRole,
      complianceState: s.complianceState,
      complianceProgram: complianceProgram.programId,
      irsState: s.irsState,
      fromWalletIdentity: s.senderIdentity,
      tokenMintAccount: s.tokenMint,
      sourceTokenAccount: s.senderTokenAccount,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).remainingAccounts([
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
    ]).signers([s.agent]).rpc();

    await tokenProgram.methods.freezePartial(new BN(20)).accounts({
      agent: s.agent.publicKey,
      tokenState: s.tokenState,
      agentRole: s.agentRole,
      wallet: s.sender.publicKey,
      partialFreeze: s.partialFreeze,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([s.agent]).rpc();

    await tokenProgram.methods.forcedTransfer(
      s.sender.publicKey,
      s.receiver.publicKey,
      new BN(10),
      new BN(90),
      new BN(0),
    ).accounts({
      agent: s.agent.publicKey,
      tokenState: s.tokenState,
      agentRole: s.agentRole,
      irpState: s.irpState,
      irsState: s.irsState,
      tirState: s.tirState,
      ctrState: s.ctrState,
      complianceState: s.complianceState,
      complianceProgram: complianceProgram.programId,
      fromWalletIdentity: s.senderIdentity,
      toWalletIdentity: s.receiverIdentity,
      toFrozen: empty,
      fromPartialFreeze: s.partialFreeze,
      tokenMintAccount: s.tokenMint,
      sourceTokenAccount: s.senderTokenAccount,
      destinationTokenAccount: s.receiverTokenAccount,
      extraAccountMetas: s.extraAccountMetas,
      controllerProgram: tokenProgram.programId,
      hookProgram: tokenHookProgram.programId,
      transferApproval: findTransferApprovalPda(s.senderTokenAccount, s.receiverTokenAccount, s.tokenState)[0],
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).remainingAccounts([
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
    ]).signers([s.agent]).rpc();

    const partialFreeze = await tokenProgram.account.partialFreeze.fetch(s.partialFreeze);
    expect(partialFreeze.frozenAmount.toNumber()).to.equal(10);

    await tokenProgram.methods.recovery(s.sender.publicKey, s.receiver.publicKey, new BN(15)).accounts({
      agent: s.agent.publicKey,
      tokenState: s.tokenState,
      agentRole: s.agentRole,
      irpState: s.irpState,
      irsState: s.irsState,
      tirState: s.tirState,
      ctrState: s.ctrState,
      newWalletIdentity: s.receiverIdentity,
      lostWalletIdentity: s.senderIdentity,
      complianceState: s.complianceState,
      complianceProgram: complianceProgram.programId,
      newWalletFrozen: empty,
      irsProgram: irsProgram.programId,
      tokenMintAccount: s.tokenMint,
      lostTokenAccount: s.senderTokenAccount,
      newTokenAccount: s.receiverTokenAccount,
      extraAccountMetas: s.extraAccountMetas,
      controllerProgram: tokenProgram.programId,
      hookProgram: tokenHookProgram.programId,
      transferApproval: findTransferApprovalPda(s.senderTokenAccount, s.receiverTokenAccount, s.tokenState)[0],
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    }).remainingAccounts([
      { pubkey: s.claim, isSigner: false, isWritable: false },
      { pubkey: s.issuerEntry, isSigner: false, isWritable: false },
      { pubkey: s.issuerFid, isSigner: false, isWritable: false },
      { pubkey: s.maxTransferState, isSigner: false, isWritable: true },
    ]).signers([s.agent]).rpc();

    await tokenProgram.methods.finalizeRecovery(s.sender.publicKey, s.receiver.publicKey, new BN(15)).accounts({
      agent: s.agent.publicKey,
      tokenState: s.tokenState,
      agentRole: s.agentRole,
      irsState: s.irsState,
      irpState: s.irpState,
      newWalletIdentity: s.receiverIdentity,
      lostWalletIdentity: s.senderIdentity,
      transferApproval: findTransferApprovalPda(s.senderTokenAccount, s.receiverTokenAccount, s.tokenState)[0],
      irsProgram: irsProgram.programId,
    }).signers([s.agent]).rpc();

    const remappedIdentity = await irsProgram.account.walletIdentity.fetch(s.receiverIdentity);
    expect(remappedIdentity.fid.toBase58()).to.equal(s.senderFid.toBase58());
    expect(remappedIdentity.country).to.equal(840);

    const removedIdentity = await provider.connection.getAccountInfo(s.senderIdentity);
    expect(removedIdentity).to.equal(null);
  });
});
