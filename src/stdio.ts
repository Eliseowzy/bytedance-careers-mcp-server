#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLogger } from "./logger.js";
import { createMcpServer } from "./server.js";

const logger = createLogger("stdio");
await createMcpServer(logger).connect(new StdioServerTransport());
