import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const LEGAL_DOCS_BUCKET = "legal-docs";

export function getSupabaseBrowserClient() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Supabase storage is not configured.");
  }
  let client = createClient(supabaseUrl, supabasePublishableKey);
  if (typeof window === "undefined") {
    throw new Error("Supabase browser client cannot be used on the server.");
  }
  console.log("Supabase browser client initialized.", client);
  return client;
}
