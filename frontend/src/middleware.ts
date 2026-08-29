import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Explicitly bypass middleware & auth checks for public extension installation page, download API, items API, and assets
  if (
    pathname === "/extension" ||
    pathname.startsWith("/extension") ||
    pathname.startsWith("/api/extension") ||
    pathname.startsWith("/api/items")
  ) {
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public extension routes & assets (/extension, /api/extension, /api/items, .zip, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|extension|api/extension|api/items|.*\\.(?:svg|png|jpg|jpeg|gif|webp|zip)$).*)"
  ],
};
