import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import { toNodeHandler } from "better-auth/node";
import { createAuth } from "./auth.js";
import { createRequireAuth } from "./middleware/requireAuth.js";
import {
  createEventsRouter,
  ensureEventIndexes,
} from "./routes/events.js";
import newsletterRoutes from "./routes/newsletter.js";

const app = express();

const PORT = Number(process.env.PORT || 5000);
const CLIENT_URL = (
  process.env.CLIENT_URL || "http://localhost:3000"
).replace(/\/+$/, "");

let initialization;
let mongoClient;

app.disable("x-powered-by");

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

async function initializeApi() {
  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DB || "kindred";

  if (!uri) {
    throw new Error("MONGODB_URI is missing.");
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 15000,
  });

  try {
    console.log("Connecting to MongoDB...");
    await client.connect();

    const database = client.db(databaseName);
    await database.command({ ping: 1 });

    console.log("MongoDB connected successfully.");

    const auth = createAuth(database, client);
    const requireAuth = createRequireAuth();

    await ensureEventIndexes(database);

    const api = express();
    api.disable("x-powered-by");

    api.locals.db = database;
    api.locals.auth = auth;

    // Better Auth handles its own request bodies.
    api.all("/api/auth/*splat", toNodeHandler(auth));

    // JSON parsing comes after the authentication handler.
    api.use(express.json({ limit: "1mb" }));

    api.use("/api/newsletter", newsletterRoutes);

    api.use(
      "/api/events",
      createEventsRouter({
        database,
        requireAuth,
      })
    );

    api.get("/", (req, res) => {
      res.json({ message: "Kindred API is running" });
    });

    api.get("/api/health", async (req, res) => {
      res.set("Cache-Control", "no-store");

      try {
        await database.command({ ping: 1 });

        res.json({
          status: "ok",
          service: "Kindred API",
          database: "connected",
        });
      } catch (error) {
        console.error("Database health check failed:", error.name);

        res.status(503).json({
          status: "error",
          service: "Kindred API",
          database: "unavailable",
        });
      }
    });

    api.get("/api/me", requireAuth, (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ user: req.user });
    });

    api.use((req, res) => {
      res.status(404).json({
        message: "API route not found",
      });
    });

    api.use((error, req, res, next) => {
      if (res.headersSent) {
        return next(error);
      }

      const status =
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status < 500
          ? error.status
          : 500;

      console.error("Request failed:", error.name);

      res.status(status).json({
        message:
          status === 400
            ? "Invalid request. Check the JSON you submitted."
            : status === 413
              ? "Request is too large."
              : "Unable to process the request.",
      });
    });

    mongoClient = client;
    console.log("Better Auth initialized successfully.");

    return api;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

function getApi() {
  if (!initialization) {
    initialization = initializeApi().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }

  return initialization;
}

// Every request waits until database and routes are ready.
// Concurrent requests share the same initialization promise.
app.use(async (req, res, next) => {
  let api;

  try {
    api = await getApi();
  } catch (error) {
    console.error("API initialization failed:", {
      name: error.name,
      code: error.code || "none",
    });

    return res.status(503).json({
      message:
        "Backend initialization failed. Check server logs and environment settings.",
    });
  }

  return api(req, res, next);
});

// Vercel imports this application to handle requests.
export default app;

// Local development starts a normal HTTP server.
if (!process.env.VERCEL) {
  getApi()
    .then(() => {
      const server = app.listen(PORT, "0.0.0.0", () => {
        console.log(`Kindred API running at http://localhost:${PORT}`);
      });

      server.on("error", async (error) => {
        console.error("HTTP server failed:", error.code || error.name);
        await mongoClient?.close().catch(() => {});
        process.exitCode = 1;
      });
    })
    .catch((error) => {
      console.error("Server startup failed:", {
        name: error.name,
        code: error.code || "none",
      });

      process.exitCode = 1;
    });
}