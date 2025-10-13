import crypto from "crypto";
export function hmacSign(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}
export function hmacVerify(secret: string, body: string, sig: string) {
  return hmacSign(secret, body) === sig;
}
