import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getCorsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-QueueIt-Duplicate, X-Requested-With",
    "Access-Control-Allow-Credentials": "true",
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

function normalizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    url.hash = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    const params = new URLSearchParams(url.search);
    const keysToDelete: string[] = [];
    for (const key of params.keys()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith("utm_") || lowerKey === "fbclid" || lowerKey === "gclid") {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((k) => params.delete(k));
    const sortedParams = Array.from(params.entries()).sort((a, b) => {
      if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
      return a[1].localeCompare(b[1]);
    });
    const newSearch = new URLSearchParams(sortedParams).toString();
    url.search = newSearch ? `?${newSearch}` : "";
    return url.toString().toLowerCase().trim();
  } catch {
    return urlStr.toLowerCase().trim();
  }
}

function resolvePlatformType(urlStr: string): string {
  const lower = urlStr.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "video";
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "tweet";
  if (lower.includes("reddit.com")) return "reddit";
  if (lower.includes("github.com")) return "github";
  return "article";
}

function resolveSourceName(urlStr: string): string {
  try {
    const hostname = new URL(urlStr).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

export async function POST(request: Request) {
  const corsHeaders = getCorsHeaders(request);

  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { detail: "Please log in to QueueIt first" },
        { status: 401, headers: corsHeaders }
      );
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      return NextResponse.json(
        { detail: "Please log in to QueueIt first" },
        { status: 401, headers: corsHeaders }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xgifnzhpfexksoxavcyc.supabase.co";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_OtLsF_q1V1Nk-aK_kpwX_g_bl85-K_O";
    const supabaseServiceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_KEY;

    // 1. Authenticate user from Bearer token
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !userData?.user) {
      console.warn("[API /items] Supabase auth check failed:", authError?.message);
      return NextResponse.json(
        { detail: "Session expired or invalid. Please log in again." },
        { status: 401, headers: corsHeaders }
      );
    }

    const user = userData.user;
    const ACCOUNT_ALIAS_MAP: Record<string, string> = {
      "87975154-d112-4aeb-96e4-b6a9e120e9dc": "dd669cb6-bbda-4e22-92b6-0f723849a1af",
      "a63fddcf-4dee-47be-b1a3-6fcf956ed3a5": "dd669cb6-bbda-4e22-92b6-0f723849a1af",
    };
    const EMAIL_ALIAS_MAP: Record<string, string> = {
      "aditi18407@gmail.com": "dd669cb6-bbda-4e22-92b6-0f723849a1af",
      "aditipatel18407@gmail.com": "dd669cb6-bbda-4e22-92b6-0f723849a1af",
      "adipatel18407@gmail.com": "dd669cb6-bbda-4e22-92b6-0f723849a1af",
    };

    const targetUserId =
      ACCOUNT_ALIAS_MAP[user.id] ||
      (user.email && EMAIL_ALIAS_MAP[user.email.toLowerCase().trim()]) ||
      user.id;

    const body = await request.json().catch(() => ({}));
    const rawUrl = body.url;

    if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
      return NextResponse.json(
        { detail: "URL is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const cleanUrl = rawUrl.trim();
    const itemTitle = body.title?.trim() || cleanUrl;

    // 2. Try proxying to backend service first (if configured backend URL is set)
    const candidates = [
      process.env.BACKEND_API_URL,
      process.env.BACKEND_URL,
      process.env.NEXT_PUBLIC_API_URL,
      "http://localhost:8001",
    ].filter(Boolean) as string[];

    for (const rawUrl of candidates) {
      const backendBase = rawUrl.replace(/[-/]+$/, "");
      if (!backendBase || backendBase.includes("localhost:3000")) continue;

      // Skip localhost when running in production serverless environments unless specifically configured
      if (process.env.NODE_ENV === "production" && (backendBase.includes("localhost") || backendBase.includes("127.0.0.1"))) {
        continue;
      }

      try {
        console.log(`[API /items] Proxying save request for user ${targetUserId} to backend at: ${backendBase}`);
        const backendRes = await fetch(`${backendBase}/api/items`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "X-Authenticated-User-Id": targetUserId,
          },
          body: JSON.stringify({
            url: cleanUrl,
            title: itemTitle,
          }),
        });

        if (backendRes.ok) {
          const backendData = await backendRes.json();
          const isDup = backendRes.headers.get("X-QueueIt-Duplicate") === "true" || (backendData && backendData.is_duplicate);
          return NextResponse.json(backendData, {
            status: backendRes.status,
            headers: {
              ...corsHeaders,
              ...(isDup ? { "X-QueueIt-Duplicate": "true" } : {}),
            },
          });
        } else {
          const errText = await backendRes.text().catch(() => "");
          console.warn(`[API /items] Backend (${backendBase}) responded with status ${backendRes.status}:`, errText);
        }
      } catch (proxyErr: any) {
        console.warn(`[API /items] Backend proxy connection failed (${backendBase}):`, proxyErr?.message || proxyErr);
      }
    }

    // 3. Server-side Direct Supabase Insertion (Fallback)
    // Direct DB insertion requires a trusted server-side service role key to persist on behalf of authenticated users
    if (!supabaseServiceKey) {
      console.error("[API /items] Backend proxy was unreachable and SUPABASE_SERVICE_ROLE_KEY is not configured in server environment variables.");
      return NextResponse.json(
        {
          detail: "Backend service is unreachable and SUPABASE_SERVICE_ROLE_KEY is not configured on the server. Please verify backend deployment and environment variables.",
        },
        { status: 503, headers: corsHeaders }
      );
    }

    console.log(`[API /items] Executing trusted server-side insert via Supabase service client for user: ${targetUserId}`);
    const dbClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const sourceType = resolvePlatformType(cleanUrl);
    const sourceName = resolveSourceName(cleanUrl);

    // Check for existing duplicate item for this user
    const { data: existingData } = await dbClient
      .from("items")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("url", cleanUrl)
      .limit(1)
      .maybeSingle();

    if (existingData) {
      return NextResponse.json(
        { ...existingData, is_duplicate: true },
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "X-QueueIt-Duplicate": "true",
          },
        }
      );
    }

    // Prepare item data matching exact database schema
    const itemId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const itemData: Record<string, any> = {
      id: itemId,
      user_id: targetUserId,
      url: cleanUrl,
      title: itemTitle,
      content_type: sourceType,
      source_name: sourceName,
      status: "unread",
      processing_status: "completed",
      is_favorite: false,
      added_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data: insertedItem, error: insertError } = await dbClient
      .from("items")
      .insert(itemData)
      .select()
      .single();

    if (insertError) {
      console.error("[API /items] Insert error:", insertError.message);
      // Fallback insert with minimal required columns
      const minimalData = {
        id: itemId,
        user_id: targetUserId,
        url: cleanUrl,
        title: itemTitle,
        status: "unread",
      };
      const { data: fallbackItem, error: fallbackError } = await dbClient
        .from("items")
        .insert(minimalData)
        .select()
        .single();

      if (fallbackError) {
        console.error("[API /items] Fallback insert error:", fallbackError.message);
        return NextResponse.json(
          { detail: `Database insert failed: ${fallbackError.message}` },
          { status: 500, headers: corsHeaders }
        );
      }

      return NextResponse.json(fallbackItem, { status: 201, headers: corsHeaders });
    }

    return NextResponse.json(insertedItem, { status: 201, headers: corsHeaders });
  } catch (err: any) {
    console.error("[API /items] Unexpected error:", err?.message || err);
    return NextResponse.json(
      { detail: err?.message || "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
