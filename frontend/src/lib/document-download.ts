"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase";

export type DownloadableDocument = {
  name: string;
  bucket?: string;
  path?: string;
  publicUrl?: string;
  type?: string;
};

const textEncoder = new TextEncoder();

function sanitizeFileName(value: string, fallback = "document") {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

const crc32Table = createCrc32Table();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function concatParts(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function getDosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

async function fetchDocumentBlob(document: DownloadableDocument) {
  if (document.bucket && document.path) {
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.storage
        .from(document.bucket)
        .download(document.path);
      if (!error && data) return data;
    } catch {
      // Fall through to public URL if storage client config/policy is unavailable.
    }
  }

  if (!document.publicUrl) {
    throw new Error(`No download URL available for ${document.name}`);
  }

  const response = await fetch(document.publicUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${document.name}`);
  }
  return response.blob();
}

function createStoredZip(files: Array<{ name: string; bytes: Uint8Array }>) {
  const parts: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  const { dosDate, dosTime } = getDosDateTime();
  let offset = 0;

  for (const file of files) {
    const fileName = textEncoder.encode(file.name);
    const checksum = crc32(file.bytes);
    const localHeader = new Uint8Array(30 + fileName.length);
    const localView = new DataView(localHeader.buffer);

    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, dosTime);
    writeUint16(localView, 12, dosDate);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, file.bytes.length);
    writeUint32(localView, 22, file.bytes.length);
    writeUint16(localView, 26, fileName.length);
    writeUint16(localView, 28, 0);
    localHeader.set(fileName, 30);

    const centralHeader = new Uint8Array(46 + fileName.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, dosTime);
    writeUint16(centralView, 14, dosDate);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, file.bytes.length);
    writeUint32(centralView, 24, file.bytes.length);
    writeUint16(centralView, 28, fileName.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(fileName, 46);

    parts.push(localHeader, file.bytes);
    centralDirectory.push(centralHeader);
    offset += localHeader.length + file.bytes.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryBytes = concatParts(centralDirectory);
  parts.push(centralDirectoryBytes);

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralDirectoryBytes.length);
  writeUint32(endView, 16, centralDirectoryOffset);
  writeUint16(endView, 20, 0);
  parts.push(endRecord);

  const zipBytes = concatParts(parts);
  const zipBuffer = zipBytes.buffer.slice(
    zipBytes.byteOffset,
    zipBytes.byteOffset + zipBytes.byteLength,
  );
  return new Blob([zipBuffer], { type: "application/zip" });
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadDocuments(
  documents: DownloadableDocument[],
  archiveName: string,
) {
  const downloadable = documents.filter((document) => document.publicUrl || document.path);
  if (downloadable.length === 0) {
    throw new Error("No downloadable documents are available.");
  }

  if (downloadable.length === 1) {
    const document = downloadable[0];
    const blob = await fetchDocumentBlob(document);
    triggerDownload(blob, sanitizeFileName(document.name));
    return;
  }

  const files = await Promise.all(
    downloadable.map(async (document, index) => {
      const blob = await fetchDocumentBlob(document);
      return {
        name: `${String(index + 1).padStart(2, "0")}-${sanitizeFileName(document.name)}`,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      };
    }),
  );

  const zip = createStoredZip(files);
  triggerDownload(zip, `${sanitizeFileName(archiveName, "legal-docs")}.zip`);
}
