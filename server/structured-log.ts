import type { NextFunction, Request, Response } from "express";

type LogFields = Record<string, boolean | number | string | undefined>;

function write(level: "error" | "info", event: string, fields: LogFields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ),
  };
  const serialized = JSON.stringify(entry);
  if (level === "error") {
    console.error(serialized);
  } else {
    console.info(serialized);
  }
}

export const log = {
  error(event: string, fields?: LogFields) {
    write("error", event, fields);
  },
  info(event: string, fields?: LogFields) {
    write("info", event, fields);
  },
};

export function requestLogging(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  response.setHeader("x-request-id", requestId);
  response.on("finish", () => {
    log.info("http_request", {
      requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    });
  });
  next();
}
