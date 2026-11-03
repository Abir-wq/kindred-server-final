
import express from "express";
import { ObjectId } from "mongodb";

export const EVENT_TYPES = [
  "Tree Planting",
  "Community Cleanup",
  "Food Donation",
  "Clothing Distribution",
  "Education",
  "Other",
];

export async function ensureEventIndexes(database) {
  const events = database.collection("events");
  const participants = database.collection("eventParticipants");

  await events.createIndexes([
    {
      key: { eventDate: 1 },
      name: "events_by_date",
    },
    {
      key: {
        "createdBy.userId": 1,
        eventDate: 1,
      },
      name: "events_by_creator_date",
    },
  ]);

  await participants.createIndexes([
    {
      key: {
        eventId: 1,
        userId: 1,
      },
      name: "unique_event_participant",
      unique: true,
    },
    {
      key: {
        userId: 1,
        joinedAt: -1,
      },
      name: "participants_by_user_date",
    },
  ]);
}

function serializeEvent(document) {
  const { _id, ...event } = document;

  return {
    id: _id.toString(),
    ...event,
    eventDate: event.eventDate.toISOString(),
  };
}

function getEventId(value) {
  if (
    typeof value !== "string" ||
    !/^[a-fA-F0-9]{24}$/.test(value)
  ) {
    return null;
  }

  return new ObjectId(value);
}

function validateEventInput(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return {
      error: "A valid event object is required.",
    };
  }

  const title =
    typeof body.title === "string"
      ? body.title.trim()
      : "";

  const description =
    typeof body.description === "string"
      ? body.description.trim()
      : "";

  const eventType =
    typeof body.eventType === "string"
      ? body.eventType.trim()
      : "";

  const imageUrl =
    typeof body.imageUrl === "string"
      ? body.imageUrl.trim()
      : "";

  const location =
    typeof body.location === "string"
      ? body.location.trim()
      : "";

  if (title.length < 5 || title.length > 120) {
    return {
      error: "Title must contain between 5 and 120 characters.",
    };
  }

  if (
    description.length < 20 ||
    description.length > 3000
  ) {
    return {
      error: "Description must contain between 20 and 3000 characters.",
    };
  }

  if (!EVENT_TYPES.includes(eventType)) {
    return {
      error: "Please select a valid event type.",
    };
  }

  if (!imageUrl || imageUrl.length > 2048) {
    return {
      error: "A valid event image URL is required.",
    };
  }

  try {
    const parsedURL = new URL(imageUrl);

    if (
      parsedURL.protocol !== "http:" &&
      parsedURL.protocol !== "https:"
    ) {
      return {
        error: "Event images must use HTTP or HTTPS URLs.",
      };
    }
  } catch {
    return {
      error: "Please provide a valid image URL.",
    };
  }

  if (location.length < 2 || location.length > 200) {
    return {
      error: "Location must contain between 2 and 200 characters.",
    };
  }

  if (
    typeof body.eventDate !== "string" ||
    !body.eventDate.trim()
  ) {
    return {
      error: "A valid future event date is required.",
    };
  }

  const eventDate = new Date(body.eventDate);

  if (
    Number.isNaN(eventDate.getTime()) ||
    eventDate <= new Date()
  ) {
    return {
      error: "Event date must be in the future.",
    };
  }

  return {
    data: {
      title,
      description,
      eventType,
      imageUrl,
      location,
      eventDate,
    },
  };
}

export function createEventsRouter({
  database,
  requireAuth,
}) {
  const router = express.Router();

  const events = database.collection("events");
  const participants =
    database.collection("eventParticipants");

  // PUBLIC: Six upcoming events for the homepage.
  router.get("/featured", async (req, res) => {
    const documents = await events
      .find({
        eventDate: {
          $gt: new Date(),
        },
      })
      .sort({ eventDate: 1 })
      .limit(6)
      .toArray();

    res.json({
      events: documents.map(serializeEvent),
    });
  });

  // PROTECTED: Events created by the authenticated user.
  router.get("/mine", requireAuth, async (req, res) => {
    const documents = await events
      .find({
        "createdBy.userId": req.user.id,
      })
      .sort({ eventDate: 1 })
      .toArray();

    res.json({
      events: documents.map(serializeEvent),
    });
  });

  // PROTECTED: Events joined by the authenticated user.
  router.get("/joined", requireAuth, async (req, res) => {
    const joinedRecords = await participants
      .find({
        userId: req.user.id,
      })
      .toArray();

    if (joinedRecords.length === 0) {
      return res.json({
        events: [],
      });
    }

    const eventIds = joinedRecords.map(
      (record) => record.eventId
    );

    const documents = await events
      .find({
        _id: {
          $in: eventIds,
        },
      })
      .sort({ eventDate: 1 })
      .toArray();

    res.json({
      events: documents.map(serializeEvent),
    });
  });

  // PUBLIC: All future events, with a bounded result limit.
  router.get("/", async (req, res) => {
    const requestedLimit = req.query.limit;

    let limit = 50;

    if (requestedLimit !== undefined) {
      if (
        typeof requestedLimit !== "string" ||
        !/^\d+$/.test(requestedLimit)
      ) {
        return res.status(400).json({
          message: "Limit must be a positive whole number.",
        });
      }

      limit = Number(requestedLimit);

      if (limit < 1 || limit > 100) {
        return res.status(400).json({
          message: "Limit must be between 1 and 100.",
        });
      }
    }

    const documents = await events
      .find({
        eventDate: {
          $gt: new Date(),
        },
      })
      .sort({ eventDate: 1 })
      .limit(limit)
      .toArray();

    res.json({
      events: documents.map(serializeEvent),
    });
  });

  // PROTECTED: Create an event.
  router.post("/", requireAuth, async (req, res) => {
    const validation = validateEventInput(req.body);

    if (validation.error) {
      return res.status(400).json({
        message: validation.error,
      });
    }

    const now = new Date();

    const newEvent = {
      ...validation.data,

      // Creator identity comes from the verified JWT,
      // never from the request body.
      createdBy: {
        userId: req.user.id,
        name: req.user.name || "Kindred member",
        email: req.user.email || null,
      },

      createdAt: now,
      updatedAt: now,
    };

    const result = await events.insertOne(newEvent);

    const createdEvent = await events.findOne({
      _id: result.insertedId,
    });

    res.status(201).json({
      message: "Event created successfully.",
      event: serializeEvent(createdEvent),
    });
  });

  // PUBLIC: Retrieve an event by ID.
  router.get("/:id", async (req, res) => {
    const eventId = getEventId(req.params.id);

    if (!eventId) {
      return res.status(400).json({
        message: "Invalid event ID.",
      });
    }

    const document = await events.findOne({
      _id: eventId,
    });

    if (!document) {
      return res.status(404).json({
        message: "Event not found.",
      });
    }

    res.json({
      event: serializeEvent(document),
    });
  });

  // PROTECTED: Join a future event.
  router.post(
    "/:id/join",
    requireAuth,
    async (req, res) => {
      const eventId = getEventId(req.params.id);

      if (!eventId) {
        return res.status(400).json({
          message: "Invalid event ID.",
        });
      }

      const event = await events.findOne({
        _id: eventId,
      });

      if (!event) {
        return res.status(404).json({
          message: "Event not found.",
        });
      }

      if (event.eventDate <= new Date()) {
        return res.status(400).json({
          message: "You cannot join an event that has already started or passed.",
        });
      }

      try {
        await participants.insertOne({
          eventId,
          userId: req.user.id,
          userEmail: req.user.email || null,
          userName: req.user.name || "Kindred member",
          joinedAt: new Date(),
        });

        res.status(201).json({
          message: "You have successfully joined this event.",
        });
      } catch (error) {
        if (error.code === 11000) {
          return res.status(409).json({
            message: "You have already joined this event.",
          });
        }

        throw error;
      }
    }
  );

  // PROTECTED: Update an event owned by the current user.
  // The request must contain all event fields.
  router.patch(
    "/:id",
    requireAuth,
    async (req, res) => {
      const eventId = getEventId(req.params.id);

      if (!eventId) {
        return res.status(400).json({
          message: "Invalid event ID.",
        });
      }

      const validation = validateEventInput(req.body);

      if (validation.error) {
        return res.status(400).json({
          message: validation.error,
        });
      }

      const ownedEvent = await events.findOne({
        _id: eventId,
        "createdBy.userId": req.user.id,
      });

      if (!ownedEvent) {
        return res.status(404).json({
          message: "Event not found or you do not own this event.",
        });
      }

      await events.updateOne(
        { _id: eventId },
        {
          $set: {
            ...validation.data,
            updatedAt: new Date(),
          },
        }
      );

      const updatedEvent = await events.findOne({
        _id: eventId,
      });

      res.json({
        message: "Event updated successfully.",
        event: serializeEvent(updatedEvent),
      });
    }
  );

  // PROTECTED: Delete an event owned by the current user.
  router.delete(
    "/:id",
    requireAuth,
    async (req, res) => {
      const eventId = getEventId(req.params.id);

      if (!eventId) {
        return res.status(400).json({
          message: "Invalid event ID.",
        });
      }

      const result = await events.deleteOne({
        _id: eventId,
        "createdBy.userId": req.user.id,
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          message: "Event not found or you do not own this event.",
        });
      }

      // Remove participation records belonging to the deleted event.
      await participants.deleteMany({
        eventId,
      });

      res.json({
        message: "Event deleted successfully.",
      });
    }
  );

  return router;
}
