import { AnchorProvider } from "@coral-xyz/anchor";

import { FracksComplianceClient } from "./compliance";
import { FracksFactoryClient } from "./factory";
import { FracksFidClient } from "./fid";
import { FracksRegistryClient } from "./registry";
import { FracksTokenClient } from "./token";

export * from "./types";

export class FracksSDK {
  readonly provider: AnchorProvider;
  readonly factory: FracksFactoryClient;
  readonly fid: FracksFidClient;
  readonly registry: FracksRegistryClient;
  readonly token: FracksTokenClient;
  readonly compliance: FracksComplianceClient;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.factory = new FracksFactoryClient(provider);
    this.fid = new FracksFidClient(provider);
    this.registry = new FracksRegistryClient(provider);
    this.token = new FracksTokenClient(provider);
    this.compliance = new FracksComplianceClient(provider);
  }

  initializeFactory(...args: Parameters<FracksFactoryClient["initializeFactory"]>) {
    return this.factory.initializeFactory(...args);
  }

  deployTokenSuite(...args: Parameters<FracksFactoryClient["deployTokenSuite"]>) {
    return this.factory.deployTokenSuite(...args);
  }
}
