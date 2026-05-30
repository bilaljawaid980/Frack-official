**FRACKS**

PROTOCOL

*Permissioned Real-World Asset Token Standard on Solana*

**Technical Architecture Specification**

Version 1.0  |  Anchor Framework  |  Solana Mainnet

| Framework | Anchor (Rust) |
| :---- | :---- |
| **Blockchain** | Solana |
| **Token Standard** | SPL Token (Token-2022) |
| **Language** | Rust \+ TypeScript (client) |
| **Protocol Classification** | Permissioned Token / RWA |

| 🔑  1\. FRACKS PROTOCOL — OVERVIEW *Permissioned RWA Tokens on Solana* |
| :---- |

## **1.1 What is FRACKS?**

FRACKS is a Solana-native permissioned token protocol designed for the issuance, management, and compliant transfer of Real-World Asset (RWA) tokens. It implements a Compliance-by-Design architecture where every token transfer is validated against on-chain identity data and offering rules before execution.

FRACKS is built entirely on Solana using the Anchor framework and SPL Token standard. It is a full rebranding and native Solana implementation of the permissioned token architecture concept — using Solana's own primitives: Programs, Program Derived Addresses (PDAs), Cross-Program Invocations (CPIs), and SPL tokens.

## **1.2 Core Design Philosophy**

* Compliance by Design — No token can be transferred unless both the on-chain identity (FRACKS Identity) and all compliance rules pass validation.

* Fully On-Chain — Identity, claims, registries, and compliance rules are all stored on Solana. No off-chain validation required for a transfer to execute.

* Solana-Native — No EVM concepts. Uses SPL Token mints, PDAs, CPI, and Anchor program accounts throughout.

* Modular — Compliance rules are pluggable modules (separate Anchor programs or accounts) that can be added or removed by the issuer.

* Factory-Driven — A single Factory Program deploys and links all required programs and accounts for a new RWA token deployment in one operation.

## **1.3 The Four Pillars of FRACKS Validation**

Every transfer in FRACKS is gated by a decentralized on-chain validator composed of four pillars:

1. FRACKS Identity (FID) — A PDA-based on-chain identity account per user wallet, holding signed claims from trusted issuers. Analogous to a self-sovereign digital passport on Solana.

2. Eligibility Verification System (EVS) — Implemented inside the Identity Registry Program. The is\_verified() instruction checks that a wallet's linked FID holds all required claim topics issued by trusted issuers.

3. Compliance Modules — Pluggable rule accounts/programs bound to the token. The can\_transfer() check validates offering-level rules (max holders, country restrictions, lockups, etc.).

4. SPL Token Mint with Transfer Hook — A Token-2022 transfer hook enforces that no transfer executes without the EVS and Compliance checks passing, at the SPL level.

## **1.4 Mapping: FRACKS vs Original Architecture Concepts**

| Original Concept (EVM) | FRACKS Solana Equivalent | Solana Primitive Used |
| :---- | :---- | :---- |
| ERC-20 Token Contract | FRACKS Token Mint \+ Token Program | SPL Token-2022 Mint \+ Transfer Hook |
| ONCHAINID (ERC-734/735) | FRACKS Identity (FID) Account | PDA per wallet, seeds: \[b"fid", wallet\] |
| Identity Registry Contract | Identity Registry Program (IRP) | Anchor Program \+ Registry State PDA |
| Identity Registry Storage | Identity Registry Storage (IRS) | PDA per wallet: \[b"irs", wallet, token\_mint\] |
| Trusted Issuers Registry | Trusted Issuers Registry Program (TIR) | Anchor Program \+ Issuer PDA entries |
| Claim Topics Registry | Claim Topics Registry Program (CTR) | Anchor Program \+ Topic PDA entries |
| Modular Compliance Contract | Compliance Program (CP) | Anchor Program \+ Module PDAs |
| Compliance Modules (add-on) | Compliance Module Accounts | PDAs bound to Compliance Program |
| T-REX Factory | FRACKS Factory Program | Anchor Program deploying all PDAs |
| Implementation Authority | Solana Program Upgrade Authority | Native Solana upgradeable BPF program |
| Agent Role | Agent Role PDA | PDA: \[b"agent", token\_mint, agent\_pubkey\] |
| isVerified() | is\_verified() CPI | CPI from Token Program to IRP |
| canTransfer() | can\_transfer() CPI | CPI from Token Program to CP |
| forcedTransfer() | forced\_transfer() instruction | Agent-only instruction on Token Program |
| CREATE2 deterministic deploy | PDA deterministic addressing | seeds \+ bump derivation |

| 🏗️  2\. HIGH-LEVEL ARCHITECTURE *Programs, Accounts, and Data Flow* |
| :---- |

## **2.1 Programs Per RWA Token Deployment**

Each RWA token deployment on FRACKS involves the following Anchor programs. Some programs are shared (singletons deployed once on-chain), while others have per-token state accounts (PDAs). The Factory Program orchestrates the initialization of all per-token state in a single transaction.

| \# | Program Name | Scope | Purpose |
| :---- | :---- | :---- | :---- |
| 1 | FRACKS Factory Program | Singleton (global) | Deploys and initializes all per-token state in one transaction |
| 2 | FRACKS Token Program | Per RWA token | SPL Token-2022 mint \+ transfer hook for compliance enforcement |
| 3 | FRACKS Identity Program (FID) | Singleton (global) | Manages on-chain FID identity accounts per user wallet |
| 4 | Identity Registry Program (IRP) | Per RWA token | Maps wallets to FID accounts; runs is\_verified() for each token |
| 5 | Identity Registry Storage (IRS) | Per RWA token (shared) | PDA store of wallet→FID mappings; can be shared across tokens |
| 6 | Trusted Issuers Registry (TIR) | Per RWA token | Stores approved claim issuer pubkeys and their claim topics |
| 7 | Claim Topics Registry (CTR) | Per RWA token | Stores required claim topic codes (e.g., 1=KYC, 2=AML, 3=Accreditation) |
| 8 | Compliance Program (CP) | Per RWA token | Runs modular compliance checks via can\_transfer(); pluggable modules |

## 

## 

## 

## 

## 

## 

## **2.2 Full Architecture Diagram**

The diagram below shows all FRACKS programs, their PDAs, and how they interact during a token transfer:

┌──────────────────────────────────────────────────────────────────────────┐  
│                         FRACKS PROTOCOL — SOLANA                         │  
│                     Full Architecture (Per RWA Token)                    │  
└──────────────────────────────────────────────────────────────────────────┘  
   
  FACTORY PROGRAM (Singleton)                                                 
  ┌────────────────────────────────────────────────────────────────┐          
  │  FactoryState PDA  \[seeds: b"factory\_state"\]                   │          
  │  ├─ owner: Pubkey (factory deployer)                           │          
  │  ├─ implementation\_authority: Pubkey                           │          
  │  └─ token\_count: u64                                           │          
  │                                                                │          
  │  TokenDeployment PDA  \[seeds: b"deployment", salt\]             │          
  │  ├─ token\_mint: Pubkey                                         │          
  │  ├─ identity\_registry: Pubkey                                  │          
  │  ├─ compliance: Pubkey                                         │          
  │  ├─ trusted\_issuers\_registry: Pubkey                           │          
  │  └─ claim\_topics\_registry: Pubkey                              │          
  └────────────────────────────────────────────────────────────────┘          
           │  deploys & links all below                                       
           ▼                                                                   
  ┌────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐   
  │  FRACKS TOKEN      │    │  IDENTITY REGISTRY  │    │  COMPLIANCE      │   
  │  PROGRAM           │    │  PROGRAM (IRP)      │    │  PROGRAM (CP)    │   
  │                    │    │                     │    │                  │   
  │  TokenMint (SPL)   │    │  RegistryState PDA  │    │  ComplianceState │   
  │  TokenState PDA    │──▶ │  ├─ irs\_account     │    │  PDA             │   
  │  AgentRole PDAs    │    │  ├─ tir\_account     │    │  ModuleList PDAs │   
  │  FrozenWallet PDAs │    │  └─ ctr\_account     │    │                  │   
  │  TransferHook ─────│────│──▶ is\_verified()─────│────│──▶ can\_transfer() │   
  └────────────────────┘    └─────────────────────┘    └──────────────────┘   
                                      │                                        
              ┌───────────────────────┼──────────────────────┐                 
              ▼                       ▼                      ▼                 
  ┌─────────────────────┐  ┌──────────────────┐  ┌─────────────────────┐      
  │  IDENTITY REGISTRY  │  │ TRUSTED ISSUERS  │  │  CLAIM TOPICS       │     
  │  STORAGE (IRS)      │  │ REGISTRY (TIR)   │  │  REGISTRY (CTR)     │     
  │                     │  │                  │  │                      │     
  │  WalletIdentity PDA │  │  IssuerEntry PDA │  │  TopicEntry PDA      │     
  │  ├─ wallet: Pubkey  │  │  ├─ fid: Pubkey  │  │  ├─ topic\_id: u64     │     
  │  ├─ fid: Pubkey     │  │  └─ topics: \[u64\]│  │  └─ description: str  │     
  │  └─ country: u16    │  │                  │  │                       │     
  └─────────────────────┘  └──────────────────┘  └─────────────────────┘      
                                      │                                        
                                      ▼                                        
  ┌────────────────────────────────────────────────────────────────────────┐   
  │                   FRACKS IDENTITY PROGRAM (FID)                        │   
  │                                                                        │   
  │  FID Account PDA  \[seeds: b"fid", wallet\_pubkey\]                       │   
  │  ├─ owner: Pubkey (wallet controlling this FID)                        │   
  │  ├─ management\_key: Pubkey                                              │   
  │  ├─ claim\_count: u32                                                   │   
  │  └─ Claim PDAs  \[seeds: b"claim", fid\_pubkey, claim\_id\]                │   
  │     ├─ topic: u64                                                      │   
  │     ├─ issuer\_fid: Pubkey (FID of the claim issuer)                    │   
  │     ├─ data\_hash: \[u8; 32\] (keccak256 of off-chain data)               │   
  │     ├─ signature: \[u8; 64\] (ed25519 signature by issuer signer)        │   
  │     ├─ issued\_at: i64                                                  │   
  │     └─ expires\_at: i64 (0 \= no expiry)                                 │   
  └────────────────────────────────────────────────────────────────────────┘ 

## **2.3 Transfer Flow Diagram**

The following shows the complete on-chain validation flow when a user calls transfer() on a FRACKS token:

  USER calls transfer(to, amount)                                              
       │                                                                        
       ▼                                                                        
  ┌─────────────────────────────────────────────────────────┐                  
  │  FRACKS TOKEN PROGRAM                                   │                  
  │                                                         │                  
  │  1\. Check: sender not frozen (FrozenWallet PDA)         │                  
  │  2\. Check: receiver not frozen (FrozenWallet PDA)       │                  
  │  3\. Check: sender has enough unfrozen balance           │                  
  │  4\. Check: token is not paused (TokenState PDA)        │                  
  └─────────────────────────────────────────────────────────┘                  
       │                                                                        
       ├─── CPI ──▶ Identity Registry Program (IRP)                            
       │            is\_verified(receiver\_wallet)                                
       │                │                                                       
       │                ├─ Lookup: IRS PDA → get receiver FID pubkey            
       │                ├─ Load: CTR PDA → required topic IDs                   
       │                ├─ Load: TIR PDA → trusted issuer FIDs per topic        
       │                └─ For each required topic:                             
       │                     └─ Load Claim PDA on receiver FID                 
       │                          ├─ Check: topic matches                       
       │                          ├─ Check: issuer is in TIR                    
       │                          ├─ Verify: ed25519 signature valid            
       │                          └─ Check: not expired                         
       │            Returns: bool (verified or not)                             
       │                                                                        
       ├─── CPI ──▶ Compliance Program (CP)                                     
       │            can\_transfer(from, to, amount)                              
       │                │                                                       
       │                ├─ Load: ComplianceState PDA → module list              
       │                └─ For each module PDA:                                 
       │                     └─ Run module rule check                           
       │                          (max\_investors, country\_restriction,           
       │                           lockup\_period, max\_balance, etc.)             
       │            Returns: bool (compliant or not)                            
       │                                                                        
       ▼                                                                        
  ┌─────────────────────────────────────────────────────────┐                  
  │  IF both checks PASS:                                   │                  
  │     → Execute SPL token transfer (CPI to Token-2022)   │                  
  │     → Update Compliance state (transferred() hook)      │                  
  │     → Emit TransferExecuted event                       │                  
  │                                                         │                  
  │  IF either check FAILS:                                 │                  
  │     → Revert with descriptive error code               │                  
  │     → Emit TransferRejected event with reason           │                  
  └─────────────────────────────────────────────────────────┘                

| 👥  3\. ROLES & STAKEHOLDERS *Who does what, permissions, and access control* |
| :---- |

## **3.1 Role Overview**

FRACKS uses a layered role system implemented via Role PDAs stored on-chain. Each role is a dedicated PDA whose existence (or non-existence) serves as the permission check. All role checks happen inside Anchor account constraints — no dynamic mapping required.

| Role | PDA Seeds | Granted By | Core Permissions |
| :---- | :---- | :---- | :---- |
| Owner | b"owner", token\_mint | Factory (at deploy) | All admin operations; add/remove agents; transfer ownership; emergency controls |
| Agent | b"agent", token\_mint, agent\_pubkey | Owner | Mint, burn, forced\_transfer, freeze wallets, register identities, update registries |
| Identity Agent | b"id\_agent", registry\_pubkey, agent\_pubkey | Owner (of IRP) | Add/remove wallets from Identity Registry Storage; register/update FID mappings |
| KYC Provider / Claim Issuer | FID account of the issuer | Owner (added to TIR) | Issue signed claims to investor FID accounts; must be registered in TIR |
| Compliance Module Authority | b"mod\_auth", compliance\_pubkey, module\_pubkey | Owner | Update parameters of a specific compliance module |
| Investor / Token Holder | Wallet \+ FID (from IRS) | KYC Provider \+ Identity Agent | Hold and transfer tokens if verified and compliant |
| Factory Owner | b"factory\_owner" | Factory deployer | Deploy new token suites via factory; update factory implementation authority |

## **3.2 Owner Role**

#### **Purpose**

The Owner is the top-level controller of a specific RWA token deployment. The Owner controls the entire suite of programs/accounts associated with one token. This is typically the token issuer or an issuer's smart multi-sig account.

#### **Owner PDA Structure**

\#\[account\]  
pub struct OwnerState {  
    pub owner: Pubkey,          // Current owner wallet  
    pub pending\_owner: Pubkey,  // Two-step ownership transfer  
    pub token\_mint: Pubkey,     // The SPL Mint this controls  
    pub bump: u8,  
}  
// PDA seeds: \[b"owner", token\_mint.key().as\_ref()\]

#### **Owner Capabilities**

* Add and remove Agents on the Token Program

* Transfer ownership of the token suite (two-step with pending\_owner)

* Add/remove trusted claim issuers to/from TIR

* Add/remove claim topics to/from CTR

* Bind and unbind compliance modules

* Pause/unpause the entire token

* Update the Compliance Program reference

* Set/update token metadata (name, symbol, decimals via SPL Token-2022)

## **3.3 Agent Role**

#### **Purpose**

Agents are operational administrators designated by the Owner. They handle day-to-day operations: minting tokens to verified investors, burning tokens, managing freezes, and performing forced transfers in compliance with legal requirements.

#### **Agent PDA Structure**

\#\[account\]  
pub struct AgentRole {  
    pub agent: Pubkey,        // Agent wallet pubkey  
    pub token\_mint: Pubkey,   // Token this agent operates on  
    pub is\_active: bool,      // Can be deactivated without deletion  
    pub bump: u8,  
}  
// PDA seeds: \[b"agent", token\_mint.key().as\_ref(), agent.key().as\_ref()\]  
// Existence of this PDA \= agent is active

#### **Agent Capabilities**

* mint(to, amount) — Mint new tokens to a verified wallet

* burn(from, amount) — Burn tokens from a wallet

* forced\_transfer(from, to, amount) — Transfer tokens bypassing sender's consent (legal/recovery use)

* freeze\_wallet(wallet) — Fully freeze a wallet (no sends or receives)

* unfreeze\_wallet(wallet) — Remove full freeze

* freeze\_partial\_tokens(wallet, amount) — Lock a specific amount of tokens in a wallet

* unfreeze\_partial\_tokens(wallet, amount) — Unlock partially frozen tokens

* recovery(lost\_wallet, new\_wallet, investor\_fid) — Recover tokens from a lost wallet to a new one

* register\_identity(wallet, fid, country) — Add an investor to the IRS

* update\_investor\_country(wallet, country) — Update investor country code

* batch\_mint / batch\_freeze / batch\_register — Batch versions of the above for efficiency

## **3.4 KYC Provider / Claim Issuer**

#### **Purpose**

A Claim Issuer is an authorized third-party entity (e.g., a KYC provider, a licensed AML screening service, a government identity provider) that verifies investor credentials off-chain and issues cryptographically signed claims on-chain to investor FID accounts. The Claim Issuer must have its own FRACKS Identity (FID) account and must be registered in the Trusted Issuers Registry (TIR) for a specific token.

#### **Claim Issuer FID Structure (Issuer's own identity)**

\#\[account\]  
pub struct FidAccount {  
    pub owner: Pubkey,            // Wallet that owns this FID  
    pub management\_key: Pubkey,   // Key allowed to manage FID  
    pub signer\_key: Pubkey,       // Key used to sign claims (ed25519)  
    pub claim\_count: u32,  
    pub bump: u8,  
}  
// PDA seeds: \[b"fid", owner\_wallet.key().as\_ref()\]  
   
// NOTE: A Claim Issuer can rotate signer keys.  
// Old claims signed by a rotated-out key become INVALID.  
// This is the revocation mechanism.

#### **How a Claim Issuer Works**

5. The KYC provider verifies investor data off-chain (document checks, AML screening, etc.).

6. It constructs a claim payload: (investor\_fid, topic\_id, data\_hash, expiry).

7. It signs this payload with its ed25519 signer\_key.

8. The claim is added to the investor's FID account as a Claim PDA.

9. The TIR maps the issuer FID pubkey → the claim topics it is authorized to issue.

## **3.5 AML Provider**

The AML Provider is functionally a Claim Issuer (see above) specifically designated for Anti-Money Laundering claim topics. In FRACKS, AML screening results are represented as a specific Claim Topic (e.g., topic\_id \= 2\) on an investor's FID. A separate AML Provider entry in the TIR scopes them to only the AML claim topic, preventing them from issuing KYC or other claim types.

#### **AML Provider Entry in TIR**

\#\[account\]  
pub struct IssuerEntry {  
    pub issuer\_fid: Pubkey,        // FID of the claim issuer  
    pub allowed\_topics: Vec\<u64\>,  // \[2\] for AML-only issuer  
    pub registry: Pubkey,          // The TIR this entry belongs to  
    pub bump: u8,  
}  
// PDA seeds: \[b"issuer", tir\_pubkey.as\_ref(), issuer\_fid.as\_ref()\]

## **3.6 Investor / Token Holder**

Investors are end users who hold FRACKS tokens. They must:

10. Have a FRACKS Identity (FID) account deployed on Solana.

11. Have the required claims on their FID (issued by trusted issuers for the specific token).

12. Be registered in the Identity Registry Storage (wallet → FID → country mapping).

13. Not have their wallet frozen.

14. Pass all modular compliance checks for every transfer.

#### **Investor FID Account**

\#\[account\]  
pub struct FidAccount {  
    pub owner: Pubkey,          // Investor wallet  
    pub management\_key: Pubkey, // Key that can add/manage claims  
    pub signer\_key: Pubkey,     // Not used for investors (no claim issuance)  
    pub claim\_count: u32,  
    pub bump: u8,  
}  
// PDA seeds: \[b"fid", investor\_wallet.key().as\_ref()\]

## **3.7 Role Access Control Summary**

| Instruction | Owner | Agent | KYC Provider | Investor |
| :---- | :---- | :---- | :---- | :---- |
| add\_agent / remove\_agent | ✅ | ❌ | ❌ | ❌ |
| mint | ❌ | ✅ | ❌ | ❌ |
| burn | ❌ | ✅ | ❌ | ❌ |
| forced\_transfer | ❌ | ✅ | ❌ | ❌ |
| freeze\_wallet | ❌ | ✅ | ❌ | ❌ |
| recovery | ❌ | ✅ | ❌ | ❌ |
| register\_identity | ❌ | ✅ (ID Agent) | ❌ | ❌ |
| pause / unpause | ✅ | ❌ | ❌ | ❌ |
| add\_trusted\_issuer | ✅ | ❌ | ❌ | ❌ |
| add\_claim\_topic | ✅ | ❌ | ❌ | ❌ |
| bind\_module (compliance) | ✅ | ❌ | ❌ | ❌ |
| issue\_claim | ❌ | ❌ | ✅ | ❌ |
| transfer (standard) | ❌ | ❌ | ❌ | ✅ (if verified) |
| create\_fid | — | — | — | ✅ (self-deploy) |

| 🪪  4\. FRACKS IDENTITY (FID) *On-Chain Identity — Solana's answer to ONCHAINID* |
| :---- |

## **4.1 Overview**

The FRACKS Identity (FID) is the Solana equivalent of a self-sovereign on-chain identity. Each participant (investor, claim issuer, or exchange) deploys a single FID account — a PDA — that stores their key management information and their collection of Claim PDAs.

The FID is NOT tied to a specific token. One FID can hold claims for multiple tokens and be reused across the entire FRACKS ecosystem. An investor who completes KYC once can use the same FID for all subsequent FRACKS token issuances, as long as the required claim topics are present.

## **4.2 FID Account — Full Data Structure**

\#\[account\]  
pub struct FidAccount {  
    /// The wallet Pubkey that owns this identity.  
    /// This is the only key allowed to add/remove management keys.  
    pub owner: Pubkey,              // 32 bytes  
   
    /// Management key — allowed to approve claim additions and  
    /// key management operations on this FID.  
    pub management\_key: Pubkey,     // 32 bytes  
   
    /// Claim signer key — only relevant for Claim Issuers.  
    /// Investors set this to their wallet; issuers set it to a  
    /// dedicated hot-signing key.  
    pub signer\_key: Pubkey,         // 32 bytes  
   
    /// Total number of claims ever added (monotonic counter,  
    /// used as part of Claim PDA seed).  
    pub claim\_count: u32,           // 4 bytes  
   
    /// Whether this FID is for a Claim Issuer (true) or investor (false).  
    pub is\_issuer: bool,            // 1 byte  
   
    /// ISO-3166 country code of the owner (for investor FIDs).  
    /// 0 if not set or issuer FID.  
    pub country: u16,               // 2 bytes  
   
    /// PDA bump seed  
    pub bump: u8,                   // 1 byte  
   
    // Total: \~104 bytes \+ 8 bytes discriminator \= 112 bytes  
}  
// Seeds: \[b"fid", owner\_wallet.as\_ref()\]

## **4.3 Claim PDA — Full Data Structure**

Each claim is stored as a separate PDA under the FID. Claims are the cryptographic attestations issued by trusted third parties about the FID holder.

\#\[account\]  
pub struct ClaimAccount {  
    /// The FID account this claim belongs to.  
    pub fid: Pubkey,                // 32 bytes  
   
    /// Unique claim index (increments from fid.claim\_count).  
    pub claim\_id: u32,              // 4 bytes  
   
    /// Claim topic code. Pre-defined codes:  
    ///   1 \= KYC (Know Your Customer)  
    ///   2 \= AML (Anti-Money Laundering)  
    ///   3 \= Accredited Investor  
    ///   4 \= Jurisdiction Eligibility  
    ///   5 \= Beneficial Ownership  
    ///   Custom \> 100 \= Issuer-defined  
    pub topic: u64,                 // 8 bytes  
   
    /// The FID (Pubkey) of the trusted claim issuer who signed this claim.  
    pub issuer\_fid: Pubkey,         // 32 bytes  
   
    /// keccak256 hash of off-chain data (identity doc, KYC report, etc.).  
    /// The actual data is never stored on-chain (privacy preservation).  
    pub data\_hash: \[u8; 32\],        // 32 bytes  
   
    /// ed25519 signature by the claim issuer's signer\_key over:  
    /// sha256(issuer\_fid || holder\_fid || topic || data\_hash || expiry)  
    pub signature: \[u8; 64\],        // 64 bytes  
   
    /// Unix timestamp when this claim was issued.  
    pub issued\_at: i64,             // 8 bytes  
   
    /// Unix timestamp when this claim expires. 0 \= never expires.  
    pub expires\_at: i64,            // 8 bytes  
   
    /// Whether this claim has been manually revoked by the issuer.  
    pub revoked: bool,              // 1 byte  
   
    /// PDA bump seed  
    pub bump: u8,                   // 1 byte  
   
    // Total: \~194 bytes \+ 8 discriminator \= \~202 bytes  
}  
// Seeds: \[b"claim", fid.key().as\_ref(), claim\_id.to\_le\_bytes().as\_ref()\]

## **4.4 FID Instructions**

| Instruction | Signer | Description |
| :---- | :---- | :---- |
| create\_fid(is\_issuer, country) | Owner wallet | Deploy a new FID PDA for the signer. One-time per wallet. |
| set\_management\_key(new\_key) | Owner | Update the management key on the FID. |
| set\_signer\_key(new\_key) | Owner or Mgmt Key | Update the claim-signing key (issuers only). |
| add\_claim(topic, data\_hash, signature, expiry) | Issuer direct or Owner | Add a new Claim PDA to a target FID. |
| revoke\_claim(claim\_id) | Issuer FID owner | Mark a specific claim as revoked (revoked=true). |
| remove\_claim(claim\_id) | FID owner or Mgmt Key | Close and delete a Claim PDA from this FID. |
| approve\_claim\_addition(request\_id) | FID owner (Mgmt Key) | Approve a pending claim addition request (indirect approach). |

## **4.5 Claim Verification Signature Format**

When a Claim Issuer signs a claim, the signed message is constructed deterministically as:

// Message to sign (256 bits \= 32 bytes):  
let message \= sha256(  
    issuer\_fid\_pubkey.as\_ref()   // 32 bytes \- who is signing  
    || holder\_fid\_pubkey.as\_ref() // 32 bytes \- who receives the claim  
    || topic.to\_le\_bytes()        // 8 bytes  \- what claim type  
    || data\_hash                  // 32 bytes \- hash of off-chain data  
    || expires\_at.to\_le\_bytes()   // 8 bytes  \- expiry  
);  
   
// The issuer signs message with their ed25519 signer\_key.  
// The resulting 64-byte signature is stored in ClaimAccount.signature.  
   
// Verification (inside is\_verified CPI):  
// ed25519\_verify(signature, message, issuer\_fid.signer\_key) \== true  
// AND issuer\_fid.signer\_key is currently set (not rotated out)  
// AND claim.revoked \== false  
// AND (claim.expires\_at \== 0 || claim.expires\_at \> Clock::get().unix\_timestamp)

| 📋  5\. IDENTITY REGISTRY PROGRAM (IRP) *Eligibility Verification System — is\_verified()* |
| :---- |

## **5.1 Overview**

The Identity Registry Program (IRP) is the Eligibility Verification System (EVS) of FRACKS. It is the central program that determines whether a given wallet is eligible to receive tokens for a specific token mint. Each token has its own IRP state PDA, linked to its own IRS, TIR, and CTR.

## **5.2 IRP State PDA — Full Data Structure**

\#\[account\]  
pub struct IdentityRegistryState {  
    /// The SPL Token mint this registry belongs to.  
    pub token\_mint: Pubkey,             // 32 bytes  
   
    /// Owner of this registry (the token issuer).  
    pub owner: Pubkey,                  // 32 bytes  
   
    /// Address of the Identity Registry Storage account.  
    /// The IRS holds the actual wallet→FID mappings.  
    pub irs\_account: Pubkey,            // 32 bytes  
   
    /// Address of the Trusted Issuers Registry account.  
    pub tir\_account: Pubkey,            // 32 bytes  
   
    /// Address of the Claim Topics Registry account.  
    pub ctr\_account: Pubkey,            // 32 bytes  
   
    /// Agent PDAs authorized to add/remove identities in this registry.  
    /// Stored as Vec for bounded size; typical max 10 identity agents.  
    pub identity\_agents: Vec\<Pubkey\>,   // 4 \+ 32\*n bytes  
   
    /// Total registered identities (informational counter).  
    pub registered\_count: u64,          // 8 bytes  
   
    pub bump: u8,  
}  
// PDA seeds: \[b"irp\_state", token\_mint.as\_ref()\]

## **5.3 is\_verified() — Full Validation Logic**

This is the most critical instruction in FRACKS. It is called via CPI from the Token Program on every transfer, mint, and recovery.

pub fn is\_verified(ctx: Context\<IsVerified\>, wallet: Pubkey) \-\> Result\<bool\> {  
    // Step 1: Look up wallet in the Identity Registry Storage  
    let irs\_entry \= \&ctx.accounts.irs\_entry; // WalletIdentity PDA  
    if irs\_entry.wallet \!= wallet {  
        return Ok(false); // wallet not registered at all  
    }  
    let holder\_fid \= irs\_entry.fid;  
   
    // Step 2: Load required claim topics from CTR  
    let required\_topics \= ctx.accounts.ctr\_state.topics.clone();  
    if required\_topics.is\_empty() {  
        return Ok(true); // No topics required \= no verification needed  
    }  
   
    // Step 3: For each required topic, find a valid claim on holder FID  
    for topic in \&required\_topics {  
        let found\_valid \= verify\_claim\_for\_topic(  
            holder\_fid,  
            \*topic,  
            \&ctx.accounts.tir\_state,  
            \&ctx.accounts.claim\_accounts, // passed as remaining\_accounts  
            Clock::get()?.unix\_timestamp,  
        )?;  
        if \!found\_valid {  
            return Ok(false); // Missing valid claim for this topic  
        }  
    }  
    Ok(true)  
}  
   
fn verify\_claim\_for\_topic(  
    holder\_fid: Pubkey,  
    topic: u64,  
    tir: \&TrustedIssuersState,  
    claims: &\[AccountInfo\],  
    now: i64,  
) \-\> Result\<bool\> {  
    for claim\_info in claims {  
        let claim: ClaimAccount \= Account::try\_from(claim\_info)?;  
        if claim.fid \!= holder\_fid { continue; }  
        if claim.topic \!= topic { continue; }  
        if claim.revoked { continue; }  
        if claim.expires\_at \!= 0 && claim.expires\_at \< now { continue; }  
        // Check issuer is trusted for this topic  
        if \!tir.is\_trusted\_for\_topic(claim.issuer\_fid, topic) { continue; }  
        // Verify ed25519 signature  
        if verify\_claim\_signature(\&claim) { return Ok(true); }  
    }  
    Ok(false)  
}

## **5.4 IRP Instructions**

| Instruction | Auth Required | Description |
| :---- | :---- | :---- |
| initialize\_registry(token\_mint, irs, tir, ctr) | Owner / Factory | Create the IdentityRegistryState PDA and link IRS, TIR, CTR. |
| is\_verified(wallet) | Token Program (CPI) | Run full eligibility check. Returns bool. Read-only. |
| add\_identity\_agent(agent) | Owner | Add an agent pubkey to identity\_agents list. |
| remove\_identity\_agent(agent) | Owner | Remove an agent from the identity\_agents list. |
| update\_irs\_reference(new\_irs) | Owner | Point this registry to a different IRS account. |
| update\_tir\_reference(new\_tir) | Owner | Point this registry to a different TIR. |
| update\_ctr\_reference(new\_ctr) | Owner | Point this registry to a different CTR. |
| transfer\_registry\_ownership(new\_owner) | Owner | Transfer ownership of this registry to another wallet. |

| 🗄️  6\. IDENTITY REGISTRY STORAGE (IRS) *The Wallet → FID → Country Whitelist* |
| :---- |

## **6.1 Overview**

The Identity Registry Storage (IRS) is the actual data store of wallet-to-identity mappings. It is separated from the IRP (which handles verification logic) to allow multiple IRP instances to share the same investor whitelist. For example, if an issuer runs two different token products, both IRPs can point to the same IRS — an investor registered once can potentially access both tokens (subject to their own CTR/TIR requirements).

## **6.2 IRS State PDA**

\#\[account\]  
pub struct IdentityRegistryStorageState {  
    /// Owner of this storage (same as token owner, or can be shared issuer)  
    pub owner: Pubkey,  
   
    /// List of IRP accounts that are authorized to read from this IRS.  
    /// On-chain enforcement: only these registries can call read operations.  
    pub bound\_registries: Vec\<Pubkey\>,  
   
    /// Total number of registered wallets.  
    pub registered\_count: u64,  
   
    pub bump: u8,  
}  
// PDA seeds: \[b"irs\_state", owner.as\_ref()\]  
// Note: One IRS per issuer (shared); each token's IRP binds to it.

## **6.3 WalletIdentity PDA (Per Wallet)**

Each registered investor has exactly one WalletIdentity PDA per IRS. This maps their wallet pubkey to their FID account and their country code.

\#\[account\]  
pub struct WalletIdentity {  
    /// The investor wallet address.  
    pub wallet: Pubkey,         // 32 bytes  
   
    /// The FID PDA address linked to this wallet.  
    pub fid: Pubkey,            // 32 bytes  
   
    /// ISO-3166 numeric country code of the investor's residence.  
    /// Examples: 840 \= USA, 826 \= UK, 276 \= Germany, 840 \= Pakistan  
    pub country: u16,           // 2 bytes  
   
    /// The IRS this entry belongs to.  
    pub irs: Pubkey,            // 32 bytes  
   
    pub bump: u8,  
}  
// PDA seeds: \[b"wallet\_identity", irs\_state.key().as\_ref(), wallet.as\_ref()\]

## **6.4 IRS Instructions**

| Instruction | Auth Required | Description |
| :---- | :---- | :---- |
| initialize\_irs() | Owner / Factory | Create the IRS State PDA. |
| bind\_registry(irp\_pubkey) | Owner | Allow a specific IRP to read from this IRS. |
| unbind\_registry(irp\_pubkey) | Owner | Remove IRP access to this IRS. |
| register\_identity(wallet, fid, country) | Identity Agent | Create a WalletIdentity PDA. Maps wallet→FID with country. |
| update\_identity(wallet, new\_fid) | Identity Agent | Change the FID linked to a wallet (e.g., FID upgrade). |
| update\_country(wallet, new\_country) | Identity Agent | Update investor country code (ISO-3166). |
| remove\_identity(wallet) | Identity Agent | Close the WalletIdentity PDA — investor removed from whitelist. |
| transfer\_irs\_ownership(new\_owner) | Owner | Transfer ownership of this IRS. |

| 🏛️  7\. TRUSTED ISSUERS REGISTRY (TIR) *Who can issue which claims for this token* |
| :---- |

## **7.1 Overview**

The Trusted Issuers Registry (TIR) stores the list of claim issuers that are authorized for a specific token. Each entry links a Claim Issuer's FID pubkey to the set of claim topics they are trusted to issue. This allows fine-grained authorization — a KYC provider can be trusted for topic 1 (KYC) but not topic 2 (AML), for instance.

## **7.2 TIR State PDA**

\#\[account\]  
pub struct TrustedIssuersState {  
    pub owner: Pubkey,  
    pub token\_mint: Pubkey,  
    pub issuer\_count: u32,  
    pub bump: u8,  
}  
// PDA seeds: \[b"tir\_state", token\_mint.as\_ref()\]

## **7.3 IssuerEntry PDA (Per Trusted Issuer)**

\#\[account\]  
pub struct IssuerEntry {  
    /// Pubkey of the Claim Issuer's FID account.  
    /// This is NOT the issuer's wallet; it is their FID PDA.  
    pub issuer\_fid: Pubkey,  
   
    /// The TIR state this entry belongs to.  
    pub tir: Pubkey,  
   
    /// The claim topic IDs this issuer is authorized to sign.  
    /// Examples: \[1\] \= KYC only, \[1, 2\] \= KYC \+ AML, \[1,2,3\] \= full  
    pub allowed\_topics: Vec\<u64\>,  // Max 20 topics per issuer entry  
   
    /// Whether this issuer is currently active.  
    pub is\_active: bool,  
   
    /// Human-readable label (for off-chain indexing). Max 64 chars.  
    pub label: String,  
   
    pub bump: u8,  
}  
// PDA seeds: \[b"issuer\_entry", tir.key().as\_ref(), issuer\_fid.as\_ref()\]

## **7.4 TIR Instructions**

| Instruction | Auth Required | Description |
| :---- | :---- | :---- |
| initialize\_tir(token\_mint) | Owner / Factory | Create TIR State PDA for this token. |
| add\_trusted\_issuer(issuer\_fid, topics, label) | Owner | Create IssuerEntry PDA. Authorizes issuer for given topics. |
| update\_issuer\_topics(issuer\_fid, new\_topics) | Owner | Change which topics an existing issuer is trusted for. |
| deactivate\_issuer(issuer\_fid) | Owner | Set is\_active=false. Existing claims from this issuer become invalid immediately. |
| reactivate\_issuer(issuer\_fid) | Owner | Restore is\_active=true for a previously deactivated issuer. |
| remove\_trusted\_issuer(issuer\_fid) | Owner | Close the IssuerEntry PDA permanently. Reclaims rent. |
| is\_trusted\_for\_topic(issuer\_fid, topic) | IRP (CPI / read) | Read-only check. Returns bool. Used inside is\_verified(). |

| 🏷️  8\. CLAIM TOPICS REGISTRY (CTR) *What claims are required to hold this token* |
| :---- |

## **8.1 Overview**

The Claim Topics Registry (CTR) defines which claim topics an investor MUST have on their FID in order to be eligible for this specific token. The IRP's is\_verified() checks every topic in the CTR and ensures the investor's FID holds a valid, unexpired, unrevoked claim for each one, signed by a trusted issuer for that topic.

## **8.2 CTR State PDA**

\#\[account\]  
pub struct ClaimTopicsState {  
    pub owner: Pubkey,  
    pub token\_mint: Pubkey,  
   
    /// Ordered list of required claim topic IDs.  
    /// ALL of these must be satisfied for is\_verified() to return true.  
    pub topics: Vec\<u64\>,       // Max 20 topics  
   
    pub bump: u8,  
}  
// PDA seeds: \[b"ctr\_state", token\_mint.as\_ref()\]

## **8.3 Standard Claim Topic Codes**

| Topic ID | Name | Description | Who Issues |
| :---- | :---- | :---- | :---- |
| 1 | KYC | Know Your Customer — identity verified | KYC Provider (licensed) |
| 2 | AML | Anti-Money Laundering screening passed | AML/Compliance Provider |
| 3 | Accredited Investor | Investor qualifies as accredited under applicable law | Legal/Financial Advisor |
| 4 | Jurisdiction Eligibility | Investor is eligible to hold this asset in their jurisdiction | Legal/Compliance Provider |
| 5 | Beneficial Ownership | Investor is the beneficial owner (no nominee structures) | KYC/Legal Provider |
| 6 | Tax Residency | Tax residency status verified | Accounting/Tax Provider |
| 7 | Sanctions Screening | Not on any sanctions list (OFAC, EU, UN) | AML/Compliance Provider |
| 100+ | Custom | Issuer-defined custom claim topics | Issuer-designated provider |

## **8.4 CTR Instructions**

| Instruction | Auth Required | Description |
| :---- | :---- | :---- |
| initialize\_ctr(token\_mint) | Owner / Factory | Create CTR State PDA. |
| add\_claim\_topic(topic\_id) | Owner | Append a required claim topic. All future is\_verified() calls must satisfy this. |
| remove\_claim\_topic(topic\_id) | Owner | Remove a topic from requirements. Existing holders no longer need it. |
| get\_claim\_topics() | IRP (CPI / read) | Read-only. Returns Vec\<u64\> of all required topics. |

| ⚠️ IMPORTANT — CTR Change Effects Adding a new topic to the CTR immediately makes ALL existing token holders who lack that claim ineligible to SEND tokens. They can still receive (unless the compliance module also blocks receiving). Removing a topic immediately allows all holders. Changes take effect at the next transfer attempt — no migration needed. |
| :---- |

| 🪙  9\. FRACKS TOKEN PROGRAM *SPL Token-2022 Mint with Transfer Hook \+ Compliance* |
| :---- |

## **9.1 Overview**

The FRACKS Token Program manages the SPL Token-2022 mint for each RWA asset. It uses the Token-2022 Transfer Hook extension to intercept every token transfer at the SPL level and enforce FRACKS compliance checks. The token program also manages freeze state, partial freezes, pausing, supply control, and recovery.

## **9.2 Why Token-2022 \+ Transfer Hook?**

In Solana's SPL Token (classic) model, transfers are handled by the Token Program directly with no extension point. Token-2022 introduces the Transfer Hook extension — a mechanism where the token mint can specify a custom Anchor program to be called on EVERY transfer. This is the Solana equivalent of overriding the transfer() function in a permissioned ERC-20 token.

// Transfer Hook: FRACKS Token Program is set as the transfer\_hook program  
// on the SPL Token-2022 mint.  
//    
// On every SPL transfer:  
//   1\. SPL Token-2022 executes the standard balance adjustment  
//   2\. SPL Token-2022 then calls FRACKS Token Program's transfer\_hook()  
//   3\. transfer\_hook() runs is\_verified() and can\_transfer() via CPI  
//   4\. If either fails, the entire transaction reverts  
//   5\. If both pass, the transfer succeeds  
//  
// This means NO transfer can bypass FRACKS checks — not even via  
// direct SPL Token Program calls from other programs.

## **9.3 TokenState PDA — Full Data Structure**

\#\[account\]  
pub struct TokenState {  
    /// The SPL Token-2022 Mint pubkey.  
    pub mint: Pubkey,                     // 32 bytes  
   
    /// Current owner (issuer) of this token.  
    pub owner: Pubkey,                    // 32 bytes  
   
    /// Pending ownership transfer (two-step pattern).  
    pub pending\_owner: Option\<Pubkey\>,    // 33 bytes  
   
    /// Address of the Identity Registry Program state for this token.  
    pub identity\_registry: Pubkey,        // 32 bytes  
   
    /// Address of the Compliance Program state for this token.  
    pub compliance: Pubkey,               // 32 bytes  
   
    /// Token name (up to 32 chars).  
    pub name: String,                     // 36 bytes  
   
    /// Token symbol (up to 12 chars).  
    pub symbol: String,                   // 16 bytes  
   
    /// Number of decimal places.  
    pub decimals: u8,                     // 1 byte  
   
    /// ISIN code for the underlying security (optional, 12 chars).  
    pub isin: String,                     // 16 bytes  
   
    /// Whether the token is globally paused.  
    /// When paused: ALL transfers, mints, and burns are blocked.  
    pub paused: bool,                     // 1 byte  
   
    pub bump: u8,  
}  
// PDA seeds: \[b"token\_state", mint.as\_ref()\]

## **9.4 FrozenWallet PDA**

Each fully-frozen wallet has a FrozenWallet PDA. The existence of this PDA blocks all sends and receives for that wallet.

\#\[account\]  
pub struct FrozenWallet {  
    pub wallet: Pubkey,  
    pub token\_mint: Pubkey,  
    pub frozen\_by: Pubkey,   // Agent who froze it  
    pub frozen\_at: i64,  
    pub bump: u8,  
}  
// PDA seeds: \[b"frozen", token\_mint.as\_ref(), wallet.as\_ref()\]  
// Existence \= frozen. Closing this PDA \= unfrozen.

## **9.5 PartialFreeze PDA**

Partial freezes lock a specific token amount within a wallet. The wallet can still transfer its unfrozen balance.

\#\[account\]  
pub struct PartialFreeze {  
    pub wallet: Pubkey,  
    pub token\_mint: Pubkey,  
    pub frozen\_amount: u64,   // Amount locked (in base units)  
    pub frozen\_by: Pubkey,  
    pub bump: u8,  
}  
// PDA seeds: \[b"partial\_freeze", token\_mint.as\_ref(), wallet.as\_ref()\]  
// Transfer check: transferable \= balance \- frozen\_amount

## **9.6 Token Program Instructions**

| Instruction | Auth | Description |
| :---- | :---- | :---- |
| initialize\_token(name, symbol, decimals, isin, irp, cp) | Owner / Factory | Create TokenState PDA and SPL Token-2022 Mint with transfer\_hook set to this program. |
| transfer(to, amount) | Token holder | Standard transfer. Runs transfer\_hook which calls is\_verified(to) \+ can\_transfer(from, to, amount). |
| transfer\_hook(from, to, amount) | SPL Token-2022 (CPI) | Intercept hook. Never called directly. Enforces compliance. |
| mint(to, amount) | Agent | Mint new tokens. Checks is\_verified(to) before minting. |
| burn(from, amount) | Agent | Burn tokens. No compliance check (agent-initiated). |
| forced\_transfer(from, to, amount) | Agent | Transfer bypassing sender consent. Checks is\_verified(to). Unfreezes partial if needed. |
| freeze\_wallet(wallet) | Agent | Create FrozenWallet PDA. Blocks all activity for that wallet. |
| unfreeze\_wallet(wallet) | Agent | Close FrozenWallet PDA. |
| freeze\_partial\_tokens(wallet, amount) | Agent | Create/update PartialFreeze PDA. |
| unfreeze\_partial\_tokens(wallet, amount) | Agent | Reduce frozen\_amount on PartialFreeze PDA. |
| recovery(lost\_wallet, new\_wallet, investor\_fid) | Agent | Forced transfer entire balance from lost\_wallet to new\_wallet. Updates IRS entry. |
| pause() | Owner | Set paused=true on TokenState. Blocks all transfers. |
| unpause() | Owner | Set paused=false. |
| set\_identity\_registry(new\_irp) | Owner | Update IRP reference. |
| set\_compliance(new\_cp) | Owner | Update Compliance Program reference. |
| add\_agent(agent) | Owner | Create AgentRole PDA for an address. |
| remove\_agent(agent) | Owner | Close AgentRole PDA. |
| transfer\_ownership(new\_owner) | Owner | Set pending\_owner for two-step transfer. |
| accept\_ownership() | Pending Owner | Finalize ownership transfer. |
| batch\_mint(recipients, amounts) | Agent | Mint to multiple wallets in one transaction. |
| batch\_forced\_transfer(from\_list, to\_list, amounts) | Agent | Multiple forced transfers in one transaction. |
| batch\_freeze(wallets) | Agent | Freeze multiple wallets at once. |

| ⚖️  10\. COMPLIANCE PROGRAM (CP) *Modular Offering Rules — can\_transfer()* |
| :---- |

## **10.1 Overview**

The Compliance Program enforces offering-level rules that apply globally across all transfers of a specific token. Unlike the IRP which checks individual investor eligibility, the Compliance Program checks rules that depend on the entire distribution state — such as maximum number of holders, country-level investment caps, lockup periods, and maximum token concentration per investor.

The Compliance Program is designed to be modular. Each rule is a separate Compliance Module — an Anchor program or a PDA — that can be added or removed by the token owner at any time. The Compliance Program iterates through all bound modules and calls can\_transfer() on each.

## **10.2 ComplianceState PDA**

\#\[account\]  
pub struct ComplianceState {  
    pub owner: Pubkey,  
    pub token\_mint: Pubkey,  
   
    /// Pubkeys of all bound module PDAs or programs.  
    /// Each module implements can\_transfer(from, to, amount) \-\> bool.  
    pub modules: Vec\<Pubkey\>,   // Max 15 modules  
   
    /// Whether any module is currently paused (emergency stop).  
    pub modules\_paused: bool,  
   
    pub bump: u8,  
}  
// PDA seeds: \[b"compliance\_state", token\_mint.as\_ref()\]

## **10.3 Compliance Module Interface**

Every compliance module must expose these instructions. The Compliance Program calls them via CPI:

pub trait ComplianceModule {  
    /// Called before every transfer.  
    /// Returns true if transfer complies with this module's rules.  
    fn can\_transfer(from: Pubkey, to: Pubkey, amount: u64) \-\> bool;  
   
    /// Called after a successful transfer to update internal module state.  
    fn transferred(from: Pubkey, to: Pubkey, amount: u64);  
   
    /// Called after a successful mint to update module state.  
    fn created(to: Pubkey, amount: u64);  
   
    /// Called after a successful burn to update module state.  
    fn destroyed(from: Pubkey, amount: u64);  
}

## **10.4 Built-in Compliance Modules**

| Module Name | Module PDA Seed | Rule Description | Key Parameters |
| :---- | :---- | :---- | :---- |
| MaxInvestorsModule | b"mod\_max\_investors" | Limits the maximum number of unique token holders globally. | max\_investors: u64 |
| CountryRestrictModule | b"mod\_country" | Blocks transfers to/from wallets in specific countries. Uses ISO-3166 country codes from IRS. | blocked\_countries: Vec\<u16\> |
| MaxBalanceModule | b"mod\_max\_balance" | Limits the maximum token balance any single wallet can hold. | max\_balance: u64 |
| MaxTransferModule | b"mod\_max\_transfer" | Limits the maximum single transfer amount per transaction. | max\_amount: u64 |
| LockupModule | b"mod\_lockup" | Prevents transfers of tokens minted before a certain timestamp (vesting/lockup period). | lockup\_end: i64 |
| DailyTransferLimitModule | b"mod\_daily\_limit" | Caps the total volume a wallet can send per 24-hour window. | daily\_limit: u64 |
| SupplyCapModule | b"mod\_supply\_cap" | Hard cap on total token supply that can ever be minted. | max\_supply: u64 |
| InvestorCountryCapModule | b"mod\_country\_cap" | Limits the number of investors per country code. | country\_caps: HashMap\<u16, u64\> |

## **10.5 Compliance Program Instructions**

| Instruction | Auth | Description |
| :---- | :---- | :---- |
| initialize\_compliance(token\_mint) | Owner / Factory | Create ComplianceState PDA. |
| can\_transfer(from, to, amount) | Token Program (CPI) | Iterate all modules, call each module's can\_transfer(). Returns true only if ALL pass. |
| transferred(from, to, amount) | Token Program (CPI) | Post-transfer hook. Updates all module state. |
| created(to, amount) | Token Program (CPI) | Post-mint hook. Updates all module state. |
| destroyed(from, amount) | Token Program (CPI) | Post-burn hook. Updates all module state. |
| bind\_module(module\_pubkey) | Owner | Add a module to the modules list. Limited to 15\. |
| unbind\_module(module\_pubkey) | Owner | Remove a module from the list. |
| call\_module\_function(module, data) | Owner | Forward an owner-privileged call to a specific module (e.g., update parameters). |

| 🏭  11\. FRACKS FACTORY PROGRAM *Single-Transaction Deployment of the Full Protocol Suite* |
| :---- |

## **11.1 Overview**

The FRACKS Factory Program allows an issuer to deploy a complete, fully-linked FRACKS token suite in a single atomic transaction (or a coordinated set of transactions for large deployments). This is the Solana equivalent of the T-REX Factory using CREATE2.

On Solana, instead of deploying new contracts (as on EVM), the Factory initializes all required PDAs with the correct ownership, linking, and configuration. The programs themselves are singletons already deployed on Solana mainnet — the factory initializes their per-token state accounts.

## **11.2 Factory State PDA**

\#\[account\]  
pub struct FactoryState {  
    /// Owner of the factory (FRACKS protocol deployer / DAO)  
    pub owner: Pubkey,  
   
    /// The canonical program IDs for all FRACKS programs.  
    /// Updated when new versions are deployed.  
    pub token\_program\_id: Pubkey,  
    pub fid\_program\_id: Pubkey,  
    pub irp\_program\_id: Pubkey,  
    pub irs\_program\_id: Pubkey,  
    pub tir\_program\_id: Pubkey,  
    pub ctr\_program\_id: Pubkey,  
    pub compliance\_program\_id: Pubkey,  
   
    /// Total RWA token suites deployed via this factory.  
    pub deployment\_count: u64,  
   
    pub bump: u8,  
}  
// PDA seeds: \[b"factory\_state"\]

## **11.3 TokenDeployment PDA**

Each deployed token suite has a registry PDA in the factory, tracking all linked components:

\#\[account\]  
pub struct TokenDeployment {  
    /// Deployment index (monotonic)  
    pub deployment\_id: u64,  
   
    /// The token issuer who initiated the deployment.  
    pub issuer: Pubkey,  
   
    /// Unique salt used to derive deterministic PDA addresses.  
    /// sha256(issuer || deployment\_nonce)  
    pub salt: \[u8; 32\],  
   
    /// All linked component PDAs for this token.  
    pub token\_mint: Pubkey,  
    pub token\_state: Pubkey,  
    pub irp\_state: Pubkey,  
    pub irs\_state: Pubkey,  
    pub tir\_state: Pubkey,  
    pub ctr\_state: Pubkey,  
    pub compliance\_state: Pubkey,  
   
    /// Timestamp of deployment.  
    pub deployed\_at: i64,  
   
    pub bump: u8,  
}  
// PDA seeds: \[b"deployment", issuer.as\_ref(), salt.as\_ref()\]

## **11.4 Factory deploy\_token\_suite() Instruction**

This is the main factory function. It takes all deployment parameters and creates all required state PDAs in the correct order:

pub struct DeployTokenSuiteArgs {  
    // Token parameters  
    pub token\_name: String,       // e.g., "FRACKS Real Estate Fund I"  
    pub token\_symbol: String,     // e.g., "FREF1"  
    pub decimals: u8,             // e.g., 6  
    pub isin: String,             // e.g., "US1234567890"  
   
    // Initial claim topics required  
    pub claim\_topics: Vec\<u64\>,   // e.g., \[1, 2\] \= KYC \+ AML  
   
    // Initial trusted issuers  
    pub trusted\_issuers: Vec\<(Pubkey, Vec\<u64\>)\>, // (issuer\_fid, topics)  
   
    // Initial compliance modules to bind  
    pub compliance\_modules: Vec\<Pubkey\>,  
   
    // Share an existing IRS or create a new one  
    pub shared\_irs: Option\<Pubkey\>,  
   
    // Unique salt for deterministic PDA derivation  
    pub salt: \[u8; 32\],  
}  
   
// Deployment order (all in one transaction or split into two):  
// 1\. Create SPL Token-2022 Mint with transfer\_hook  
// 2\. Initialize TokenState PDA  
// 3\. Initialize CTR with claim\_topics  
// 4\. Initialize TIR with trusted\_issuers  
// 5\. Initialize IRS (new) or bind existing IRS  
// 6\. Initialize IRP linking IRS \+ TIR \+ CTR  
// 7\. Initialize ComplianceState and bind modules  
// 8\. Link IRP \+ CP to TokenState  
// 9\. Transfer ownership of all components to issuer  
// 10\. Record TokenDeployment PDA in factory

## **11.5 Factory Deployment Sequence Diagram**

  ISSUER calls deploy\_token\_suite(args)  
       │  
       ▼  
  ┌─────────────────────────────────────────────────────────┐  
  │  FRACKS FACTORY PROGRAM                                 │  
  │                                                         │  
  │  Step 1: init Token-2022 Mint (transfer\_hook \= this)   │  
  │  Step 2: init TokenState PDA                            │  
  │  Step 3: init CTR PDA (write claim\_topics)              │  
  │  Step 4: init TIR PDA (write trusted\_issuers)           │  
  │  Step 5: init/bind IRS PDA                              │  
  │  Step 6: init IRP PDA (link IRS \+ TIR \+ CTR)            │  
  │  Step 7: init ComplianceState PDA                       │  
  │  Step 8: bind compliance modules (CPIs to each)         │  
  │  Step 9: link IRP \+ CP into TokenState                  │  
  │  Step 10: set TokenState.owner \= issuer wallet          │  
  │  Step 11: write TokenDeployment PDA                     │  
  └─────────────────────────────────────────────────────────┘  
       │                    │                    │  
       ▼                    ▼                    ▼  
  Token-2022 Mint    IRP \+ IRS \+ TIR    ComplianceState  
  TokenState PDA          \+ CTR          \+ Module PDAs  
  AgentRole PDAs                                            
                                                            
  All owned by ISSUER, all linked together.                
  Issuer can now add agents and start registering investors.

| 📊  12\. PROGRAMS & ACCOUNTS PER RWA TOKEN *Complete inventory of what gets created per token* |
| :---- |

## **12.1 Programs (Deployed Once, Shared)**

These Anchor programs are deployed once on Solana mainnet. All RWA tokens share these programs. Each token deployment only creates new PDA state accounts within these programs.

| Program | Program ID (set at deploy) | Upgrade Authority |
| :---- | :---- | :---- |
| FRACKS Factory Program | FRACKS\_FACTORY\_PROGRAM\_ID | FRACKS Protocol Multisig |
| FRACKS Token Program | FRACKS\_TOKEN\_PROGRAM\_ID | FRACKS Protocol Multisig |
| FRACKS Identity Program (FID) | FRACKS\_FID\_PROGRAM\_ID | FRACKS Protocol Multisig |
| Identity Registry Program (IRP) | FRACKS\_IRP\_PROGRAM\_ID | FRACKS Protocol Multisig |
| Identity Registry Storage (IRS) | FRACKS\_IRS\_PROGRAM\_ID | FRACKS Protocol Multisig |
| Trusted Issuers Registry (TIR) | FRACKS\_TIR\_PROGRAM\_ID | FRACKS Protocol Multisig |
| Claim Topics Registry (CTR) | FRACKS\_CTR\_PROGRAM\_ID | FRACKS Protocol Multisig |
| Compliance Program (CP) | FRACKS\_CP\_PROGRAM\_ID | FRACKS Protocol Multisig |

## **12.2 PDA Accounts Created Per Token Deployment**

| Account / PDA | Seeds | Program Owner | Lifetime |
| :---- | :---- | :---- | :---- |
| Token-2022 Mint | Deterministic from salt | SPL Token-2022 | Permanent |
| TokenState | b"token\_state", mint | Token Program | Permanent |
| IdentityRegistryState | b"irp\_state", mint | IRP | Permanent |
| IdentityRegistryStorageState | b"irs\_state", owner | IRS (shared) | Permanent (shared) |
| TrustedIssuersState | b"tir\_state", mint | TIR | Permanent |
| ClaimTopicsState | b"ctr\_state", mint | CTR | Permanent |
| ComplianceState | b"compliance\_state", mint | CP | Permanent |
| TokenDeployment | b"deployment", issuer, salt | Factory | Permanent |
| OwnerState | b"owner", mint | Token Program | Permanent |
| AgentRole (per agent) | b"agent", mint, agent | Token Program | Deletable |
| IssuerEntry (per issuer) | b"issuer\_entry", tir, issuer\_fid | TIR | Deletable |
| ModuleState (per module) | b"module", compliance, module | CP | Deletable |
| ComplianceModule PDAs | varies by module type | CP or Module Program | Deletable |

## **12.3 PDA Accounts Created Per Investor**

| Account / PDA | Seeds | Program Owner | Created By |
| :---- | :---- | :---- | :---- |
| FID Account | b"fid", investor\_wallet | FID Program | Investor (self-deploy) |
| WalletIdentity (in IRS) | b"wallet\_identity", irs, wallet | IRS Program | Identity Agent |
| ClaimAccount (per claim) | b"claim", fid, claim\_id | FID Program | Claim Issuer |
| SPL Token Account (ATA) | wallet, token\_mint (ATA) | Token-2022 | Investor / Agent |
| FrozenWallet (if frozen) | b"frozen", mint, wallet | Token Program | Agent (on freeze) |
| PartialFreeze (if partial) | b"partial\_freeze", mint, wallet | Token Program | Agent |

| 🔄  13\. LIFECYCLE PROCESSES *Step-by-step flows for all key operations* |
| :---- |

## **13.1 Investor Onboarding Flow**

  INVESTOR ONBOARDING — End-to-End Flow                                       
   
  1\. INVESTOR creates FID Account                                              
     Call: FID Program → create\_fid(is\_issuer=false, country=840)             
     Result: FidAccount PDA at \[b"fid", investor\_wallet\]                      
   
  2\. INVESTOR requests KYC from KYC Provider                                  
     (Off-chain: submits docs, gets verified)                                  
   
  3\. KYC PROVIDER issues Claim on investor's FID                              
     Call: FID Program → add\_claim(                                            
         target\_fid \= investor\_fid,                                            
         topic \= 1,  // KYC                                                    
         data\_hash \= keccak256(kyc\_report),                                    
         signature \= ed25519(issuer\_signer\_key, message),                      
         expires\_at \= now \+ 365\_days,                                          
     )                                                                          
     Result: ClaimAccount PDA at \[b"claim", investor\_fid, 0\]                  
   
  4\. If AML also required, AML Provider issues AML claim (topic=2) similarly  
   
  5\. IDENTITY AGENT registers investor in IRS                                 
     Call: IRS Program → register\_identity(                                    
         wallet \= investor\_wallet,                                              
         fid   \= investor\_fid,                                                 
         country \= 840,                                                         
     )                                                                          
     Result: WalletIdentity PDA at \[b"wallet\_identity", irs, investor\_wallet\]  
   
  6\. AGENT creates SPL Token ATA for investor                                 
     (or investor self-creates via Associated Token Program)                   
   
  7\. AGENT mints tokens to investor                                           
     Call: Token Program → mint(to=investor\_wallet, amount=1000\_000000)       
     Internal: CPI → IRP.is\_verified(investor\_wallet) → true                 
     Result: Tokens minted to investor ATA                                    
   
  INVESTOR IS NOW AN ACTIVE TOKEN HOLDER ✅                               


## **13.2 Compliant Transfer Flow**

  COMPLIANT TOKEN TRANSFER — Detailed Flow                                    
   
  SENDER calls: Token Program → transfer(to=receiver, amount=500\_000000)     
                                                                               
  ─── Pre-checks (Token Program) ─────────────────────────────────────────   
  1\. Load TokenState: assert paused \== false                                  
  2\. Load FrozenWallet\[sender\]: assert does not exist                         
  3\. Load FrozenWallet\[receiver\]: assert does not exist                       
  4\. Load PartialFreeze\[sender\]: free\_balance \= balance \- frozen\_amount       
     assert amount \<= free\_balance                                             
   
  ─── Eligibility Check (CPI to IRP) ─────────────────────────────────────   
  5\. CPI → IRP.is\_verified(receiver\_wallet)                                   
     a. Load WalletIdentity\[receiver\]: get receiver\_fid                       
     b. Load CTR: required\_topics \= \[1, 2\]  // KYC \+ AML                     
     c. For topic=1 (KYC):                                                    
        \- Scan receiver\_fid Claim PDAs for topic=1                            
        \- Find claim: topic=1, issuer=kyc\_provider\_fid                        
        \- Check: TIR has kyc\_provider\_fid trusted for topic=1 → yes           
        \- Check: claim.revoked \== false → yes                                 
        \- Check: claim.expires\_at \> now → yes                                 
        \- Verify ed25519 signature → valid                                    
        → KYC claim valid ✅                                                    
     d. For topic=2 (AML): similar → AML claim valid ✅                       
     e. Return: true                                                           
   
  ─── Compliance Check (CPI to CP) ──────────────────────────────────────    
  6\. CPI → CP.can\_transfer(sender, receiver, 500\_000000)                      
     a. Load ComplianceState: modules \= \[MaxInvestors, CountryRestrict\]       
     b. CPI → MaxInvestors.can\_transfer(...)                                  
        \- Current investors: 245 / max\_investors: 500                         
        \- Is receiver new holder? Yes → 246 \<= 500 → true ✅                  
     c. CPI → CountryRestrict.can\_transfer(...)                               
        \- Load WalletIdentity\[receiver\]: country=826 (UK)                     
        \- blocked\_countries \= \[364, 408\] (Iran, North Korea)                  
        \- 826 not in blocked list → true ✅                                    
     d. All modules passed → Return: true                                     
   
  ─── Transfer Execution ─────────────────────────────────────────────────    
  7\. CPI → SPL Token-2022 → transfer(sender\_ata, receiver\_ata, amount)        
  8\. CPI → CP.transferred(sender, receiver, amount) \[post-hook\]               
     → Update MaxInvestors module (increment holder count if new holder)      
  9\. Emit: TransferExecuted { sender, receiver, amount }                      
                                                                               
  TRANSFER COMPLETE ✅                                                     


## **13.3 Token Recovery Flow**

15. Investor contacts the issuer/agent claiming loss of wallet private key.

16. Agent verifies the investor's identity against their FID's off-chain data (via the data\_hash stored in their KYC claim).

17. Investor provides their existing FID pubkey and a new wallet address.

18. Agent calls Token Program → recovery(lost\_wallet, new\_wallet, investor\_fid).

19. Token Program checks is\_verified(new\_wallet) to confirm new wallet is registered.

20. Token Program executes forced\_transfer of all tokens from lost\_wallet to new\_wallet.

21. Identity Agent calls IRS.update\_identity(lost\_wallet, new\_fid) and IRS.register\_identity(new\_wallet, investor\_fid, country).

22. Recovery event is emitted and permanently recorded on-chain for audit.

| ⚡  14\. SOLANA-SPECIFIC CONSIDERATIONS *Key Solana primitives, constraints, and patterns* |
| :---- |

## **14.1 Account Size and Rent**

Every Solana account must maintain a minimum SOL balance (rent exemption) proportional to its size. The following table shows estimated sizes and rent costs for key FRACKS accounts:

| Account | Approx. Size (bytes) | Rent Exempt (SOL approx.) | Paid By |
| :---- | :---- | :---- | :---- |
| FID Account | \~120 | \~0.002 SOL | Investor (self) |
| ClaimAccount | \~210 | \~0.003 SOL | Claim Issuer or Investor |
| WalletIdentity | \~110 | \~0.0016 SOL | Identity Agent / Issuer |
| TokenState | \~250 | \~0.003 SOL | Factory / Issuer |
| ComplianceState | \~500 | \~0.006 SOL | Factory / Issuer |
| IRP State | \~350 | \~0.004 SOL | Factory / Issuer |
| IssuerEntry | \~180 | \~0.0025 SOL | Issuer (Owner) |
| AgentRole | \~80 | \~0.0012 SOL | Issuer (Owner) |

## **14.2 Transaction Size Limits**

Solana transactions are limited to 1232 bytes. Complex operations involving many CPI calls or many accounts must be split across multiple transactions. Key considerations:

* The full is\_verified() check requires passing all relevant Claim PDAs as remaining\_accounts. For investors with many claims, this must be managed carefully.

* Batch instructions (batch\_mint, batch\_register) should be limited to \~5-10 items per transaction to avoid hitting account limits (35 accounts max per transaction).

* The deploy\_token\_suite() factory call may need to be split into 2-3 transactions for full initialization.

## **14.3 PDA Determinism vs EVM CREATE2**

On EVM, the T-REX Factory uses CREATE2 to deploy token contracts at the same address across chains. On Solana:

* PDAs are derived deterministically from seeds \+ program\_id. Same seeds → same PDA address, always.

* The salt in TokenDeployment seeds (sha256 of issuer \+ nonce) provides the same cross-deployment uniqueness as CREATE2 salt.

* PDAs cannot have private keys, which means they can only be signed for by the owning program using invoke\_signed() — more secure than EOA-based contract ownership.

## **14.4 Cross-Program Invocations (CPI)**

The FRACKS protocol relies heavily on CPIs. Key CPI patterns:

// CPI from Token Program to IRP (is\_verified check):  
let cpi\_ctx \= CpiContext::new(  
    ctx.accounts.irp\_program.to\_account\_info(),  
    IsVerified {  
        registry\_state: ctx.accounts.irp\_state.to\_account\_info(),  
        irs\_state: ctx.accounts.irs\_state.to\_account\_info(),  
        tir\_state: ctx.accounts.tir\_state.to\_account\_info(),  
        ctr\_state: ctx.accounts.ctr\_state.to\_account\_info(),  
        wallet\_identity: ctx.accounts.wallet\_identity.to\_account\_info(),  
        // \+ remaining\_accounts: all ClaimAccount PDAs for the receiver  
    }  
);  
let verified \= fracks\_irp::cpi::is\_verified(cpi\_ctx, receiver\_wallet)?;  
require\!(verified, FracksError::ReceiverNotVerified);

## **14.5 ed25519 Signature Verification on Solana**

Solana provides a native ed25519 program for signature verification. FRACKS uses this for claim signature validation. The recommended approach uses the ed25519 pre-instruction method:

// APPROACH: Use Solana's Ed25519Program via instruction introspection.  
// The claim addition transaction must include an Ed25519 signature  
// verification instruction BEFORE the add\_claim instruction.  
//  
// In the add\_claim instruction, verify:  
// \- Instructions sysvar contains an Ed25519 verification instruction  
// \- The verified pubkey matches the issuer's signer\_key  
// \- The verified message matches the expected claim payload  
   
use solana\_program::ed25519\_program;  
   
fn verify\_claim\_signature(claim: \&ClaimAccount, issuer\_fid: \&FidAccount,  
                           ix\_sysvar: \&AccountInfo) \-\> Result\<()\> {  
    let message \= construct\_claim\_message(claim);  
    // Parse ix\_sysvar to find ed25519 verification instruction  
    // Verify: pubkey \== issuer\_fid.signer\_key && msg \== message  
    // This is the most gas-efficient approach on Solana  
    Ok(())  
}

## **14.6 Upgradeability**

Solana programs are upgradeable by default if an upgrade authority is set. The FRACKS Protocol uses a Squads multisig as the upgrade authority for all core programs. The versioning model on Solana differs from the EVM proxy pattern:

* No proxy contracts needed. Program upgrades are handled at the native Solana BPF loader level.

* PDA data structures must be carefully versioned — adding fields requires a migration instruction or backward-compatible borsh layouts.

* The Factory's program\_id references in FactoryState can be updated to point to new program versions as upgrades are deployed.

* Individual token issuers can run on a specific program version by deploying their own copy of the programs (advanced use case, not recommended for most issuers).

| 🚨  15\. ERROR CODES & EVENTS *All error codes and on-chain events emitted by FRACKS* |
| :---- |

## **15.1 FRACKS Error Codes**

| Error Code | Name | Description |
| :---- | :---- | :---- |
| 6000 | ReceiverNotVerified | is\_verified() returned false for receiver wallet |
| 6001 | TransferNotCompliant | can\_transfer() returned false — compliance rule violation |
| 6002 | SenderWalletFrozen | Sender wallet has a FrozenWallet PDA |
| 6003 | ReceiverWalletFrozen | Receiver wallet has a FrozenWallet PDA |
| 6004 | InsufficientFreeBalance | sender balance minus frozen\_amount \< transfer amount |
| 6005 | TokenPaused | TokenState.paused \== true |
| 6006 | NotOwner | Caller does not have Owner permission |
| 6007 | NotAgent | Caller does not have Agent permission |
| 6008 | NotIdentityAgent | Caller does not have Identity Agent permission |
| 6009 | FidAlreadyExists | Tried to create\_fid() for a wallet that already has a FID |
| 6010 | ClaimExpired | A required claim has expired |
| 6011 | ClaimRevoked | A required claim has been revoked by the issuer |
| 6012 | IssuerNotTrusted | Claim issuer is not in the Trusted Issuers Registry |
| 6013 | InvalidSignature | ed25519 signature on a claim is invalid |
| 6014 | TopicNotRequired | Tried to add a claim for a topic not in the CTR |
| 6015 | MaxModulesReached | Tried to bind more than 15 compliance modules |
| 6016 | ModuleAlreadyBound | Tried to bind a module that is already bound |
| 6017 | WalletAlreadyRegistered | register\_identity() called for already-registered wallet |
| 6018 | WalletNotRegistered | Tried to operate on a wallet not in the IRS |
| 6019 | InvalidCountryCode | ISO-3166 country code out of valid range |
| 6020 | MaxInvestorsReached | MaxInvestorsModule: transfer would exceed max holder count |
| 6021 | CountryRestricted | CountryRestrictModule: receiver country is blocked |
| 6022 | MaxBalanceExceeded | MaxBalanceModule: transfer would exceed receiver's max balance |
| 6023 | LockupActive | LockupModule: tokens are still in lockup period |

## **15.2 On-Chain Events**

| Event Name | Emitted By | Fields |
| :---- | :---- | :---- |
| TransferExecuted | Token Program | from, to, amount, timestamp |
| TransferRejected | Token Program | from, to, amount, error\_code, timestamp |
| TokensMinted | Token Program | to, amount, by\_agent, timestamp |
| TokensBurned | Token Program | from, amount, by\_agent, timestamp |
| ForcedTransfer | Token Program | from, to, amount, by\_agent, timestamp |
| WalletFrozen | Token Program | wallet, by\_agent, timestamp |
| WalletUnfrozen | Token Program | wallet, by\_agent, timestamp |
| PartialFreeze | Token Program | wallet, amount, by\_agent, timestamp |
| TokenRecovery | Token Program | lost\_wallet, new\_wallet, amount, by\_agent, timestamp |
| TokenPaused | Token Program | by\_owner, timestamp |
| TokenUnpaused | Token Program | by\_owner, timestamp |
| AgentAdded | Token Program | agent, by\_owner, timestamp |
| AgentRemoved | Token Program | agent, by\_owner, timestamp |
| FidCreated | FID Program | owner, fid\_pubkey, is\_issuer, country, timestamp |
| ClaimAdded | FID Program | fid, claim\_id, topic, issuer\_fid, expires\_at, timestamp |
| ClaimRevoked | FID Program | fid, claim\_id, topic, by\_issuer, timestamp |
| IdentityRegistered | IRS Program | wallet, fid, country, by\_agent, timestamp |
| IdentityRemoved | IRS Program | wallet, by\_agent, timestamp |
| TrustedIssuerAdded | TIR Program | issuer\_fid, topics, by\_owner, timestamp |
| TrustedIssuerRemoved | TIR Program | issuer\_fid, by\_owner, timestamp |
| ClaimTopicAdded | CTR Program | topic\_id, by\_owner, timestamp |
| ClaimTopicRemoved | CTR Program | topic\_id, by\_owner, timestamp |
| ModuleBound | Compliance Program | module\_pubkey, by\_owner, timestamp |
| ModuleUnbound | Compliance Program | module\_pubkey, by\_owner, timestamp |
| TokenSuiteDeployed | Factory Program | issuer, mint, deployment\_id, salt, timestamp |

| 🛠️  16\. DEVELOPER INTEGRATION GUIDE *How to deploy and integrate with FRACKS* |
| :---- |

## **16.1 Repository Structure**

fracks-protocol/  
├── programs/  
│   ├── fracks-factory/        \# Factory Program (Anchor)  
│   ├── fracks-token/          \# Token Program \+ Transfer Hook (Anchor)  
│   ├── fracks-fid/            \# FRACKS Identity Program (Anchor)  
│   ├── fracks-irp/            \# Identity Registry Program (Anchor)  
│   ├── fracks-irs/            \# Identity Registry Storage (Anchor)  
│   ├── fracks-tir/            \# Trusted Issuers Registry (Anchor)  
│   ├── fracks-ctr/            \# Claim Topics Registry (Anchor)  
│   ├── fracks-compliance/     \# Compliance Program (Anchor)  
│   └── modules/               \# Built-in Compliance Modules  
│       ├── mod-max-investors/  
│       ├── mod-country-restrict/  
│       ├── mod-max-balance/  
│       ├── mod-lockup/  
│       └── mod-daily-limit/  
├── sdk/                       \# TypeScript SDK (@fracks/sdk)  
│   ├── src/  
│   │   ├── factory.ts  
│   │   ├── token.ts  
│   │   ├── fid.ts  
│   │   ├── registry.ts  
│   │   ├── compliance.ts  
│   │   └── types.ts  
│   └── package.json  
├── tests/                     \# Anchor integration tests  
├── migrations/                \# Deploy scripts  
└── Anchor.toml

## **16.2 Environment Dependencies**

| Dependency | Version | Purpose |
| :---- | :---- | :---- |
| Rust | 1.79.0+ | Program compilation |
| Solana CLI | 1.18.x+ | Deployment and testing |
| Anchor CLI | 0.30.x+ | Anchor framework toolchain |
| Node.js | 18.x+ | TypeScript SDK and tests |
| @coral-xyz/anchor | 0.30.x+ | TypeScript Anchor client |
| @solana/spl-token | 0.4.x+ | SPL Token-2022 client |
| @solana/web3.js | 1.95.x+ | Core Solana web3 library |

## **16.3 Deploying a FRACKS Token (TypeScript SDK)**

import { FracksFactory, FracksSDK } from "@fracks/sdk";  
import { Connection, Keypair } from "@solana/web3.js";  
   
const connection \= new Connection("https://api.mainnet-beta.solana.com");  
const issuerKeypair \= Keypair.fromSecretKey(/\* your issuer key \*/);  
   
const sdk \= new FracksSDK(connection, issuerKeypair);  
   
// Deploy a full FRACKS token suite  
const deployment \= await sdk.factory.deployTokenSuite({  
    tokenName: "FRACKS Real Estate Fund I",  
    tokenSymbol: "FREF1",  
    decimals: 6,  
    isin: "US1234567890",  
    claimTopics: \[1, 2\],       // KYC \+ AML  
    trustedIssuers: \[  
        {  
            issuerFid: kycProviderFid,  
            topics: \[1\],         // Only KYC  
            label: "Acme KYC Provider"  
        },  
        {  
            issuerFid: amlProviderFid,  
            topics: \[2\],         // Only AML  
            label: "Acme AML Screening"  
        }  
    \],  
    complianceModules: \[maxInvestorsModulePubkey, countryRestrictModulePubkey\],  
    salt: crypto.randomBytes(32),  
});  
   
console.log("Token Mint:", deployment.tokenMint.toBase58());  
console.log("IRP State:", deployment.irpState.toBase58());  
console.log("Compliance:", deployment.complianceState.toBase58());

## **16.4 Registering an Investor**

// Step 1: Investor creates their FID (self-deploy)  
const fid \= await sdk.fid.createFid({  
    wallet: investorWallet,  
    isIssuer: false,  
    country: 840,  // USA  
});  
   
// Step 2: KYC Provider issues KYC claim to investor FID  
// (done by KYC Provider using their signing key)  
const dataHash \= keccak256(kycReportBytes);  
const claim \= await sdk.fid.addClaim({  
    targetFid: fid,  
    topic: 1,    // KYC  
    dataHash,  
    issuerFid: kycProviderFid,  
    issuerSignerKey: kycProviderSignerKeyPair,  
    expiresAt: Date.now() / 1000 \+ 365 \* 86400,  // 1 year  
});  
   
// Step 3: Identity Agent registers investor in IRS  
await sdk.irs.registerIdentity({  
    wallet: investorWallet,  
    fid: fid,  
    country: 840,  
    irsState: deployment.irsState,  
});  
   
// Step 4: Agent mints tokens to investor  
await sdk.token.mint({  
    to: investorWallet,  
    amount: 1000\_000000n,  // 1000 tokens at 6 decimals  
    tokenMint: deployment.tokenMint,  
});

| 🔒  17\. SECURITY CONSIDERATIONS *Attack vectors, mitigations, and audit checklist* |
| :---- |

## **17.1 Key Security Risks and Mitigations**

| Risk | Description | Mitigation in FRACKS |
| :---- | :---- | :---- |
| Compromised Claim Issuer Key | Attacker gains claim issuer signer\_key and issues fraudulent KYC/AML claims | Issuer can rotate signer\_key; old claims instantly invalid. Use hardware HSM for signer\_key. Owner can remove issuer from TIR immediately. |
| Sybil / Replay Claim Attack | Attacker tries to replay a valid claim from one FID to another | Claim signature includes both issuer\_fid AND holder\_fid. A claim for FID-A is cryptographically invalid on FID-B. |
| Expired Claim Bypass | Attacker holds on to tokens after KYC claim expires | is\_verified() always checks expires\_at \> now. Expired claims fail. Transfers are blocked until claim is renewed. |
| Malicious Compliance Module | A buggy or malicious module always returns true, bypassing rules | Owner must carefully audit modules before binding. The module list is public on-chain. All modules must be independently audited. |
| Agent Key Compromise | Attacker gains agent key and executes forced transfers or freezes | Use Squads multisig for agent operations on high-value tokens. Agent actions are all emitted as on-chain events for audit. |
| PDA Seed Collision | Two different inputs produce the same PDA address (collision attack) | Solana's PDA derivation is based on SHA-256; collision-resistant. Use canonical seed ordering. |
| CPI Privilege Escalation | Malicious program impersonates IRP or CP in a CPI chain | Token Program verifies program IDs of IRP and CP against TokenState.identity\_registry and TokenState.compliance before accepting CPI responses. |
| Registry Manipulation | Unauthorized modification of TIR or CTR | TIR and CTR accept only Owner-signed instructions. Owner should be a multisig. |

## **17.2 Recommended Security Setup**

* Use a Squads v4 multisig (3-of-5 or higher) as the Owner for all high-value token deployments.

* Store claim issuer signer\_key in a hardware security module (HSM) — never a software key for production.

* Set a maximum claim validity period (expires\_at) — 12 months recommended for KYC claims.

* Have all compliance modules independently audited before binding to a production deployment.

* Emit all events to an off-chain indexer (Helius, Triton, etc.) for compliance audit trails.

* Implement a circuit-breaker (pause functionality) process with response time SLA for the issuer or agent.

* Periodically re-verify that all IRS entries have valid, unexpired claims — especially for long-duration tokens.

## **17.3 Audit Scope Checklist**

* FRACKS Token Program — transfer gate logic, freeze/unfreeze, forced transfer, recovery, mint/burn access control

* FRACKS Identity Program — FID creation, claim addition/revocation, signature verification logic

* IRP — is\_verified() full claim chain verification, CPI account validation

* IRS — PDA access control, identity agent checks, one-identity-per-wallet enforcement

* TIR — issuer entry management, topic authorization scoping

* CTR — topic list management, effect on is\_verified() immediately

* Compliance Program — module binding/unbinding, can\_transfer() aggregation, post-transfer hooks

* Factory Program — deployment ordering, ownership transfer after deploy, salt uniqueness

* All compliance modules — individual rule logic, state update correctness after hooks

| 📎  18\. APPENDIX *Quick Reference, Glossary, and Account Map* |
| :---- |

## **18.1 Glossary**

| Term | Definition |
| :---- | :---- |
| FID (FRACKS Identity) | A PDA-based on-chain identity account per user wallet. Stores claims and key management info. Analogous to a decentralized passport on Solana. |
| Claim | A signed attestation (ClaimAccount PDA) issued by a trusted claim issuer to an investor's FID, confirming a specific attribute (e.g., KYC passed, AML cleared). |
| Claim Topic | A numeric code (u64) identifying the type of claim (1=KYC, 2=AML, etc.). The CTR stores the list of required topics for each token. |
| EVS | Eligibility Verification System. The combined logic of IRP \+ IRS \+ TIR \+ CTR that determines if a wallet is eligible to receive tokens. |
| PDA | Program Derived Address. A Solana account whose address is derived deterministically from seeds and a program ID. Used for all FRACKS state storage. |
| CPI | Cross-Program Invocation. The mechanism by which one Solana program calls instructions on another program. FRACKS uses CPIs extensively. |
| SPL Token-2022 | The second-generation Solana token standard with extension support, including Transfer Hooks used by FRACKS. |
| Transfer Hook | A Token-2022 extension that calls a custom program on every token transfer. FRACKS uses this to enforce compliance checks. |
| IRP | Identity Registry Program. Manages the EVS logic; runs is\_verified(). |
| IRS | Identity Registry Storage. Stores wallet→FID→country mappings. Can be shared across multiple tokens from the same issuer. |
| TIR | Trusted Issuers Registry. Maps claim issuer FIDs to the topics they are authorized to sign for. |
| CTR | Claim Topics Registry. Lists all claim topics an investor must hold to be eligible for a specific token. |
| CP | Compliance Program. Manages and runs modular compliance rules via can\_transfer(). |
| ISO-3166 | International standard for country codes. FRACKS uses numeric ISO-3166 codes (e.g., 840=USA, 276=Germany). |
| Rent Exemption | Minimum SOL balance required by Solana to keep an account alive. All FRACKS PDAs are rent-exempt. |

## **18.2 Complete Account Map — All PDA Seeds**

| PDA Type | Program | Seeds | Notes |
| :---- | :---- | :---- | :---- |
| FactoryState | Factory | \[b"factory\_state"\] | Global singleton |
| TokenDeployment | Factory | \[b"deployment", issuer, salt\] | Per token suite |
| TokenState | Token | \[b"token\_state", mint\] | Per token |
| OwnerState | Token | \[b"owner", mint\] | Per token |
| AgentRole | Token | \[b"agent", mint, agent\] | Per agent per token |
| FrozenWallet | Token | \[b"frozen", mint, wallet\] | Per frozen wallet |
| PartialFreeze | Token | \[b"partial\_freeze", mint, wallet\] | Per wallet with partial freeze |
| FidAccount | FID | \[b"fid", owner\_wallet\] | Per user (global) |
| ClaimAccount | FID | \[b"claim", fid, claim\_id\_bytes\] | Per claim per FID |
| IdentityRegistryState | IRP | \[b"irp\_state", mint\] | Per token |
| IdentityRegistryStorageState | IRS | \[b"irs\_state", owner\] | Per issuer (shared) |
| WalletIdentity | IRS | \[b"wallet\_identity", irs, wallet\] | Per investor per IRS |
| TrustedIssuersState | TIR | \[b"tir\_state", mint\] | Per token |
| IssuerEntry | TIR | \[b"issuer\_entry", tir, issuer\_fid\] | Per issuer per TIR |
| ClaimTopicsState | CTR | \[b"ctr\_state", mint\] | Per token |
| ComplianceState | CP | \[b"compliance\_state", mint\] | Per token |
| ModuleState | CP | \[b"module", compliance, module\] | Per module per token |

## **18.3 Standard Claim Topics Reference**

| ID | Name | Issued By | Expiry Recommendation |
| :---- | :---- | :---- | :---- |
| 1 | KYC — Know Your Customer | Licensed KYC Provider | 12 months |
| 2 | AML — Anti-Money Laundering | AML Screening Provider | 6 months |
| 3 | Accredited Investor | Legal / Financial Advisor | 12 months |
| 4 | Jurisdiction Eligibility | Legal / Compliance Provider | 12 months |
| 5 | Beneficial Ownership Declaration | KYC / Legal Provider | 12 months |
| 6 | Tax Residency Certification | Tax / Accounting Provider | 12 months |
| 7 | Sanctions Screening Clearance | AML / Compliance Provider | 3 months |
| 8 | Institutional Investor Status | Legal / Financial Advisor | 12 months |
| 9 | Professional Investor Status | Legal / Financial Advisor | 12 months |
| 100+ | Custom Issuer-Defined Topics | Issuer-Designated Provider | Issuer-defined |

*End of FRACKS Protocol Architecture Specification v1.0*

Built for Solana  •  Powered by Anchor  •  SPL Token-2022