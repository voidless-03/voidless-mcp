# Runs the local (stdio) Voidless MCP server from server/.
# Pass your Voidless+ API key at run time: docker run -i -e VOIDLESS_API_KEY=void_... voidless-mcp
FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/ ./
ENTRYPOINT ["node", "index.js"]
