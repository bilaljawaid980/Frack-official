"use client";

import { redirect } from "next/navigation";

export default function LegacyIssuerIdentityPage() {
  redirect("/trusted-provider/provider-fid");
}
