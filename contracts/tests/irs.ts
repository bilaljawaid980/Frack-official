import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

import { FracksIrs } from "../target/types/fracks_irs";

describe("fracks-irs phase 2", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.FracksIrs as Program<FracksIrs>;

  const findIrsPda = (owner: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("irs_state"), owner.toBuffer()], program.programId);

  const findWalletIdentityPda = (irs: PublicKey, wallet: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("wallet_identity"), irs.toBuffer(), wallet.toBuffer()],
      program.programId,
    );

  const parseError = (error: any) => {
    const anchorError = error?.error ?? error;
    return {
      code: anchorError?.errorCode?.code ?? anchorError?.errorName,
      number: anchorError?.errorCode?.number ?? anchorError?.errorNumber,
      message: anchorError?.message ?? error?.message ?? String(error),
      logs: anchorError?.logs ?? error?.logs ?? [],
    };
  };

  it("registers, rejects duplicates, updates, and removes identities", async () => {
    const owner = anchor.web3.Keypair.generate();
    const investor = anchor.web3.Keypair.generate();
    const airdropSig = await provider.connection.requestAirdrop(owner.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(airdropSig, "confirmed");

    const [irsState] = findIrsPda(owner.publicKey);
    await program.methods
      .initializeIrs()
      .accounts({
        owner: owner.publicKey,
        irsState,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const [walletIdentity] = findWalletIdentityPda(irsState, investor.publicKey);
    const fid = anchor.web3.Keypair.generate().publicKey;

    await program.methods
      .registerIdentity(investor.publicKey, fid, 840)
      .accounts({
        authority: owner.publicKey,
        irsState,
        registryState: anchor.web3.SystemProgram.programId,
        walletIdentity,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const identity = await program.account.walletIdentity.fetch(walletIdentity);
    expect(identity.wallet.toBase58()).to.equal(investor.publicKey.toBase58());
    expect(identity.fid.toBase58()).to.equal(fid.toBase58());
    expect(identity.country).to.equal(840);

    try {
      await program.methods
        .registerIdentity(investor.publicKey, fid, 840)
        .accounts({
          authority: owner.publicKey,
          irsState,
          registryState: anchor.web3.SystemProgram.programId,
          walletIdentity,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
      expect.fail("expected duplicate registration to fail");
    } catch (error: any) {
      const parsed = parseError(error);
      const details = [parsed.code, parsed.number, parsed.message, ...parsed.logs]
        .filter((value) => value !== undefined && value !== null)
        .join("\n");
      expect(details).to.match(/WalletAlreadyRegistered|Wallet is already registered|custom program error/i);
    }

    const newFid = anchor.web3.Keypair.generate().publicKey;
    await program.methods
      .updateIdentity(newFid)
      .accounts({
        authority: owner.publicKey,
        irsState,
        registryState: anchor.web3.SystemProgram.programId,
        walletIdentity,
      })
      .signers([owner])
      .rpc();

    await program.methods
      .updateCountry(586)
      .accounts({
        authority: owner.publicKey,
        irsState,
        registryState: anchor.web3.SystemProgram.programId,
        walletIdentity,
      })
      .signers([owner])
      .rpc();

    const updatedIdentity = await program.account.walletIdentity.fetch(walletIdentity);
    expect(updatedIdentity.fid.toBase58()).to.equal(newFid.toBase58());
    expect(updatedIdentity.country).to.equal(586);

    try {
      await program.methods
        .updateCountry(1000)
        .accounts({
          authority: owner.publicKey,
          irsState,
          registryState: anchor.web3.SystemProgram.programId,
          walletIdentity,
        })
        .signers([owner])
        .rpc();
      expect.fail("expected invalid country code to fail");
    } catch (error: any) {
      const parsed = parseError(error);
      expect(parsed.code).to.equal("InvalidCountryCode");
      expect(parsed.number).to.equal(6017);
    }

    await program.methods
      .removeIdentity()
      .accounts({
        authority: owner.publicKey,
        irsState,
        registryState: anchor.web3.SystemProgram.programId,
        walletIdentity,
      })
      .signers([owner])
      .rpc();

    const account = await provider.connection.getAccountInfo(walletIdentity);
    expect(account).to.equal(null);
  });
});
