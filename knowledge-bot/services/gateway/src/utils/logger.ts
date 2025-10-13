import pino from "pino";

const level = process.env.LOG_LEVEL || "info";
const transport =
  process.env.NODE_ENV !== "production"
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined;

export const logger = pino({
  level,
  transport,
  base: {
    service: "gateway",
  },
});

export function requestSerializer(req: any) {
  return {
    id: req.id,
    method: req.method,
    url: req.originalUrl || req.url,
    tenant: req.tenantId,
  };
}

export function responseSerializer(res: any) {
  return {
    statusCode: res.statusCode,
  };
}
