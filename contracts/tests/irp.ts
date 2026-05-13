import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import nacl from "tweetnacl";
import { createHash } from "crypto";
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";

describe("fracks-irp phase 3", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const BN = (anchor as any).BN ?? (anchor as any).default?.BN;

  const fidProgram = anchor.workspace.FracksFid as Program<any>;
  const irsProgram = anchor.workspace.FracksIrs as Program<any>;
  const tirProgram = anchor.workspace.FracksTir as Program<any>;
  const ctrProgram = anchor.workspace.FracksCtr as Program<any>;
  const irpProgram = anchor.workspace.FracksIrp as Program<any>;

  const findFidPda = (wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("fid"), wallet.toBuffer()], fidProgram.programId);

  const findClaimPda = (fid: PublicKey, claimId: number) => {
    const claimIdLe = Buffer.alloc(4);
    claimIdLe.writeUInt32LE(claimId, 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), fid.toBuffer(), claimIdLe],
      fidProgram.programId,
    );
  };

  const findIrsPda = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("irs_state"), owner.toBuffer()], irsProgram.programId);

  const findWalletIdentityPda = (irs: PublicKey, wallet: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("wallet_identity"), irs.toBuffer(), wallet.toBuffer()],
      irsProgram.programId,
    );

  const findTirPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("tir_state"), mint.toBuffer()], tirProgram.programId);

  const findIssuerEntryPda = (tir: PublicKey, issuerFid: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("issuer_entry"), tir.toBuffer(), issuerFid.toBuffer()],
      tirProgram.programId,
    );

  const findCtrPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("ctr_state"), mint.toBuffer()], ctrProgram.programId);

  const findIrpPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("irp_state"), mint.toBuffer()], irpProgram.programId);

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

  const airdrop = async (pubkey: PublicKey) => {
    const sig = await provider.connection.requestAirdrop(pubkey, 3 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  const setupScenario = async (expiresAtTs?: number) => {
    const owner = anchor.web3.Keypair.generate();
    const issuer = anchor.web3.Keypair.generate();
    const investor = anchor.web3.Keypair.generate();
    const tokenMint = anchor.web3.Keypair.generate().publicKey;
    const issuerSigner = nacl.sign.keyPair();

    for (const wallet of [owner.publicKey, issuer.publicKey, investor.publicKey]) {
      await airdrop(wallet);
    }

    const [issuerFid] = findFidPda(issuer.publicKey);
    const [investorFid] = findFidPda(investor.publicKey);
    const [irsState] = findIrsPda(owner.publicKey);
    const [tirState] = findTirPda(tokenMint);
    const [ctrState] = findCtrPda(tokenMint);
    const [registryState] = findIrpPda(tokenMint);
    const [walletIdentity] = findWalletIdentityPda(irsState, investor.publicKey);
    const [issuerEntry] = findIssuerEntryPda(tirState, issuerFid);

    await fidProgram.methods
      .createFid(true, 0)
      .accounts({ owner: issuer.publicKey, fid: issuerFid, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([issuer])
      .rpc();

    await fidProgram.methods
      .setSignerKey(new PublicKey(issuerSigner.publicKey))
      .accounts({ authority: issuer.publicKey, fid: issuerFid })
      .signers([issuer])
      .rpc();

    await fidProgram.methods
      .createFid(false, 840)
      .accounts({ owner: investor.publicKey, fid: investorFid, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([investor])
      .rpc();

    await irsProgram.methods
      .initializeIrs()
      .accounts({ owner: owner.publicKey, irsState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await tirProgram.methods
      .initializeTir(tokenMint)
      .accounts({ owner: owner.publicKey, tirState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await ctrProgram.methods
      .initializeCtr(tokenMint)
      .accounts({ owner: owner.publicKey, ctrState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await irpProgram.methods
      .initializeRegistry(tokenMint, irsState, tirState, ctrState)
      .accounts({ owner: owner.publicKey, registryState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await irsProgram.methods
      .bindRegistry(registryState)
      .accounts({ owner: owner.publicKey, irsState })
      .signers([owner])
      .rpc();

    await irsProgram.methods
      .registerIdentity(investor.publicKey, investorFid, 840)
      .accounts({
        authority: owner.publicKey,
        irsState,
        registryState: anchor.web3.SystemProgram.programId,
        walletIdentity,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    await ctrProgram.methods
      .addClaimTopic(new BN(1))
      .accounts({ owner: owner.publicKey, ctrState })
      .signers([owner])
      .rpc();

    await tirProgram.methods
      .addTrustedIssuer(issuerFid, [new BN(1)], "kyc")
      .accounts({
        owner: owner.publicKey,
        tirState,
        issuerEntry,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const topic = new BN(1);
    const expiresAt = new BN(expiresAtTs ?? Math.floor(Date.now() / 1000) + 3600);
    const dataHash = createHash("sha256").update("phase-3-kyc").digest();
    const message = claimMessage(issuerFid, investorFid, topic, dataHash, expiresAt);
    const signature = nacl.sign.detached(message, issuerSigner.secretKey);
    const [claim] = findClaimPda(investorFid, 0);
    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: issuerSigner.publicKey,
      message,
      signature,
    });

    await fidProgram.methods
      .addClaim(topic, [...dataHash], [...signature], expiresAt)
      .accounts({
        issuerOwner: issuer.publicKey,
        issuerFid,
        targetFid: investorFid,
        claim,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .preInstructions([ed25519Ix])
      .signers([issuer])
      .rpc();

    return {
      owner,
      issuer,
      investor,
      issuerSigner,
      issuerFid,
      investorFid,
      irsState,
      tirState,
      ctrState,
      registryState,
      walletIdentity,
      issuerEntry,
      claim,
    };
  };

  const isVerified = async (scenario: any, remainingAccounts: { pubkey: PublicKey; isWritable?: boolean }[]) =>
    irpProgram.methods
      .isVerified(scenario.investor.publicKey)
      .accounts({
        registryState: scenario.registryState,
        irsState: scenario.irsState,
        tirState: scenario.tirState,
        ctrState: scenario.ctrState,
        walletIdentity: scenario.walletIdentity,
      })
      .remainingAccounts(
        remainingAccounts.map((account) => ({
          pubkey: account.pubkey,
          isSigner: false,
          isWritable: account.isWritable ?? false,
        })),
      )
      .view();

  it("returns true when every required claim path is valid", async () => {
    const scenario = await setupScenario();
    const verified = await isVerified(scenario, [
      { pubkey: scenario.claim },
      { pubkey: scenario.issuerEntry },
      { pubkey: scenario.issuerFid },
    ]);
    expect(verified).to.equal(true);
  });

  it("returns false when the required claim is missing", async () => {
    const scenario = await setupScenario();
    const verified = await isVerified(scenario, [
      { pubkey: scenario.issuerEntry },
      { pubkey: scenario.issuerFid },
    ]);
    expect(verified).to.equal(false);
  });

  it("returns false for revoked, expired, and inactive claims", async () => {
    const revoked = await setupScenario();
    await fidProgram.methods
      .revokeClaim()
      .accounts({ issuerOwner: revoked.issuer.publicKey, issuerFid: revoked.issuerFid, claim: revoked.claim })
      .signers([revoked.issuer])
      .rpc();
    expect(
      await isVerified(revoked, [
        { pubkey: revoked.claim },
        { pubkey: revoked.issuerEntry },
        { pubkey: revoked.issuerFid },
      ]),
    ).to.equal(false);

    const expired = await setupScenario(Math.floor(Date.now() / 1000) - 60);
    expect(
      await isVerified(expired, [
        { pubkey: expired.claim },
        { pubkey: expired.issuerEntry },
        { pubkey: expired.issuerFid },
      ]),
    ).to.equal(false);

    const inactive = await setupScenario();
    await tirProgram.methods
      .deactivateIssuer()
      .accounts({ owner: inactive.owner.publicKey, tirState: inactive.tirState, issuerEntry: inactive.issuerEntry })
      .signers([inactive.owner])
      .rpc();
    expect(
      await isVerified(inactive, [
        { pubkey: inactive.claim },
        { pubkey: inactive.issuerEntry },
        { pubkey: inactive.issuerFid },
      ]),
    ).to.equal(false);
  });

  it("returns false after the issuer rotates away from the signing key used on the claim", async () => {
    const scenario = await setupScenario();
    const replacementSigner = nacl.sign.keyPair();

    await fidProgram.methods
      .setSignerKey(new PublicKey(replacementSigner.publicKey))
      .accounts({ authority: scenario.issuer.publicKey, fid: scenario.issuerFid })
      .signers([scenario.issuer])
      .rpc();

    const verified = await isVerified(scenario, [
      { pubkey: scenario.claim },
      { pubkey: scenario.issuerEntry },
      { pubkey: scenario.issuerFid },
    ]);
    expect(verified).to.equal(false);
  });

  it("returns false when the issuer is trusted but not for the required topic", async () => {
    const scenario = await setupScenario();

    await ctrProgram.methods
      .addClaimTopic(new BN(2))
      .accounts({ owner: scenario.owner.publicKey, ctrState: scenario.ctrState })
      .signers([scenario.owner])
      .rpc();

    const verified = await isVerified(scenario, [
      { pubkey: scenario.claim },
      { pubkey: scenario.issuerEntry },
      { pubkey: scenario.issuerFid },
    ]);
    expect(verified).to.equal(false);
  });
});
