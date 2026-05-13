import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import { FracksCtr } from "../target/types/fracks_ctr";

describe("fracks-ctr phase 2", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.FracksCtr as Program<FracksCtr>;

  const findCtrPda = (tokenMint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("ctr_state"), tokenMint.toBuffer()], program.programId);

  it("adds and removes claim topics", async () => {
    const owner = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(owner.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSig, "confirmed");

    const tokenMint = anchor.web3.Keypair.generate().publicKey;
    const [ctrState] = findCtrPda(tokenMint);

    await program.methods
      .initializeCtr(tokenMint)
      .accounts({
        owner: owner.publicKey,
        ctrState,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    await program.methods
      .addClaimTopic(new anchor.BN(1))
      .accounts({
        owner: owner.publicKey,
        ctrState,
      })
      .signers([owner])
      .rpc();

    await program.methods
      .addClaimTopic(new anchor.BN(2))
      .accounts({
        owner: owner.publicKey,
        ctrState,
      })
      .signers([owner])
      .rpc();

    let state = await program.account.claimTopicsState.fetch(ctrState);
    expect(state.topics.map((topic) => topic.toNumber())).to.deep.equal([1, 2]);

    await program.methods
      .removeClaimTopic(new anchor.BN(1))
      .accounts({
        owner: owner.publicKey,
        ctrState,
      })
      .signers([owner])
      .rpc();

    state = await program.account.claimTopicsState.fetch(ctrState);
    expect(state.topics.map((topic) => topic.toNumber())).to.deep.equal([2]);
  });
});
