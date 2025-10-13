import type { Request, Response, NextFunction } from "express";
import { cfg } from "../config.js";

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  const t = req.header(cfg.tenantHeader);
  if (!t) return res.status(400).json({ error: "missing tenant header" });
  (req as any).tenantId = t;
  next();
}
