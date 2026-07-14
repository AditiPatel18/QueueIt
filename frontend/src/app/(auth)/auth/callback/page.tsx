"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const handleCallbackCalled = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      if (handleCallbackCalled.current) return;
      handleCallbackCalled.current = true;

      console.log("[callback]");
      const supabase = createClient();

      try {
        // 1. window.location.href
        console.log("1. window.location.href:", window.location.href);

        // 2. code value
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get("code");
        console.log("2. code value:", code);

        let exchangeResult = null;
        let exchangeErrorObj = null;

        if (code) {
          console.log("[exchange]");
          try {
            const res = await supabase.auth.exchangeCodeForSession(code);
            exchangeResult = res.data;
            exchangeErrorObj = res.error;
          } catch (e: any) {
            exchangeErrorObj = e;
          }
        }

        // 3. exchangeCodeForSession result
        console.log("3. exchangeCodeForSession result:", exchangeResult);
        // 4. exchangeCodeForSession error
        console.log("4. exchangeCodeForSession error:", exchangeErrorObj);

        let getSessionResult = null;
        let getSessionErrorObj = null;
        try {
          const res = await supabase.auth.getSession();
          getSessionResult = res.data;
          getSessionErrorObj = res.error;
        } catch (e: any) {
          getSessionErrorObj = e;
        }

        // 5. getSession result
        console.log("5. getSession result:", getSessionResult);
        // 6. getSession error
        console.log("6. getSession error:", getSessionErrorObj);

        // 7. document.cookie
        console.log("7. document.cookie:", document.cookie);

        // 8. localStorage keys
        const localStorageKeys = typeof window !== "undefined" ? Object.keys(localStorage) : [];
        console.log("8. localStorage keys:", localStorageKeys);

        let getUserResult = null;
        try {
          getUserResult = await supabase.auth.getUser();
        } catch (e: any) {
          getUserResult = e;
        }

        // 9. supabase.auth.getUser()
        console.log("9. supabase.auth.getUser() result/error:", getUserResult);

        const session = exchangeResult?.session || getSessionResult?.session;

        // 3. If session exists
        if (session) {
          console.log("[session]");
          
          // Fetch user with getUser()
          const { data: { user }, error: userError } = await supabase.auth.getUser();
          if (userError || !user) throw userError || new Error("Failed to get user");
          console.log("[user]", user.email);

          // Create profile only if missing
          const { data: existingProfile, error: profileError } = await supabase
            .from("profiles")
            .select("id")
            .eq("id", user.id)
            .maybeSingle();

          if (!existingProfile && !profileError) {
            const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "User";
            const { error: insertError } = await supabase
              .from("profiles")
              .insert({
                id: user.id,
                email: user.email,
                name: name
              });
            if (insertError) {
              console.error("Error creating profile:", insertError);
            }
          }

          console.log("[dashboard]");
          // Redirect to /dashboard
          router.replace("/dashboard");
        } else {
          console.log("[login-redirect] No session found (skipping redirect on failure)");
          setError("No session found. Check console logs for instrumented debug details.");
        }
      } catch (err: any) {
        console.error("Error in auth callback:", err);
        setError(err.message || "Authentication error");
        console.log("[login-redirect] Error occurred (skipping redirect on failure)");
      }
    };

    handleCallback();
  }, [router]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <p className="text-destructive font-medium">Authentication error: {error}</p>
        <p className="text-sm text-muted-foreground mt-2">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
