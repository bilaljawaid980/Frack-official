import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const LEGAL_DOCS_BUCKET =
  process.env.SUPABASE_LEGAL_DOCS_BUCKET || "legal-docs";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

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

function sanitizePathPart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function fileExtension(fileName: string) {
  return fileName.includes(".") ? fileName.split(".").pop() || "bin" : "bin";
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function legalDocUrl(bucket: string, path: string) {
  const params = new URLSearchParams({ bucket, path });
  return `/api/legal-docs/file?${params.toString()}`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const issuerWallet = String(formData.get("issuerWallet") || "");
    const symbol = String(formData.get("symbol") || "asset");
    const files = formData.getAll("files").filter((entry): entry is File => {
      return entry instanceof File;
    });
    const documentTypes = formData
      .getAll("documentTypes")
      .map((entry) => String(entry || "asset_document"));

    if (!issuerWallet) {
      return errorResponse("Issuer wallet is required.");
    }

    if (files.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) {
        return errorResponse(
          `${file.name} must be a PDF, JPG, or PNG document.`,
        );
      }
      if (file.size > MAX_FILE_SIZE) {
        return errorResponse(`${file.name} exceeds the 10MB upload limit.`);
      }
    }

    const supabase = getSupabaseAdminClient();
    const requestFolder = [
      sanitizePathPart(issuerWallet),
      `${Date.now()}-${crypto.randomUUID()}`,
    ].join("/");

    const uploadedDocuments = await Promise.all(
      files.map(async (file, index) => {
        const documentType = documentTypes[index] || "asset_document";
        const safeName = sanitizePathPart(
          file.name.replace(/\.[^/.]+$/, ""),
        );
        const path = [
          requestFolder,
          sanitizePathPart(symbol || "asset"),
          sanitizePathPart(documentType),
          `${index + 1}-${crypto.randomUUID()}-${safeName}.${fileExtension(file.name)}`,
        ].join("/");

        const buffer = Buffer.from(await file.arrayBuffer());
        const { error } = await supabase.storage
          .from(LEGAL_DOCS_BUCKET)
          .upload(path, buffer, {
            contentType: file.type || undefined,
            upsert: false,
          });

        if (error) throw new Error(error.message);

        return {
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          documentType,
          bucket: LEGAL_DOCS_BUCKET,
          path,
          publicUrl: legalDocUrl(LEGAL_DOCS_BUCKET, path),
        };
      }),
    );

    return NextResponse.json({ success: true, data: uploadedDocuments });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Document upload failed.";
    const status =
      message.toLowerCase().includes("not configured") ? 500 : 400;
    return errorResponse(message, status);
  }
}
