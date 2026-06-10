# Fracks Protocol — Solana Compliant Security Token Suite

[![Rust](https://img.shields.io/badge/Rust-1.89%2B-orange.svg)](https://www.rust-lang.org/)
[![Anchor](https://img.shields.io/badge/Anchor-0.32.1-purple.svg)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-Testnet-green.svg)](https://solana.com/)
[![Token-2022](https://img.shields.io/badge/SPL-Token--2022-blue.svg)](https://spl.solana.com/token-2022)

Fracks Protocol is a Solana-native platform for issuing and managing **compliant security tokens** that represent regulated real-world assets (RWAs). It brings an ERC-3643 / T-REX–inspired architecture to Solana, combining on-chain identity, trusted issuers, claim topics, identity registries, pluggable compliance modules, factory-based deployment, and **SPL Token-2022 transfer-hook enforcement** so that regulatory rules are evaluated and enforced at the token layer on every transfer.

The platform ships as a full stack:

- **Smart contracts** — a Solana Anchor workspace in [`contracts/`](contracts/)
- **Backend** — a NestJS API with Prisma, Postgres, and an on-chain indexer in [`backend/`](backend/)
- **Frontend** — a Next.js application for issuers, investors, compliance officers, and administrators in [`frontend/`](frontend/)
- **Deployment** — Docker / Docker Compose definitions for the frontend, backend, Postgres, and Prisma migrations

---

## Table of Contents

- [Status](#status)
- [Highlights](#highlights)
- [Program Suite](#program-suite)
- [Testnet Program IDs](#testnet-program-ids)
- [Architecture](#architecture)
- [Token Lifecycle & Operations](#token-lifecycle--operations)
- [Repository Layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Contracts](#contracts)
- [Backend](#backend)
- [Frontend](#frontend)
- [Docker Deployment](#docker-deployment)
- [Security Notes](#security-notes)
- [Documentation](#documentation)
- [License](#license)

---

## Status

Testnet deployment work was completed on **May 8, 2026**.

- **Anchor programs** — deployed and verified on Solana testnet
- **Governance custody** — upgrade authority transferred to a Squads vault PDA
- **Tests** — green in the recorded deployment summary
- **Outstanding** — factory upgrade execution through the local Squads CLI was not completed in the recorded session

See [contracts/FRACKS_TESTNET_DEPLOYMENT_SUMMARY_2026-05-08.md](contracts/FRACKS_TESTNET_DEPLOYMENT_SUMMARY_2026-05-08.md) for the detailed deployment report.

---

## Highlights

- **Compliance enforced on-chain** — every transfer is routed through a Token-2022 transfer hook that validates identity, claim topics, trusted issuers, and all bound compliance modules before the transfer can settle.
- **Pluggable compliance modules** — country caps, country restrictions, daily limits, lock-ups, maximum balances, investor counts, transfer caps, and supply caps can be attached, removed, or paged independently per token.
- **Full security-token lifecycle** — primary issuance (direct mint and cash-settled subscriptions), secondary transfers, burns, forced transfers, and key recovery.
- **Issuer controls** — pause/unpause trading, freeze entire wallets, and freeze a *partial* token balance while leaving the remainder transferable.
- **Identity & KYC** — on-chain Fracks Identity (FID) accounts, claim issuance/revocation, trusted-issuer management, and an identity registry split across proxy and storage programs.
- **Factory deployment** — `fracks_factory` provisions a complete, wired token suite (mint, compliance, registries) in a coordinated flow.
- **Role-based agents** — delegate privileged operations to agents without surrendering ownership.

---

## Program Suite

### Core programs

| Program | Responsibility |
| --- | --- |
| `fracks_factory` | Deploys and coordinates complete compliant token suites |
| `fracks_token` | Compliant security-token logic (issuance, transfer, freeze, burn, recovery) |
| `fracks_token_hook` | SPL Token-2022 transfer-hook enforcement |
| `fracks_fid` | Fracks Identity account program (on-chain identity & claims) |
| `fracks_irp` | Identity registry proxy |
| `fracks_irs` | Identity registry storage |
| `fracks_tir` | Trusted issuers registry |
| `fracks_ctr` | Claim topics registry |
| `fracks_compliance` | Compliance module router |

### Compliance modules

| Module | Rule |
| --- | --- |
| `mod_country_cap` | Caps holders per country |
| `mod_country_restrict` | Allows/blocks specific countries |
| `mod_daily_limit` | Per-day transfer volume limit |
| `mod_lockup` | Time-based transfer lock-ups |
| `mod_max_balance` | Maximum balance per holder |
| `mod_max_investors` | Maximum number of investors |
| `mod_max_transfer` | Maximum amount per transfer |
| `mod_supply_cap` | Maximum total supply |

---

## Testnet Program IDs

| Program | Program ID |
| --- | --- |
| `fracks_factory` | `6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe` |
| `fracks_token` | `Gr9Y5q2aHtQEpYHgqme3hctqQ2sNRGF1ZVx9cQvMDjBn` |
| `fracks_token_hook` | `CQwdsA97gSiPMUzNXjS22AUu6HmvzMK2XZVqhswYEHLi` |
| `fracks_fid` | `7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH` |
## Fracks Protocol — Solana Compliant Security Token Suite

[![Rust](https://img.shields.io/badge/Rust-1.89%2B-orange.svg)](https://www.rust-lang.org/)
[![Anchor](https://img.shields.io/badge/Anchor-0.32.1-purple.svg)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-Devnet-yellowgreen.svg)](https://solana.com/)
[![SPL-Token-2022](https://img.shields.io/badge/SPL-Token--2022-blue.svg)](https://spl.solana.com/token-2022)

Fracks is a modular Solana-native platform for issuing and operating compliant security tokens that represent regulated real-world assets (RWAs). It applies transfer-hook enforcement via SPL Token-2022, on-chain identity and claim management, and a factory pattern to deploy wired, auditable token suites.

This repository contains:

- `contracts/` — Anchor programs (core programs and compliance modules)
- `backend/` — NestJS API, Prisma schema, and an on-chain indexer
- `frontend/` — Next.js issuer / investor / admin UI
- Docker Compose definitions to run the full stack locally

**What’s changed (latest):**
- Documentation updated to reflect devnet deployments and current program IDs.
- Backend defaults target `devnet` and use Helius RPC by default in development `.env`.

**Quick links:** [contracts](contracts/) • [backend](backend/) • [frontend](frontend/) • [docs](docs/)

---

**Contents**

- Status
- Quickstart
- Programs & Devnet IDs
- Architecture & Transfer Flow
- Contracts: build & test
- Backend & Frontend: run locally
- Docker: full-stack commands
- Security & Governance notes
- Where to find more docs

---

## Status

The project has a complete Anchor workspace and accompanying backend/frontend. Recent deployment and audit artifacts are in `contracts/` and `docs/` with dates in May 2026. This README focuses on developer setup for `devnet` and local development.

---

## Quickstart (developer)

1) Install prerequisites: Rust toolchain, Anchor, Solana CLI, Node.js 20+, pnpm, Docker.

2) Contracts build & test

```bash
cd contracts
anchor build
anchor test
```

3) Backend

```bash
cd ../backend
pnpm install
pnpm prisma generate
pnpm run start
```

4) Frontend

```bash
cd ../frontend
pnpm install
pnpm run dev
```

Or run everything with Docker Compose (see Docker section).

---

## Programs & Devnet Program IDs

## Fracks Protocol — Solana Security-Token Framework

[![Rust](https://img.shields.io/badge/Rust-1.89%2B-orange.svg)](https://www.rust-lang.org/) [![Anchor](https://img.shields.io/badge/Anchor-0.32.1-purple.svg)](https://www.anchor-lang.com/) [![Solana](https://img.shields.io/badge/Solana-Devnet-blue.svg)](https://solana.com/) [![SPL-Token-2022](https://img.shields.io/badge/SPL-Token--2022-blue.svg)](https://spl.solana.com/token-2022)

Fracks is a modular Solana-native framework for issuing and operating compliant security tokens that represent regulated real-world assets (RWAs). It enforces compliance at the token layer via SPL Token-2022 transfer hooks, on-chain identity, trusted issuers, claims, and pluggable compliance modules.

This repository contains:

- `contracts/` — Anchor programs (core programs and compliance modules)
- `backend/` — NestJS API, Prisma schema, and the on-chain indexer
- `frontend/` — Next.js issuer/investor/admin UI
- Docker compose and Dockerfiles to run the full stack locally

Contents
--------

- Status
- Key highlights
- Program suite and Devnet program IDs
- Architecture overview
- Quick start (contracts, backend, frontend)
- Repository layout and links
- Security notes and next steps
- Where to find more docs

Status
------

Configuration and Devnet deployments are documented in the `backend/.env` file and the `contracts/` docs. The repository contains the latest devnet program IDs used by the backend indexer (see the Devnet Program IDs table below).

Key highlights
--------------

- Compliance enforced on-chain via SPL Token-2022 transfer hooks
- Modular compliance programs (country caps, lockups, daily limits, etc.)
- Factory-based token suite provisioning (`fracks_factory`)
- Full token lifecycle: issuance, transfers, forced transfers, burns, recovery
- Role-based agents and governance-ready upgrade authority management

Program suite (core)
---------------------

Core programs provide the token, identity, registry, and compliance surfaces used by Fracks.

| Program | Responsibility |
| --- | --- |
| `fracks_factory` | Deploys and wires token suites (mint, registries, compliance) |
| `fracks_token` | Token logic: issuance, freeze, burn, recovery |
| `fracks_token_hook` | SPL Token-2022 transfer-hook enforcement |
| `fracks_fid` | On-chain identity & claims |
| `fracks_irp` | Identity registry proxy |
| `fracks_irs` | Identity registry storage |
| `fracks_tir` | Trusted issuers registry |
| `fracks_ctr` | Claim topics registry |
| `fracks_compliance` | Compliance router and module coordinator |

Compliance modules (examples)
-----------------------------

| Module | Purpose |
| --- | --- |
| `mod_country_cap` | Per-country holder caps |
| `mod_country_restrict` | Country allow/block lists |
| `mod_daily_limit` | Per-day transfer volume limit |
| `mod_lockup` | Time-based lockups |
| `mod_max_balance` | Max balance per holder |
| `mod_max_investors` | Max number of investors |
| `mod_max_transfer` | Max transfer amount |
| `mod_supply_cap` | Max total supply |

Devnet Program IDs
-------------------

The table below contains the currently configured Devnet program IDs (sourced from `backend/.env`). If you update deployments, update `backend/.env` and this table accordingly.

| Program | Devnet Program ID |
| --- | --- |
| `fracks_factory` | `FtrzQ1hhjL7vbEPAxLBeLgrmomanSVj9UpV6LLJ5TYFS` |
| `fracks_token` | `6Naj8HsuNdUJQyyzmPssm1mZRDF7F5VMQ91n9QyMoyGj` |
| `fracks_token_hook` | `9JrgWtW4UrQoC3tVQRxWBBEQPjDJ2QFDzAVAvSzGtPJ5` |
| `fracks_fid` | `Fb2roXDWjEaZwWJvxAWJTCRsK4Hy4V64MuCwoGXWMUtW` |
| `fracks_irp` | `HQqgbvfmSzY1yEyhVbyhYqSsbVrRmjUnPmm2nE4ZwRvZ` |
| `fracks_irs` | `CnAZUQ9jFm2eLGA8d8ek1gpLwGc6xZqvnbyJ9s7swbWc` |
| `fracks_tir` | `9bgANehpsEDdgyo5DwpY36wmnPdpCihSiAP9TLoBBf4L` |
| `fracks_ctr` | `8MuWrtbZ1zPzrDhSKPjDd78SMQAMtBuprPnc1Zam1Gig` |
| `fracks_compliance` | `HnJiNrmDeVFZksgEXaQwyVqHXQLRcyqXEksbYhkiPFFV` |

Modifier / Module Program IDs (Devnet)
-------------------------------------

| Module | Devnet Program ID |
| --- | --- |
| `mod_max_investors` | `2zfQv7RxmL5BAgXXFagZXBNby4Q41YGH6hnSJAcsXQeU` |
| `mod_country_restrict` | `4ChDAU375yPJXZLG5XqtbbKdirAr3xHU5vnhppUjgu2d` |
| `mod_max_balance` | `HEjNS1GC9nffSdXbi6aQ9WNQBNFy4Q41YGH6hnSJAcsXQeU` |
| `mod_max_transfer` | `4gJbGvgnBhJ91gByKNo7eEVmCbsUkK5opyeo3M1VEJsy` |
| `mod_lockup` | `EvDVqTUjs3ZsAUfPQdyVskYCzoPTbWybF5tcBtWYfAuz` |
| `mod_daily_limit` | `5dfHskP5MijaDY2gYsE44CPAuomt1vWgbPdGi62cquoT` |
| `mod_supply_cap` | `6tfb66btx776wdsPS5EHDTwWnvPSLJQje7gFQ4EDGxGc` |
| `mod_country_cap` | `EcLffdKdSsCpNczazKsSeRw7FCN6vVjKAEMH5CZGBndr` |

Architecture (brief)
--------------------

Fracks separates identity, registry, compliance, and token logic across Anchor programs so compliance checks run atomically during token transfers. The transfer flow is:

1. SPL Token-2022 transfer occurs.
2. The Token-2022 transfer hook calls `fracks_token_hook`.
3. The hook invokes `fracks_compliance`, which consults registries (`fracks_irp`/`fracks_irs`), claim topics (`fracks_ctr`), and trusted issuers (`fracks_tir`) and runs bound modules.

Quick start
-----------

Build contracts and run tests:

```bash
cd contracts
anchor build
anchor test
```

Run backend (separate shell):

```bash
cd backend
pnpm install
pnpm prisma generate
pnpm run start
```

Run frontend (separate shell):

```bash
cd frontend
pnpm install
pnpm run dev
```

Or bring up the full stack with Docker:

```bash
docker compose up -d --build
```

Backend environment example (Devnet)
---------------------------------

Set the following (or copy from `backend/.env`):

```env
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=<your-devnet-rpc>
FRACKS_FACTORY=FtrzQ1hhjL7vbEPAxLBeLgrmomanSVj9UpV6LLJ5TYFS
FRACKS_TOKEN_PROGRAM=6Naj8HsuNdUJQyyzmPssm1mZRDF7F5VMQ91n9QyMoyGj
FRACKS_TOKEN_HOOK=9JrgWtW4UrQoC3tVQRxWBBEQPjDJ2QFDzAVAvSzGtPJ5
FRACKS_COMPLIANCE=HnJiNrmDeVFZksgEXaQwyVqHXQLRcyqXEksbYhkiPFFV
FRACKS_IRP=HQqgbvfmSzY1yEyhVbyhYqSsbVrRmjUnPmm2nE4ZwRvZ
FRACKS_IRS=CnAZUQ9jFm2eLGA8d8ek1gpLwGc6xZqvnbyJ9s7swbWc
FRACKS_FID=Fb2roXDWjEaZwWJvxAWJTCRsK4Hy4V64MuCwoGXWMUtW
FRACKS_TIR=9bgANehpsEDdgyo5DwpY36wmnPdpCihSiAP9TLoBBf4L
FRACKS_CTR=8MuWrtbZ1zPzrDhSKPjDd78SMQAMtBuprPnc1Zam1Gig
```

Repository layout
-----------------

See the `contracts/`, `backend/`, and `frontend/` folders for code and documentation.

Security notes and next steps
-----------------------------

- Privileged instructions require owner/agent authority and remain auditable.
- Program upgrade authority should be governed by a multisig or vault (Squads).
- Update program IDs in `backend/.env` when re-deploying; keep the README table synced with `backend/.env`.
- Run an independent external audit before any mainnet deployment.

Documentation
-------------

- [Contract Architecture](contracts/FRACKS_Protocol_Architecture.md)
- [Implementation Details](contracts/FRACKS_IMPLEMENTATION_DETAILED.md)
- [Testing Guide](contracts/FRACKS_TESTING_GUIDE.md)
- [CLI Command Reference](contracts/FRACKS_CLI_COMMAND_REFERENCE.md)
- [Deployment Summary](contracts/FRACKS_TESTNET_DEPLOYMENT_SUMMARY_2026-05-08.md)

License
-------

License information has not been finalized for this repository.