import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import factoryIdl from "../../target/idl/fracks_factory.json";
import ctrIdl from "../../target/idl/fracks_ctr.json";
import irpIdl from "../../target/idl/fracks_irp.json";
import irsIdl from "../../target/idl/fracks_irs.json";
import tirIdl from "../../target/idl/fracks_tir.json";
import tokenIdl from "../../target/idl/fracks_token.json";
import tokenHookIdl from "../../target/idl/fracks_token_hook.json";
import complianceIdl from "../../target/idl/fracks_compliance.json";
import { DeployTokenSuiteInput, TokenSuiteDeployment } from "./types";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const asProgram = (provider: AnchorProvider, idl: Idl) =>
  new Program(idl, provider) as Program<any>;

export class FracksFactoryClient {
  readonly provider: AnchorProvider;
  readonly program: Program<any>;
  readonly tokenProgram: Program<any>;
  readonly tokenHookProgram: Program<any>;
  readonly irpProgram: Program<any>;
  readonly irsProgram: Program<any>;
  readonly tirProgram: Program<any>;
  readonly ctrProgram: Program<any>;
  readonly complianceProgram: Program<any>;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = asProgram(provider, factoryIdl as Idl);
    this.tokenProgram = asProgram(provider, tokenIdl as Idl);
    this.tokenHookProgram = asProgram(provider, tokenHookIdl as Idl);
    this.irpProgram = asProgram(provider, irpIdl as Idl);
    this.irsProgram = asProgram(provider, irsIdl as Idl);
    this.tirProgram = asProgram(provider, tirIdl as Idl);
    this.ctrProgram = asProgram(provider, ctrIdl as Idl);
    this.complianceProgram = asProgram(provider, complianceIdl as Idl);
  }

  findFactoryStatePda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("factory_state")], this.program.programId);
  }

  findDeploymentPda(issuer: PublicKey, salt: Buffer | Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("deployment"), issuer.toBuffer(), Buffer.from(salt)],
      this.program.programId,
    );
  }

  async initializeFactory(owner?: Keypair) {
    const signer = owner ?? (this.provider.wallet as anchor.Wallet).payer;
    const [factoryState] = this.findFactoryStatePda();
    return this.program.methods
      .initializeFactory()
      .accounts({
        owner: signer.publicKey,
        factoryState,
        tokenProgram: this.tokenProgram.programId,
        irpProgram: this.irpProgram.programId,
        irsProgram: this.irsProgram.programId,
        tirProgram: this.tirProgram.programId,
        ctrProgram: this.ctrProgram.programId,
        complianceProgram: this.complianceProgram.programId,
        systemProgram: SystemProgram.programId,
      })
      .signers(owner ? [owner] : [])
      .rpc();
  }

  async deployTokenSuite(input: DeployTokenSuiteInput, issuer?: Keypair): Promise<TokenSuiteDeployment> {
    const signer = issuer ?? (this.provider.wallet as anchor.Wallet).payer;
    const tokenMintKeypair = input.tokenMintKeypair ?? Keypair.generate();
    const tokenMint = input.tokenMint ?? tokenMintKeypair.publicKey;
    if (!tokenMint.equals(tokenMintKeypair.publicKey)) {
      throw new Error("tokenMint must match tokenMintKeypair.publicKey for factory-created Token-2022 mints");
    }
    const salt = Buffer.from(input.salt);

    const [factoryState] = this.findFactoryStatePda();
    const [deployment] = this.findDeploymentPda(signer.publicKey, salt);
    const [tokenState] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_state"), tokenMint.toBuffer()],
      this.tokenProgram.programId,
    );
    const [ownerState] = PublicKey.findProgramAddressSync(
      [Buffer.from("owner"), tokenMint.toBuffer()],
      this.tokenProgram.programId,
    );
    const [irsState] = input.sharedIrs
      ? [input.sharedIrs]
      : PublicKey.findProgramAddressSync(
          [Buffer.from("irs_state"), signer.publicKey.toBuffer()],
          this.irsProgram.programId,
        );
    const [tirState] = PublicKey.findProgramAddressSync(
      [Buffer.from("tir_state"), tokenMint.toBuffer()],
      this.tirProgram.programId,
    );
    const [ctrState] = PublicKey.findProgramAddressSync(
      [Buffer.from("ctr_state"), tokenMint.toBuffer()],
      this.ctrProgram.programId,
    );
    const [irpState] = PublicKey.findProgramAddressSync(
      [Buffer.from("irp_state"), tokenMint.toBuffer()],
      this.irpProgram.programId,
    );
    const [complianceState] = PublicKey.findProgramAddressSync(
      [Buffer.from("compliance_state"), tokenMint.toBuffer()],
      this.complianceProgram.programId,
    );
    const [extraAccountMetas] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), tokenMint.toBuffer()],
      this.tokenHookProgram.programId,
    );

    const trustedIssuerEntries = input.trustedIssuers.map((issuerConfig) =>
      PublicKey.findProgramAddressSync(
        [Buffer.from("issuer_entry"), tirState.toBuffer(), issuerConfig.issuerFid.toBuffer()],
        this.tirProgram.programId,
      )[0],
    );

    const bn = (value: number) => new anchor.BN(value);

    await this.program.methods
      .createTokenMint(input.decimals)
      .accounts({
        payer: signer.publicKey,
        tokenState,
        tokenMintAccount: tokenMint,
        hookProgram: this.tokenHookProgram.programId,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([...(issuer ? [issuer] : []), tokenMintKeypair])
      .rpc();

    await this.program.methods
      .deployTokenSuite({
        tokenMint,
        tokenName: input.tokenName,
        tokenSymbol: input.tokenSymbol,
        decimals: input.decimals,
        isin: input.isin,
        claimTopics: input.claimTopics.map(bn),
        trustedIssuers: input.trustedIssuers.map((trustedIssuer) => ({
          issuerFid: trustedIssuer.issuerFid,
          topics: trustedIssuer.topics.map(bn),
          label: trustedIssuer.label,
        })),
        complianceModules: input.complianceModules,
        sharedIrs: input.sharedIrs ?? null,
        salt: [...salt],
      })
      .accounts({
        issuer: signer.publicKey,
        factoryState,
        deployment,
        tokenState,
        ownerState,
        irsState,
        tirState,
        ctrState,
        irpState,
        complianceState,
        tokenMintAccount: tokenMint,
        extraAccountMetas,
        tokenProgram: this.tokenProgram.programId,
        hookProgram: this.tokenHookProgram.programId,
        irpProgram: this.irpProgram.programId,
        irsProgram: this.irsProgram.programId,
        tirProgram: this.tirProgram.programId,
        ctrProgram: this.ctrProgram.programId,
        complianceProgram: this.complianceProgram.programId,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(
        [
          ...trustedIssuerEntries.map((pubkey) => ({
            pubkey,
            isSigner: false,
            isWritable: true,
          })),
          ...input.complianceModules.map((pubkey) => ({
            pubkey,
            isSigner: false,
            isWritable: false,
          })),
        ],
      )
      .signers(issuer ? [issuer] : [])
      .rpc();

    return {
      deployment,
      tokenMint,
      extraAccountMetas,
      tokenState,
      ownerState,
      irsState,
      tirState,
      ctrState,
      irpState,
      complianceState,
    };
  }
}
