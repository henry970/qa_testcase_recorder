// scripts/build.js — builds the Chrome Web Store upload: dist/qa-testcase-recorder-<version>.zip
// Run with: npm run build   (no dependencies; Node 18+)
//
// Only the files the extension loads go into the zip. The build fails if a file
// the extension references is missing from the list below, or doesn't exist.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "manifest.json",
  "background.js",
  "replay.js",
  "content.js",
  "generator.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "exporters.js",
  "xlsx.full.min.js",
  "icon16.png",
  "icon32.png",
  "icon48.png",
  "icon128.png",
];
// Files whose references to other local files are checked.
const SCANNED = ["manifest.json", "background.js", "popup.html", "popup.js"];

function fail(msg) { console.error("\n✖ Build failed: " + msg + "\n"); process.exit(1); }

// ---- checks -------------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;
if (!/^\d+(\.\d+){0,3}$/.test(version || "")) fail(`manifest version "${version}" is not 1-4 dot-separated numbers.`);
if ((manifest.description || "").length > 132) fail(`manifest description is ${manifest.description.length} characters; the store allows 132.`);

for (const f of FILES) if (!fs.existsSync(path.join(ROOT, f))) fail(`listed file is missing: ${f}`);

const referenced = new Set();
for (const f of SCANNED) {
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const m of text.matchAll(/["']([\w.-]+\.(?:js|css|png|html|json))["']/g)) referenced.add(m[1]);
}
const missing = [...referenced].filter((r) => !FILES.includes(r));
if (missing.length) fail(`referenced but not packaged: ${missing.join(", ")} — add them to FILES in scripts/build.js.`);

// ---- zip (deflate, no dependencies) ------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const now = dosTime(new Date());
const locals = [], centrals = [];
let offset = 0;
for (const name of FILES) {
  const data = fs.readFileSync(path.join(ROOT, name));
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const nameBuf = Buffer.from(name, "utf8");
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(now.time, 10); local.writeUInt16LE(now.date, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  locals.push(local, nameBuf, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(useDeflate ? 8 : 0, 10);
  central.writeUInt16LE(now.time, 12); central.writeUInt16LE(now.date, 14);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + body.length;
}
const centralSize = centrals.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(FILES.length, 8); end.writeUInt16LE(FILES.length, 10);
end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);

const outDir = path.join(ROOT, "dist");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `qa-testcase-recorder-${version}.zip`);
fs.writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`✔ Built ${path.relative(ROOT, out)} (${kb(fs.statSync(out).size)}) — ${FILES.length} files, version ${version}`);
for (const f of FILES) console.log(`   ${f.padEnd(20)} ${kb(fs.statSync(path.join(ROOT, f)).size)}`);
