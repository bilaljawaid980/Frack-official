import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import nacl from "tweetnacl";
import { createHash } from "crypto";
import { Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";

import { FracksFid } from "../target/types/fracks_fid";

describe("fracks-fid phase 1", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FracksFid as Program<FracksFid>;
  const issuerSigner = nacl.sign.keyPair();

  const findFidPda = (wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("fid"), wallet.toBuffer()], program.programId);

  const findClaimPda = (fid: PublicKey, claimId: number) =>
    {
      const claimIdLe = Buffer.alloc(4);
      claimIdLe.writeUInt32LE(claimId, 0);
      return PublicKey.findProgramAddressSync(
        [Buffer.from("claim"), fid.toBuffer(), claimIdLe],
        program.programId,
      );
    };

  const claimMessage = (
    issuerFid: PublicKey,
    holderFid: PublicKey,
    topic: anchor.BN,
    dataHash: Uint8Array,
    expiresAt: anchor.BN,
  ) => {
    const payload = Buffer.concat([
      issuerFid.toBuffer(),
      holderFid.toBuffer(),
      topic.toArrayLike(Buffer, "le", 8),
      Buffer.from(dataHash),
      expiresAt.toArrayLike(Buffer, "le", 8),
    ]);

    return createHash("sha256").update(payload).digest();
  };

  const airdrop = async (pubkey: PublicKey) => {
    const signature = await provider.connection.requestAirdrop(
      pubkey,
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(signature, "confirmed");
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

  it("creates a FID at the expected PDA", async () => {
    const [fid] = findFidPda(provider.wallet.publicKey);

    await program.methods
      .createFid(false, 840)
      .accounts({
        owner: provider.wallet.publicKey,
        fid,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const account = await program.account.fidAccount.fetch(fid);
    expect(account.owner.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    expect(account.country).to.equal(840);
    expect(account.isIssuer).to.equal(false);
  });

  it("rejects a second FID for the same wallet", async () => {
    const [fid] = findFidPda(provider.wallet.publicKey);

    try {
      await program.methods
        .createFid(false, 840)
        .accounts({
          owner: provider.wallet.publicKey,
          fid,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("expected duplicate create_fid to fail");
    } catch (error: any) {
      const parsed = parseError(error);
      expect(parsed.code).to.equal("FidAlreadyExists");
      expect(parsed.number).to.equal(6012);
    }
  });

  it("adds a claim with a valid signature and rejects an invalid one", async () => {
    const issuer = anchor.web3.Keypair.generate();
    const investor = anchor.web3.Keypair.generate();

    for (const wallet of [issuer.publicKey, investor.publicKey]) {
      await airdrop(wallet);
    }

    const [issuerFid] = findFidPda(issuer.publicKey);
    const [investorFid] = findFidPda(investor.publicKey);

    await program.methods
      .createFid(true, 0)
      .accounts({
        owner: issuer.publicKey,
        fid: issuerFid,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([issuer])
      .rpc();

    await program.methods
      .setSignerKey(new PublicKey(issuerSigner.publicKey))
      .accounts({
        authority: issuer.publicKey,
        fid: issuerFid,
      })
      .signers([issuer])
      .rpc();

    await program.methods
      .createFid(false, 840)
      .accounts({
        owner: investor.publicKey,
        fid: investorFid,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([investor])
      .rpc();

    const topic = new anchor.BN(1);
    const expiresAt = new anchor.BN(Math.floor(Date.now() / 1000) + 86400);
    const dataHash = createHash("sha256").update("kyc-report").digest();
    const message = claimMessage(issuerFid, investorFid, topic, dataHash, expiresAt);
    const signature = nacl.sign.detached(message, issuerSigner.secretKey);
    const [claim] = findClaimPda(investorFid, 0);

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: issuerSigner.publicKey,
      message,
      signature,
    });

    await program.methods
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

    const claimAccount = await program.account.claimAccount.fetch(claim);
    expect(claimAccount.claimId).to.equal(0);
    expect(claimAccount.revoked).to.equal(false);

    const badSignature = Uint8Array.from(signature);
    badSignature[0] ^= 0xff;
    const [badClaim] = findClaimPda(investorFid, 1);

    try {
      await program.methods
        .addClaim(topic, [...dataHash], [...badSignature], expiresAt)
        .accounts({
          issuerOwner: issuer.publicKey,
          issuerFid,
          targetFid: investorFid,
          claim: badClaim,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .preInstructions([ed25519Ix])
        .signers([issuer])
        .rpc();
      expect.fail("expected invalid signature to fail");
    } catch (error: any) {
      const parsed = parseError(error);
      expect(parsed.code).to.equal("InvalidClaimSignature");
      expect(parsed.number).to.equal(6008);
    }
  });

  it("revokes claims and blocks non-issuer revocations", async () => {
    const issuer = anchor.web3.Keypair.generate();
    const investor = anchor.web3.Keypair.generate();
    const stranger = anchor.web3.Keypair.generate();
    const issuerEphemeralSigner = nacl.sign.keyPair();

    for (const wallet of [issuer.publicKey, investor.publicKey, stranger.publicKey]) {
      await airdrop(wallet);
    }

    const [issuerFid] = findFidPda(issuer.publicKey);
    const [investorFid] = findFidPda(investor.publicKey);

    await program.methods
      .createFid(true, 0)
      .accounts({
        owner: issuer.publicKey,
        fid: issuerFid,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([issuer])
      .rpc();

    await program.methods
      .setSignerKey(new PublicKey(issuerEphemeralSigner.publicKey))
      .accounts({
        authority: issuer.publicKey,
        fid: issuerFid,
      })
      .signers([issuer])
      .rpc();

    await program.methods
      .createFid(false, 840)
      .accounts({
        owner: investor.publicKey,
        fid: investorFid,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([investor])
      .rpc();

    const topic = new anchor.BN(2);
    const expiresAt = new anchor.BN(Math.floor(Date.now() / 1000) + 86400);
    const dataHash = createHash("sha256").update("aml-report").digest();
    const message = claimMessage(issuerFid, investorFid, topic, dataHash, expiresAt);
    const signature = nacl.sign.detached(message, issuerEphemeralSigner.secretKey);
    const [claim] = findClaimPda(investorFid, 0);

    await program.methods
      .addClaim(topic, [...dataHash], [...signature], expiresAt)
      .accounts({
        issuerOwner: issuer.publicKey,
        issuerFid,
        targetFid: investorFid,
        claim,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .preInstructions([
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: issuerEphemeralSigner.publicKey,
          message,
          signature,
        }),
      ])
      .signers([issuer])
      .rpc();

    try {
      await program.methods
        .revokeClaim()
        .accounts({
          issuerOwner: stranger.publicKey,
          issuerFid,
          claim,
        })
        .signers([stranger])
        .rpc();
      expect.fail("expected non-issuer revoke to fail");
    } catch (error: any) {
      const parsed = parseError(error);
      expect(parsed.code).to.equal("Unauthorized");
      expect(parsed.number).to.equal(6025);
    }

    await program.methods
      .revokeClaim()
      .accounts({
        issuerOwner: issuer.publicKey,
        issuerFid,
        claim,
      })
      .signers([issuer])
      .rpc();

    const revokedClaim = await program.account.claimAccount.fetch(claim);
    expect(revokedClaim.revoked).to.equal(true);
  });

  it("rotating the signer key invalidates claims signed by the old key", async () => {
    const issuer = anchor.web3.Keypair.generate();
    const investor = anchor.web3.Keypair.generate();
    const oldSigner = nacl.sign.keyPair();
    const newSigner = nacl.sign.keyPair();

    for (const wallet of [issuer.publicKey, investor.publicKey]) {
      await airdrop(wallet);
    }

    const [issuerFid] = findFidPda(issuer.publicKey);
    const [investorFid] = findFidPda(investor.publicKey);

    await program.methods
      .createFid(true, 0)
      .accounts({
        owner: issuer.publicKey,
        fid: issuerFid,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([issuer])
      .rpc();

    await program.methods
      .createFid(false, 840)
      .accounts({
        owner: investor.publicKey,
        fid: investorFid,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([investor])
      .rpc();

    await program.methods
      .setSignerKey(new PublicKey(oldSigner.publicKey))
      .accounts({
        authority: issuer.publicKey,
        fid: issuerFid,
      })
      .signers([issuer])
      .rpc();

    await program.methods
      .setSignerKey(new PublicKey(newSigner.publicKey))
      .accounts({
        authority: issuer.publicKey,
        fid: issuerFid,
      })
      .signers([issuer])
      .rpc();

    const topic = new anchor.BN(3);
    const expiresAt = new anchor.BN(Math.floor(Date.now() / 1000) + 86400);
    const dataHash = createHash("sha256").update("accreditation-report").digest();
    const oldMessage = claimMessage(issuerFid, investorFid, topic, dataHash, expiresAt);
    const oldSignature = nacl.sign.detached(oldMessage, oldSigner.secretKey);
    const [claim] = findClaimPda(investorFid, 0);

    try {
      await program.methods
        .addClaim(topic, [...dataHash], [...oldSignature], expiresAt)
        .accounts({
          issuerOwner: issuer.publicKey,
          issuerFid,
          targetFid: investorFid,
          claim,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .preInstructions([
          Ed25519Program.createInstructionWithPublicKey({
            publicKey: oldSigner.publicKey,
            message: oldMessage,
            signature: oldSignature,
          }),
        ])
        .signers([issuer])
        .rpc();
      expect.fail("expected old signer key to be rejected after rotation");
    } catch (error: any) {
      const parsed = parseError(error);
      expect(parsed.code).to.equal("InvalidClaimSignature");
      expect(parsed.number).to.equal(6008);
    }

    const newMessage = claimMessage(issuerFid, investorFid, topic, dataHash, expiresAt);
    const newSignature = nacl.sign.detached(newMessage, newSigner.secretKey);

    await program.methods
      .addClaim(topic, [...dataHash], [...newSignature], expiresAt)
      .accounts({
        issuerOwner: issuer.publicKey,
        issuerFid,
        targetFid: investorFid,
        claim,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .preInstructions([
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: newSigner.publicKey,
          message: newMessage,
          signature: newSignature,
        }),
      ])
      .signers([issuer])
      .rpc();

    const claimAccount = await program.account.claimAccount.fetch(claim);
    expect(claimAccount.claimId).to.equal(0);
  });
});
