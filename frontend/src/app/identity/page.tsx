"use client";

import { redirect } from "next/navigation";

export default function LegacyIdentityPage() {
  redirect("/trusted-provider/claim-provider");
}
