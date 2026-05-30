# Fracks Protocol: Solana Compliant Security Token Suite

[![Rust](https://img.shields.io/badge/Rust-1.89%2B-orange.svg)](https://www.rust-lang.org/)
[![Anchor](https://img.shields.io/badge/Anchor-0.32.1-purple.svg)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-Testnet-green.svg)](https://solana.com/)

Fracks Protocol is a Solana-native compliant security token platform for regulated real-world asset tokenization. It implements an ERC-3643/T-REX-inspired architecture with on-chain identity, trusted issuers, claim topics, identity registries, compliance modules, factory deployment, and SPL Token-2022 transfer-hook enforcement.

The repository includes:

- Solana Anchor programs in `contracts/`
- NestJS backend API in `backend/`
- Next.js frontend in `frontend/`
- Docker deployment files for frontend, backend, Postgres, and Prisma migrations

## Status

Testnet deployment work was completed on May 8, 2026.

- Anchor programs: deployed on Solana testnet
- Governance custody: transferred to Squads vault PDA
- Tests: green in the deployment summary
- Remaining release note: factory upgrade execution through local Squads CLI was not completed in the recorded session

See [contracts/FRACKS_TESTNET_DEPLOYMENT_SUMMARY_2026-05-08.md](contracts/FRACKS_TESTNET_DEPLOYMENT_SUMMARY_2026-05-08.md) for the detailed deployment summary.

## Program Suite

Core programs:

- `fracks_factory` - deploys and coordinates compliant token suites
- `fracks_token` - compliant security token logic
- `fracks_token_hook` - SPL Token-2022 transfer-hook enforcement
- `fracks_fid` - Fracks identity account program
- `fracks_irp` - identity registry proxy
- `fracks_irs` - identity registry storage
- `fracks_tir` - trusted issuers registry
- `fracks_ctr` - claim topics registry
- `fracks_compliance` - compliance module router

Compliance modules:

- `mod_country_cap`
- `mod_country_restrict`
- `mod_daily_limit`
- `mod_lockup`
- `mod_max_balance`
- `mod_max_investors`
- `mod_max_transfer`
- `mod_supply_cap`

## Testnet Program IDs

| Program | Program ID |
| --- | --- |
| `fracks_factory` | `6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe` |
| `fracks_token` | `Gr9Y5q2aHtQEpYHgqme3hctqQ2sNRGF1ZVx9cQvMDjBn` |
| `fracks_token_hook` | `CQwdsA97gSiPMUzNXjS22AUu6HmvzMK2XZVqhswYEHLi` |
| `fracks_fid` | `7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH` |
| `fracks_irp` | `6dDKwtRbGkHJhU9LztpDkBC3fUdM46WeKJdrASFikce6` |
| `fracks_irs` | `CsrdR7QK3ma6hxU46Cp4DZHAdbGPWPiwmGjhKsR9VzdS` |
| `fracks_tir` | `Am5W7oEe8NCU4jdLP8qyUT3gjUPCDsvTSxGhdCQp1ETS` |
| `fracks_ctr` | `B15EFQKwnfbNHXHhPVvVcw18PaBeTDsRLNRno3QS8Yna` |
| `fracks_compliance` | `9XYxZzDfU17BBpN1qhdu7RDCCrV6uebDgi5xse7Jbz5d` |
| `mod_country_cap` | `Cv1HA7nHX8vxZvyCKXjk3gYPkqhfHFXxEsyxSXyRT3Ci` |
| `mod_country_restrict` | `BCGKsDTyncA4EbHzxGVmEi3pheotJiaxCwYvHGxERiZ7` |
| `mod_daily_limit` | `FYJ1K8cWUsDmbxNpgaBaEmm3RpvvfpxBBWg2MLm4x8Sq` |
| `mod_lockup` | `6XqxWPwZQrfTo2ZJeT7wBhJaXd1eKjB2kx5ZrP1CLwa9` |
| `mod_max_balance` | `9BjLakhcX1ms34VjRwUgMZQAgdbsMM8C1gSPqrJTyCpH` |
| `mod_max_investors` | `4KVbq2esECUHZZdsBiDMM3mxYt8K7rNJUdotG6uZJfRQ` |
| `mod_max_transfer` | `Ee6RXC46Nb4Bo2BTQcXBHfuxLZdzbKtPmb3sGf2Egiqh` |
| `mod_supply_cap` | `EkgX6pGFCFT7FuNWuBAAMePy43iU9oETLDota4nTA3x8` |

## Architecture

The protocol separates token issuance, identity verification, trusted issuer management, claim topic requirements, and compliance checks into independent Anchor programs.

High-level transfer flow:

1. A token transfer is requested through SPL Token-2022.
2. The transfer hook invokes Fracks compliance logic.
3. Compliance checks identity registry state, required claim topics, trusted issuer approvals, and configured compliance modules.
4. The transfer is approved or rejected on-chain.

This design keeps regulated-transfer rules enforceable at the token layer while allowing compliance modules to be extended or replaced.

## Repository Layout

```text
.
├── contracts/              # Solana Anchor workspace
│   ├── programs/           # Core Fracks programs
│   ├── programs/modules/   # Compliance modules
│   ├── scripts/            # CLI and governance helpers
│   └── tests/              # Anchor integration tests
├── backend/                # NestJS API, Prisma, indexer
├── frontend/               # Next.js frontend
├── docker-compose.yml      # App stack
├── Dockerfile.backend
└── Dockerfile.frontend
```

## Prerequisites

- Rust stable
- Solana CLI
- Anchor CLI `0.32.1`
- Node.js 20+
- pnpm
- Docker and Docker Compose, for containerized app deployment

## Build Contracts

```bash
cd contracts
anchor build
```

## Run Contract Tests

```bash
cd contracts
anchor test
```

## Solana CLI Setup

For testnet:

```bash
solana config set --url https://api.testnet.solana.com
solana config get
```

For localnet:

```bash
solana-test-validator
solana config set --url http://127.0.0.1:8899
```

## Backend

The backend is a NestJS API with Prisma and Postgres. It stores application data, user state, indexed token data, KYC submissions, activity logs, and indexed on-chain state.

```bash
cd backend
pnpm install
pnpm prisma generate
pnpm run build
pnpm run start
```

Important environment variables:

```env
DATABASE_URL=postgresql://postgres:1234@localhost:5432/rwaPlatformDB?schema=public
SOLANA_RPC_URL=https://api.testnet.solana.com
SOLANA_CLUSTER=testnet
FRACKS_FACTORY=6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe
FRACKS_TOKEN_MINT=99eSVUsJKBHL7JMiVVjCBqMShxX74Nb7d5JkDn19NQAR
```

## Frontend

The frontend is a Next.js app for issuers, investors, compliance users, identity/KYC flows, and admin operations.

```bash
cd frontend
pnpm install
pnpm run dev
```

Default local URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`

## Docker Deployment

The Docker stack runs:

- `db` - Postgres
- `migrate` - one-shot Prisma migration container
- `backend` - NestJS API
- `indexer` - backend indexer runner
- `frontend` - Next.js production server

```bash
docker compose up -d --build
```

Stop the stack:

```bash
docker compose down
```

Reset the local database volume:

```bash
docker compose down -v
docker compose up -d --build
```

## Key Operations

- Deploy compliant token suites through `fracks_factory`
- Register identities with `fracks_fid`, `fracks_irp`, and `fracks_irs`
- Configure trusted issuers through `fracks_tir`
- Configure required claim topics through `fracks_ctr`
- Attach compliance modules through `fracks_compliance`
- Enforce transfer checks through `fracks_token_hook`
- Manage issuance, redemption, recovery, freeze, pause, and admin flows

## Security Notes

- Privileged instructions require explicit authority checks.
- Program upgrade authority is documented as transferred to the Squads vault PDA in the testnet deployment summary.
- Compliance checks are enforced through the transfer-hook path.
- External audit is recommended before mainnet use.

## Documentation

- [Contract Architecture](contracts/FRACKS_Protocol_Architecture.md)
- [Testing Guide](contracts/FRACKS_TESTING_GUIDE.md)
- [CLI Command Reference](contracts/FRACKS_CLI_COMMAND_REFERENCE.md)
- [Deployment Summary](contracts/FRACKS_TESTNET_DEPLOYMENT_SUMMARY_2026-05-08.md)
- [Backend README](backend/README.md)
- [Frontend README](frontend/README.md)

## License

License information has not been finalized in this repository.
