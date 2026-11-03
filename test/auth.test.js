import assert from "node:assert/strict";
import test from "node:test";
import { createAuth } from "../src/auth.js";
import { memoryAdapter } from "better-auth/adapters/memory";

const BASE_URL = "http://localhost:5000";
const TEST_EMAIL = "audit@example.invalid";
const TEST_PASSWORD = "Audit-Local-2026!";

function createMemoryAuth() {
  const previous = {
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    clientURL: process.env.CLIENT_URL,
    githubId: process.env.GITHUB_CLIENT_ID,
    githubSecret: process.env.GITHUB_CLIENT_SECRET,
  };

  process.env.BETTER_AUTH_SECRET =
    "isolated-unit-test-secret-with-more-than-32-characters";
  process.env.BETTER_AUTH_URL = BASE_URL;
  process.env.CLIENT_URL = "http://localhost:3000";
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;

  const authStore = Object.fromEntries(
    ["user", "session", "account", "verification", "jwks"].map((name) => [name, []])
  );
  const auth = createAuth(authStore, null, memoryAdapter);

  function restore() {
    const values = [
      ["BETTER_AUTH_SECRET", previous.secret],
      ["BETTER_AUTH_URL", previous.baseURL],
      ["CLIENT_URL", previous.clientURL],
      ["GITHUB_CLIENT_ID", previous.githubId],
      ["GITHUB_CLIENT_SECRET", previous.githubSecret],
    ];
    for (const [key, value] of values) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  return { auth, restore };
}

async function requestAuth(auth, path, { method = "GET", body, cookie } = {}) {
  const headers = new Headers();
  headers.set("origin", "http://localhost:3000");
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return auth.handler(new Request(`${BASE_URL}/api/auth${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

function sessionCookie(response) {
  const cookies = response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  const cookie = cookies
    .flatMap((header) => header.split(/,(?=[^;]+=)/))
    .map((header) => header.split(";")[0].trim())
    .find((header) => /session_token=/.test(header));
  assert.ok(cookie, "Better Auth should set a session cookie");
  return cookie;
}

test("email/password auth initializes without optional GitHub OAuth credentials", () => {
  const { auth, restore } = createMemoryAuth();
  try {
    assert.equal(typeof auth.handler, "function");
  } finally {
    restore();
  }
});

test("signup, session lookup, JWT issuance, logout, and relogin work in memory", async () => {
  const { auth, restore } = createMemoryAuth();
  try {
    const signup = await requestAuth(auth, "/sign-up/email", {
      method: "POST",
      body: { name: "Audit User", email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    assert.equal(signup.status, 200);
    const signupCookie = sessionCookie(signup);

    const signupSessionResponse = await requestAuth(auth, "/get-session", {
      cookie: signupCookie,
    });
    const signupSession = await signupSessionResponse.json();
    assert.equal(signupSession.user.email, TEST_EMAIL);

    const signout = await requestAuth(auth, "/sign-out", {
      method: "POST",
      cookie: signupCookie,
      body: {},
    });
    assert.equal(signout.status, 200);

    const signIn = await requestAuth(auth, "/sign-in/email", {
      method: "POST",
      body: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    assert.equal(signIn.status, 200);
    const loginCookie = sessionCookie(signIn);

    const tokenResponse = await requestAuth(auth, "/token", {
      cookie: loginCookie,
    });
    assert.equal(tokenResponse.status, 200);
    const tokenData = await tokenResponse.json();
    assert.equal(typeof tokenData.token, "string");
    assert.ok(tokenData.token.length > 20);

    const finalSignout = await requestAuth(auth, "/sign-out", {
      method: "POST",
      cookie: loginCookie,
      body: {},
    });
    assert.equal(finalSignout.status, 200);
  } finally {
    restore();
  }
});
