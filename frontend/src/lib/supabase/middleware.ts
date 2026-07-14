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

  // Refresh the session — this is critical for keeping auth state alive
  const {
    data: { user },
  } = await supabase.auth.getUser();

  console.log(`[middleware] Path: ${request.nextUrl.pathname}, User: ${user ? user.email : "null"}`);

  // Protect dashboard routes — redirect to login if not authenticated
  if (
    !user &&
    request.nextUrl.pathname.startsWith("/dashboard")
  ) {
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
