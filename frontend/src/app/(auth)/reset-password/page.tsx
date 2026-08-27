"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Loader2, CheckCircle, ArrowLeft } from "lucide-react";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    const supabase = createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    });

    if (error) {
      console.error("[Supabase Reset Password Error]", error);
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <Card className="glass-strong border-border/30">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
          <h2 className="text-xl font-bold">Password Reset Email Sent</h2>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            We sent a password setup/reset link to <strong className="text-foreground">{email}</strong>.
            Please check your inbox and click the link to set your password.
          </p>
          <div className="pt-2">
            <Link href="/login">
              <Button variant="outline" className="border-border/50 hover:bg-accent/50 cursor-pointer">
                Back to Sign In
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="glass-strong border-border/30">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-2xl font-bold">Reset / Set Password</CardTitle>
          <CardDescription className="text-muted-foreground">
            Enter your email to receive a password setup or reset link
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleResetPassword} className="space-y-4" autoComplete="off">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 py-5 bg-input/50 border-border/30 focus:border-primary/50 transition-colors"
                  required
                  autoComplete="off"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              id="reset-password-btn"
              type="submit"
              className="w-full py-5 gradient-primary text-white border-0 hover:opacity-90 transition-opacity cursor-pointer"
              disabled={loading}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send Reset Link
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link
          href="/login"
          className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Sign In
        </Link>
      </p>
    </>
  );
}
