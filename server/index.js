#!/usr/bin/env node
/**
 * Voidless MCP Server (local, stdio).
 *
 * Exposes the Voidless API as MCP tools for clients that run a local server: Claude Desktop, Claude
 * Code, Cursor, VS Code. The hosted connector at https://mcp.voidless.dev/mcp serves the same tools
 * (tools.js) to clients that take a URL and sign in instead.
 *
 * The free game-dev tools (slice/pack sheets, Godot SpriteFrames, GIFs, palette swap, outlines) are
 * server-only code (Oct 30 2026): this package does not contain them. It lists them from the hosted
 * connector and forwards each call there with the same key, so they show up here too.
 *
 * Required environment variables:
 *   VOIDLESS_API_KEY  - void_... API key from your Voidless account (hand-made keys are Voidless+;
 *                       on a free account, use the hosted connector instead)
 * Optional:
 *   VOIDLESS_MCP_URL  - the hosted connector the free tools are forwarded to, default https://mcp.voidless.dev/mcp
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { createVoidlessServer, VERSION } from "./tools.js";

const API_KEY = process.env.VOIDLESS_API_KEY || "";
// Without a key the server still starts and lists its tools (so directories and inspectors such as
// Glama can index it); each call then fails with the API's authentication error.
if (!API_KEY) {
  console.error("[voidless-mcp] VOIDLESS_API_KEY is not set (expected a void_... key): tools are listed, but calls will fail until it is set");
}
const REMOTE_URL = process.env.VOIDLESS_MCP_URL || "https://mcp.voidless.dev/mcp";
const API_URL = (process.env.VOIDLESS_API_URL || "https://api.voidless.dev").replace(/\/$/, "");
// Pointed at a Voidless other than production (a dev stack: VOIDLESS_API_URL=http://localhost:1339) and
// with no VOIDLESS_MCP_URL, the free tools must not be forwarded to the production connector: a dev key
// is not a production key, so the listing failed and Claude Code had no export_godot_spriteframes (Nov 12
// 2026, tutorial recording). A repo checkout has the free tools' code (free/, not in the npm package), so
// they run in-process against the same API; otherwise forward to VOIDLESS_MCP_URL as before.
const NON_PROD_API = !/^https:\/\/api\.voidless\.dev$/.test(API_URL);
const LOCAL_FREE = NON_PROD_API && !process.env.VOIDLESS_MCP_URL;

const server = createVoidlessServer(API_KEY, "stdio");

if (LOCAL_FREE) {
  try {
    const { registerFreeTools } = await import("./free/index.js");
    const { makeLibrary } = await import("./free/library.js");
    const { makeDescriber } = await import("./free/describe.js");
    registerFreeTools(server, {
      user: { id: `stdio:${API_URL}`, email: null, tier: "dev", internal: true },
      client: "stdio-local",
      localFiles: true,                      // export_godot_spriteframes out_dir writes into the project
      capture: () => {},                     // no usage events from a dev stack
      library: makeLibrary({ apiUrl: API_URL, auth: { apiKey: API_KEY } }),
      describe: makeDescriber({ apiUrl: API_URL, apiKey: API_KEY }),   // model "free" prompts are read by that stack's Strapi
    });
  } catch (err) {
    console.error(`[voidless-mcp] ${API_URL} is not production and the free tools' code is not here (${err?.message || err}); ` +
      "run npm install in mcp-server/free, or set VOIDLESS_MCP_URL to that stack's /mcp");
  }
}

await server.connect(new StdioServerTransport());

// After connecting, so a slow or unreachable network never delays startup: the tools appear when the
// listing arrives (the client is told the tool list changed). Generic on purpose: whatever the hosted
// server marks as free ("voidless/free" in _meta) is forwarded, so new free tools need no release here.
if (!LOCAL_FREE) try {
  const remote = new Client({ name: "voidless-mcp-local", version: VERSION });
  await remote.connect(new StreamableHTTPClientTransport(new URL(REMOTE_URL), {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}`, "X-Voidless-Client": `mcp/${VERSION} (stdio)` } },
  }));
  // generate_image's model "free" is drawn by the hosted server too (procedural, no credits).
  server.voidlessFreeImage = (args) => remote.callTool({ name: "generate_image", arguments: args }, undefined, { timeout: 180_000 });
  const { tools } = await remote.listTools();
  for (const t of tools.filter((t) => t._meta?.["voidless/free"])) {
    if (server._registeredTools?.[t.name]) continue;
    server.registerTool(t.name, {
      title: t.title || t.annotations?.title,
      description: t.description,
      inputSchema: z.fromJSONSchema(t.inputSchema),
      annotations: t.annotations,
      _meta: t._meta,
    }, async (args) => {
      const res = await remote.callTool({ name: t.name, arguments: args }, undefined, { timeout: 180_000 });
      // A big export comes back as links (the hosted server can't write here): with out_dir, fetch them
      // into the user's folder so the model gets the files, not a cut-off .tres (Nov 13 2026).
      const links = res?._meta?.["voidless/files"];
      if (args?.out_dir && Array.isArray(links) && links.length) {
        try {
          const { writeLocal } = await import("./exportlocal.js");
          const files = [];
          for (const l of links) {
            const r = await fetch(l.url);
            if (!r.ok) throw new Error(`${l.name}: HTTP ${r.status}`);
            files.push({ name: l.name, bytes: Buffer.from(await r.arrayBuffer()) });
          }
          const paths = writeLocal(args.out_dir, files);
          const text = (res.content.find((c) => c.type === "text")?.text || "").split("\n\nThe files are too big")[0];
          return { ...res, content: [{ type: "text", text: `${text}\n\nWrote:\n${paths.map((p) => `- ${p}`).join("\n")}` }, ...res.content.filter((c) => c.type !== "text")] };
        } catch (err) {
          console.error(`[voidless-mcp] could not save the export into ${args.out_dir}: ${err?.message || err}`);
        }
      }
      return res;
    });
  }
} catch (err) {
  console.error(`[voidless-mcp] free tools unavailable (could not reach ${REMOTE_URL}): ${err?.message || err}`);
}
