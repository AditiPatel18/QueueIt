import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  console.log(`[guard] Checking user status: ${user ? user.email : "null"}`);

  if (!user) {
    console.log("[guard] Redirecting unauthorized request to /login");
    redirect("/login");
  }

  return <>{children}</>;
}
