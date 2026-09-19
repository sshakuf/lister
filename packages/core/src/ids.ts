import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export const ID_LENGTH = 8;
const ID_RE = /^[0-9a-z]{8}$/;

/** A Bullet ID: 8 random characters from [0-9a-z]. */
export function newId(): string {
  const bytes = randomBytes(ID_LENGTH);
  let out = "";
  for (let i = 0; i < ID_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function isValidId(s: unknown): s is string {
  return typeof s === "string" && ID_RE.test(s);
}
