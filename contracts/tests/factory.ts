import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import { FracksSDK } from "../sdk/src";

describe("fracks-factory and sdk phase 6", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const BN = (anchor as any).BN ?? (anchor as any).default?.BN;
  const defaultPubkey = new PublicKey(new Uint8Array(32));
  const factoryOwner = Keypair.generate();

  const factory = anchor.workspace.FracksFactory as Program<any>;
  const fid = anchor.workspace.FracksFid as Program<any>;
  const maxTransfer = anchor.workspace.ModMaxTransfer as Program<any>;

  const airdrop = async (pubkey: PublicKey) => {
    const sig = await provider.connection.requestAirdrop(pubkey, 4 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  const findFidPda = (wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("fid"), wallet.toBuffer()], fid.programId);
  const findFactoryStatePda = () =>
    PublicKey.findProgramAddressSync([Buffer.from("factory_state")], factory.programId);
  const findDeploymentPda = (issuer: PublicKey, salt: Buffer) =>
    PublicKey.findProgramAddressSync([Buffer.from("deployment"), issuer.toBuffer(), salt], factory.programId);
  const findMaxTransferPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_max_transfer"), mint.toBuffer()], maxTransfer.programId);

  it("deploys a full linked suite and supports shared IRS reuse via the SDK", async () => {
    const issuer = Keypair.generate();
    const trustedIssuer = Keypair.generate();
    const sdk = new FracksSDK(provider);

    for (const wallet of [factoryOwner.publicKey, issuer.publicKey, trustedIssuer.publicKey]) {
      await airdrop(wallet);
    }

    const [factoryState] = findFactoryStatePda();
    await sdk.initializeFactory(factoryOwner);

    const [trustedIssuerFid] = findFidPda(trustedIssuer.publicKey);
    await fid.methods
      .createFid(true, 840)
      .accounts({ owner: trustedIssuer.publicKey, fid: trustedIssuerFid, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([trustedIssuer])
      .rpc();

    const tokenMintOneKeypair = Keypair.generate();
    const tokenMintOne = tokenMintOneKeypair.publicKey;
    const [maxTransferModule] = findMaxTransferPda(tokenMintOne);
    await maxTransfer.methods
      .initializeModule(tokenMintOne, new BN(250))
      .accounts({
        owner: issuer.publicKey,
        moduleState: maxTransferModule,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([issuer])
      .rpc();

    const saltOne = Buffer.alloc(32, 1);
    const first = await sdk.deployTokenSuite(
      {
        tokenMint: tokenMintOne,
        tokenName: "FRACKS Phase Six One",
        tokenSymbol: "FP61",
        decimals: 6,
        isin: "USPHASE60001",
        claimTopics: [1, 2],
        trustedIssuers: [{ issuerFid: trustedIssuerFid, topics: [1, 2], label: "Trusted KYC" }],
        complianceModules: [maxTransferModule],
        tokenMintKeypair: tokenMintOneKeypair,
        salt: saltOne,
      },
      issuer,
    );

    const factoryStateAccount = await factory.account.factoryState.fetch(factoryState);
    expect(factoryStateAccount.deploymentCount.toNumber()).to.equal(1);

    const firstDeployment = await factory.account.tokenDeployment.fetch(first.deployment);
    expect(firstDeployment.issuer.toBase58()).to.equal(issuer.publicKey.toBase58());
    expect(firstDeployment.tokenMint.toBase58()).to.equal(tokenMintOne.toBase58());
    expect(firstDeployment.irsState.toBase58()).to.equal(first.irsState.toBase58());

    const complianceState = await sdk.compliance.program.account.complianceState.fetch(first.complianceState);
    expect(complianceState.modules).to.deep.equal([maxTransferModule]);

    const tokenState = await sdk.token.program.account.tokenState.fetch(first.tokenState);
    expect(tokenState.identityRegistry.toBase58()).to.equal(first.irpState.toBase58());
    expect(tokenState.compliance.toBase58()).to.equal(first.complianceState.toBase58());
    const mintAccount = await getMint(provider.connection, tokenMintOne, undefined, TOKEN_2022_PROGRAM_ID);
    expect(mintAccount.mintAuthority?.toBase58()).to.equal(first.tokenState.toBase58());
    expect(mintAccount.decimals).to.equal(6);

    const secondSalt = Buffer.alloc(32, 2);
    const tokenMintTwoKeypair = Keypair.generate();
    const tokenMintTwo = tokenMintTwoKeypair.publicKey;
    const second = await sdk.deployTokenSuite(
      {
        tokenMint: tokenMintTwo,
        tokenName: "FRACKS Phase Six Two",
        tokenSymbol: "FP62",
        decimals: 6,
        isin: "USPHASE60002",
        claimTopics: [1],
        trustedIssuers: [{ issuerFid: trustedIssuerFid, topics: [1], label: "Trusted KYC" }],
        complianceModules: [],
        sharedIrs: first.irsState,
        tokenMintKeypair: tokenMintTwoKeypair,
        salt: secondSalt,
      },
      issuer,
    );

    expect(second.irsState.toBase58()).to.equal(first.irsState.toBase58());

    const secondDeployment = await factory.account.tokenDeployment.fetch(second.deployment);
    expect(secondDeployment.deploymentId.toNumber()).to.equal(1);
    expect(secondDeployment.irsState.toBase58()).to.equal(first.irsState.toBase58());

    const updatedFactory = await factory.account.factoryState.fetch(factoryState);
    expect(updatedFactory.deploymentCount.toNumber()).to.equal(2);

    try {
      await sdk.deployTokenSuite(
        {
          tokenMintKeypair: Keypair.generate(),
          tokenName: "Duplicate Salt",
          tokenSymbol: "DUP6",
          decimals: 6,
          isin: "USDUPL000001",
          claimTopics: [1],
          trustedIssuers: [{ issuerFid: trustedIssuerFid, topics: [1], label: "Trusted KYC" }],
          complianceModules: [],
          sharedIrs: first.irsState,
          salt: saltOne,
        },
        issuer,
      );
      expect.fail("expected duplicate deployment salt to fail");
    } catch (error: any) {
      expect(String(error)).to.contain("Deployment already exists");
    }

    const [expectedDeployment] = findDeploymentPda(issuer.publicKey, saltOne);
    expect(first.deployment.toBase58()).to.equal(expectedDeployment.toBase58());
  });

  it("uses a two-step factory ownership handoff", async () => {
    const pendingOwner = Keypair.generate();

    for (const wallet of [factoryOwner.publicKey, pendingOwner.publicKey]) {
      await airdrop(wallet);
    }

    const [factoryState] = findFactoryStatePda();
    await factory.methods
      .transferFactoryOwnership(pendingOwner.publicKey)
      .accounts({
        owner: factoryOwner.publicKey,
        factoryState,
      })
      .signers([factoryOwner])
      .rpc();

    let state = await factory.account.factoryState.fetch(factoryState);
    expect(state.owner.toBase58()).to.equal(factoryOwner.publicKey.toBase58());
    expect(state.pendingOwner.toBase58()).to.equal(pendingOwner.publicKey.toBase58());

    await factory.methods
      .acceptFactoryOwnership()
      .accounts({
        pendingOwner: pendingOwner.publicKey,
        factoryState,
      })
      .signers([pendingOwner])
      .rpc();

    state = await factory.account.factoryState.fetch(factoryState);
    expect(state.owner.toBase58()).to.equal(pendingOwner.publicKey.toBase58());
    expect(state.pendingOwner.toBase58()).to.equal(defaultPubkey.toBase58());
  });
});
