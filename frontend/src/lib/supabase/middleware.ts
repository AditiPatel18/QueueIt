import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Updates the Supabase auth session in middleware.
 * This ensures the session stays fresh on every request.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          const requestHeaders = new Headers(request.headers);
          const cookiesList = request.cookies.getAll().map(c => `${c.name}=${c.value}`).join('; ');
          requestHeaders.set('cookie', cookiesList);
          supabaseResponse = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session with a 3-second timeout guard to prevent 504 MIDDLEWARE_INVOCATION_TIMEOUT on DNS/network errors
  let user = null;
  try {
    const authPromise = supabase.auth.getUser();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Supabase auth timeout in middleware")), 3000)
    );
    const { data } = await Promise.race([authPromise, timeoutPromise]);
    user = data?.user ?? null;
  } catch (err: any) {
    console.warn(`[middleware] Supabase auth check failed or timed out: ${err?.message || err}`);
  }

  console.log(`[middleware] Path: ${request.nextUrl.pathname}, User: ${user ? user.email : "null"}`);

  // Protect dashboard & protected app routes — redirect to login if not authenticated
  const protectedPaths = ["/dashboard", "/analytics", "/chat", "/history", "/profile", "/update-password"];
  const isProtected = protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    console.log(`[middleware] Guard redirect to login from: ${request.nextUrl.pathname}`);
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if (
    user &&
    (request.nextUrl.pathname === "/login" ||
      request.nextUrl.pathname === "/signup")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    console.log(`[middleware] Authenticated redirect to dashboard from: ${request.nextUrl.pathname}`);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
