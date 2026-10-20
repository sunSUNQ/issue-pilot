#!/usr/bin/env node
// pl-token: mint a GitHub App installation token and verify identity binding.
//
// Reads from env:
//   PL_APP_ID               pinned GitHub App id
//   PL_APP_INSTALLATION_ID  pinned installation id
//   PL_APP_KEY_PATH         path to the App private key PEM (read in-memory only)
//   PL_EXPECTED_BOT         optional: fail if minted token does not act as this bot login
//   PL_REPO_EXPECTED        optional: fail if installation does not cover this repo
//
// Writes one JSON object to stdout:
//   { appId, slug, installationId, account, bot, repos, expiresAt, token }
//
// The token/JWT values never appear on stderr and never in logs. Any binding
// failure exits 1 without emitting a token.
import fs from 'node:fs';
import crypto from 'node:crypto';

const API = 'https://api.github.com';

const SENTINEL = '__PL_TOKEN_FAIL__';

// Never call process.exit() after fetch: the win32 uv teardown race asserts and
// clobbers the exit code (observed in R16 T2.3a). Set exitCode and let Node
// drain naturally - undici idle sockets are unref'ed, so exit is prompt.
const fail = (message) => {
  console.error(`PL_TOKEN_FAIL ${message}`);
  process.exitCode = 1;
  throw SENTINEL;
};

async function api(url, auth, init) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${auth}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'issue-pilot-pl-token',
    },
    ...init,
  });
  const text = await res.text(); // always consume: no pending body handle on failure
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  return { status: res.status, json };
}

async function main() {
  const appId = String(process.env.PL_APP_ID ?? '');
  const installationId = String(process.env.PL_APP_INSTALLATION_ID ?? '');
  const pemPath = process.env.PL_APP_KEY_PATH ?? '';
  const expectedBot = process.env.PL_EXPECTED_BOT ?? '';
  const expectedRepo = process.env.PL_REPO_EXPECTED ?? '';

  if (!appId || !installationId || !pemPath) {
    fail('missing PL_APP_ID / PL_APP_INSTALLATION_ID / PL_APP_KEY_PATH');
  }

  let pem;
  try {
    pem = fs.readFileSync(pemPath, 'utf8'); // in-memory only
  } catch (error) {
    fail(`cannot read PL_APP_KEY_PATH: ${error.message}`);
  }

  const b64u = (buffer) => Buffer.from(buffer).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ iss: appId, iat: issuedAt - 30, exp: issuedAt + 480 }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const jwt = `${header}.${payload}.${b64u(signer.sign(pem))}`;

  const appRes = await api(`${API}/app`, jwt);
  if (appRes.status !== 200) fail(`GET /app -> ${appRes.status}`);
  const app = appRes.json;
  if (String(app.id) !== appId) fail(`app id mismatch: PEM signs app ${app.id}, pinned ${appId}`);

  const instRes = await api(`${API}/app/installations/${installationId}`, jwt);
  if (instRes.status !== 200) fail(`GET /app/installations/${installationId} -> ${instRes.status}`);
  const inst = instRes.json;
  if (String(inst.app_id) !== appId) fail(`installation ${installationId} belongs to app ${inst.app_id}, pinned ${appId}`);
  if (inst.suspended) fail(`installation ${installationId} is suspended`);

  const tokRes = await api(`${API}/app/installations/${installationId}/access_tokens`, jwt, {
    method: 'POST', body: '{}',
  });
  if (tokRes.status !== 201) fail(`POST /app/installations/${installationId}/access_tokens -> ${tokRes.status}`);
  const token = tokRes.json;

  const reposRes = await api(`${API}/installation/repositories?per_page=100`, token.token);
  if (reposRes.status !== 200) fail(`GET /installation/repositories -> ${reposRes.status}`);
  const repos = (reposRes.json.repositories ?? []).map((repo) => repo.full_name);
  if (expectedRepo && !repos.includes(expectedRepo)) fail(`installation does not cover ${expectedRepo}`);

  const gqlRes = await api(`${API}/graphql`, token.token, {
    method: 'POST', body: JSON.stringify({ query: 'query{viewer{login}}' }),
  });
  const bot = gqlRes.status === 200 && gqlRes.json.data ? gqlRes.json.data.viewer.login : '';
  if (!bot) fail(`viewer lookup failed (HTTP ${gqlRes.status})`);
  if (expectedBot && bot !== expectedBot) fail(`bot mismatch: token acts as ${bot}, expected ${expectedBot}`);

  process.stdout.write(JSON.stringify({
    appId: app.id,
    slug: app.slug,
    installationId: Number(installationId),
    account: inst.account?.login ?? '',
    bot,
    repos,
    expiresAt: token.expires_at,
    token: token.token,
  }));
}

try {
  await main();
} catch (error) {
  if (error !== SENTINEL) {
    console.error(`PL_TOKEN_FAIL ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
