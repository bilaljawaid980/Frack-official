import { Connection, PublicKey } from "@solana/web3.js";

export class ChainClient {
  private connection: Connection;

  constructor(rpcEndpoint: string) {
    this.connection = new Connection(rpcEndpoint, "confirmed");
  }

  async getAccountInfo(pubkey: string) {
    return this.connection.getAccountInfo(new PublicKey(pubkey), "confirmed");
  }
}
