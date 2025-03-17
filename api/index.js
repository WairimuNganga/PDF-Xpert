import express from "express";
import cors from "cors";
import { main } from "../functions/updatePdf.js";

const app = express();
const API_KEY = process.env.WEBHOOK_API_KEY;

app.use(cors());
app.use(express.json());

// Middleware for Authentication
app.use((req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({
      success: false,
      status: "Unauthorized",
      message: "Invalid API key. Please provide a valid Bearer token.",
    });
  }
  next();
});

// GET /webhook (For testing)
app.get("/webhook", (req, res) => {
  res.status(200).json({
    success: true,
    status: "Webhook Ready",
    message: "Webhook endpoint is live! Send a POST request with data.",
  });
});

// POST /webhook (Non-blocking processing)
app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || Object.keys(payload).length === 0) {
      return res.status(400).json({
        success: false,
        status: "Bad Request",
        message: "Empty webhook payload. Please provide valid data.",
      });
    }

    // Immediately acknowledge the webhook to prevent Vercel timeouts
    res.status(202).json({
      success: true,
      status: "Accepted",
      message: "Webhook received. Processing in the background.",
    });

    //Process in the background to avoid Vercel execution limits
    setTimeout(async () => {
      try {
        console.log("🚀 Processing webhook payload:", payload);
        await main(payload);
        console.log("✅ Processing complete");
      } catch (error) {
        console.error("❌ Background processing error:", error);
      }
    }, 0);

  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).json({
      success: false,
      status: "Internal Server Error",
      message: "An unexpected error occurred while processing the webhook.",
      errorDetails: error.message,
    });
  }
});

export default app;