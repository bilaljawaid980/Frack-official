ALTER TABLE "asset_valuer_assignments" ALTER COLUMN "token_contract" DROP NOT NULL;
ALTER TABLE "asset_valuer_assignments" ALTER COLUMN "asset_registry_address" DROP NOT NULL;
ALTER TABLE "asset_valuer_assignments" ALTER COLUMN "tir_state_address" DROP NOT NULL;

ALTER TABLE "asset_valuations" ALTER COLUMN "token_contract" DROP NOT NULL;
ALTER TABLE "asset_valuations" ALTER COLUMN "asset_registry_address" DROP NOT NULL;
ALTER TABLE "asset_valuations" ALTER COLUMN "tx_hash" DROP NOT NULL;