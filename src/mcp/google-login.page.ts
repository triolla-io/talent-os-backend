export function renderGoogleLoginPage(opts: {
  loginSessionId: string;
  googleClientId: string;
  completeUrl: string;
}): string {
  const { loginSessionId, googleClientId, completeUrl } = opts;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Talent OS to Claude</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0b0c;color:#eee}
.card{padding:32px;border:1px solid #2a2a2e;border-radius:12px;max-width:360px;text-align:center}
button{font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#4f46e5;color:#fff;cursor:pointer}
#err{color:#f87171;margin-top:12px;min-height:1em}</style></head>
<body><div class="card">
<h2>Connect Talent OS</h2>
<p>Sign in with Google to let Claude access your recruiting data.</p>
<button id="signin">Sign in with Google</button>
<div id="err"></div>
</div>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<script>
const SESSION = ${JSON.stringify(loginSessionId)};
const COMPLETE = ${JSON.stringify(completeUrl)};
const CLIENT_ID = ${JSON.stringify(googleClientId)};
function fail(m){document.getElementById('err').textContent = m || 'Sign-in failed';}
document.getElementById('signin').addEventListener('click', () => {
  try {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'openid email profile',
      callback: async (resp) => {
        if (!resp || !resp.access_token) return fail('No access token from Google');
        try {
          const r = await fetch(COMPLETE, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loginSessionId: SESSION, access_token: resp.access_token }),
          });
          const data = await r.json();
          if (!r.ok || !data.redirect) return fail(data.message || 'Could not complete sign-in');
          window.location.href = data.redirect;
        } catch (e) { fail(String(e)); }
      },
    });
    client.requestAccessToken();
  } catch (e) { fail('Google Identity Services not loaded'); }
});
</script></body></html>`;
}
