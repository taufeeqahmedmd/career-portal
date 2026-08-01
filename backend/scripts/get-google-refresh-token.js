// One-time helper: mints a Google OAuth refresh token for Drive resume uploads.
//
// Setup (Google Cloud Console, same project as the Drive API):
//   1. "APIs & Services" -> "OAuth consent screen": configure it (Internal if
//      Workspace, otherwise External + add your Google account as a test user).
//   2. "Credentials" -> "Create credentials" -> "OAuth client ID" -> type
//      "Desktop app". Copy the client ID and secret.
//   3. Run:  node scripts/get-google-refresh-token.js <CLIENT_ID> <CLIENT_SECRET>
//   4. Sign in as the Google account that should own the uploaded resumes,
//      then paste the printed values into backend/.env.

const http = require('http');
const { google } = require('googleapis');

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Usage: node scripts/get-google-refresh-token.js <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}`;
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('Waiting for Google sign-in...');
    return;
  }
  res.end('Done! You can close this tab and return to the terminal.');
  server.close();
  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      console.error('\nNo refresh token returned. Remove prior access for this app at');
      console.error('https://myaccount.google.com/permissions and run this script again.');
      process.exit(1);
    }
    console.log('\nAdd these lines to backend/.env:\n');
    console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    process.exit(0);
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('Open this URL in your browser and sign in:\n');
  console.log(authUrl);
  console.log('\nListening for the redirect on ' + redirectUri + ' ...');
});
