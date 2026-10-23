"use client";
import { InvitationAcceptance } from "../administration";
export default function InvitationPage() {
  async function api(path: string, options: RequestInit = {}) {
    const r = await fetch(
      (process.env.NEXT_PUBLIC_DAI_BASE_PATH || "") + "/api" + path,
      {
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
      },
    );
    const body = await r.json();
    if (!r.ok)
      throw new Error(
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail),
      );
    return body;
  }
  return (
    <main style={{ maxWidth: 600, margin: "60px auto", padding: 24 }}>
      <h1>Join your DaiHealth facility</h1>
      <p>
        Use the token provided by your administrator. This preview uses
        synthetic accounts and simulated OTP.
      </p>
      <InvitationAcceptance api={api} />
      <a href={(process.env.NEXT_PUBLIC_DAI_BASE_PATH || "") + "/"}>
        Return to sign in
      </a>
    </main>
  );
}
