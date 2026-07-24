import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";

// Lightweight anonymous identity: a random uid in an httpOnly cookie. No login
// wall — every visitor gets a stable id their designs are scoped to. Real auth
// (magic link / OAuth) can layer on top later without changing the data model.
const COOKIE = "chisel_uid";

export async function identity(c: Context, next: Next) {
  let uid = getCookie(c, COOKIE);
  if (!uid) {
    uid = crypto.randomUUID();
    setCookie(c, COOKIE, uid, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 400, // 400 days — Hono's max allowed cookie lifetime
    });
  }
  c.set("uid", uid);
  await next();
}
