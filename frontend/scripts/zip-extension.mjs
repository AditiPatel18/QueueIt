import fs from "fs";
import path from "path";
import JSZip from "jszip";

const rootDir = path.resolve(process.cwd(), "..");
const extensionDir = fs.existsSync(path.join(rootDir, "extension-v2"))
  ? path.join(rootDir, "extension-v2")
  : path.join(rootDir, "extension");
const outputDir = path.join(process.cwd(), "public", "extension");
const outputPath = path.join(outputDir, "queueit-extension.zip");
const legacyOutputPath = path.join(process.cwd(), "public", "queueit-extension.zip");

async function zipFolder(dir, zip, zipRoot = "") {
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

async function main() {
  if (!fs.existsSync(extensionDir)) {
    console.error("Extension directory not found at:", extensionDir);
    if (fs.existsSync(outputPath)) {
      console.log("Using existing extension ZIP at:", outputPath);
      return;
    }
    process.exit(1);
  }
  console.log("Zipping extension from:", extensionDir);
  const zip = new JSZip();
  await zipFolder(extensionDir, zip);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const content = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(outputPath, content);
  fs.writeFileSync(legacyOutputPath, content);
  console.log("Successfully generated extension ZIP at:", outputPath);
}

main().catch((err) => {
  console.error("Error generating extension zip:", err);
  process.exit(1);
});
