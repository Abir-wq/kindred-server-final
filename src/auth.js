import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { jwt } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";

export function createAuth(database, client, adapterFactory) {
  const secret = process.env.BETTER_AUTH_SECRET;

  const baseURL = (
    process.env.BETTER_AUTH_URL || "http://localhost:5000"
  ).replace(/\/+$/, "");

  const clientURL = (
    process.env.CLIENT_URL || "http://localhost:3000"
  ).replace(/\/+$/, "");

  if (!secret || secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must contain at least 32 characters."
    );
  }

  const githubClientId = process.env.GITHUB_CLIENT_ID?.trim();
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();

  const socialProviders = {};

  if (githubClientId && githubClientSecret) {
    socialProviders.github = {
      clientId: githubClientId,
      clientSecret: githubClientSecret,
      scope: ["user:email"],
    };
  } else if (githubClientId || githubClientSecret) {
    console.warn(
      "GitHub sign-in is disabled because both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required."
    );
  }

  const isHttps = new URL(baseURL).protocol === "https:";

  return betterAuth({
    appName: "Kindred",
    baseURL,
    secret,

    trustedOrigins: [clientURL],

    advanced: {
      defaultCookieAttributes: {
        sameSite: isHttps ? "none" : "lax",
        secure: isHttps,
        httpOnly: true,
      },
    },

    database: adapterFactory
      ? adapterFactory(database)
      : mongodbAdapter(database, { client }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 6,
      maxPasswordLength: 128,
    },

    socialProviders,

    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: false,

        // Kindred does not verify emails during registration.
        requireLocalEmailVerified: false,

        // Still require the OAuth provider to verify its email.
        trustedProviders: [],
        allowDifferentEmails: false,
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") {
          return;
        }

        const password = ctx.body?.password;

        if (
          typeof password !== "string" ||
          password.length < 6 ||
          password.length > 128 ||
          !/[a-z]/.test(password) ||
          !/[A-Z]/.test(password)
        ) {
          throw new APIError("BAD_REQUEST", {
            message:
              "Password must contain at least 6 characters, including one uppercase and one lowercase letter.",
          });
        }
      }),
    },

    plugins: [jwt()],
  });
}