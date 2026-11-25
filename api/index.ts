import { createApp } from "../src/app.js";
import { createLogger } from "../src/logger.js";

export default createApp(createLogger("http"));
