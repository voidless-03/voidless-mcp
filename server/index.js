#!/usr/bin/env node
/**
 * Voidless MCP Server (local, stdio).
 *
 * Exposes the Voidless API as MCP tools for clients that run a local server: Claude Desktop, Claude
 * Code, Cursor, VS Code. The hosted connector at https://mcp.voidless.dev/mcp serves the same tools
 * (tools.js) to clients that take a URL and sign in instead.
 *
 * Required environment variables:
 *   VOIDLESS_API_KEY  - void_... API key from your Voidless account (Voidless+)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createVoidlessServer } from "./tools.js";

const API_KEY = process.env.VOIDLESS_API_KEY || "";
if (!API_KEY) {
  console.error("[voidless-mcp] VOIDLESS_API_KEY is not set (expected a void_... key)");
  process.exit(1);
}

const server = createVoidlessServer(API_KEY);
await server.connect(new StdioServerTransport());
