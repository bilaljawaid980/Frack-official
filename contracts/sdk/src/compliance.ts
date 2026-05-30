import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import complianceIdl from "../../target/idl/fracks_compliance.json";

export class FracksComplianceClient {
  readonly provider: AnchorProvider;
  readonly program: Program<any>;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program(complianceIdl as Idl, provider) as Program<any>;
  }

  findComplianceStatePda(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("compliance_state"), tokenMint.toBuffer()],
      this.program.programId,
    );
  }
}
