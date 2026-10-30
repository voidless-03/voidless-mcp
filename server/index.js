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
if (!API_KEY) {
  console.error("[voidless-mcp] VOIDLESS_API_KEY is not set (expected a void_... key)");
  process.exit(1);
}
const REMOTE_URL = process.env.VOIDLESS_MCP_URL || "https://mcp.voidless.dev/mcp";

const server = createVoidlessServer(API_KEY, "stdio");
await server.connect(new StdioServerTransport());

// After connecting, so a slow or unreachable network never delays startup: the tools appear when the
// listing arrives (the client is told the tool list changed). Generic on purpose: whatever the hosted
// server marks as free ("voidless/free" in _meta) is forwarded, so new free tools need no release here.
try {
  const remote = new Client({ name: "voidless-mcp-local", version: VERSION });
  await remote.connect(new StreamableHTTPClientTransport(new URL(REMOTE_URL), {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}`, "X-Voidless-Client": `mcp/${VERSION} (stdio)` } },
  }));
  const { tools } = await remote.listTools();
  for (const t of tools.filter((t) => t._meta?.["voidless/free"])) {
    if (server._registeredTools?.[t.name]) continue;
    server.registerTool(t.name, {
      title: t.title || t.annotations?.title,
      description: t.description,
      inputSchema: z.fromJSONSchema(t.inputSchema),
      annotations: t.annotations,
      _meta: t._meta,
    }, (args) => remote.callTool({ name: t.name, arguments: args }, undefined, { timeout: 180_000 }));
  }
} catch (err) {
  console.error(`[voidless-mcp] free tools unavailable (could not reach ${REMOTE_URL}): ${err?.message || err}`);
}
