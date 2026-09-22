# Google login setup

Google login authenticates a browser to the computer serving its HTTPS app. It does not replace peer sync credentials, and it does not require a native iOS app. Open the configured Mac mini HTTPS address from iPhone or Mac. Tailscale must be connected for online access.

## Google Auth Platform

Use a dedicated Google Cloud project named Lister. This installation uses project `divine-bonbon-509308-s5`. In Google Auth Platform:

1. Branding: app name Lister; support/contact email your Google account.
2. Audience: External for a personal Gmail account. While Testing, add your own email as a test user.
3. Create a client of type **Web application**, named Lister Mac mini.
4. Authorized redirect URI (exactly):

   ```text
   https://shahafs-mac-mini.tailab5abb.ts.net:8443/api/hive/auth/google/callback
   ```

   This uses a server redirect flow; no JavaScript origin is needed.
5. Download the client JSON and keep it private. Lister requests only `openid email`; no Gmail, Drive or Calendar access is needed.

Google's setup and protocol documentation: https://developers.google.com/identity/openid-connect/openid-connect

## Local configuration

Create `~/.lister/google-auth.json` on the Mac mini with these fields. Fill the client ID and secret locally using the downloaded credentials, never commit them or paste the secret into chat.

```json
{
  "clientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com",
  "clientSecret": "YOUR_CLIENT_SECRET",
  "ownerEmail": "sshakuf@gmail.com",
  "origin": "https://shahafs-mac-mini.tailab5abb.ts.net:8443"
}
```

```bash
chmod 600 ~/.lister/google-auth.json
```

Restart the Lister daemon after installing configuration. Open the HTTPS app and choose Continue with Google. Sign in as the configured owner. The first successful verified sign-in binds the owner to Google's stable account ID; other accounts cannot enroll themselves.

Missing Google configuration keeps existing recovery-token login available. Local CLI access on the serving machine remains available. Use the configured HTTPS origin for bookmarks and Home Screen installs. When Google login is configured, remote visits to `/` or `/index.html` on an older host or port redirect to that origin; loopback access and API requests retain their existing behavior. Secure sign-in cookies cannot authenticate an old HTTP address. Browser sessions last 30 days and survive daemon restarts; sign in again after expiration. Each browser session is independent and can be revoked without disconnecting computer sync.

## Offline and recovery

A Google sign-in needs Google and the serving computer online. Once the app has downloaded the hive, existing offline editing works independently of sign-in. Expired sessions and login failures preserve pending edits; reconnect and sign in again to synchronize them. Clearing browser website data can remove offline work, so export or sync before clearing it. Signing out does not erase saved outlines or pending edits from that browser.

Google configuration and the separate browser session database are not part of the shared hive or its JSON export. Back up local authentication configuration separately. Google login is initially configured on the mini origin; a different computer's remote HTTPS address needs its own configuration and registered callback. The local MacBook client continues to work with its existing local access and peer credentials.

## Changing the configured owner

The owner binding and sessions live in `~/.lister/browser-auth.sqlite`, separately from outline data. Changing the owner email, OAuth client ID or origin requires an explicit local reset of this authentication database while the daemon is stopped; preserve a backup before doing so. This signs out all Google browser sessions and permits the newly configured verified owner to enroll. Rotating only the OAuth client secret retains the binding. Local CLI recovery remains available.
