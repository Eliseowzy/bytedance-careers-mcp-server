import { createApp } from "./app.js";
import { createLogger } from "./logger.js";

const logger = createLogger("http");
const port = Number(process.env.PORT ?? 3000);
createApp(logger).listen(port, () => logger.info({ port }, "ByteDance careers MCP server listening"));
