import { Injectable } from "@nestjs/common";
import { createHash } from "crypto";

type QuickExitRequest = {
  wallet: string;
  tokenMint: string;
  quantity: number;
  nav: number;
};

type MarketListing = {
  id: string;
  tokenMint: string;
  seller: string;
  quantity: number;
  pricePerToken: number;
  status: "OPEN" | "LOCKED" | "SETTLED" | "CANCELLED";
};

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

@Injectable()
export class SandboxService {
  private creditLinePkr = 50_000_000;
  private listings: MarketListing[] = [
    {
      id: "SM-001",
      tokenMint: "demo-real-estate-token",
      seller: "SeedInvestor111111111111111111111111111111111",
      quantity: 2_500,
      pricePerToken: 980,
      status: "OPEN",
    },
    {
      id: "SM-002",
      tokenMint: "demo-real-estate-token",
      seller: "SeedInvestor222222222222222222222222222222222",
      quantity: 1_000,
      pricePerToken: 1_015,
      status: "OPEN",
    },
  ];

  readiness() {
    return {
      phase4Status: "SANDBOX_ONLY",
      message: "Real NADRA, bank, PLRA, valuer, custodian, PLF, certifier, court, insurance, Shariah, RDA, and FBR integrations require external agreements before production.",
      integrations: [
        { mock: "NADRA Simulator", production: "NADRA Verisys API", status: "MOU_REQUIRED" },
        { mock: "Bank Payment Simulator", production: "Bank BaaS API", status: "PARTNERSHIP_REQUIRED" },
        { mock: "PLRA Simulator", production: "PLRA digital Fard API", status: "MOU_REQUIRED" },
        { mock: "Valuer Simulator", production: "SECP valuer integration", status: "PARTNERSHIP_REQUIRED" },
        { mock: "Custodian Simulator", production: "Licensed custodian integration", status: "PARTNERSHIP_REQUIRED" },
        { mock: "PLF Institution Simulator", production: "NBFC/bank credit line", status: "REGULATORY_APPROVAL_REQUIRED" },
        { mock: "Court Simulator", production: "Manual compliance workflow", status: "NO_PUBLIC_API" },
        { mock: "Insurance Simulator", production: "Licensed insurer API", status: "PARTNERSHIP_REQUIRED" },
        { mock: "FBR CGT Reporting", production: "FBR reporting workflow", status: "SPEC_REQUIRED" },
      ],
    };
  }

  listSecondaryMarket() {
    return { listings: this.listings };
  }

  requestQuickExit(request: QuickExitRequest) {
    const proceeds = Math.floor(request.quantity * request.nav * 0.98);
    if (proceeds > this.creditLinePkr) {
      return {
        status: "REJECTED",
        reason: "PLF credit line exhausted",
        availableCreditLinePkr: this.creditLinePkr,
      };
    }

    this.creditLinePkr -= proceeds;
    return {
      status: "APPROVED",
      requestHash: hashPayload(request),
      proceeds,
      discountBps: 200,
      availableCreditLinePkr: this.creditLinePkr,
      simulatedSteps: ["requested", "institution_buying", "fiat_on_the_way", "complete"],
    };
  }

  certifyMilestone(body: Record<string, unknown>) {
    return {
      status: "CERTIFIED",
      topic: 6,
      certifier: "sandbox-construction-certifier",
      certificateHash: hashPayload(body),
      onChainInstruction: "fracks_asset_registry.attest_milestone",
    };
  }

  getWirasat(reference: string) {
    return {
      reference,
      status: "FOUND",
      deceasedCnicHash: hashPayload({ reference, type: "deceased-cnic" }),
      courtRefHash: hashPayload({ reference, type: "court" }),
      heirs: [
        { label: "spouse", shareBps: 1250 },
        { label: "son", shareBps: 4375 },
        { label: "daughter", shareBps: 4375 },
      ],
    };
  }

  getInsurancePolicy(assetId: string) {
    return {
      assetId,
      policyStatus: "ACTIVE",
      insurer: "Sandbox Property Insurer",
      coveredAmount: 100_000_000,
      policyHash: hashPayload({ assetId, policy: "sandbox" }),
    };
  }

  declareInsuranceLoss(assetId: string, body: Record<string, unknown>) {
    return {
      assetId,
      status: "CLAIM_APPROVED",
      insuranceClaimHash: hashPayload({ assetId, ...body }),
      simulatedWebhook: "insurance.claim.approved",
      onChainInstruction: "fracks_asset_registry.declare_total_loss",
    };
  }

  certifyShariah(body: Record<string, unknown>) {
    return {
      status: "CERTIFIED",
      topic: 7,
      board: "sandbox-shariah-board",
      certificationHash: hashPayload(body),
    };
  }
}
