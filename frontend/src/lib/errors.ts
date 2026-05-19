// ─── FRACKS Error Decoder ─────────────────────────────────────────────────────
//
// Centralises all on-chain error codes across every FRACKS program so the
// frontend can present user-friendly messages instead of raw numeric codes.
// ─────────────────────────────────────────────────────────────────────────────

export interface DecodedError {
  code: number;
  name: string;
  message: string;
  userMessage: string;
}

// ─── Error Tables ─────────────────────────────────────────────────────────────

/**
 * Token-Hook program errors (base offset 6000).
 * Source: fracks_token_hook IDL.
 */
const TOKEN_HOOK_ERRORS: Record<number, Omit<DecodedError, "code">> = {
  6000: {
    name: "InvalidTokenState",
    message: "Invalid FRACKS token state.",
    userMessage: "The token state account is invalid or not initialized.",
  },
  6001: {
    name: "InvalidTokenAccount",
    message: "Invalid Token-2022 account.",
    userMessage: "The token account is not a valid Token-2022 account.",
  },
  6002: {
    name: "MissingTransferHook",
    message: "Token-2022 mint is missing the FRACKS transfer hook.",
    userMessage: "This token does not have the required transfer hook configured.",
  },
  6003: {
    name: "MissingPermanentDelegate",
    message: "Token-2022 mint is missing the FRACKS permanent delegate.",
    userMessage:
      "This token does not have the required permanent delegate extension.",
  },
  6004: {
    name: "InvalidExtraAccountMetas",
    message: "Invalid extra-account-metas account.",
    userMessage: "The hook configuration account is invalid.",
  },
  6005: {
    name: "ProgramCalledOutsideTransfer",
    message: "Transfer hook was called outside an active Token-2022 transfer.",
    userMessage: "The transfer hook can only be invoked during a token transfer.",
  },
  6006: {
    name: "MissingTransferApproval",
    message: "FRACKS transfer approval is missing or invalid.",
    userMessage:
      "Transfer requires a compliance pre-approval. Please request approval before transferring.",
  },
  6007: {
    name: "NotController",
    message: "Invalid controller authority.",
    userMessage: "You are not authorized to perform this action.",
  },
  6008: {
    name: "InsufficientBalance",
    message: "Insufficient transferable balance.",
    userMessage:
      "Insufficient balance. Some funds may be frozen or locked up.",
  },
  6009: {
    name: "ArithmeticOverflow",
    message: "Arithmetic overflow.",
    userMessage: "A numerical overflow occurred. The amount may be too large.",
  },
  6010: {
    name: "InvalidCompliance",
    message: "Invalid compliance account.",
    userMessage: "The compliance configuration account is invalid.",
  },
  6011: {
    name: "InvalidOwnerState",
    message: "Invalid FRACKS owner state.",
    userMessage: "The token ownership account is invalid.",
  },
  6012: {
    name: "NotOwner",
    message: "Signer is not the FRACKS token owner.",
    userMessage: "Only the token owner can perform this action.",
  },
  6013: {
    name: "TooManyModules",
    message: "Too many compliance modules for Token-2022 extra-account-metas.",
    userMessage:
      "The token has too many compliance modules attached. Remove some modules first.",
  },
  6014: {
    name: "InvalidComplianceModule",
    message: "Invalid compliance module account.",
    userMessage: "One of the compliance module accounts is invalid.",
  },
};

const TOKEN_RAW_ERRORS: Record<number, Omit<DecodedError, "code">> = {
  6000: {
    name: "NotOwner",
    message: "Signer is not the owner.",
    userMessage: "Only the token owner can perform this action.",
  },
  6001: {
    name: "WalletNotVerified",
    message: "Wallet is not verified.",
    userMessage:
      "Investor wallet is not registered and active in this token identity registry.",
  },
  6002: {
    name: "WalletFrozen",
    message: "Wallet is frozen.",
    userMessage: "This wallet is frozen and cannot receive tokens.",
  },
  6003: {
    name: "TokenPaused",
    message: "Token is paused.",
    userMessage: "This token is currently paused.",
  },
  6009: {
    name: "NotAgent",
    message: "Signer is not an active agent.",
    userMessage: "Connected wallet is not an active token agent.",
  },
  6011: {
    name: "UnauthorizedAuthority",
    message: "Signer is neither the suite owner nor an active agent.",
    userMessage:
      "Connected wallet is not authorized to operate this token suite.",
  },
  6032: {
    name: "InvalidTokenAccount",
    message: "Token-2022 account is invalid.",
    userMessage: "A Token-2022 mint or token account is invalid.",
  },
};

const COMPLIANCE_RAW_ERRORS: Record<number, Omit<DecodedError, "code">> = {
  6047: {
    name: "ModuleAlreadyBound",
    message: "Module is already bound.",
    userMessage: "This compliance module is already attached to the token.",
  },
  6048: {
    name: "ModuleNotBound",
    message: "Module is not bound.",
    userMessage: "This compliance module is not attached to the token.",
  },
  6049: {
    name: "MissingModuleAccount",
    message: "Missing module account.",
    userMessage: "A required compliance module account is missing.",
  },
  6050: {
    name: "InvalidModuleAccount",
    message: "Invalid module account.",
    userMessage: "A compliance module account is invalid.",
  },
  6051: {
    name: "MissingModuleProgramAccount",
    message: "Missing module program account.",
    userMessage: "A required compliance module program account is missing.",
  },
  6052: {
    name: "ModuleHookAuthorityMismatch",
    message: "Module hook authority is not bound to this compliance state.",
    userMessage:
      "A compliance module's hook authority does not match the expected compliance state.",
  },
  6053: {
    name: "MissingModuleSupportAccount",
    message: "Missing module support account.",
    userMessage: "A required compliance module support account is missing.",
  },
};

const IRS_RAW_ERRORS: Record<number, Omit<DecodedError, "code">> = {
  6015: {
    name: "WalletAlreadyRegistered",
    message: "Wallet is already registered.",
    userMessage: "This wallet already has an identity registered.",
  },
  6016: {
    name: "WalletNotRegistered",
    message: "Wallet is not registered.",
    userMessage: "This wallet does not have an identity registered.",
  },
  6017: {
    name: "InvalidCountryCode",
    message: "Country code is invalid.",
    userMessage: "The provided country code is not valid.",
  },
  6038: {
    name: "InvalidFidAccount",
    message: "FID account is missing or does not match the wallet.",
    userMessage:
      "This investor must create/register their FID first. The FID account is missing or does not belong to this wallet.",
  },
  6039: {
    name: "InvalidInvestorFid",
    message: "Investor registration requires a non-issuer FID.",
    userMessage: "Investor onboarding requires an investor FID, not an issuer FID.",
  },
  6040: {
    name: "FidCountryMismatch",
    message: "FID country does not match IRS identity country.",
    userMessage: "The investor FID country does not match the country entered for this identity.",
  },
};

const ERROR_NAME_USER_MESSAGES: Record<string, string> = {
  WalletNotVerified:
    "Wallet is not verified. The sender and recipient must both have active FID identity and valid required claims.",
  InvalidFidAccount:
    "This investor must create/register their FID first. The FID account is missing or does not belong to this wallet.",
  InvalidInvestorFid:
    "Investor onboarding requires an investor FID, not an issuer FID.",
  FidCountryMismatch:
    "The investor FID country does not match the country entered for this identity.",
  WalletAlreadyRegistered: "This wallet already has an identity registered.",
  WalletNotRegistered: "This wallet does not have an identity registered.",
  DuplicateClaimTopicIssuer:
    "An active claim already exists for this provider, topic, and investor. Forward the request instead of issuing a duplicate claim.",
};

/**
 * Errors shared across multiple FRACKS programs (base offset 12000).
 * Each program may use a subset of these codes.
 */
const FRACKS_COMMON_ERRORS: Record<number, Omit<DecodedError, "code">> = {
  // ── Token program ─────────────────────────────────────────────────────────
  12000: {
    name: "NotOwner",
    message: "Signer is not the owner.",
    userMessage: "Only the token owner can perform this action.",
  },
  12001: {
    name: "WalletNotVerified",
    message: "Wallet is not verified.",
    userMessage:
      "Your wallet has not been verified. Complete KYC/identity verification to participate.",
  },
  12002: {
    name: "WalletFrozen",
    message: "Wallet is frozen.",
    userMessage:
      "This wallet is frozen and cannot send or receive tokens.",
  },
  12003: {
    name: "TokenPaused",
    message: "Token is paused.",
    userMessage:
      "All transfers for this token are currently paused by the issuer.",
  },
  12004: {
    name: "ComplianceCheckFailed",
    message: "Compliance check failed.",
    userMessage:
      "This transfer does not meet compliance requirements. Contact the token issuer for details.",
  },
  12007: {
    name: "IssuerNotTrusted",
    message: "Claim issuer is not trusted.",
    userMessage: "The identity claim issuer is not in the trusted issuers registry.",
  },
  12008: {
    name: "InvalidClaimSignature",
    message: "Claim signature is invalid.",
    userMessage: "The identity claim has an invalid cryptographic signature.",
  },
  12009: {
    name: "NotAgent",
    message: "Signer is not an active agent.",
    userMessage: "You do not have agent permissions for this token.",
  },
  12010: {
    name: "InsufficientBalance",
    message: "Insufficient transferable balance.",
    userMessage:
      "Insufficient balance. Some funds may be frozen or subject to a lockup.",
  },
  12012: {
    name: "FidAlreadyExists",
    message: "FID already exists for this wallet.",
    userMessage: "An identity record already exists for this wallet address.",
  },
  12013: {
    name: "InvalidRegistryReference",
    message: "Registry reference is invalid.",
    userMessage: "The identity registry reference is invalid.",
  },
  12014: {
    name: "MaxModulesReached",
    message: "Max modules reached.",
    userMessage:
      "The compliance module limit has been reached. Remove an existing module before adding a new one.",
  },
  12015: {
    name: "WalletAlreadyRegistered",
    message: "Wallet is already registered.",
    userMessage: "This wallet already has an identity registered.",
  },
  12016: {
    name: "WalletNotRegistered",
    message: "Wallet is not registered.",
    userMessage: "This wallet does not have an identity registered.",
  },
  12017: {
    name: "InvalidCountryCode",
    message: "Country code is invalid.",
    userMessage: "The provided country code is not a valid ISO 3166-1 numeric code.",
  },
  12025: {
    name: "NotPendingOwner",
    message: "Pending owner mismatch.",
    userMessage: "Only the pending owner can accept ownership.",
  },
  12026: {
    name: "MetadataTooLong",
    message: "Metadata exceeds the documented length limits.",
    userMessage: "Token name, symbol, or ISIN exceeds the maximum length.",
  },
  12027: {
    name: "MissingEd25519Instruction",
    message: "An ed25519 verification instruction is required before add_claim.",
    userMessage:
      "Identity claims require an Ed25519 signature verification instruction.",
  },
  12028: {
    name: "InvalidInstructionsSysvar",
    message: "The provided instructions sysvar account is invalid.",
    userMessage: "Transaction instruction sysvar is missing or invalid.",
  },
  12029: {
    name: "ArithmeticOverflow",
    message: "Arithmetic overflow.",
    userMessage: "A numerical overflow occurred.",
  },
  12030: {
    name: "ClaimFidMismatch",
    message: "Claim account does not belong to the provided FID.",
    userMessage: "The claim does not belong to this identity.",
  },
  12031: {
    name: "RegistryAlreadyBound",
    message: "Registry is already bound.",
    userMessage: "This identity registry is already bound.",
  },
  12032: {
    name: "RegistryNotBound",
    message: "Registry is not bound.",
    userMessage: "This identity registry is not bound.",
  },
  12033: {
    name: "MaxBoundRegistriesReached",
    message: "Maximum bound registries reached.",
    userMessage: "Cannot bind more registries – the limit has been reached.",
  },
  12034: {
    name: "ArithmeticOverflow",
    message: "Arithmetic overflow.",
    userMessage: "A numerical overflow occurred.",
  },
  12035: {
    name: "TooManyTopics",
    message: "Too many topics supplied.",
    userMessage: "The number of claim topics exceeds the maximum allowed.",
  },
  12036: {
    name: "LabelTooLong",
    message: "Issuer label is too long.",
    userMessage: "The issuer label exceeds the 64-character limit.",
  },
  12037: {
    name: "DuplicateTopic",
    message: "Duplicate topic supplied.",
    userMessage: "Each claim topic must appear only once.",
  },
  12038: {
    name: "ArithmeticOverflow",
    message: "Arithmetic overflow.",
    userMessage: "A numerical overflow occurred.",
  },
  12039: {
    name: "MaxTopicsReached",
    message: "Maximum topics reached.",
    userMessage: "The maximum number of claim topics has been reached.",
  },
  12040: {
    name: "TopicAlreadyExists",
    message: "Topic already exists.",
    userMessage: "This claim topic has already been registered.",
  },
  12041: {
    name: "TopicNotFound",
    message: "Topic not found.",
    userMessage: "The requested claim topic was not found.",
  },
  12042: {
    name: "IdentityAgentAlreadyExists",
    message: "Identity agent already exists.",
    userMessage: "This wallet is already an identity agent.",
  },
  12043: {
    name: "MaxIdentityAgentsReached",
    message: "Maximum identity agents reached.",
    userMessage: "The maximum number of identity agents has been reached.",
  },
  12044: {
    name: "TrustedIssuerNotFound",
    message: "Trusted issuer entry not found.",
    userMessage: "The trusted issuer entry was not found in the registry.",
  },
  12045: {
    name: "IssuerFidNotFound",
    message: "Issuer FID account not found.",
    userMessage: "The issuer identity (FID) account was not found.",
  },
  12046: {
    name: "InvalidClaimSignature",
    message: "Claim signature is invalid.",
    userMessage: "The identity claim has an invalid cryptographic signature.",
  },
  12047: {
    name: "ModuleAlreadyBound",
    message: "Module is already bound.",
    userMessage: "This compliance module is already attached to the token.",
  },
  12048: {
    name: "ModuleNotBound",
    message: "Module is not bound.",
    userMessage: "This compliance module is not attached to the token.",
  },
  12049: {
    name: "MissingModuleAccount",
    message: "Missing module account.",
    userMessage: "A required compliance module account is missing.",
  },
  12050: {
    name: "InvalidModuleAccount",
    message: "Invalid module account.",
    userMessage: "A compliance module account is invalid.",
  },
  12051: {
    name: "MissingModuleProgramAccount",
    message: "Missing module program account.",
    userMessage: "A required compliance module program account is missing.",
  },
  12052: {
    name: "ModuleHookAuthorityMismatch",
    message: "Module hook authority is not bound to this compliance state.",
    userMessage:
      "A compliance module's hook authority does not match the expected compliance state.",
  },
  12053: {
    name: "MissingModuleSupportAccount",
    message: "Missing module support account.",
    userMessage: "A required compliance module support account is missing.",
  },
  // ── Factory ───────────────────────────────────────────────────────────────
  12060: {
    name: "DeploymentAlreadyExists",
    message: "Deployment already exists for this issuer and salt.",
    userMessage:
      "A token suite with this salt has already been deployed by this issuer. Use a different salt.",
  },
  12061: {
    name: "InvalidDerivedAccount",
    message: "One or more derived accounts do not match the expected PDA.",
    userMessage: "An account address does not match the expected derived address.",
  },
  12062: {
    name: "ProgramIdMismatch",
    message: "The provided program IDs do not match the factory configuration.",
    userMessage: "Program IDs do not match the factory's registered programs.",
  },
  12063: {
    name: "MissingTrustedIssuerAccounts",
    message: "Missing issuer entry accounts for trusted issuer initialization.",
    userMessage: "Trusted issuer accounts were not provided.",
  },
  12064: {
    name: "InvalidTokenMetadata",
    message: "Token metadata is invalid.",
    userMessage: "Token name, symbol, or ISIN is invalid.",
  },
  12065: {
    name: "TooManyClaimTopics",
    message: "Too many claim topics were provided.",
    userMessage: "Reduce the number of claim topics and try again.",
  },
  12066: {
    name: "TooManyTrustedIssuers",
    message: "Too many trusted issuers were provided.",
    userMessage: "Reduce the number of trusted issuers and try again.",
  },
  12067: {
    name: "TooManyComplianceModules",
    message: "Too many compliance modules were provided.",
    userMessage:
      "Too many compliance modules selected. Reduce the module count and try again.",
  },
  12068: {
    name: "TrustedIssuerTopicsEmpty",
    message: "Trusted issuers must declare at least one topic.",
    userMessage:
      "Each trusted issuer must be associated with at least one claim topic.",
  },
  12069: {
    name: "InvalidTrustedIssuerLabel",
    message: "Trusted issuer labels must be between 1 and 64 characters.",
    userMessage: "Issuer label must be between 1 and 64 characters.",
  },
  12070: {
    name: "ArithmeticOverflow",
    message: "Arithmetic overflow.",
    userMessage: "A numerical overflow occurred.",
  },
  12071: {
    name: "MissingComplianceModuleAccounts",
    message:
      "Missing compliance module accounts for hook extra-account-metas initialization.",
    userMessage: "Compliance module accounts are missing from the transaction.",
  },
  12072: {
    name: "TokenMintAlreadyInitialized",
    message: "Token-2022 mint account is already initialized.",
    userMessage: "The token mint has already been initialized.",
  },
  12073: {
    name: "InvalidTokenMint",
    message: "Token-2022 mint account is invalid.",
    userMessage: "The provided token mint address is invalid.",
  },
  12074: {
    name: "NotPendingOwner",
    message: "Pending owner mismatch.",
    userMessage: "Only the pending owner can accept ownership.",
  },
  12075: {
    name: "InvalidPendingOwner",
    message: "Pending owner cannot be the default pubkey.",
    userMessage: "The pending owner address is invalid.",
  },
};

/**
 * Module-specific compliance errors (base 12000).
 * Includes errors from daily_limit, supply_cap, max_investors, country_cap,
 * country_restrict, and generic module authorization errors.
 *
 * Note: Several module programs reuse the same numeric codes with different
 * semantics. The entries below capture the most impactful user-facing variant.
 * Context-aware decoding is handled by inspecting log messages where possible.
 */
const COMPLIANCE_MODULE_ERRORS: Record<number, Omit<DecodedError, "code">> = {
  // 12001 — used by: country_restrict (TooManyCountries),
  //                   mod_max_investors / mod_supply_cap / mod_daily_limit / mod_country_cap (NotAuthorized)
  //         Most common failure path for an end-user is NotAuthorized.
  12001: {
    name: "NotAuthorized",
    message: "Signer is not authorized to update module hook state.",
    userMessage:
      "You are not authorized to update this compliance module's state.",
  },
  // 12002 — used by: mod_daily_limit (InvalidUsageAccount),
  //                   mod_supply_cap (MaxSupplyExceeded),
  //                   mod_country_cap (InvalidCountryCount)
  //         MaxSupplyExceeded is the most visible to token investors.
  12002: {
    name: "MaxSupplyExceeded",
    message: "Max supply exceeded.",
    userMessage:
      "This mint would exceed the configured supply cap. The issuer has capped the total supply.",
  },
  // 12003 — ArithmeticOverflow in module programs
  12003: {
    name: "ArithmeticOverflow",
    message: "Arithmetic overflow.",
    userMessage: "A numerical overflow occurred in a compliance module.",
  },
  // 12004 — TooManyCountryCaps (mod_country_cap)
  12004: {
    name: "TooManyCountryCaps",
    message: "Too many country caps.",
    userMessage: "The number of country caps exceeds the maximum allowed.",
  },
};

// ─── Human-readable compliance module check messages ──────────────────────────

const COMPLIANCE_CHECK_USER_MESSAGES: Record<string, string> = {
  DailyLimitExceeded:
    "Daily transfer limit exceeded. Try again after the 24-hour window resets.",
  MaxBalanceExceeded:
    "Maximum balance would be exceeded. The recipient cannot hold more tokens.",
  MaxTransferExceeded:
    "Transfer amount exceeds the single-transfer limit.",
  LockupActive:
    "Tokens are in lockup and cannot be transferred until the lockup period expires.",
  SupplyCapExceeded:
    "Total supply cap would be exceeded. No more tokens can be minted.",
  MaxInvestorsExceeded:
    "Maximum number of investors has been reached. No new wallets can receive tokens.",
  CountryRestricted:
    "Country not allowed. This transfer involves a restricted jurisdiction.",
  CountryCapExceeded:
    "Country investor cap reached. No more investors from this country are permitted.",
};

// ─── Anchor Framework Errors (100–299) ───────────────────────────────────────

const ANCHOR_FRAMEWORK_ERRORS: Record<number, Omit<DecodedError, "code">> = {
  100: { name: "InstructionMissing", message: "8-byte instruction identifier not provided.", userMessage: "Transaction malformed: instruction identifier missing." },
  101: { name: "InstructionFallbackNotFound", message: "Fallback functions are not supported.", userMessage: "The instruction sent doesn't match any on-chain instruction. The IDL version may be out of sync with the deployed program." },
  102: { name: "InstructionDidNotDeserialize", message: "The program could not deserialize the instruction.", userMessage: "Instruction arguments are invalid or the IDL is mismatched with the on-chain program." },
  103: { name: "InstructionDidNotSerialize", message: "The program could not serialize the instruction.", userMessage: "Failed to serialize instruction response." },
  1000: { name: "IdlInstructionStub", message: "The program was compiled without IDL instructions.", userMessage: "IDL instructions are not available in this build." },
  1001: { name: "IdlInstructionInvalidProgram", message: "Invalid program given to the IDL instruction.", userMessage: "IDL instruction received an invalid program." },
  2000: { name: "ConstraintMut", message: "A mut constraint was violated.", userMessage: "An account required to be mutable is not mutable." },
  2001: { name: "ConstraintHasOne", message: "A has_one constraint was violated.", userMessage: "An account ownership check failed." },
  2002: { name: "ConstraintSigner", message: "A signer constraint was violated.", userMessage: "A required signer did not sign the transaction." },
  2003: { name: "ConstraintRaw", message: "A raw constraint was violated.", userMessage: "A constraint check failed." },
  2004: { name: "ConstraintOwner", message: "An owner constraint was violated.", userMessage: "An account is not owned by the expected program." },
  2005: { name: "ConstraintRentExempt", message: "A rent exemption constraint was violated.", userMessage: "An account does not have enough SOL to be rent-exempt." },
  2006: { name: "ConstraintSeeds", message: "A seeds constraint was violated.", userMessage: "A PDA address did not match the expected derived address." },
  2007: { name: "ConstraintExecutable", message: "An executable constraint was violated.", userMessage: "An account expected to be executable (a program) is not." },
  2008: { name: "ConstraintState", message: "A state constraint was violated.", userMessage: "An account state constraint failed." },
  2009: { name: "ConstraintAssociated", message: "An associated constraint was violated.", userMessage: "An associated token account address is incorrect." },
  2010: { name: "ConstraintAssociatedInit", message: "An associated init constraint was violated.", userMessage: "Failed to initialize an associated token account." },
  2011: { name: "ConstraintClose", message: "A close constraint was violated.", userMessage: "Account close destination is invalid." },
  2012: { name: "ConstraintAddress", message: "An address constraint was violated.", userMessage: "An account address does not match the expected address." },
  2013: { name: "ConstraintZero", message: "Expected zero account discriminant.", userMessage: "An account was expected to be empty/uninitialized." },
  2014: { name: "ConstraintTokenMint", message: "A token mint constraint was violated.", userMessage: "Token account mint does not match the expected mint." },
  2015: { name: "ConstraintTokenOwner", message: "A token owner constraint was violated.", userMessage: "Token account owner does not match the expected owner." },
  2016: { name: "ConstraintMintMintAuthority", message: "Mint authority constraint violated.", userMessage: "Mint authority does not match the expected authority." },
  2017: { name: "ConstraintMintFreezeAuthority", message: "Freeze authority constraint violated.", userMessage: "Freeze authority does not match the expected authority." },
  2018: { name: "ConstraintMintDecimals", message: "Mint decimals constraint violated.", userMessage: "Mint decimals do not match the expected value." },
  2019: { name: "ConstraintSpace", message: "A space constraint was violated.", userMessage: "Account does not have the expected size." },
  3000: { name: "AccountDiscriminatorAlreadySet", message: "Account discriminator already set.", userMessage: "Attempted to re-initialize an already-initialized account." },
  3001: { name: "AccountDiscriminatorNotFound", message: "Account discriminator not found.", userMessage: "Account discriminator missing — the account may not be initialized." },
  3002: { name: "AccountDiscriminatorMismatch", message: "Account discriminator mismatch.", userMessage: "Account type mismatch — the account data does not match the expected account type." },
  3003: { name: "AccountDidNotDeserialize", message: "Failed to deserialize account.", userMessage: "Could not read account data. The account may be corrupted or the IDL is out of date." },
  3004: { name: "AccountDidNotSerialize", message: "Failed to serialize account.", userMessage: "Could not write account data." },
  3005: { name: "AccountNotEnoughKeys", message: "Not enough account keys given to instruction.", userMessage: "Transaction is missing required accounts." },
  3006: { name: "AccountNotMutable", message: "The given account is not mutable.", userMessage: "An account that must be writable is read-only." },
  3007: { name: "AccountOwnedByWrongProgram", message: "Account owned by wrong program.", userMessage: "An account is owned by an unexpected program." },
  3008: { name: "InvalidProgramId", message: "Program ID was not as expected.", userMessage: "A program account has an unexpected program ID." },
  3009: { name: "InvalidProgramExecutable", message: "Program is not executable.", userMessage: "A program account is not marked as executable." },
  3010: { name: "AccountNotSigner", message: "The given account did not sign.", userMessage: "A required account signature is missing." },
  3011: { name: "AccountNotSystemOwned", message: "Account is not owned by system program.", userMessage: "An account expected to be system-owned is not." },
  3012: { name: "AccountNotInitialized", message: "The program expected this account to be initialized.", userMessage: "An account has not been initialized. Please initialize it first." },
  3013: { name: "AccountNotProgramData", message: "The given account is not a program data account.", userMessage: "An account expected to be program data is not." },
  3014: { name: "AccountNotAssociatedTokenAccount", message: "The given account is not the associated token account.", userMessage: "An account is not the correct associated token account." },
  3015: { name: "AccountSysvarMismatch", message: "The given public key does not match the required sysvar.", userMessage: "A sysvar account address is incorrect." },
  3016: { name: "AccountReallocExceedsLimit", message: "The account reallocation exceeds the MAX_PERMITTED_DATA_INCREASE limit.", userMessage: "Account data resize exceeds the permitted limit." },
  3017: { name: "AccountDuplicateReallocs", message: "The account was duplicated for realloc.", userMessage: "Account reallocation was attempted more than once." },
  4000: { name: "DeclaredProgramIdMismatch", message: "The declared program id does not match the actual program id.", userMessage: "Program ID mismatch between the IDL and the running program." },
  5000: { name: "Deprecated", message: "Deprecated account used.", userMessage: "A deprecated account type was used." },
};

// ─── Parse Helpers ────────────────────────────────────────────────────────────

/**
 * Extracts the numeric error code from an Anchor program error.
 * Anchor encodes errors in several shapes depending on version and context.
 */
function extractAnchorErrorCode(err: unknown): number | null {
  if (err === null || err === undefined) return null;

  // AnchorError with code property
  if (
    typeof err === "object" &&
    "error" in err &&
    err.error !== null &&
    typeof err.error === "object" &&
    "errorCode" in err.error
  ) {
    const ec = (err as { error: { errorCode: { number: number } } }).error
      .errorCode;
    if (typeof ec.number === "number") return ec.number;
  }

  // ProgramError shape: { code: number }
  if (typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "number") return code;
  }

  // SendTransactionError / generic Error with message containing the code
  const msg =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : typeof err === "string"
      ? err
      : "";

  // "custom program error: 0x1770" → 6000 decimal
  const hexMatch = msg.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
  if (hexMatch) return parseInt(hexMatch[1], 16);

  // "Error Code: InvalidTokenState. Error Number: 6000."
  const numMatch = msg.match(/Error Number:\s*(\d+)/i);
  if (numMatch) return parseInt(numMatch[1], 10);

  // Raw decimal code
  const rawMatch = msg.match(/\b(6\d{3}|12\d{3})\b/);
  if (rawMatch) return parseInt(rawMatch[1], 10);

  return null;
}

function extractAnchorErrorName(err: unknown): string | null {
  const msg =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : typeof err === "string"
      ? err
      : "";
  return msg.match(/Error Code:\s*([A-Za-z0-9_]+)/i)?.[1] ?? null;
}

function lookupErrorCode(
  code: number
): Omit<DecodedError, "code"> | null {
  // Anchor framework range (100–5999)
  if (code >= 100 && code < 6000) {
    return ANCHOR_FRAMEWORK_ERRORS[code] ?? null;
  }
  // Token-hook range (6000–6999)
  if (code >= 6000 && code < 7000) {
    return IRS_RAW_ERRORS[code] ?? COMPLIANCE_RAW_ERRORS[code] ?? TOKEN_RAW_ERRORS[code] ?? TOKEN_HOOK_ERRORS[code] ?? null;
  }
  // FRACKS program range (12000+)
  if (code >= 12000) {
    return (
      FRACKS_COMMON_ERRORS[code] ??
      COMPLIANCE_MODULE_ERRORS[code] ??
      null
    );
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses an Anchor / Solana error and returns structured data.
 * Returns null if the error cannot be decoded as a known program error.
 */
export function parseAnchorError(err: unknown): DecodedError | null {
  const name = extractAnchorErrorName(err);
  if (name && ERROR_NAME_USER_MESSAGES[name]) {
    return {
      code: -1,
      name,
      message: name,
      userMessage: ERROR_NAME_USER_MESSAGES[name],
    };
  }

  const code = extractAnchorErrorCode(err);
  if (code === null) return null;

  const entry = lookupErrorCode(code);
  if (!entry) {
    return {
      code,
      name: "UnknownProgramError",
      message: `Unknown program error code: ${code}`,
      userMessage: `An unexpected on-chain error occurred (code ${code}).`,
    };
  }

  return { code, ...entry };
}

/**
 * Returns a user-friendly string for a transfer-hook execution error.
 * Falls back to a generic message if the error cannot be decoded.
 */
export function decodeTransferHookError(err: unknown): string {
  const decoded = parseAnchorError(err);
  if (decoded) return decoded.userMessage;

  // Check for compliance check failure keyword
  const msg = String(
    typeof err === "object" && err !== null && "message" in err
      ? (err as { message: unknown }).message
      : err
  );

  const anchorNameMatch = msg.match(/Error Code:\s*([A-Za-z0-9_]+)/i);
  const anchorName = anchorNameMatch?.[1];
  if (anchorName && ERROR_NAME_USER_MESSAGES[anchorName]) {
    return ERROR_NAME_USER_MESSAGES[anchorName];
  }

  for (const [key, userMsg] of Object.entries(COMPLIANCE_CHECK_USER_MESSAGES)) {
    if (msg.toLowerCase().includes(key.toLowerCase())) return userMsg;
  }
  for (const [key, userMsg] of Object.entries(ERROR_NAME_USER_MESSAGES)) {
    if (msg.toLowerCase().includes(key.toLowerCase())) return userMsg;
  }

  return "Transfer failed due to a compliance or hook error. Contact the token issuer.";
}

/**
 * Returns a human-readable message for a numeric compliance error code.
 */
export function getComplianceErrorMessage(code: number): string {
  const entry = lookupErrorCode(code);
  return (
    entry?.userMessage ??
    `Compliance check failed with error code ${code}.`
  );
}

/**
 * Returns true if the error originates from a compliance check failure.
 */
export function isComplianceError(err: unknown): boolean {
  const code = extractAnchorErrorCode(err);
  if (code === null) return false;

  // Known compliance-related codes
  const complianceCodes = new Set([
    6006, // MissingTransferApproval
    6010, // InvalidCompliance
    6013, // TooManyModules
    6014, // InvalidComplianceModule
    12004, // ComplianceCheckFailed
    12047, // ModuleAlreadyBound
    12048, // ModuleNotBound
    12049, // MissingModuleAccount
    12050, // InvalidModuleAccount
    12051, // MissingModuleProgramAccount
    12052, // ModuleHookAuthorityMismatch
    12053, // MissingModuleSupportAccount
    12014, // MaxModulesReached
  ]);
  if (complianceCodes.has(code)) return true;

  // Module check failures – daily limit, max balance, etc.
  const msg = String(
    typeof err === "object" && err !== null && "message" in err
      ? (err as { message: unknown }).message
      : err
  );

  const anchorNameMatch = msg.match(/Error Code:\s*([A-Za-z0-9_]+)/i);
  const anchorName = anchorNameMatch?.[1];
  if (anchorName && ERROR_NAME_USER_MESSAGES[anchorName]) {
    return true;
  }
  for (const key of Object.keys(COMPLIANCE_CHECK_USER_MESSAGES)) {
    if (msg.toLowerCase().includes(key.toLowerCase())) return true;
  }

  return false;
}

/**
 * Formats any Solana / Anchor error into a presentable string for the UI.
 * Covers: decoded program errors, simulation failures, network errors.
 */
export function formatTransactionError(err: unknown): string {
  if (!err) return "An unknown error occurred.";

  // Try to decode as a known program error first
  const decoded = parseAnchorError(err);
  if (decoded) return decoded.userMessage;

  const msg = String(
    typeof err === "object" && err !== null && "message" in err
      ? (err as { message: unknown }).message
      : err
  );

  // User rejected transaction in wallet
  if (
    msg.includes("User rejected") ||
    msg.includes("user rejected") ||
    msg.includes("Transaction rejected")
  ) {
    return "Transaction was rejected in your wallet.";
  }

  // Insufficient SOL
  if (
    msg.includes("insufficient lamports") ||
    msg.includes("not enough SOL") ||
    msg.includes("insufficient funds for rent")
  ) {
    return "Insufficient SOL to pay for transaction fees and rent.";
  }

  if (
    msg.includes("Only the platform admin can deploy token suites") ||
    msg.includes("not the factory owner")
  ) {
    return "Only the platform admin wallet can deploy token suites. Connect the factory owner/admin wallet, then enter the issuer wallet as final owner.";
  }

  if (msg.includes("ComputationalBudgetExceeded")) {
    return "Transaction exceeded the Solana compute budget. Try again, or reduce the number of modules/accounts in this operation.";
  }

  if (
    msg.includes("encoding overruns Uint8Array") ||
    msg.includes("VersionedTransaction too large") ||
    msg.includes("Transaction too large")
  ) {
    return "The transfer transaction was too large to serialize. The app will create any missing recipient token account separately, then send the compliant transfer.";
  }

  if (msg.includes("ProgramFailedToComplete")) {
    return "The on-chain program could not finish the instruction. Please refresh state and try again; if it repeats, check that the connected wallet has the required role.";
  }

  if (msg.includes("unsafe") || msg.includes("Transaction resulted in an error")) {
    return "Wallet flagged this transaction because simulation failed. Check the selected wallet role, token, and compliance accounts before retrying.";
  }

  // Blockhash expired
  if (
    msg.includes("Blockhash not found") ||
    msg.includes("block height exceeded")
  ) {
    return "Transaction expired. Please try again.";
  }

  // Simulation failure
  if (msg.includes("Transaction simulation failed")) {
    const inner = msg.replace("Transaction simulation failed: ", "").trim();
    return `Simulation failed: ${inner || "unknown reason"}`;
  }

  // Network / RPC
  if (
    msg.includes("Failed to fetch") ||
    msg.includes("Network Error") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("429") ||
    msg.includes("Too Many Requests")
  ) {
    return "RPC rate limit hit. Please retry in a moment or switch to a less busy Solana testnet RPC endpoint.";
  }

  return msg || "An unexpected error occurred.";
}
