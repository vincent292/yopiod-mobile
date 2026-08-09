import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { config } from "./config";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

function callbackParams(url: string) {
  const [base, fragment = ""] = url.split("#", 2);
  const query = new URL(base).searchParams;
  const hash = new URLSearchParams(fragment);
  return {
    accessToken: hash.get("access_token") ?? query.get("access_token") ?? "",
    code: query.get("code") ?? hash.get("code") ?? "",
    error: hash.get("error_description") ?? query.get("error_description") ?? hash.get("error") ?? query.get("error") ?? "",
    refreshToken: hash.get("refresh_token") ?? query.get("refresh_token") ?? "",
  };
}

export async function signInCustomerWithGoogle() {
  const appRedirect = makeRedirectUri({ scheme: "yopido", path: "auth/callback" });
  const webRedirect = `${config.apiBaseUrl.replace(/\/$/, "")}/auth/mobile`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: webRedirect,
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) throw new Error("google-auth-failed");

  const result = await WebBrowser.openAuthSessionAsync(data.url, appRedirect);
  if (result.type !== "success") {
    if (result.type === "cancel" || result.type === "dismiss") return null;
    throw new Error("google-auth-failed");
  }

  const params = callbackParams(result.url);
  if (params.error) throw new Error(params.error);
  if (params.code) {
    const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
    if (exchangeError) throw exchangeError;
    return sessionData.session;
  }
  if (!params.accessToken || !params.refreshToken) throw new Error("google-session-missing");

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: params.accessToken,
    refresh_token: params.refreshToken,
  });
  if (sessionError) throw sessionError;
  return sessionData.session;
}
