import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { cfg } from "../config.js";

const authMode = (process.env.ADMIN_AUTH_MODE || "token").toLowerCase(); // token | jwt
const audience = process.env.ADMIN_JWT_AUDIENCE;
const issuer = process.env.ADMIN_JWT_ISSUER;

function publicKeyFromEnv() {
  const jwk = process.env.ADMIN_JWT_PUBLIC_JWK;
  if (!jwk) return null;
  try {
    const parsed = JSON.parse(jwk);
    if (parsed.kty === "RSA" && parsed.n && parsed.e) {
      const { createPublicKey } = require("crypto");
      const jwkToPem = require("jwk-to-pem");
      return jwkToPem(parsed);
    }
    return null;
  } catch (err) {
    console.error("Failed to parse ADMIN_JWT_PUBLIC_JWK", err);
    return null;
  }
}

const jwtSecret = process.env.ADMIN_JWT_SECRET;
const publicPem = publicKeyFromEnv();

function verifyJwt(token: string) {
  if (!jwtSecret && !publicPem) throw new Error("Configure ADMIN_JWT_SECRET or ADMIN_JWT_PUBLIC_JWK");
  const key = publicPem || jwtSecret!;
  return jwt.verify(token, key, {
    audience: audience || undefined,
    issuer: issuer || undefined,
  });
}

export function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  if (authMode === "jwt") {
    const header = req.header("Authorization") || "";
    const match = header.match(/^Bearer\s+(.*)$/i);
    if (!match) {
      return res.status(401).json({ error: "missing bearer token" });
    }
    try {
      const decoded = verifyJwt(match[1]);
      (req as any).adminPrincipal = decoded;
      return next();
    } catch (err) {
      console.error("admin jwt verification failed", err);
      return res.status(401).json({ error: "invalid admin token" });
    }
  }

  if (!cfg.adminToken) {
    return res.status(503).json({ error: "admin interface not configured" });
  }
  const header = req.header("X-Admin-Token");
  if (!header || header !== cfg.adminToken) {
    return res.status(401).json({ error: "invalid admin token" });
  }
  next();
}
