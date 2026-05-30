#!/bin/bash

node scripts/cli/fracks_factory/deploy_token_suite.js \
--issuer "$(solana address)" \
--factory_state "$FACTORY" \
--deployment "$DEPLOYMENT" \
--token_state "$TOKEN_STATE" \
--owner_state "$OWNER_STATE" \
--irs_state "$FACTORY_IRS" \
--tir_state "$FACTORY_TIR" \
--ctr_state "$FACTORY_CTR" \
--irp_state "$FACTORY_IRP" \
--compliance_state "$FACTORY_COMPLIANCE" \
--args @deploy_args.json \
--remaining-accounts-file remaining_factory.json
