# RWA Compliance Minting Fix — Task Tracker

- `[ ]` 1. Remove `setIdentityActivation` call from `token.ts`'s `mint()` flow.
- `[ ]` 2. Add recipient/investor identity active check: if registered but inactive, query IRS/IRP owner dynamically and throw a clear, early error pointing to the platform admin.
- `[ ]` 3. Refactor `validateRecipientClaimsForMint` to check for missing claims, expired claims, revoked claims, and untrusted claim issuers in TIR.
- `[ ]` 4. Dynamically derive and fetch the TIR Owner from the `tir_state` account to include in the untrusted issuer error message.
- `[ ]` 5. Make sure no automatic repair is executed inside the `mint()` flow (neither TIR repair nor identity activation).
- `[ ]` 6. Verify that identity derivation uses the wallet owner's public key (recipient), not the ATA.
- `[ ]` 7. Create the mint simulation script `frontend/src/scratch/simulate_mint.ts` to perform pre-flight compliance lookups and simulate the mint transaction.
- `[ ]` 8. Run the simulation script and verify success.
- `[ ]` 9. Run type checking `pnpm exec tsc --noEmit` and production build `pnpm run build`.
- `[ ]` 10. Write the walkthrough summarizing exact contract conditions, wrong/missing values, changed files, and simulation results.
