const anchor = require("@coral-xyz/anchor");
const factoryIdl = require("../target/idl/fracks_factory.json");
const tokenIdl = require("../target/idl/fracks_token.json");
const irpIdl = require("../target/idl/fracks_irp.json");
const irsIdl = require("../target/idl/fracks_irs.json");
const tirIdl = require("../target/idl/fracks_tir.json");
const ctrIdl = require("../target/idl/fracks_ctr.json");
const complianceIdl = require("../target/idl/fracks_compliance.json");

module.exports = async function deploy() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const defaultPubkey = new anchor.web3.PublicKey(new Uint8Array(32));
  const governanceOwnerRaw = process.env.FRACKS_FACTORY_OWNER || process.env.FRACKS_PROTOCOL_MULTISIG;
  const governanceOwner = governanceOwnerRaw ? new anchor.web3.PublicKey(governanceOwnerRaw) : provider.wallet.publicKey;

  const factory = new anchor.Program(factoryIdl, provider);
  const token = new anchor.Program(tokenIdl, provider);
  const irp = new anchor.Program(irpIdl, provider);
  const irs = new anchor.Program(irsIdl, provider);
  const tir = new anchor.Program(tirIdl, provider);
  const ctr = new anchor.Program(ctrIdl, provider);
  const compliance = new anchor.Program(complianceIdl, provider);

  const [factoryState] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("factory_state")],
    factory.programId,
  );

  const existing = await provider.connection.getAccountInfo(factoryState);
  if (existing) {
    console.log(`factory_state already initialized: ${factoryState.toBase58()}`);
    try {
      const state = await factory.account.factoryState.fetch(factoryState);
      console.log(`factory_state owner: ${state.owner.toBase58()}`);
      if (state.pendingOwner && !state.pendingOwner.equals(defaultPubkey)) {
        console.log(`factory_state pending owner: ${state.pendingOwner.toBase58()}`);
      }
    } catch (_error) {
      // Best-effort logging only.
    }
    return;
  }

  await factory.methods
    .initializeFactory()
    .accounts({
      owner: provider.wallet.publicKey,
      factoryState,
      tokenProgram: token.programId,
      irpProgram: irp.programId,
      irsProgram: irs.programId,
      tirProgram: tir.programId,
      ctrProgram: ctr.programId,
      complianceProgram: compliance.programId,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`factory_state initialized: ${factoryState.toBase58()}`);
  console.log(`factory_state owner: ${provider.wallet.publicKey.toBase58()}`);

  if (!governanceOwner.equals(provider.wallet.publicKey)) {
    await factory.methods
      .transferFactoryOwnership(governanceOwner)
      .accounts({
        owner: provider.wallet.publicKey,
        factoryState,
      })
      .rpc();

    console.log(`factory_state pending owner set: ${governanceOwner.toBase58()}`);
    console.log("governance acceptance required: run accept_factory_ownership from the governance wallet or multisig execution path");
  }
};
