import pino from "pino";

export function createLogger(mode: "http" | "stdio") {
  return pino({ level: process.env.LOG_LEVEL ?? "info" }, mode === "stdio" ? pino.destination(2) : undefined);
}

export type Logger = ReturnType<typeof createLogger>;
