import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");

  // Only allow relative paths to prevent redirects to localhost/external URLs
  const next =
    nextParam && nextParam.startsWith("/")
      ? nextParam
      : "/dashboard";

  if (code) {
    const supabase = await createClient();

    const { data, error } =
      await supabase.auth.exchangeCodeForSession(code);

    if (!error && data?.user) {
      const user = data.user;

      // Ensure profile exists
      const { data: existingProfile, error: profileError } =
        await supabase
          .from("profiles")
          .select("id")
          .eq("id", user.id)
          .maybeSingle();

      if (!existingProfile && !profileError) {
        const name =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split("@")[0] ||
          "User";

        const { error: insertError } = await supabase
          .from("profiles")
          .insert({
            id: user.id,
            email: user.email,
            name,
          });

        if (insertError) {
          console.error(
            "Error creating profile in OAuth callback:",
            insertError
          );
        }
      }

      // Get the actual host used by the deployed application
      const forwardedHost = request.headers.get("x-forwarded-host");

      if (process.env.NODE_ENV === "development") {
        return NextResponse.redirect(`${origin}${next}`);
      }

      if (forwardedHost) {
        return NextResponse.redirect(
          `https://${forwardedHost}${next}`
        );
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}