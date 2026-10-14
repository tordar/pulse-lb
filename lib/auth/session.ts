import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "pulse_session";
const ALGO = "HS256";
const ONE_DAY = 60 * 60 * 24;
const SESSION_TTL_SECONDS = 30 * ONE_DAY;

export type Session = {
  uid: string;            // users.id
  mbAccountId: number;
  lbUsername: string;
};

function secretKey(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(raw);
}

export async function setSession(session: Session): Promise<void> {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: ALGO })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALGO] });
    if (
      typeof payload.uid !== "string" ||
      typeof payload.mbAccountId !== "number" ||
      typeof payload.lbUsername !== "string"
    ) {
      return null;
    }
    return {
      uid: payload.uid,
      mbAccountId: payload.mbAccountId,
      lbUsername: payload.lbUsername,
    };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
