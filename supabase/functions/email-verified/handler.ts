// The Auth service validates the email link before redirecting here. This page
// never exchanges a code, creates a session, or changes an account. Plain text
// is intentional: hosted Supabase does not serve HTML without a custom domain.
export function handleEmailVerified(request: Request): Response {
  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
  }
  const params = new URL(request.url).searchParams;
  const failed = params.has("error") || params.has("error_code") || params.has("error_description");
  const message = failed
    ? "This email link could not be used. It may have expired or already been opened.\n\nReturn to Clu and try signing in. If your email still needs verification, open Create Account and request a new verification email."
    : params.get("code")
      ? "Email verification complete.\n\nReturn to Clu on your phone and sign in with your email and password. You can close this tab."
      : "Return to Clu and sign in with your email and password.\n\nIf your email still needs verification, open Create Account and request a new verification email.";
  // Do not reflect codes, email addresses, provider errors or redirect URLs.
  return new Response(request.method === "HEAD" ? null : `Clu\n\n${message}\n`, { status: 200, headers });
}
