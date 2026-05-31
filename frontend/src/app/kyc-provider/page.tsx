"use client";

import { redirect } from "next/navigation";

export default function LegacyKycProviderPage() {
  redirect("/trusted-provider/claim-provider");
}
