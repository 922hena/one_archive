import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SCORE_BUCKET = "scores";
export const LOGIN_PAGE = "schedule.html";

function looksLikeSecretKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length < 2) return false;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).role === "service_role";
  } catch {
    return false;
  }
}

export function createAppClient() {
  const config = window.ONE_ARCHIVE ?? {};
  const url = typeof config.supabaseUrl === "string" ? config.supabaseUrl.trim() : "";
  const key = typeof config.supabasePublishableKey === "string" ? config.supabasePublishableKey.trim() : "";
  if (!url.startsWith("https://") || !key || key.includes("YOUR_PUBLISHABLE_KEY") || looksLikeSecretKey(key)) {
    return null;
  }
  // Same options as schedule.js so both pages share one stored session.
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "implicit"
    }
  });
}

export async function requireUser(supabase) {
  const { data, error } = await supabase.auth.getSession();
  const user = data?.session?.user ?? null;
  if (error || !user) {
    window.location.replace(LOGIN_PAGE);
    return null;
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (!session?.user) window.location.replace(LOGIN_PAGE);
  });
  return user;
}
