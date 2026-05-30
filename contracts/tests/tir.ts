import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import { FracksTir } from "../target/types/fracks_tir";

describe("fracks-tir phase 2", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.FracksTir as Program<FracksTir>;

  const findTirPda = (tokenMint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("tir_state"), tokenMint.toBuffer()], program.programId);

  const findIssuerEntryPda = (tir: PublicKey, issuerFid: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("issuer_entry"), tir.toBuffer(), issuerFid.toBuffer()],
      program.programId,
    );

  it("adds issuers, deactivates them, and reports topic trust", async () => {
    const owner = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(owner.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSig, "confirmed");

    const tokenMint = anchor.web3.Keypair.generate().publicKey;
    const issuerFid = anchor.web3.Keypair.generate().publicKey;
    const [tirState] = findTirPda(tokenMint);
    const [issuerEntry] = findIssuerEntryPda(tirState, issuerFid);

    await program.methods
      .initializeTir(tokenMint)
      .accounts({
        owner: owner.publicKey,
        tirState,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    await program.methods
      .addTrustedIssuer(issuerFid, [new anchor.BN(1), new anchor.BN(2)], "Provider A")
      .accounts({
        owner: owner.publicKey,
        tirState,
        issuerEntry,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    let trusted = await program.methods
      .isTrustedForTopic(issuerFid, new anchor.BN(1))
      .accounts({
        tirState,
        issuerEntry,
      })
      .view();
    expect(trusted).to.equal(true);

    await program.methods
      .deactivateIssuer()
      .accounts({
        owner: owner.publicKey,
        tirState,
        issuerEntry,
      })
      .signers([owner])
      .rpc();

    trusted = await program.methods
      .isTrustedForTopic(issuerFid, new anchor.BN(1))
      .accounts({
        tirState,
        issuerEntry,
      })
      .view();
    expect(trusted).to.equal(false);

    await program.methods
      .reactivateIssuer()
      .accounts({
        owner: owner.publicKey,
        tirState,
        issuerEntry,
      })
      .signers([owner])
      .rpc();

    trusted = await program.methods
      .isTrustedForTopic(issuerFid, new anchor.BN(2))
      .accounts({
        tirState,
        issuerEntry,
      })
      .view();
    expect(trusted).to.equal(true);
  });
});
