import express from "express";
import cors from "cors";
import { main } from "./updatePdf.js";

const app = express();
const PORT = process.env.PORT || 3000;

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

// GET /webhook (To show a message when users visit in a browser)
app.get("/webhook", (req, res) => {
  res.status(200).json({
    success: true,
    status: "Webhook Ready",
    message: "Webhook endpoint is live! Send a POST request with data.",
  });
});

// POST /webhook (Handles webhook requests)
app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;

    // Check if payload is empty
    if (!payload || Object.keys(payload).length === 0) {
      return res.status(400).json({
        success: false,
        status: "Bad Request",
        message: "Empty webhook payload. Please provide valid data.",
      });
    }

    // Process the payload
    const data = await main(payload);

    // Successfully processed webhook
    res.status(200).json({
      success: true,
      status: "Success",
      message: "Webhook received and processed successfully.",
      processedData: data,
    });
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

//Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
