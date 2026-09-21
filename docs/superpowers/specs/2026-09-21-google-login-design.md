# Google login for the existing hive

Approved in conversation: Google OpenID Connect login for the iPhone web app and Mac browsers; sole owner sshakuf@gmail.com. No Swift app required.

The Mac mini serves the same shared app at https://shahafs-mac-mini.tailab5abb.ts.net:8443. Add a Google authorization-code flow, with PKCE, nonce and browser-bound single-use state. Validate ID token signatures, issuer, audience, expiry and nonce using a maintained library. Allow only the configured verified email at initial enrollment; persist its stable Google subject and require that subject subsequently. Configuration is local to the serving computer, not replicated or exported in hive data. OAuth client secret stays in a mode-0600 local file. No Google credentials or refresh tokens in the browser.

Issue a random per-browser session in a Secure HttpOnly SameSite=Lax host-only cookie; store only its hash, expiry, owner subject and hive identity durably. Sessions survive restarts, expire after 30 days, and can be revoked individually. Reauthentication preserves IndexedDB and pending edits. Require same-origin checks on cookie-authenticated mutations, including requests without an Origin; GET must not mutate outline data. Keep local CLI recovery and current explicit bearer auth compatible. Peer pairing/sync remain independent.

Public endpoints: GET /api/hive/auth/config returns {google:boolean,loginUrl?:string}; GET /api/hive/auth/google/start; GET /api/hive/auth/google/callback. Callback redirects only to fixed app origin and carries generic errors, never tokens. Authenticated session endpoints list/revoke browser sessions and logout. A stale bearer must not shadow a valid cookie. Offline login is impossible; previously downloaded lists stay editable and sync after reauthentication. Sign-out must not silently discard pending work.

First version supports Google login on the configured HTTPS mini origin, from iPhone or Mac browsers; local MacBook app and daemon retain existing access. Other remote device origins need independent configuration. Tailscale remains necessary.

Local config: ~/.lister/google-auth.json with clientId, clientSecret, ownerEmail, origin. Callback URI: https://shahafs-mac-mini.tailab5abb.ts.net:8443/api/hive/auth/google/callback. Missing config leaves recovery-token login functioning. Invalid config must not silently weaken authentication. Owner account changes invalidate old sessions/binding or require explicit local recovery. Setup documentation must explain Google Auth Platform web client and file installation without putting secrets in git/chat.

Validation: mocked Google boundary with real signed-token verification tests where practical; rejection of wrong owner, unverified email, changed subject, wrong nonce/state/expiry, replay, cookie CSRF, cross-hive sessions. Full suite/build. Actual Google/iPhone validation requires the user's OAuth credentials and Google sign-in.
