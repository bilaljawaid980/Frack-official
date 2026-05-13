import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import ctrIdl from "../../target/idl/fracks_ctr.json";
import irpIdl from "../../target/idl/fracks_irp.json";
import irsIdl from "../../target/idl/fracks_irs.json";
import tirIdl from "../../target/idl/fracks_tir.json";

export class FracksRegistryClient {
  readonly provider: AnchorProvider;
  readonly irpProgram: Program<any>;
  readonly irsProgram: Program<any>;
  readonly tirProgram: Program<any>;
  readonly ctrProgram: Program<any>;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.irpProgram = new Program(irpIdl as Idl, provider) as Program<any>;
    this.irsProgram = new Program(irsIdl as Idl, provider) as Program<any>;
    this.tirProgram = new Program(tirIdl as Idl, provider) as Program<any>;
    this.ctrProgram = new Program(ctrIdl as Idl, provider) as Program<any>;
  }

  findIrsStatePda(owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("irs_state"), owner.toBuffer()],
      this.irsProgram.programId,
    );
  }

  findIrpStatePda(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("irp_state"), tokenMint.toBuffer()],
      this.irpProgram.programId,
    );
  }

  findTirStatePda(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("tir_state"), tokenMint.toBuffer()],
      this.tirProgram.programId,
    );
  }

  findCtrStatePda(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("ctr_state"), tokenMint.toBuffer()],
      this.ctrProgram.programId,
    );
  }
}
