import { ulid } from "ulid";

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function newId(): string {
  return ulid().toUpperCase();
}

export function nowIso(): string {
  return new Date().toISOString();
}
