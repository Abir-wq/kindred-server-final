import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { ObjectId } from "mongodb";
import { createEventsRouter } from "../src/routes/events.js";

function createTestDatabase() {
  const storedEvents = [];
  const events = {
    async insertOne(document) {
      const stored = { _id: new ObjectId(), ...document };
      storedEvents.push(stored);
      return { insertedId: stored._id };
    },
    async findOne(query) {
      return storedEvents.find((event) =>
        event._id.equals(query._id)
      ) || null;
    },
  };

  const participants = {
    async find() {
      return { toArray: async () => [] };
    },
    async insertOne() {
      return { insertedId: new ObjectId() };
    },
    async deleteMany() {
      return { deletedCount: 0 };
    },
  };

  return {
    collection(name) {
      if (name === "events") return events;
      if (name === "eventParticipants") return participants;
      throw new Error(`Unexpected test collection: ${name}`);
    },
    storedEvents,
  };
}

async function withTestServer(handler, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/events", handler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}/api/events`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const validEvent = {
  title: "Community Garden Day",
  description:
    "Join neighbours to prepare the shared garden for the new season.",
  eventType: "Tree Planting",
  imageUrl: "https://example.com/garden.jpg",
  location: "Community Garden",
  eventDate: "2099-06-15T10:00:00.000Z",
};

test("authenticated user can create an event and server identity is authoritative", async () => {
  const database = createTestDatabase();
  const requireAuth = (req, res, next) => {
    req.user = {
      id: "test-user-1",
      name: "Audit User",
      email: "audit@example.invalid",
    };
    next();
  };
  const router = createEventsRouter({ database, requireAuth });

  await withTestServer(router, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validEvent,
        createdBy: { userId: "spoofed-user" },
      }),
    });
    const data = await response.json();

    assert.equal(response.status, 201);
    assert.equal(data.event.title, validEvent.title);
    assert.match(data.event.id, /^[a-f0-9]{24}$/i);
    assert.equal(data.event.createdBy.userId, "test-user-1");
    assert.equal(data.event.createdBy.email, "audit@example.invalid");
    assert.equal(database.storedEvents.length, 1);
  });
});

test("invalid event data is rejected without inserting a record", async () => {
  const database = createTestDatabase();
  const requireAuth = (req, res, next) => {
    req.user = { id: "test-user-1" };
    next();
  };
  const router = createEventsRouter({ database, requireAuth });

  await withTestServer(router, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validEvent, eventDate: "2000-01-01T00:00:00.000Z" }),
    });
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.match(data.message, /future/i);
    assert.equal(database.storedEvents.length, 0);
  });
});

test("event creation stays protected when the request is unauthenticated", async () => {
  const database = createTestDatabase();
  const requireAuth = (req, res) =>
    res.status(401).json({ message: "Authentication required." });
  const router = createEventsRouter({ database, requireAuth });

  await withTestServer(router, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validEvent),
    });

    assert.equal(response.status, 401);
    assert.equal(database.storedEvents.length, 0);
  });
});
