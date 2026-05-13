import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import tokenIdl from "../../target/idl/fracks_token.json";

export class FracksTokenClient {
  readonly provider: AnchorProvider;
  readonly program: Program<any>;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program(tokenIdl as Idl, provider) as Program<any>;
  }

  findTokenStatePda(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("token_state"), tokenMint.toBuffer()],
      this.program.programId,
    );
  }

  findOwnerStatePda(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("owner"), tokenMint.toBuffer()], this.program.programId);
  }

  findAgentRolePda(tokenMint: PublicKey, agent: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), tokenMint.toBuffer(), agent.toBuffer()],
      this.program.programId,
    );
  }
}
