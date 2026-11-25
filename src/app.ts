import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "./logger.js";
import { createMcpServer } from "./server.js";

export function createApp(logger: Logger) {
  const app = express();
  app.use(express.json());
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.post("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        if (!isInitializeRequest(req.body)) {
          res.status(400).json({ error: "Missing or invalid MCP session" });
          return;
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          }
        });
        transport.onclose = () => {
          if (transport?.sessionId) transports.delete(transport.sessionId);
        };
        await createMcpServer(logger).connect(transport);
      }
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error({ error }, "MCP request failed");
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  const existing = async (req: express.Request, res: express.Response) => {
    const transport = transports.get(req.headers["mcp-session-id"] as string);
    if (!transport) {
      res.status(400).send("Invalid MCP session");
      return;
    }
    await transport.handleRequest(req, res);
  };

  app.get("/mcp", existing);
  app.delete("/mcp", existing);
  return app;
}
