/** writeLocal for the stdio server (free/ is not in the npm package): see free/exportfiles.js. */
import fs from "node:fs";
import path from "node:path";

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
function bytesOf(f) {
  return Buffer.isBuffer(f.bytes) ? f.bytes : Buffer.from(f.text ?? "", "utf8");
}
function checkNames(files) {
  for (const f of files) if (!SAFE_NAME.test(f.name)) throw new Error(`Bad export file name: ${f.name}`);
}

/** Write the files into `dir` (made if missing); returns their absolute paths. */
export function writeLocal(dir, files) {
  checkNames(files);
  const root = path.resolve(String(dir).replace(/^~(?=$|\/)/, process.env.HOME || "~"));
  fs.mkdirSync(root, { recursive: true });
  return files.map((f) => {
    const p = path.join(root, f.name);
    fs.writeFileSync(p, bytesOf(f));
    return p;
  });
}
