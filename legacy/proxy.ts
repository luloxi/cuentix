import { NextResponse } from "next/server";

/**
 * Better Auth finishes Google OAuth on `/api/auth/callback/google`, which is
 * outside this matcher. The proxy only lets pages through. API routes stay
 * excluded so unauthenticated fetches get JSON 401 from the route handlers
 * instead of an HTML redirect.
 *
 * A missing BETTER_AUTH_SECRET must not crash page renders.
 */
export async function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
