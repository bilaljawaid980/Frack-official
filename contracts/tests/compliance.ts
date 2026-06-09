import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

describe("fracks-compliance phase 3", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const BN = (anchor as any).BN ?? (anchor as any).default?.BN;

  const compliance = anchor.workspace.FracksCompliance as Program<any>;
  const maxInvestors = anchor.workspace.ModMaxInvestors as Program<any>;
  const countryRestrict = anchor.workspace.ModCountryRestrict as Program<any>;
  const maxBalance = anchor.workspace.ModMaxBalance as Program<any>;
  const maxTransfer = anchor.workspace.ModMaxTransfer as Program<any>;
  const lockup = anchor.workspace.ModLockup as Program<any>;
  const dailyLimit = anchor.workspace.ModDailyLimit as Program<any>;
  const supplyCap = anchor.workspace.ModSupplyCap as Program<any>;
  const countryCap = anchor.workspace.ModCountryCap as Program<any>;

  const airdrop = async (pubkey: PublicKey) => {
    const sig = await provider.connection.requestAirdrop(pubkey, 3 * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
  };

  const findCompliancePda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("compliance_state"), mint.toBuffer()], compliance.programId);
  const findMaxInvestorsPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_max_investors"), mint.toBuffer()], maxInvestors.programId);
  const findCountryRestrictPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_country"), mint.toBuffer()], countryRestrict.programId);
  const findMaxBalancePda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_max_balance"), mint.toBuffer()], maxBalance.programId);
  const findMaxTransferPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_max_transfer"), mint.toBuffer()], maxTransfer.programId);
  const findLockupPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_lockup"), mint.toBuffer()], lockup.programId);
  const findDailyLimitPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_daily_limit"), mint.toBuffer()], dailyLimit.programId);
  const findDailyUsagePda = (module: PublicKey, wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("daily_usage"), module.toBuffer(), wallet.toBuffer()], dailyLimit.programId);
  const findSupplyCapPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_supply_cap"), mint.toBuffer()], supplyCap.programId);
  const findCountryCapPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("mod_country_cap"), mint.toBuffer()], countryCap.programId);
  const findCountryCountPda = (module: PublicKey, country: number) => {
    const le = Buffer.alloc(2);
    le.writeUInt16LE(country, 0);
    return PublicKey.findProgramAddressSync([Buffer.from("country_count"), module.toBuffer(), le], countryCap.programId);
  };

  it("enforces all built-in module boundary rules and the compliance pause bypass", async () => {
    const owner = anchor.web3.Keypair.generate();
    const trackedWallet = anchor.web3.Keypair.generate();
    const tokenMint = anchor.web3.Keypair.generate().publicKey;
    await airdrop(owner.publicKey);

    const [complianceState] = findCompliancePda(tokenMint);
    const [maxInvestorsState] = findMaxInvestorsPda(tokenMint);
    const [countryRestrictState] = findCountryRestrictPda(tokenMint);
    const [maxBalanceState] = findMaxBalancePda(tokenMint);
    const [maxTransferState] = findMaxTransferPda(tokenMint);
    const [lockupState] = findLockupPda(tokenMint);
    const [supplyCapState] = findSupplyCapPda(tokenMint);
    const [countryCapState] = findCountryCapPda(tokenMint);
    const [usCountryCount] = findCountryCountPda(countryCapState, 840);

    await compliance.methods
      .initializeCompliance(tokenMint)
      .accounts({ owner: owner.publicKey, complianceState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await maxInvestors.methods
      .initializeModule(tokenMint, new BN(1))
      .accounts({ owner: owner.publicKey, moduleState: maxInvestorsState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();
    expect(
      await maxInvestors.methods.canTransfer(new BN(1), new BN(0)).accounts({ moduleState: maxInvestorsState }).view(),
    ).to.equal(true);
    await maxInvestors.methods
      .created(new BN(1), new BN(1))
      .accounts({ authority: owner.publicKey, moduleState: maxInvestorsState })
      .signers([owner])
      .rpc();
    expect(
      await maxInvestors.methods.canTransfer(new BN(1), new BN(0)).accounts({ moduleState: maxInvestorsState }).view(),
    ).to.equal(false);

    await countryRestrict.methods
      .initializeModule(tokenMint, [840])
      .accounts({ owner: owner.publicKey, moduleState: countryRestrictState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();
    expect(
      await countryRestrict.methods.canTransfer(586, 840).accounts({ moduleState: countryRestrictState }).view(),
    ).to.equal(false);

    await maxBalance.methods
      .initializeModule(tokenMint, new BN(100))
      .accounts({ owner: owner.publicKey, moduleState: maxBalanceState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();
    expect(
      await maxBalance.methods.canTransfer(new BN(20), new BN(90)).accounts({ moduleState: maxBalanceState }).view(),
    ).to.equal(false);

    await maxTransfer.methods
      .initializeModule(tokenMint, new BN(50))
      .accounts({ owner: owner.publicKey, moduleState: maxTransferState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();
    expect(
      await maxTransfer.methods.canTransfer(new BN(60)).accounts({ moduleState: maxTransferState }).view(),
    ).to.equal(false);

    await lockup.methods
      .initializeModule(tokenMint, new BN(Math.floor(Date.now() / 1000) + 3600))
      .accounts({ owner: owner.publicKey, moduleState: lockupState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();
    expect(await lockup.methods.canTransfer().accounts({ moduleState: lockupState }).view()).to.equal(false);

    await supplyCap.methods
      .initializeModule(tokenMint, new BN(100))
      .accounts({ owner: owner.publicKey, moduleState: supplyCapState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();
    await supplyCap.methods
      .created(new BN(80))
      .accounts({ authority: owner.publicKey, moduleState: supplyCapState })
      .signers([owner])
      .rpc();
    try {
      await supplyCap.methods
        .created(new BN(30))
        .accounts({ authority: owner.publicKey, moduleState: supplyCapState })
        .signers([owner])
        .rpc();
      expect.fail("expected supply cap failure");
    } catch (error: any) {
      expect(String(error)).to.contain("Max supply exceeded");
    }

    await countryCap.methods
      .initializeModule(tokenMint, [{ country: 840, cap: new BN(1) }])
      .accounts({ owner: owner.publicKey, moduleState: countryCapState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();
    await countryCap.methods
      .initializeCountryCount(840)
      .accounts({
        owner: owner.publicKey,
        moduleState: countryCapState,
        countryCount: usCountryCount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
    expect(
      await countryCap.methods
        .canTransfer(new BN(10), new BN(0), 840)
        .accounts({ moduleState: countryCapState, countryCount: usCountryCount })
        .view(),
    ).to.equal(true);
    await countryCap.methods
      .created(new BN(10), new BN(10), 840)
      .accounts({ authority: owner.publicKey, moduleState: countryCapState, countryCount: usCountryCount })
      .signers([owner])
      .rpc();
    expect(
      await countryCap.methods
        .canTransfer(new BN(10), new BN(0), 840)
        .accounts({ moduleState: countryCapState, countryCount: usCountryCount })
        .view(),
    ).to.equal(false);

    await compliance.methods
      .bindModule(maxTransferState)
      .accounts({ owner: owner.publicKey, complianceState })
      .signers([owner])
      .rpc();

    expect(
      await compliance.methods
        .canTransfer(
          owner.publicKey,
          trackedWallet.publicKey,
          new BN(60),
          new BN(100),
          new BN(0),
          586,
          586,
        )
        .accounts({ complianceState })
        .remainingAccounts([{ pubkey: maxTransferState, isSigner: false, isWritable: false }])
        .view(),
    ).to.equal(false);

    await compliance.methods
      .setModulesPaused(true)
      .accounts({ owner: owner.publicKey, complianceState })
      .signers([owner])
      .rpc();

    expect(
      await compliance.methods
        .canTransfer(
          owner.publicKey,
          trackedWallet.publicKey,
          new BN(60),
          new BN(100),
          new BN(0),
          586,
          586,
        )
        .accounts({ complianceState })
        .remainingAccounts([{ pubkey: maxTransferState, isSigner: false, isWritable: false }])
        .view(),
    ).to.equal(true);
  });

  it("fails closed when daily-limit usage support state is missing", async () => {
    const owner = anchor.web3.Keypair.generate();
    const trackedWallet = anchor.web3.Keypair.generate();
    const tokenMint = anchor.web3.Keypair.generate().publicKey;
    await airdrop(owner.publicKey);

    const [complianceState] = findCompliancePda(tokenMint);
    const [dailyLimitState] = findDailyLimitPda(tokenMint);

    await compliance.methods
      .initializeCompliance(tokenMint)
      .accounts({ owner: owner.publicKey, complianceState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await dailyLimit.methods
      .initializeModule(tokenMint, new BN(100))
      .accounts({ owner: owner.publicKey, moduleState: dailyLimitState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await dailyLimit.methods
      .setHookAuthority(complianceState)
      .accounts({ owner: owner.publicKey, moduleState: dailyLimitState })
      .signers([owner])
      .rpc();

    await compliance.methods
      .bindModule(dailyLimitState)
      .accounts({ owner: owner.publicKey, complianceState })
      .signers([owner])
      .rpc();

    try {
      await compliance.methods
        .transferred(trackedWallet.publicKey, owner.publicKey, new BN(25), new BN(75), new BN(25), 840, 840)
        .accounts({ complianceState })
        .remainingAccounts([
          { pubkey: dailyLimitState, isSigner: false, isWritable: true },
          { pubkey: dailyLimit.programId, isSigner: false, isWritable: false },
        ])
        .rpc();
      expect.fail("expected missing daily-limit support account failure");
    } catch (error: any) {
      expect(String(error)).to.contain("Missing module support account");
    }
  });

  it("updates mutable module state through compliance post-hooks when hook authority is configured", async () => {
    const owner = anchor.web3.Keypair.generate();
    const supportPayer = anchor.web3.Keypair.generate();
    const tokenMint = anchor.web3.Keypair.generate().publicKey;
    await airdrop(owner.publicKey);
    await airdrop(supportPayer.publicKey);

    const [complianceState] = findCompliancePda(tokenMint);
    const [maxInvestorsState] = findMaxInvestorsPda(tokenMint);
    const [dailyLimitState] = findDailyLimitPda(tokenMint);
    const [dailyUsageState] = findDailyUsagePda(dailyLimitState, owner.publicKey);
    const [supplyCapState] = findSupplyCapPda(tokenMint);
    const [countryCapState] = findCountryCapPda(tokenMint);
    const [usCountryCount] = findCountryCountPda(countryCapState, 840);

    await compliance.methods
      .initializeCompliance(tokenMint)
      .accounts({ owner: owner.publicKey, complianceState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await maxInvestors.methods
      .initializeModule(tokenMint, new BN(5))
      .accounts({ owner: owner.publicKey, moduleState: maxInvestorsState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await dailyLimit.methods
      .initializeModule(tokenMint, new BN(100))
      .accounts({ owner: owner.publicKey, moduleState: dailyLimitState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await dailyLimit.methods
      .initializeWalletUsage(owner.publicKey)
      .accounts({
        owner: supportPayer.publicKey,
        moduleState: dailyLimitState,
        walletUsage: dailyUsageState,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([supportPayer])
      .rpc();

    await supplyCap.methods
      .initializeModule(tokenMint, new BN(100))
      .accounts({ owner: owner.publicKey, moduleState: supplyCapState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await countryCap.methods
      .initializeModule(tokenMint, [{ country: 840, cap: new BN(10) }])
      .accounts({ owner: owner.publicKey, moduleState: countryCapState, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([owner])
      .rpc();

    await countryCap.methods
      .initializeCountryCount(840)
      .accounts({
        owner: supportPayer.publicKey,
        moduleState: countryCapState,
        countryCount: usCountryCount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([supportPayer])
      .rpc();

    await maxInvestors.methods
      .setHookAuthority(complianceState)
      .accounts({ owner: owner.publicKey, moduleState: maxInvestorsState })
      .signers([owner])
      .rpc();

    await dailyLimit.methods
      .setHookAuthority(complianceState)
      .accounts({ owner: owner.publicKey, moduleState: dailyLimitState })
      .signers([owner])
      .rpc();

    await supplyCap.methods
      .setHookAuthority(complianceState)
      .accounts({ owner: owner.publicKey, moduleState: supplyCapState })
      .signers([owner])
      .rpc();

    await countryCap.methods
      .setHookAuthority(complianceState)
      .accounts({ owner: owner.publicKey, moduleState: countryCapState })
      .signers([owner])
      .rpc();

    for (const moduleState of [maxInvestorsState, dailyLimitState, supplyCapState, countryCapState]) {
      await compliance.methods
        .bindModule(moduleState)
        .accounts({ owner: owner.publicKey, complianceState })
        .signers([owner])
        .rpc();
    }

    await compliance.methods
      .created(owner.publicKey, new BN(25), new BN(25), 840)
      .accounts({ complianceState })
      .remainingAccounts([
        { pubkey: maxInvestorsState, isSigner: false, isWritable: true },
        { pubkey: maxInvestors.programId, isSigner: false, isWritable: false },
        { pubkey: dailyLimitState, isSigner: false, isWritable: true },
        { pubkey: dailyLimit.programId, isSigner: false, isWritable: false },
        { pubkey: dailyUsageState, isSigner: false, isWritable: true },
        { pubkey: supplyCapState, isSigner: false, isWritable: true },
        { pubkey: supplyCap.programId, isSigner: false, isWritable: false },
        { pubkey: countryCapState, isSigner: false, isWritable: true },
        { pubkey: countryCap.programId, isSigner: false, isWritable: false },
        { pubkey: usCountryCount, isSigner: false, isWritable: true },
      ])
      .rpc();

    let maxInvestorsAccount = await maxInvestors.account.maxInvestorsModule.fetch(maxInvestorsState);
    let dailyUsageAccount = await dailyLimit.account.dailyWalletUsage.fetch(dailyUsageState);
    let supplyCapAccount = await supplyCap.account.supplyCapModule.fetch(supplyCapState);
    let countryCapCount = await countryCap.account.countryInvestorCount.fetch(usCountryCount);
    expect(maxInvestorsAccount.holderCount.toNumber()).to.equal(1);
    expect(dailyUsageAccount.volume.toNumber()).to.equal(0);
    expect(supplyCapAccount.totalSupply.toNumber()).to.equal(25);
    expect(countryCapCount.count.toNumber()).to.equal(1);

    await compliance.methods
      .transferred(owner.publicKey, tokenMint, new BN(25), new BN(0), new BN(25), 840, 840)
      .accounts({ complianceState })
      .remainingAccounts([
        { pubkey: maxInvestorsState, isSigner: false, isWritable: true },
        { pubkey: maxInvestors.programId, isSigner: false, isWritable: false },
        { pubkey: dailyLimitState, isSigner: false, isWritable: true },
        { pubkey: dailyLimit.programId, isSigner: false, isWritable: false },
        { pubkey: dailyUsageState, isSigner: false, isWritable: true },
        { pubkey: supplyCapState, isSigner: false, isWritable: true },
        { pubkey: supplyCap.programId, isSigner: false, isWritable: false },
        { pubkey: countryCapState, isSigner: false, isWritable: true },
        { pubkey: countryCap.programId, isSigner: false, isWritable: false },
        { pubkey: usCountryCount, isSigner: false, isWritable: true },
        { pubkey: usCountryCount, isSigner: false, isWritable: true },
      ])
      .rpc();

    maxInvestorsAccount = await maxInvestors.account.maxInvestorsModule.fetch(maxInvestorsState);
    dailyUsageAccount = await dailyLimit.account.dailyWalletUsage.fetch(dailyUsageState);
    supplyCapAccount = await supplyCap.account.supplyCapModule.fetch(supplyCapState);
    countryCapCount = await countryCap.account.countryInvestorCount.fetch(usCountryCount);
    expect(maxInvestorsAccount.holderCount.toNumber()).to.equal(1);
    expect(dailyUsageAccount.volume.toNumber()).to.equal(25);
    expect(supplyCapAccount.totalSupply.toNumber()).to.equal(25);
    expect(countryCapCount.count.toNumber()).to.equal(1);

    await compliance.methods
      .destroyed(owner.publicKey, new BN(10), new BN(0), 840)
      .accounts({ complianceState })
      .remainingAccounts([
        { pubkey: maxInvestorsState, isSigner: false, isWritable: true },
        { pubkey: maxInvestors.programId, isSigner: false, isWritable: false },
        { pubkey: dailyLimitState, isSigner: false, isWritable: true },
        { pubkey: dailyLimit.programId, isSigner: false, isWritable: false },
        { pubkey: supplyCapState, isSigner: false, isWritable: true },
        { pubkey: supplyCap.programId, isSigner: false, isWritable: false },
        { pubkey: countryCapState, isSigner: false, isWritable: true },
        { pubkey: countryCap.programId, isSigner: false, isWritable: false },
        { pubkey: usCountryCount, isSigner: false, isWritable: true },
      ])
      .rpc();

    maxInvestorsAccount = await maxInvestors.account.maxInvestorsModule.fetch(maxInvestorsState);
    supplyCapAccount = await supplyCap.account.supplyCapModule.fetch(supplyCapState);
    countryCapCount = await countryCap.account.countryInvestorCount.fetch(usCountryCount);
    expect(maxInvestorsAccount.holderCount.toNumber()).to.equal(0);
    expect(supplyCapAccount.totalSupply.toNumber()).to.equal(15);
    expect(countryCapCount.count.toNumber()).to.equal(0);
  });

});
