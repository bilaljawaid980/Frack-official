import { Module } from "@nestjs/common";
import { AssetsService } from "./assets.service";
import { AssetsController } from "./assets.controller";
import { BlockchainTransactionsModule } from "../blockchain-transactions/blockchain-transactions.module";

@Module({
  imports: [BlockchainTransactionsModule],
  providers: [AssetsService],
  controllers: [AssetsController],
})
export class AssetsModule {}
