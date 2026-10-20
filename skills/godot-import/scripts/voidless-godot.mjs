#!/usr/bin/env node
/**
 * Import a Voidless asset into a Godot 4 project as a SpriteFrames resource.
 *
 * Downloads every animation (and the 8-way turn, if the asset has one) into
 * <project>/<dir>/<animation>/NN.png and writes <project>/<dir>/<name>.tres, ready for an
 * AnimatedSprite2D. No dependencies; Node 18 or newer.
 *
 *   node voidless-godot.mjs --asset 115918 --project ./my-game
 *   node voidless-godot.mjs --from-json asset.json --project ./my-game --dir art/knight --fps 10
 *
 * --asset needs VOIDLESS_API_KEY (a void_... key from https://voidless.dev/account).
 * --from-json takes the asset as JSON instead ({ id, prompt, file, meta_data: { frames } }).
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const HELP = `Usage: voidless-godot.mjs (--asset ID | --from-json FILE) --project DIR [options]

  --asset ID        Voidless asset id (needs VOIDLESS_API_KEY)
  --from-json FILE  Asset JSON instead of fetching it
  --project DIR     Godot project root (the folder with project.godot)
  --dir PATH        Folder inside the project (default: art/<asset name>)
  --name NAME       Resource name (default: from the asset's prompt)
  --fps N           Playback speed for every animation (default: 12)
  --only A,B        Only these animations (names as Voidless lists them)
  --dry-run         Print what would be written, download nothing
`;

const CDN = "https://cdn.voidless.dev";
const API = (process.env.VOIDLESS_API_URL || "https://api.voidless.dev").replace(/\/$/, "");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--")) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) fail(`${a} needs a value`);
      out[a.slice(2)] = v;
      i++;
    } else fail(`Unexpected argument: ${a}`);
  }
  return out;
}

function fail(msg) {
  console.error(`voidless-godot: ${msg}\n\n${HELP}`);
  process.exit(1);
}

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "sprite";

const url = (key) => (/^https?:\/\//.test(key) ? key : `${CDN}/${String(key).replace(/^\/+/, "")}`);

// Clips that should play once: Godot leaves them on their last frame.
const ONE_SHOT = /attack|death|die|hurt|hit|jump|dash|cast|shoot|punch|kick|slash/;

async function loadAsset(args) {
  if (args["from-json"]) {
    const raw = JSON.parse(await readFile(args["from-json"], "utf8"));
    return raw.data?.attributes ? { id: raw.data.id, ...raw.data.attributes } : raw;
  }
  const key = process.env.VOIDLESS_API_KEY;
  if (!key) fail("--asset needs VOIDLESS_API_KEY (create one at https://voidless.dev/account), or pass --from-json");
  const res = await fetch(`${API}/api/assets/${encodeURIComponent(args.asset)}`, { headers: { "x-api-key": key } });
  if (!res.ok) fail(`Could not load asset ${args.asset}: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
  return res.json();
}

// The animations to write: one per animation frame, plus each facing of an 8-way turn as a
// one-frame "idle_<facing>" (only when the asset has no clip of that name already).
function collect(asset, only) {
  const frames = (asset.meta_data?.frames || []).filter((f) => !f.archived && Array.isArray(f.images) && f.images.length);
  const anims = [];
  const used = new Set();
  const add = (name, images, loop) => {
    let n = slug(name);
    for (let k = 2; used.has(n); k++) n = `${slug(name)}_${k}`;
    used.add(n);
    anims.push({ name: n, source: name, images, loop });
  };
  for (const f of frames.filter((f) => f.type === "animation")) {
    const name = f.name || `animation_${f.id}`;
    add(name, f.images, !ONE_SHOT.test(name.toLowerCase()));
  }
  const turn = frames.find((f) => String(f.type || "").startsWith("rotations"));
  if (turn) {
    const facings = String(turn.tags || "").split(",").map((t) => t.trim());
    turn.images.forEach((img, i) => {
      const facing = facings[i] || `facing_${i + 1}`;
      if (!used.has(slug(`idle_${facing}`))) add(`idle_${facing}`, [img], false);
    });
  }
  if (!anims.length && asset.file) add("default", [asset.file], false);
  if (only) {
    const want = new Set(only.split(",").map((s) => slug(s.trim())));
    return anims.filter((a) => want.has(a.name) || want.has(slug(a.source)));
  }
  return anims;
}

async function download(src, dest) {
  const res = await fetch(url(src));
  if (!res.ok) throw new Error(`${url(src)}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(1, 4).toString() !== "PNG") throw new Error(`${url(src)} is not a PNG`);
  await writeFile(dest, buf);
}

function tres(anims, resPaths, fps) {
  const ext = [];
  let n = 0;
  const blocks = anims.map((a) => {
    const frames = resPaths[a.name].map((p) => {
      const id = `${++n}_tex`;
      ext.push(`[ext_resource type="Texture2D" path="${p}" id="${id}"]`);
      return `{\n"duration": 1.0,\n"texture": ExtResource("${id}")\n}`;
    });
    return `{\n"frames": [${frames.join(", ")}],\n"loop": ${a.loop},\n"name": &"${a.name}",\n"speed": ${Number(fps).toFixed(1)}\n}`;
  });
  return (
    `[gd_resource type="SpriteFrames" load_steps=${ext.length + 1} format=3]\n\n` +
    ext.join("\n") +
    `\n\n[resource]\nanimations = [${blocks.join(", ")}]\n`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  if (!args.asset && !args["from-json"]) fail("pass --asset ID or --from-json FILE");
  if (!args.project) fail("pass --project (the Godot project folder)");
  try {
    await access(join(args.project, "project.godot"));
  } catch {
    fail(`${args.project} has no project.godot`);
  }
  const fps = Number(args.fps || 12);
  if (!(fps > 0 && fps <= 60)) fail("--fps must be between 1 and 60");

  const asset = await loadAsset(args);
  const name = slug(args.name || asset.prompt || `asset_${asset.id}`);
  const dir = (args.dir || `art/${name}`).replace(/^res:\/\//, "").replace(/^\/+|\/+$/g, "");
  const anims = collect(asset, args.only);
  if (!anims.length) fail(`asset ${asset.id ?? ""} has nothing to import${args.only ? ` matching --only ${args.only}` : ""}`);

  const root = join(args.project, dir);
  const resPaths = {};
  let count = 0;
  for (const a of anims) {
    const folder = join(root, a.name);
    if (!args.dryRun) await mkdir(folder, { recursive: true });
    resPaths[a.name] = [];
    for (let i = 0; i < a.images.length; i++) {
      const file = join(folder, `${String(i).padStart(2, "0")}.png`);
      if (!args.dryRun) await download(a.images[i], file);
      resPaths[a.name].push("res://" + relative(args.project, file).split(sep).join("/"));
      count++;
    }
    console.log(`${a.name.padEnd(24)} ${String(a.images.length).padStart(3)} frames  ${a.loop ? "loop" : "once"}`);
  }
  const out = join(root, `${name}.tres`);
  if (!args.dryRun) await writeFile(out, tres(anims, resPaths, fps));
  const resOut = "res://" + relative(args.project, out).split(sep).join("/");
  console.log(`\n${args.dryRun ? "Would write" : "Wrote"} ${count} frames and ${resOut}`);
  console.log(`Use it: AnimatedSprite2D → Sprite Frames → Load → ${resOut}, then play("${anims[0].name}").`);
}

main().catch((e) => {
  console.error(`voidless-godot: ${e.message}`);
  process.exit(1);
});
