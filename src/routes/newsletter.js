import { Router } from "express";

const router = Router();

router.post("/subscribe", async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || email.length > 254 || !emailPattern.test(email)) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    const database = req.app.locals.db;

    if (!database) {
      return res.status(503).json({
        message: "The database is temporarily unavailable.",
      });
    }

    const subscribers = database.collection("newsletter_subscribers");

    // Ensure each email address can only be subscribed once.
    await subscribers.createIndex({ email: 1 }, { unique: true });

    try {
      await subscribers.insertOne({
        email,
        subscribedAt: new Date(),
      });

      return res.status(201).json({
        message: "Thanks for subscribing to the Kindred newsletter!",
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(200).json({
          message: "This email is already subscribed. Thank you!",
        });
      }

      throw error;
    }
  } catch (error) {
    console.error("Newsletter subscription failed:", error.name);

    return res.status(500).json({
      message: "Unable to subscribe right now. Please try again later.",
    });
  }
});

export default router;