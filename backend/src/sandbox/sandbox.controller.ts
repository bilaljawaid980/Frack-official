import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { SandboxService } from "./sandbox.service";

@Controller("sandbox")
export class SandboxController {
  constructor(private readonly sandbox: SandboxService) {}

  @Get("phase4/readiness")
  readiness() {
    return this.sandbox.readiness();
  }

  @Get("secondary-market/listings")
  listings() {
    return this.sandbox.listSecondaryMarket();
  }

  @Post("plf/quick-exit")
  quickExit(@Body() body: any) {
    return this.sandbox.requestQuickExit(body);
  }

  @Post("certifier/certify-milestone")
  certifyMilestone(@Body() body: Record<string, unknown>) {
    return this.sandbox.certifyMilestone(body);
  }

  @Get("court/wirasat/:reference")
  wirasat(@Param("reference") reference: string) {
    return this.sandbox.getWirasat(reference);
  }

  @Get("insurance/policy/:assetId")
  insurancePolicy(@Param("assetId") assetId: string) {
    return this.sandbox.getInsurancePolicy(assetId);
  }

  @Post("insurance/declare-loss/:assetId")
  declareLoss(@Param("assetId") assetId: string, @Body() body: Record<string, unknown>) {
    return this.sandbox.declareInsuranceLoss(assetId, body);
  }

  @Post("shariah/certify")
  shariah(@Body() body: Record<string, unknown>) {
    return this.sandbox.certifyShariah(body);
  }
}
