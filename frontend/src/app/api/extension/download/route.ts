import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import JSZip from "jszip";

async function zipFolder(dir: string, zip: JSZip, zipRoot = "") {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const relativePath = zipRoot ? `${zipRoot}/${file}` : file;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      await zipFolder(fullPath, zip, relativePath);
    } else {
      const content = fs.readFileSync(fullPath);
      zip.file(relativePath, content);
    }
  }
}

import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return new NextResponse("Unauthorized. Please log in or sign up to download the QueueIt Extension.", {
        status: 401,
      });
    }

    const extensionZipPath = path.join(process.cwd(), "public", "extension", "queueit-extension.zip");
    const publicZipPath = path.join(process.cwd(), "public", "queueit-extension.zip");
    let zipBuffer: Buffer;

    if (fs.existsSync(extensionZipPath)) {
      zipBuffer = fs.readFileSync(extensionZipPath);
    } else if (fs.existsSync(publicZipPath)) {
      zipBuffer = fs.readFileSync(publicZipPath);
    } else {
      // Dynamic fallback: zip from root extension directory
      const extensionDir = path.resolve(process.cwd(), "..", "extension");
      if (!fs.existsSync(extensionDir)) {
        return new NextResponse("Extension directory not found", { status: 404 });
      }
      const zip = new JSZip();
      await zipFolder(extensionDir, zip);
      zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    }

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="queueit-extension.zip"',
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error serving extension ZIP:", error);
    return new NextResponse("Failed to generate extension ZIP", { status: 500 });
  }
}
