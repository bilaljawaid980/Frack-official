import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_BUCKET = process.env.SUPABASE_LEGAL_DOCS_BUCKET || "legal-docs";

function getSupabaseAdminClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Supabase server storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

function isSafePath(path: string) {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("..") &&
    !path.includes("\\")
  );
}

function fileNameFromPath(path: string) {
  return path.split("/").pop()?.replace(/["\r\n]/g, "") || "document";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bucket = searchParams.get("bucket") || DEFAULT_BUCKET;
    const path = searchParams.get("path") || "";

    if (bucket !== DEFAULT_BUCKET) {
      return NextResponse.json(
        { success: false, error: "Invalid document bucket." },
        { status: 400 },
      );
    }

    if (!isSafePath(path)) {
      return NextResponse.json(
        { success: false, error: "Invalid document path." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) {
      return NextResponse.json(
        { success: false, error: error?.message || "Document not found." },
        { status: 404 },
      );
    }

    return new NextResponse(data, {
      headers: {
        "Content-Type": data.type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${fileNameFromPath(path)}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to download document.",
      },
      { status: 500 },
    );
  }
}
