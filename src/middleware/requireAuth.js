
import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

export function createRequireAuth(
  baseURL = process.env.BETTER_AUTH_URL || "http://localhost:5000"
) {
  const authBaseURL = baseURL.replace(/\/+$/, "");

  const JWKS = createRemoteJWKSet(
    new URL(`${authBaseURL}/api/auth/jwks`)
  );

  return async function requireAuth(req, res, next) {
    const authorization = req.headers.authorization;

    if (
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        message: "Authentication token is missing.",
      });
    }

    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: authBaseURL,
        audience: authBaseURL,
        algorithms: ["EdDSA"],
      });

      if (
        typeof payload.sub !== "string" ||
        !payload.sub ||
        typeof payload.exp !== "number"
      ) {
        return res.status(401).json({
          message: "Invalid authentication token.",
        });
      }

      // Attach verified identity to the request.
      req.user = {
        id: payload.sub,
        email:
          typeof payload.email === "string"
            ? payload.email
            : undefined,
        name:
          typeof payload.name === "string"
            ? payload.name
            : undefined,
      };

      req.auth = payload;

      return next();
    } catch {
      return res.status(401).json({
        message: "Invalid or expired authentication token.",
      });
    }
  };
}
