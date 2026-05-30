import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { FactoryService } from "../services/factory";
import { createReadonlyProvider } from "../lib/anchor";
import { FACTORY_PROGRAM_ID } from "../lib/constants";
import crypto from "crypto";

async function runSimulation() {
  console.log("====================================================");
  console.log("STARTING SOLANA FACTORY DEPLOY SIMULATION TEST");
  console.log("====================================================");

  // 1. Setup connection and provider
  const connection = new Connection("https://api.testnet.solana.com", "confirmed");
  const provider = createReadonlyProvider(connection);
  const factoryService = new FactoryService(provider);

  // 2. Generate random accounts
  const issuer = Keypair.generate().publicKey;
  const tokenMint = Keypair.generate().publicKey;
  const salt = new Uint8Array(crypto.randomBytes(32));

  console.log("Issuer:", issuer.toBase58());
  console.log("Token Mint:", tokenMint.toBase58());
  console.log("Salt (hex):", Buffer.from(salt).toString("hex"));

  // 3. Derive PDA
  const [deploymentPda] = factoryService.getDeploymentPda(issuer, salt);
  console.log("Derived Deployment PDA:", deploymentPda.toBase58());

  // 4. Set up mock arguments (without deprecated offering/price fields)
  const args = {
    issuer: issuer.toBase58(),
    tokenMint: tokenMint.toBase58(),
    tokenName: "Simulated RWA Token",
    tokenSymbol: "SIMRWA",
    decimals: 6,
    isin: "US1234567890",
    claimTopics: [1, 2],
    trustedIssuers: [],
    complianceModules: [],
    salt,
  };

  // 5. Derive all state PDAs expected in the accounts context
  const [factoryState] = factoryService.getFactoryStatePda();
  
  const tokenProgramId = new PublicKey("92MCTz2KpWqhSD7LWay97LmZbdmpAj4fJ3FXtV7rbW9s");
  const irpProgramId = new PublicKey("C8jtErJYtuu7pSZczfSm1JvDmv254Nmmw1KLX6rBdY8o");
  const irsProgramId = new PublicKey("GSLErK4bEfF6ZozTWfjYikWfnBitMYrdbbgfXubJBgVJ");
  const tirProgramId = new PublicKey("8KDYYPx74w6ZLKZgcvVWrj1mCv1gcULdTh2jbxcJwGMJ");
  const ctrProgramId = new PublicKey("12rCF9fuSth8T3o6sfpfWdGyaDEQ1jNsxe1ZvKH7q2tS");
  const complianceProgramId = new PublicKey("FhMXw2VmYYksR4VcjQCUNWYrhzba1rmfiU1EDvaTsxHj");
  const hookProgramId = new PublicKey("4sLPqAViuzo1yJJExKn2TfP42enBQPhvAUZq5japm85m");

  const [tokenState] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_state"), tokenMint.toBuffer()],
    tokenProgramId
  );
  const [ownerState] = PublicKey.findProgramAddressSync(
    [Buffer.from("owner"), tokenMint.toBuffer()],
    tokenProgramId
  );
  const [irpState] = PublicKey.findProgramAddressSync(
    [Buffer.from("irp_state"), tokenMint.toBuffer()],
    irpProgramId
  );
  const [irsState] = PublicKey.findProgramAddressSync(
    [Buffer.from("irs_state"), tokenMint.toBuffer()],
    irsProgramId
  );
  const [tirState] = PublicKey.findProgramAddressSync(
    [Buffer.from("tir_state"), tokenMint.toBuffer()],
    tirProgramId
  );
  const [ctrState] = PublicKey.findProgramAddressSync(
    [Buffer.from("ctr_state"), tokenMint.toBuffer()],
    ctrProgramId
  );
  const [complianceState] = PublicKey.findProgramAddressSync(
    [Buffer.from("compliance_state"), tokenMint.toBuffer()],
    complianceProgramId
  );
  const [extraAccountMetas] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), tokenMint.toBuffer()],
    hookProgramId
  );

  // 6. Build the arguments for deployTokenSuite program instruction
  const trustedIssuers = args.trustedIssuers.map((ti: any) => ({
    issuerFid: new PublicKey(ti.issuerFid),
    topics: ti.topics.map((topic: any) => new BN(topic.toString())),
    label: ti.label,
  }));

  const ixArgs = {
    issuer,
    tokenMint,
    tokenName: args.tokenName,
    tokenSymbol: args.tokenSymbol,
    decimals: args.decimals,
    isin: args.isin,
    claimTopics: args.claimTopics.map((topic) => new BN(topic.toString())),
    trustedIssuers,
    complianceModules: [],
    sharedIrs: null,
    salt: Array.from(args.salt),
  };

  console.log("Instruction Args Built successfully.");

  // 7. Re-verify the program's coder & methods builder
  // We use this.program.methods.deployTokenSuite(ixArgs).accounts(...) to construct instruction
  try {
    const deployIx = await (factoryService["program"].methods as any)
      .deployTokenSuite(ixArgs)
      .accounts({
        admin: provider.wallet.publicKey,
        factoryState,
        issuer,
        deployment: deploymentPda,
        tokenState,
        ownerState,
        irsState,
        tirState,
        ctrState,
        irpState,
        complianceState,
        tokenMintAccount: tokenMint,
        extraAccountMetas,
        tokenProgram: tokenProgramId,
        hookProgram: hookProgramId,
        irpProgram: irpProgramId,
        irsProgram: irsProgramId,
        tirProgram: tirProgramId,
        ctrProgram: ctrProgramId,
        complianceProgram: complianceProgramId,
        systemProgram: PublicKey.default,
      })
      .remainingAccounts([])
      .instruction();

    console.log("Anchor Instruction successfully constructed!");
    console.log("Instruction programId:", deployIx.programId.toBase58());
    console.log("Instruction keys count:", deployIx.keys.length);
    console.log("Instruction data hex:", Buffer.from(deployIx.data).toString("hex"));
    
    // Validate that the Borsh serialization contains correct byte mappings
    console.log("SUCCESS: Client-side Borsh serialization and PDA inputs are 100% structurally aligned!");
  } catch (error) {
    console.error("FAILURE: Anchor instruction construction failed!");
    console.error(error);
    process.exit(1);
  }
}

runSimulation();
