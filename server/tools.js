/**
 * Voidless MCP tools, shared by the local server (index.js, stdio, VOIDLESS_API_KEY) and the hosted
 * connector (http.js, mcp.voidless.dev, signed in with OAuth). createVoidlessServer(apiKey) builds
 * one MCP server acting as the owner of that void_ key.
 *
 * Exposes the Voidless API as MCP tools so any MCP client (Claude, Cursor, …) can find and tag a
 * user's assets and generate new ones: sprites, edits, 8-way rotations, single animations, whole
 * animation sets from presets (left side mirrored from the right), sound, music, video and rigged
 * 3D models.
 *
 * Request shapes follow the Strapi controllers in strapi/src/api/generate/controllers. Several
 * fields there are tested with `!== ""`, so an omitted field is NOT the same as an empty one:
 * referenceImage/styleImage/end_frame are always sent, empty when unused.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pngjs from "pngjs";
const { PNG } = pngjs;
import { z } from "zod";
import { readFileSync } from "node:fs";
import { Agent, setGlobalDispatcher } from "undici";

// Node's fetch gives up after 5 minutes without response headers. Generation calls answer only
// when the job is done, and an 8-direction animation set can run longer, so wait as long as the
// server does.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }));

export const VERSION = "1.6.9";
const BASE_URL = process.env.VOIDLESS_API_URL || "https://api.voidless.dev";
const CDN_URL = "https://cdn.voidless.dev";
// Where asset links point. Results link to the asset's page in the app rather than to raw GIFs: the
// page plays every animation and holds the rotations, edits and downloads. A local API (our own dev
// setup) defaults to the local app; VOIDLESS_APP_URL overrides either.
const APP_URL = (
  process.env.VOIDLESS_APP_URL ||
  (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL) ? "http://localhost:4200" : "https://voidless.dev")
).replace(/\/$/, "");

// Inline previews are still frames (from the middle of a clip, not its GIF): an animation GIF is ~600 KB
// and most clients show only its first frame anyway. The GIF stays in the text as a link. Capped so a
// call that returns a whole set does not flood the context; 8 covers one 8-direction set.
const MAX_INLINE_IMAGES = 8;

const GALLERY_URI = "ui://voidless/gallery.html";
const GALLERY_MIME = "text/html;profile=mcp-app";
const GALLERY_TOOLS = [
  "generate_image", "upload_image", "edit_image", "rotate_sprite", "animate_sprite", "generate_animation_set",
  "flip_left_side", "generate_video", "generate_sfx", "generate_music", "generate_3d_model", "get_asset",
  "list_assets", "extract_parts", "pixelate_image", "extend_video", "clean_up_sprite",
];
const GALLERY_HTML = readFileSync(new URL("./gallery.html", import.meta.url), "utf8");

export function createVoidlessServer(API_KEY) {
  async function api(method, path, body) {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let data;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg = data?.error?.message || data?.message || data?.raw || `HTTP ${res.status}`;
      throw new Error(`Voidless API error (${res.status}): ${msg}`);
    }
    return data;
  }

  const apiGet = (path) => api("GET", path);
  const apiPost = (path, body) => api("POST", path, body);
  const apiPut = (path, body) => api("PUT", path, body);

  // Tool errors go back to the model as text it can act on, not as a protocol failure.
  function tool(handler) {
    return async (args) => {
      try {
        return await handler(args);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: String(err.message || err) }] };
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  function mimeFromPath(filePath) {
    const ext = String(filePath || "").split(".").pop().toLowerCase();
    const map = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
      mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm",
      glb: "model/gltf-binary", gltf: "model/gltf+json",
    };
    return map[ext] || "application/octet-stream";
  }

  // Stored keys are R2 paths (assets/<uid>/…) or Drive refs (gdrive:…), which have no public URL.
  function cdnUrl(key) {
    if (!key || typeof key !== "string") return null;
    if (/^https?:\/\//.test(key)) return key;
    if (key.startsWith("gdrive:")) return null;
    return `${CDN_URL}/${key.replace(/^\/+/, "")}`;
  }

  // The image that shows what a frame is. For an animation that is a frame from the middle: every clip
  // starts (and loops back) on the sprite's resting pose, so its first frame made a dash or an attack
  // look like the character standing still.
  function stillOf(frame) {
    const images = Array.isArray(frame?.images) ? frame.images : [];
    if (!images.length) return frame?.gif;
    return frame.type === "animation" ? images[Math.floor(images.length / 2)] : images[0];
  }

  async function inlineImage(key) {
    const url = cdnUrl(key);
    if (!url || !mimeFromPath(url).startsWith("image/")) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = Buffer.from(await res.arrayBuffer()).toString("base64");
      return { type: "image", data, mimeType: mimeFromPath(url) };
    } catch {
      return null;
    }
  }

  function money(data) {
    const parts = [];
    if (typeof data?.cost === "number") parts.push(`Cost: ${data.cost} credits`);
    if (typeof data?.credits === "number") parts.push(`Credits left: ${data.credits}`);
    return parts.join(" · ");
  }

  // A rotation frame's `tags` field is its facings list ("right,up,left…"), which animation presets
  // read to match each image to a direction. It is not user tagging, and must not be overwritten.
  const isRotation = (frame) => String(frame?.type || "").startsWith("rotations");

  // One line per frame, carrying everything a follow-up call needs: the frame id (frameIndex /
  // items / frameId elsewhere) and the image keys (referenceFile / end_frame / imageIndex).
  function frameLine(frame) {
    const images = Array.isArray(frame.images) ? frame.images : [];
    const bits = [`frame ${frame.id}`, frame.type || "frame", frame.name ? `"${frame.name}"` : null];
    if (frame.tags) bits.push(`${isRotation(frame) ? "facings" : "tags"}: ${frame.tags}`);
    const imageText =
      images.length <= 8
        ? images.map((k, i) => `      [${i}] ${k}`).join("\n")
        : `      ${images.length} images, first ${images[0]}, last ${images[images.length - 1]}`;
    return `  - ${bits.filter(Boolean).join(" · ")}${images.length ? "\n" + imageText : ""}`;
  }

  async function frameContent(frames, { inline = true } = {}) {
    const content = [];
    if (!frames?.length) return content;
    content.push({ type: "text", text: "New frames:\n" + frames.map(frameLine).join("\n") });
    if (inline) {
      for (const frame of frames.slice(0, MAX_INLINE_IMAGES)) {
        const image = await inlineImage(stillOf(frame));
        if (image) content.push(image);
      }
    }
    return content;
  }

  // Responses that create a new asset: { file, assetId, credits, cost, … }.
  async function assetResult(data, label) {
    const url = cdnUrl(data.file);
    const lines = [
      `${label} created.`,
      data.assetId ? `Asset ID: ${data.assetId} · ${APP_URL}/asset/${data.assetId}` : null,
      url && !mimeFromPath(url).startsWith("image/") ? `File: ${url}` : null,
      data.thumbnail ? `Thumbnail: ${cdnUrl(data.thumbnail)}` : null,
      data.seed !== undefined ? `Seed: ${data.seed}` : null,
      money(data),
    ].filter(Boolean);
    const content = [{ type: "text", text: lines.join("\n") }];
    const image = await inlineImage(data.file);
    if (image) content.push(image);
    const link = data.assetId ? `${APP_URL}/asset/${data.assetId}` : undefined;
    const main = mediaItem(data.file, label, { link });
    const thumb = !main || main.kind === "audio" ? mediaItem(data.thumbnail, `${label} preview`, { link }) : null;
    return withGallery({ content }, [main, thumb], label);
  }

  // Responses that append frames to an existing asset: { frames, credits, cost }.
  async function framesResult(data, assetId, label) {
    const content = [
      {
        type: "text",
        text: [`${label} added to asset ${assetId} (${APP_URL}/asset/${assetId}).`, money(data)]
          .filter(Boolean)
          .join("\n"),
      },
    ];
    content.push(...(await frameContent(data.frames)));
    if (Array.isArray(data.missing) && data.missing.length) {
      content.push({ type: "text", text: `Skipped (could not be edited): ${JSON.stringify(data.missing)}` });
    }
    return withGallery({ content }, (data.frames || []).flatMap((f) => frameItems(f, assetId)), label);
  }

  // Multi-animation responses: { results: [{ assetId, frames, skipped? }], quality, cost, … }.
  async function resultsContent(data, label) {
    const content = [
      {
        type: "text",
        text: [label, data.quality ? `Quality: ${data.quality}` : null, money(data)].filter(Boolean).join("\n"),
      },
    ];
    let inlined = 0;
    for (const result of data.results || []) {
      if (result.skipped) {
        content.push({ type: "text", text: `Asset ${result.assetId}: skipped${result.error ? ` (${result.error})` : ""}` });
        continue;
      }
      content.push({
        type: "text",
        text: `Asset ${result.assetId} (${APP_URL}/asset/${result.assetId}):\n` + (result.frames || []).map(frameLine).join("\n"),
      });
      for (const frame of result.frames || []) {
        if (inlined >= MAX_INLINE_IMAGES) break;
        const image = await inlineImage(stillOf(frame));
        if (image) {
          content.push(image);
          inlined++;
        }
      }
    }
    const items = (data.results || []).filter((r) => !r.skipped).flatMap((r) => (r.frames || []).flatMap((f) => frameItems(f, r.assetId)));
    return withGallery({ content }, items, label);
  }

  // ---------------------------------------------------------------------------
  // Gallery (MCP Apps): what the inline viewer shows. Hosts that support MCP Apps (claude.ai, the
  // Claude apps, ChatGPT) draw ui://voidless/gallery.html under the tool call and hand it the
  // result's structuredContent.gallery; others just read the text and the inline images.
  // ---------------------------------------------------------------------------
  function mediaKind(url) {
    const m = mimeFromPath(url);
    if (m === "image/gif") return "gif";
    if (m.startsWith("image/")) return "image";
    if (m.startsWith("video/")) return "video";
    if (m.startsWith("audio/")) return "audio";
    return null;
  }
  function mediaItem(key, label, extra = {}) {
    const url = cdnUrl(key);
    const kind = url && mediaKind(url);
    return kind ? { kind, url, label: label || "", ...extra } : null;
  }
  // One frame record -> what to show: an animation plays (its GIF), a rotation set shows every
  // facing, anything else its image.
  function frameItems(frame, assetId) {
    const link = assetId ? `${APP_URL}/asset/${assetId}` : undefined;
    const name = frame.name || frame.type || "frame";
    const images = Array.isArray(frame.images) ? frame.images : [];
    if (frame.type === "animation") {
      // The viewer plays the frames itself (not every animation has a GIF stored); the still is the
      // poster until they load. Capped so a long clip doesn't bloat the result.
      const sequence = images.map(cdnUrl).filter(Boolean).slice(0, 64);
      const item = mediaItem(stillOf(frame) || frame.gif, name, { link, frames: images.length });
      if (item && sequence.length > 1) { item.kind = "animation"; item.sequence = sequence; }
      return item ? [item] : [];
    }
    if (isRotation(frame)) {
      const facings = String(frame.tags || "").split(",").map((t) => t.trim());
      return images.map((k, i) => mediaItem(k, facings[i] || `${name} ${i + 1}`, { link })).filter(Boolean);
    }
    const item = mediaItem(images[0] || frame.gif, name, { link });
    return item ? [item] : [];
  }
  const MAX_GALLERY = 48;
  const withGallery = (result, items, title) => ({
    ...result,
    structuredContent: { title, gallery: items.filter(Boolean).slice(0, MAX_GALLERY) },
  });

  // Read by clients as the server's standing instructions (MCP `instructions`).
  const INSTRUCTIONS =
    "Every generation tool spends the user's Voidless credits. Make each request once: show the user the result " +
    "(the gallery displays it) and let them decide. Do not call a generation tool again to try for a better result, " +
    "to fix a detail, or because the result is not exactly what you pictured — ask the user first, saying what it " +
    "would cost. Re-run only on a clear failure the tool reports (an error), or when the user asks. " +
    "For a character that will be animated, generate it in the 'idle' pose; 'tpose' is only for rigging. " +
    "To use Voidless images inside HTML, a game or any code you write (artifacts and code sandboxes often cannot " +
    "download from voidless.dev), call get_image_data: it returns the image, or an animation as a sprite strip, as a " +
    "data URI you can paste in. Do not ask the user to download and attach files.";
  const server = new McpServer({ name: "voidless", version: VERSION }, { instructions: INSTRUCTIONS });

  // Tool annotations (MCP ToolAnnotations). Generation tools create something new in the caller's
  // Voidless library and spend credits: none deletes or overwrites (edits append new frames; the
  // source is kept), a repeat call makes another result and bills again, and the effects stay
  // inside the user's own account. Directories such as Claude's require title +
  // readOnlyHint/destructiveHint on every tool.
  function writeTool(title) {
    return { title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  }
  function readTool(title) {
    return { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  }
  // Tagging changes labels only (no credits), but replace/remove drop existing tags.
  function tagTool(title) {
    return { title, readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
  }

  const assetId = z.number().int().describe("Asset ID (from list_assets / get_asset or a previous result)");
  const referenceFile = z
    .string()
    .default("")
    .describe(
      "Work from one image of an existing frame instead of the asset's base: pass an image key exactly as " +
        "get_asset lists it. Empty = the asset's current base image."
    );
  const frameId = z
    .number()
    .int()
    .optional()
    .describe("Optional: the frame the new frames hang under in the editor (usually the frame referenceFile came from).");

  // ---------------------------------------------------------------------------
  // Reading the library
  // ---------------------------------------------------------------------------

  server.tool(
    "list_assets",
    "List the user's Voidless assets, newest first: id, type, prompt, tags and how many frames/animations " +
      "each has. Use this to find an asset to animate, rotate or edit. Free.",
    {
      type: z.enum(["image", "sfx", "music", "video", "model"]).optional().describe("Only this asset type"),
      tag: z.string().optional().describe("Only assets whose tags contain this text"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    },
    readTool("List assets"),
    tool(async ({ type, tag, page, pageSize }) => {
      const q = [];
      if (type) q.push(`filters[$and][0][type]=${type}`);
      if (tag) q.push(`filters[tags][$contains]=${encodeURIComponent(tag)}`);
      q.push("sort=createdAt:desc", `pagination[page]=${page}`, `pagination[pageSize]=${pageSize}`);
      const data = await apiGet(`/assets?${q.join("&")}`);
      const rows = (data.data || []).map((item) => {
        const a = item.attributes || item;
        const frames = (a.meta_data?.frames || []).filter((f) => !f.archived);
        const animations = frames.filter((f) => f.type === "animation").length;
        const kind = a.meta_data?.image_type ? `${a.type}/${a.meta_data.image_type}` : a.type;
        const extra = frames.length ? ` · ${frames.length} frames (${animations} animations)` : "";
        const tags = a.tags ? ` · tags: ${a.tags}` : "";
        return `- ${item.id} · ${kind} · "${String(a.prompt || "").slice(0, 80)}"${tags}${extra}`;
      });
      const p = data.meta?.pagination;
      const footer = p ? `\nPage ${p.page} of ${p.pageCount} (${p.total} assets)` : "";
      const items = (data.data || []).map((item) => {
        const a = item.attributes || item;
        const label = `${item.id} · ${String(a.prompt || a.type || "").slice(0, 40)}`;
        const link = `${APP_URL}/asset/${item.id}`;
        return mediaItem(a.file, label, { link }) || mediaItem(a.meta_data?.thumbnail, label, { link });
      });
      return withGallery({ content: [{ type: "text", text: (rows.join("\n") || "No assets found.") + footer }] }, items, "Your assets");
    })
  );

  // ── image data for HTML ──────────────────────────────────────────────────────────────────
  // Claude's HTML artifacts (and many sandboxes) cannot load images from another site, and an image a
  // tool shows the model cannot be copied out of the conversation into code. So this hands back the
  // picture itself as a small data: URI the client pastes into <img src> or a CSS background. Shrunk to
  // fit a text budget: a 512 PNG as base64 is ~400k characters, far past what a reply can carry.
  const DATA_URI_BUDGET = 60000;

  function decodePng(buf) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }

  // Box-average downscale (keeps pixel art blocky when the factor is whole, smooth art clean otherwise).
  function shrink(img, w, h) {
    if (img.width === w && img.height === h) return img;
    const out = Buffer.alloc(w * h * 4);
    const sx = img.width / w, sy = img.height / h;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4, al = img.data[i + 3];
          r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += al; n++;
        }
        const o = (y * w + x) * 4;
        if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
        out[o + 3] = a / n;
      }
    }
    return { width: w, height: h, data: out };
  }

  function encodeStrip(frames, cell) {
    const png = new PNG({ width: cell * frames.length, height: cell });
    frames.forEach((f, k) => {
      const s = shrink(f, cell, cell);
      for (let y = 0; y < cell; y++) s.data.copy(png.data, (y * png.width + k * cell) * 4, y * cell * 4, (y + 1) * cell * 4);
    });
    return PNG.sync.write(png, { colorType: 6 });
  }

  async function fetchPng(key) {
    const url = cdnUrl(key);
    if (!url) throw new Error(`No public file for ${key}.`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url} (${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.slice(1, 4).toString() !== "PNG") throw new Error(`${url} is not a PNG; use the URL instead.`);
    return decodePng(buf);
  }

  server.tool(
    "get_image_data",
    "An asset's image as a data: URI to put straight into HTML (<img src=…> or a CSS background), for " +
      "sandboxes that cannot load images from another site, such as Claude's HTML artifacts. For an animation " +
      "or rotation frame it returns ONE horizontal sprite strip (all frames side by side, each size×size) plus a " +
      "CSS snippet that plays it. Shrunk to fit a reply (small sizes are fine for sprites; scale them up in CSS " +
      "with image-rendering: pixelated). Free.",
    {
      id: assetId,
      frameId: z.number().int().optional().describe("Frame id from get_asset (an animation, rotation set or edit). Omit for the base image"),
      imageIndex: z.number().int().optional().describe("Only this image of the frame (e.g. one facing of a rotation set) instead of the strip"),
      size: z.number().int().min(16).max(256).default(128).describe("Pixels per image (square). Lowered automatically if the result would be too long"),
    },
    readTool("Get image data"),
    tool(async ({ id, frameId: fid, imageIndex, size }) => {
      const a = await apiGet(`/assets/${id}`);
      const frames = (a.meta_data && a.meta_data.frames) || [];
      let keys;
      let label = "base image";
      if (fid === undefined || fid === null) {
        keys = [a.file];
      } else {
        const f = frames.find((x) => x && x.id === fid) || frames[fid];
        if (!f) throw new Error(`Asset ${id} has no frame ${fid}. Use get_asset for frame ids.`);
        const images = Array.isArray(f.images) ? f.images : [];
        if (!images.length) throw new Error(`Frame ${fid} has no images.`);
        keys = Number.isInteger(imageIndex) ? [images[imageIndex]].filter(Boolean) : images;
        if (!keys.length) throw new Error(`Frame ${fid} has no image ${imageIndex}.`);
        label = `${f.name || f.type || "frame"}${Number.isInteger(imageIndex) ? ` [${imageIndex}]` : ""}`;
      }
      const decoded = await Promise.all(keys.slice(0, 64).map(fetchPng));
      let cell = Math.min(size, Math.max(...decoded.map((d) => Math.max(d.width, d.height))));
      let png = encodeStrip(decoded, cell);
      while (png.length * 4 / 3 > DATA_URI_BUDGET && cell > 16) {
        cell = Math.max(16, Math.floor(cell * 0.75));
        png = encodeStrip(decoded, cell);
      }
      const uri = `data:image/png;base64,${png.toString("base64")}`;
      const n = decoded.length;
      const lines = [
        n === 1
          ? `Asset ${id} ${label}: ${cell}×${cell} PNG as a data URI (${uri.length} characters).`
          : `Asset ${id} ${label}: a sprite strip of ${n} frames, each ${cell}×${cell}, total ${cell * n}×${cell} (${uri.length} characters).`,
        n > 1
          ? `Play it with CSS: width:${cell}px;height:${cell}px;background:url(<the URI>) 0 0/auto ${cell}px;` +
            `animation:play ${(n / 8).toFixed(2)}s steps(${n}) infinite; @keyframes play{to{background-position:-${cell * n}px 0}}` +
            " (scale with transform:scale(N) and image-rendering:pixelated)."
          : "Use it as <img src=\"<the URI>\" style=\"image-rendering:pixelated\"> or a CSS background.",
        "",
        uri,
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    })
  );

  server.tool(
    "get_asset",
    "Show one asset with every frame: frame ids, types (animation, rotations - 8-way, edit - text, layer…), " +
      "names, facings and image keys. Frame ids are what frameIndex/items/frameId take elsewhere; image keys " +
      "are what referenceFile and end_frame take. Free.",
    { id: assetId, preview: z.boolean().default(true).describe("Include the base image inline") },
    readTool("Get asset"),
    tool(async ({ id, preview }) => {
      const a = await apiGet(`/assets/${id}`);
      const meta = a.meta_data || {};
      const frames = (meta.frames || []).filter((f) => !f.archived);
      const lines = [
        `Asset ${a.id} · ${a.type}${meta.image_type ? "/" + meta.image_type : ""} · ${APP_URL}/asset/${a.id}`,
        a.prompt ? `Prompt: ${a.prompt}` : null,
        `Tags: ${a.tags || "(none)"}`,
        meta.size ? `Size: ${meta.size}px · ${meta.dimension || ""} · style ${meta.style || "-"} · facing ${meta.facing || "-"}` : null,
        a.file ? `Base image: ${a.file}` : null,
        meta.rigged_file ? `Rigged: yes (${(meta.animations || []).length} animations)` : null,
        Array.isArray(meta.video_extensions) && meta.video_extensions.length
          ? `Video extensions: ${meta.video_extensions.map((v) => v.file).join(", ")}`
          : null,
        frames.length ? `Frames (${frames.length}):\n${frames.map(frameLine).join("\n")}` : "No frames yet.",
      ].filter(Boolean);
      const content = [{ type: "text", text: lines.join("\n") }];
      if (preview) {
        const image = await inlineImage(a.file);
        if (image) content.push(image);
      }
      const link = `${APP_URL}/asset/${a.id}`;
      const items = [mediaItem(a.file, a.prompt ? a.prompt.slice(0, 60) : `Asset ${a.id}`, { link }), ...frames.flatMap((f) => frameItems(f, a.id))];
      return withGallery({ content }, items, `Asset ${a.id}`);
    })
  );

  server.tool(
    "get_animation_presets",
    "List the animation-set presets (platformer-character, topdown-walk/run/dash/attack/idle) with the " +
      "actions each one makes, and the quality tiers with their credit cost per pass. Free.",
    {},
    readTool("Get animation presets"),
    tool(async () => {
      const data = await apiGet("/generate/multi-animation/presets");
      const presets = (data.presets || []).map((p) => `- ${p.key} (${p.label}): ${p.actions.join(", ")}`);
      const qualities = (data.qualities || []).map((q) => `- ${q.key}: ${q.resolution}, ${q.credits} credits per pass`);
      return {
        content: [
          {
            type: "text",
            text: `Presets:\n${presets.join("\n")}\n\nQuality (picked automatically from the sprite size):\n${qualities.join("\n")}\n\nUp to ${data.maxImages} images per run.`,
          },
        ],
      };
    })
  );

  // ---------------------------------------------------------------------------
  // Tagging
  // ---------------------------------------------------------------------------

  const tagList = z
    .array(z.string().min(1).max(40))
    .min(1)
    .describe("Tags, e.g. ['player', 'level-1']. Case-insensitive duplicates are merged");
  const tagMode = z
    .enum(["add", "remove", "replace"])
    .default("add")
    .describe("add = keep existing tags and add these, remove = drop these, replace = set exactly these");

  function applyTags(current, tags, mode) {
    const existing = String(current || "").split(",").map((t) => t.trim()).filter(Boolean);
    const lower = new Set(tags.map((t) => t.toLowerCase()));
    const merged = mode === "replace" ? tags : mode === "remove" ? existing.filter((t) => !lower.has(t.toLowerCase())) : [...existing, ...tags];
    // Same rule as the server's normalizeTags: case-insensitive duplicates keep the first spelling.
    const seen = new Map();
    for (const t of merged) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    return [...seen.values()];
  }

  server.tool(
    "tag_asset",
    "Add, remove or replace the tags on an asset, so it can be found again with list_assets(tag). Free.",
    { id: assetId, tags: tagList, mode: tagMode },
    tagTool("Tag asset"),
    tool(async ({ id, tags, mode }) => {
      const asset = await apiGet(`/assets/${id}`);
      const next = applyTags(asset.tags, tags, mode).join(",");
      const data = await apiPut(`/assets/${id}`, { data: { tags: next } });
      const saved = (data.data?.attributes || data.data || data).tags ?? next;
      return { content: [{ type: "text", text: `Asset ${id} tags: ${saved || "(none)"}` }] };
    })
  );

  server.tool(
    "tag_frame",
    "Add, remove or replace the tags on one frame of an image asset (an animation, edit or part), e.g. " +
      "to mark which clip is 'idle' or 'final'. 8-way rotation frames cannot be tagged: their tags are the " +
      "facings the animation presets rely on. Free.",
    {
      id: assetId,
      frameIndex: z.number().int().describe("Frame id from get_asset"),
      tags: tagList,
      mode: tagMode,
    },
    tagTool("Tag frame"),
    tool(async ({ id, frameIndex, tags, mode }) => {
      const asset = await apiGet(`/assets/${id}`);
      const frame = (asset.meta_data?.frames || []).find((f) => f.id === frameIndex && !f.archived);
      if (!frame) throw new Error(`Asset ${id} has no frame ${frameIndex}. Use get_asset ${id} for its frame ids.`);
      if (isRotation(frame)) {
        throw new Error(`Frame ${frameIndex} is an 8-way rotation: its tags are its facings, which animation presets read. Tag the asset instead.`);
      }
      if (!frame.images?.length) throw new Error(`Frame ${frameIndex} has no images to locate it by.`);
      const next = applyTags(frame.tags, tags, mode).join(",");
      // The server finds the frame by one of its image files, which stays stable across reindexing.
      const data = await apiPut(`/assets/${id}/frame-tags`, { referenceFile: frame.images[0], tags: next });
      return { content: [{ type: "text", text: `Frame ${frameIndex} of asset ${id} tags: ${data.tags || "(none)"}` }] };
    })
  );

  // ---------------------------------------------------------------------------
  // Images
  // ---------------------------------------------------------------------------

  server.tool(
    "generate_image",
    "Generate a game sprite/asset image. Infer every field from the request: art STYLE, colour PALETTE, " +
      "asset TYPE, output SIZE and PERSPECTIVE; for characters also facing/pose/bodyType. Use the default model " +
      "(flux2-klein, 1 credit) unless the user names another. Costs by model: flux2-klein 1, flux-juggernaut 1, " +
      "seedream-5-flash 2, gpt-image-2.5 5, retro-diffusion 10, nano-banana-2 15 credits (a reference image makes it " +
      "2 and uses flux2-klein). Call it once per request and " +
      "show the result; ask the user before generating again (each call spends credits).",
    {
      prompt: z.string().max(300).describe("The subject only (max 300 chars). Put style/colour in the style/palette fields."),
      model: z
        .enum(["flux2-klein", "gpt-image-2.5", "seedream-5-flash", "nano-banana-2", "retro-diffusion", "flux-juggernaut"])
        .default("flux2-klein")
        .describe("The default, flux2-klein, unless the user asks for a specific model by name."),
      type: z
        .enum(["object", "character", "character portrait", "artwork", "tileset", "ui"])
        .describe(
          "'character' = full-body sprite (uses facing/pose/bodyType); 'character portrait' = headshot; 'object' = props " +
            "and items; 'artwork' = scenes/backgrounds; 'tileset' = a terrain tile sheet (always GPT-Image, see " +
            "tilesetKind; below 512 it is drawn at 512 and pixelated); 'ui' = interface pieces (see uiMode)."
        ),
      dimension: z.enum(["2d", "top down", "isometric"]).default("2d").describe("'2d' = side view, 'top down' = overhead, 'isometric' = 2.5D"),
      size: z
        .union([z.literal(32), z.literal(64), z.literal(128), z.literal(256), z.literal(512), z.literal(1024)])
        .default(512)
        .describe("Output px. 32/64/128/256 give a pixel-art look; 512 for every other style; 1024 for high-res."),
      colours: z.number().int().min(4).max(12).default(8).describe("Colour count for pixel-art reduction (4–12)"),
      style: z
        .string()
        .default("")
        .describe(
          "Style preset: pixel-art, cartoon, cel-shading, flat, hand-drawn, paper-cutout, comic-book, anime, watercolor, " +
            "low-poly, 3d-render, claymation, photorealistic, voxel. Empty = pixel art below 512, cartoon otherwise."
        ),
      palette: z
        .enum(["none", "black-and-white", "retro", "vibrant", "pastel", "neon", "earthy", "gameboy", "sepia"])
        .default("none")
        .describe("Colour-scheme preset, independent of style. 'none' keeps the style's own colours."),
      facing: z.enum(["forward", "right"]).default("forward").describe("Characters: front view or side profile. Side profiles rotate best."),
      pose: z
        .enum(["idle", "tpose"])
        .default("idle")
        .describe(
          "Characters, front or side view: 'idle' = relaxed stance with the arms down — the default, for animation " +
            "sets, rotations and almost everything. 'tpose' = arms held straight out — ONLY when the user asks for a " +
            "T-pose (e.g. to rig the character in the skeleton editor)."
        ),
      bodyType: z.enum(["humanoid", "quadruped"]).default("humanoid").describe("Characters: body plan"),
      tilesetKind: z
        .enum(["platformer", "blob17", "wang"])
        .optional()
        .describe(
          "type 'tileset' only: 'platformer' = side-view 3x3 ground sheet (default for 2d); 'wang' = top-down two-terrain " +
            "4x5 auto-tile sheet in the free Tileset Generator's layout (default for top down; name both terrains, e.g. " +
            "'a cobblestone path in grass'), every edge matched so any arrangement tiles seamlessly; 'blob17' = top-down " +
            "17-piece sheet of one terrain on transparent. Top-down sheets have 256 px tiles; size 32/64/128 returns pixel tiles"
        ),
      aspect: z
        .enum(["1:1", "16:9"])
        .default("1:1")
        .describe("type 'artwork' only: '16:9' for a backdrop, scene or game background (1344x756 at 1024, 672x378 at 512). Everything that is not artwork is always 1:1"),
      uiMode: z
        .enum(["graphic", "title", "text"])
        .default("graphic")
        .describe("type 'ui' only: 'graphic' = button/panel/HUD piece, 'title' = game-title wordmark spelling the prompt, 'text' = plain label spelling the prompt"),
      seed: z.number().int().min(0).default(0).describe("RNG seed (0 = random)"),
      referenceImage: z.string().default("").describe("Optional raw base64 image (no data: prefix) to base the result on"),
      styleImage: z.string().default("").describe("Optional raw base64 image whose art style to copy"),
    },
    writeTool("Generate image"),
    tool(async ({ facing, pose, bodyType, palette, uiMode, tilesetKind, aspect, ...rest }) => {
      const wide = rest.type === "artwork" && aspect === "16:9" ? "16:9" : "1:1";
      const tileset = rest.type === "tileset";
      // Tilesets are GPT-Image only (the server enforces it too); the kind rides in options.mode.
      if (tileset) rest.model = "gpt-image-2.5";
      const mode = tileset ? tilesetKind || "" : uiMode;
      const body = { ...rest, palette: [], options: { facing, pose, bodyType, palette, mode, aspect: wide } };
      return assetResult(await apiPost("/generate/image", body), "Image");
    })
  );

  server.tool(
    "edit_image",
    "Edit an existing image asset with an instruction (change colours, add a hat, fix a detail…). The edit is " +
      "added as a new frame; the original stays. 5 credits.",
    {
      id: assetId,
      prompt: z.string().describe("What to change"),
      referenceFile,
      frameId,
      images: z.array(z.string()).max(4).default([]).describe("Optional extra reference images: image keys from get_asset or https URLs"),
      remove_bg: z.boolean().default(true).describe("Remove the background from the result, as the app's editor does. Set false for artwork or a scene that should keep its background"),
    },
    writeTool("Edit image"),
    // Always the app's own editor, the same one as the editor's "Edit this image" box.
    tool(async (args) => framesResult(await apiPost("/generate/image-edit", { ...args, model: "p-image" }), args.id, "Edit"))
  );

  server.tool(
    "rotate_sprite",
    "Turn a sprite into an 8-way set (front, back, sides and diagonals) in one pass. The result is a " +
      "'rotations - 8-way' frame whose facings line up with its images; pass those to generate_animation_set " +
      "to animate each direction. Works best from a side-profile sprite. 10 credits.",
    { id: assetId, referenceFile, frameId },
    writeTool("Rotate sprite (8-way)"),
    tool(async (args) => framesResult(await apiPost("/generate/image-rotations", args), args.id, "8-way rotation"))
  );

  server.tool(
    "extract_parts",
    "Split a character sprite into separate body parts (head, torso, arms, legs…) as 'layer' frames, for " +
      "rigging or cut-out animation. 5 credits. Call get_asset afterwards for the parts' frame ids.",
    {
      id: assetId,
      prompt: z.string().default("").describe("Optional: which parts to cut out. Empty = the standard rig parts"),
      referenceFile,
      frameId,
    },
    writeTool("Extract sprite parts"),
    tool(async (args) => {
      const data = await apiPost("/generate/image-parts", args);
      // The ids returned here are off by (parts - 1): the server numbers from the last appended
      // frame. Point at get_asset instead of printing ids that would misdirect a follow-up call.
      const names = (data.frames || []).map((f) => f.name).filter(Boolean);
      return {
        content: [
          {
            type: "text",
            text: `Extracted ${names.length} parts from asset ${args.id}: ${names.join(", ")}.\n${money(data)}\nUse get_asset ${args.id} for their frame ids and image keys.`,
          },
        ],
        structuredContent: { title: "Parts", gallery: (data.frames || []).flatMap((f) => frameItems(f, args.id)).slice(0, MAX_GALLERY) },
      };
    })
  );

  server.tool(
    "upload_image",
    "Add an image the user already has to their library, so it can be animated, rotated or edited. It must " +
      "be square at 32, 64, 128, 256, 512 or 1024 px. Free.",
    {
      image: z.string().describe("Base64 image (a data: prefix is stripped automatically)"),
      type: z.enum(["object", "character", "character portrait", "artwork"]).default("character"),
      remove_bg: z.boolean().default(false).describe("Remove the background on upload"),
    },
    writeTool("Upload image"),
    tool(async ({ image, ...rest }) => {
      const raw = String(image).replace(/^data:[^,]*,/, "");
      return assetResult(await apiPost("/upload/image", { image: raw, ...rest }), "Upload");
    })
  );

  server.tool(
    "pixelate_image",
    "Convert any image to pixel art at a target size and colour count. Returns the image; nothing is " +
      "saved to the library. 1 credit.",
    {
      image: z.string().describe("Base64 source image (a data: prefix is stripped automatically)"),
      size: z.union([z.literal(32), z.literal(64), z.literal(128), z.literal(256), z.literal(512), z.literal(1024)]).default(64)
        .describe("Pixel size. 512 and 1024 are drawn on a real 4x grid (128 / 256 art pixels)"),
      colours: z.number().int().min(4).max(12).default(8),
    },
    writeTool("Pixelate image"),
    tool(async ({ image, ...rest }) => {
      const data = await apiPost("/pixelate/image", { image: String(image).replace(/^data:[^,]*,/, ""), ...rest });
      return {
        content: [
          { type: "text", text: money(data) || "Pixelated." },
          { type: "image", data: data.image, mimeType: "image/png" },
        ],
        structuredContent: { title: "Pixel art", gallery: data.image ? [{ kind: "image", url: `data:image/png;base64,${data.image}`, label: "Pixelated" }] : [] },
      };
    })
  );

  server.tool(
    "clean_up_sprite",
    "Make a sprite or a short animation made ANYWHERE (another AI tool, an artist, a screen recording) " +
      "game-ready with Voidless's own clean-up: background removed with stray pieces checked (sparks and dust " +
      "kept, smudges removed); pixel art put on a real pixel grid with one palette and stray pixels fixed. A 1-5 s " +
      "video comes back as 16 frames: kind 'loop' cuts the cleanest loop (walk, run, idle), 'once' keeps the " +
      "whole move (attack, jump). Saved to the user's library. Give the file as a public URL (best for videos) or " +
      "base64. 1 free run a day (10 on Voidless+), then 1 credit an image, 2 a video. For a quick pixel-art " +
      "version of an already clean image, pixelate_image is enough.",
    {
      url: z.string().optional().describe("Public http(s) link to the image or video. Use this for videos"),
      file: z.string().optional().describe("Base64 file instead of url (a data: prefix is stripped automatically)"),
      kind: z.enum(["image", "video"]).optional().describe("What the file is. Inferred from the url's extension when omitted"),
      style: z.enum(["pixel", "smooth"]).default("pixel").describe("pixel = pixel art at 32-1024; smooth = clean cut-out at 512 or 1024"),
      size: z.union([z.literal(32), z.literal(64), z.literal(128), z.literal(256), z.literal(512), z.literal(1024)]).optional()
        .describe("Output size. Default 64 for pixel, 512 for smooth (smooth allows only 512 or 1024)"),
      motion: z.enum(["loop", "once"]).default("loop").describe("Video only: loop = find the cleanest loop; once = keep the whole clip"),
    },
    writeTool("Clean up sprite"),
    tool(async ({ url, file, kind, style, size, motion }) => {
      if (!url && !file) throw new Error("Give the file as a url or as base64 in file.");
      const pixel = style !== "smooth";
      const out = size || (pixel ? 64 : 512);
      if (!pixel && out !== 512 && out !== 1024) throw new Error("Smooth art comes back at 512 or 1024.");
      const guessed = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(String(url || "")) ? "video"
        : /^data:video\//i.test(String(file || "")) ? "video" : "image";
      const body = { kind: kind || guessed, size: out, pixel, loop: motion };
      if (url) body.url = url;
      else body.data = String(file).replace(/^data:[^,]*,/, "");
      const data = await apiPost("/cleanup/run", body);
      const link = data.assetId ? `${APP_URL}/asset/${data.assetId}` : undefined;
      const lines = [
        `Cleaned up: ${data.kind === "video" ? `${(data.images || []).length} frames` : "1 sprite"} at ${data.size}px${data.pixel ? " pixel art" : ""}.`,
        data.assetId ? `Asset ID: ${data.assetId} · ${link}` : null,
        data.kind === "video" && Array.isArray(data.span) ? `Frames taken from ${data.span[0]}s to ${data.span[1]}s of the clip.` : null,
        data.free ? `Free run (${data.freeLeft} free left today).` : null,
        money(data),
      ].filter(Boolean);
      const content = [{ type: "text", text: lines.join("\n") }];
      if (data.kind === "video") {
        const frame = { id: 0, name: "Clean-up", type: "animation", images: data.images || [], gif: data.gif };
        content.push(...(await frameContent([frame])));
        return withGallery({ content }, frameItems(frame, data.assetId), "Clean-up");
      }
      const image = await inlineImage(data.file);
      if (image) content.push(image);
      return withGallery({ content }, [mediaItem(data.file, "Cleaned up", { link })], "Clean-up");
    })
  );

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------

  server.tool(
    "animate_sprite",
    "Animate one sprite into a single 16-frame clip from a description of the motion. For several clips " +
      "(walk + run + attack, or every direction) use generate_animation_set instead: it is one job. 15 credits.",
    {
      id: assetId,
      prompt: z.string().describe("The motion, e.g. 'walk cycle', 'swings sword overhead'"),
      referenceFile,
      end_frame: z.string().default("").describe("Optional image key for the clip to end on (e.g. to loop back to a pose). Empty = free ending"),
      frameId,
    },
    writeTool("Animate sprite"),
    tool(async (args) => framesResult(await apiPost("/generate/image-animation", { ...args, mode: "f" }), args.id, "Animation"))
  );

  const pick = z.object({
    assetId: z.number().int().describe("Asset to animate"),
    frameIndex: z.number().int().nullable().optional().describe("Frame id from get_asset (e.g. an 8-way rotation frame). Omit for the asset's base image"),
    imageIndex: z.number().int().optional().describe("Which image of that frame (for a rotation frame: the facing's position in its facings list)"),
    base: z.boolean().optional().describe("true = the asset's original base image, counted as the 'down' (front) facing. Only for sprites drawn facing the camera"),
  });

  server.tool(
    "generate_animation_set",
    "Generate several animations in one job. Two ways to use it:\n" +
      "1. A PRESET on one sprite: platformer-character (idle, run, jump, attack-1, death, hurt) or a top-down " +
      "set (topdown-walk/run/dash/attack: 8 directions; topdown-idle: 4). Each item gets the preset's actions.\n" +
      "2. A PRESET across an 8-way rotation set: one item per facing, {assetId, frameIndex:<rotation frame id>, " +
      "imageIndex:i} where i is the facing's position in the frame's facings list, and every facing gets its own " +
      "directional clip (walk-left from the left-facing image, …). If the facings list has no 'down' (the sprite " +
      "was drawn facing the camera), add {assetId, base:true} as 'down'. If it already has 'down' (a side-view " +
      "sprite), use only the rotation's own images: the base is the side view, not the front. For topdown-idle " +
      "pick only the 4 cardinals (down, right, up, left).\n" +
      "Without a preset, list the actions in the prompt for up to 6 custom clips, one clip each: " +
      "'name: description' separated by semicolons names each clip (e.g. 'attack-2: an overhead slash; block: raise " +
      "the sword to guard'); for one image a plain 'idle, run, jump' also works. Every image gets every action. " +
      "Cost: 100 credits per pass (200 for 1024px sprites, which run in 4K); a pass holds up to 6 clips. On an " +
      "8-way rotation set the left, up-left and down-left clips are mirrored from the right-side ones (the " +
      "rotation's left side is a mirror already), so an 8-way set is ONE pass; set flipFacings false to animate " +
      "all eight (2 passes). Clips are added to their source asset as frames named after the action.",
    {
      items: z.array(pick).min(1).max(12).describe("Images to animate, in order"),
      preset: z
        .enum(["platformer-character", "topdown-walk", "topdown-run", "topdown-dash", "topdown-attack", "topdown-idle"])
        .optional()
        .describe("Named set of actions (see get_animation_presets)"),
      prompt: z.string().default("").describe("Without a preset: the actions to make, as 'name: description' separated by semicolons. With one: optional extra direction for every clip"),
      holdFacing: z.boolean().default(false).describe("End every clip on the frame it started from, so directional loops do not drift"),
      flipFacings: z.boolean().default(true).describe("On an 8-way rotation set, mirror the left-side clips from the right-side ones instead of animating them (half the price). One-sided details swap sides, as on the rotation images"),
      autoFlip: z.boolean().default(false).describe("After the run, mirror every right-side clip on the asset that has no left twin (animate only the right-facing turns, get all eight). Free"),
    },
    writeTool("Generate animation set"),
    tool(async (args) => resultsContent(await apiPost("/generate/multi-animation", args), "Animation set generated."))
  );

  server.tool(
    "flip_left_side",
    "Mirror every right, up-right and down-right animation on an asset that has no left twin into one " +
      "(walk-right -> walk-left). The 8-way turns draw the left side as a mirror of the right, so animate " +
      "the right-facing turns and flip for the rest. Free (no model call). One-sided details swap sides.",
    { id: assetId },
    writeTool("Flip to left side"),
    tool(async ({ id }) => framesResult(await apiPost("/generate/flip", { id }), id, "Flip"))
  );

  // ---------------------------------------------------------------------------
  // Audio
  // ---------------------------------------------------------------------------

  server.tool(
    "generate_sfx",
    "Generate a short sound effect (coin pickup, sword hit, footstep…). 5 credits.",
    { prompt: z.string().describe("The sound to make") },
    writeTool("Generate sound effect"),
    tool(async ({ prompt }) => assetResult(await apiPost("/generate/sfx", { prompt }), "Sound effect"))
  );

  server.tool(
    "generate_music",
    "Generate a music track. 10 credits.",
    {
      prompt: z.string().min(10).max(300).describe("Genre, mood and instruments, e.g. 'upbeat chiptune for a title screen' (10–300 chars)"),
      duration: z.number().int().min(30).max(120).default(60).describe("Seconds (30–120)"),
      bpm: z.number().int().min(80).max(200).default(100),
      keyScale: z.string().default("C major").describe("e.g. 'A minor', 'D major'"),
    },
    writeTool("Generate music"),
    tool(async (args) => assetResult(await apiPost("/generate/music", args), "Music"))
  );

  // ---------------------------------------------------------------------------
  // Video
  // ---------------------------------------------------------------------------

  server.tool(
    "generate_video",
    "Generate a short video clip (trailer shot, cutscene, animated background) from a prompt and 1–7 " +
      "reference images. 15 credits per second.",
    {
      prompt: z.string().describe("What happens in the clip"),
      images: z.array(z.string()).min(1).max(7).describe("Reference images: image keys from get_asset, https URLs, or data: URIs"),
      duration: z.number().int().min(4).max(15).default(4).describe("Seconds (4–15)"),
      width: z.number().int().default(1280),
      height: z.number().int().default(720),
    },
    writeTool("Generate video"),
    tool(async (args) => assetResult(await apiPost("/generate/video", args), "Video"))
  );

  server.tool(
    "extend_video",
    "Continue an existing video asset from its last frame. 15 credits per second.",
    {
      assetId: z.number().int().describe("The video asset"),
      prompt: z.string().describe("What happens next"),
      video: z.string().default("").describe("Which clip to continue (a file key from get_asset). Empty = the latest extension, else the original"),
      duration: z.number().int().min(4).max(15).default(4),
      width: z.number().int().default(1280),
      height: z.number().int().default(720),
    },
    writeTool("Extend video"),
    tool(async ({ video, ...args }) => {
      let source = video;
      if (!source) {
        const asset = await apiGet(`/assets/${args.assetId}`);
        const extensions = asset.meta_data?.video_extensions || [];
        source = extensions.length ? extensions[extensions.length - 1].file : asset.file;
      }
      const data = await apiPost("/generate/video-extend", { ...args, video: source, images: [] });
      const clips = (data.videos || []).map((v) => `- ${cdnUrl(v.file)}`).join("\n");
      const link = `${APP_URL}/asset/${args.assetId}`;
      return withGallery(
        { content: [{ type: "text", text: `Extended video ${args.assetId}:\n${clips}\n${money(data)}` }] },
        (data.videos || []).map((v, i) => mediaItem(v.file, `Extension ${i + 1}`, { link })),
        "Video extended"
      );
    })
  );

  // ---------------------------------------------------------------------------
  // 3D
  // ---------------------------------------------------------------------------

  server.tool(
    "generate_3d_model",
    "Generate a 3D model (GLB) from a prompt. 15 credits (lq) or 60 (hq).",
    {
      prompt: z.string().describe("The model to make"),
      type: z.enum(["object", "character"]).default("object").describe("'character' makes a T-posed figure ready for rigging"),
      style: z.string().default("cartoon style").describe("e.g. 'cartoon style', 'low-poly', 'realistic'"),
      mode: z.enum(["lq", "hq"]).default("hq").describe("lq = fast draft (15 credits), hq = detailed (60 credits)"),
      bodyType: z.enum(["humanoid", "quadruped"]).default("humanoid").describe("Characters only"),
      seed: z.number().int().min(0).default(0),
    },
    writeTool("Generate 3D model"),
    tool(async ({ bodyType, ...rest }) => {
      const options = rest.type === "character" ? { pose: "tpose", bodyType } : {};
      return assetResult(await apiPost("/generate/3d-model", { ...rest, options }), "3D model");
    })
  );

  server.tool(
    "rig_3d_model",
    "Add a skeleton to a humanoid 3D model so it can be animated (non-humanoids are refused before any " +
      "charge). Run before animate_3d_model. 140 credits.",
    {
      id: z.number().int().describe("3D model asset ID"),
      height_meters: z.number().min(0.2).max(10).default(1.7).describe("Character height in metres"),
    },
    writeTool("Rig 3D model"),
    tool(async (args) => {
      const data = await apiPost("/generate/model-rig", args);
      return { content: [{ type: "text", text: `Rigged model ${args.id}: ${cdnUrl(data.rigged_glb || data.rigged_file)}\n${money(data)}` }] };
    })
  );

  server.tool(
    "animate_3d_model",
    "Animate a rigged 3D model from a description of the motion. 30 credits.",
    {
      id: z.number().int().describe("Rigged 3D model asset ID"),
      prompt: z.string().describe("The motion, e.g. 'walk cycle', 'idle breathing'"),
      duration: z.number().min(1).max(10).default(3).describe("Seconds"),
    },
    writeTool("Animate 3D model"),
    tool(async (args) => {
      const data = await apiPost("/generate/model-animation", args);
      const anim = data.animation || {};
      return {
        content: [{ type: "text", text: `Animation "${anim.name || args.prompt}" on model ${args.id}: ${cdnUrl(anim.file)}\n${money(data)}` }],
      };
    })
  );

  // The inline gallery, and the tools whose results it shows.
  server.registerResource(
    "gallery",
    GALLERY_URI,
    { title: "Voidless results", description: "Shows the images, animations, video and audio a tool made.", mimeType: GALLERY_MIME },
    async () => ({
      contents: [{
        uri: GALLERY_URI,
        mimeType: GALLERY_MIME,
        text: GALLERY_HTML,
        _meta: {
          ui: { csp: { resourceDomains: [CDN_URL] }, prefersBorder: false },
          "openai/widgetCSP": { resource_domains: [CDN_URL], connect_domains: [] },
          "openai/widgetDescription": "The images and animations Voidless just made.",
        },
      }],
    })
  );
  const galleryMeta = { ui: { resourceUri: GALLERY_URI }, "ui/resourceUri": GALLERY_URI, "openai/outputTemplate": GALLERY_URI };
  for (const name of GALLERY_TOOLS) {
    const t = server._registeredTools?.[name];
    if (t) t.update({ _meta: { ...(t._meta || {}), ...galleryMeta } });
  }

  return server;
}
