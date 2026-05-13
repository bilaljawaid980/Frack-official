import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import fidIdl from "../../target/idl/fracks_fid.json";

export class FracksFidClient {
  readonly provider: AnchorProvider;
  readonly program: Program<any>;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program(fidIdl as Idl, provider) as Program<any>;
  }

  findFidPda(wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("fid"), wallet.toBuffer()], this.program.programId);
  }

  async createFid(wallet: PublicKey, isIssuer: boolean, country: number) {
    const [fid] = this.findFidPda(wallet);
    await this.program.methods
      .createFid(isIssuer, country)
      .accounts({ owner: wallet, fid, systemProgram: SystemProgram.programId })
      .rpc();
    return fid;
  }
}
