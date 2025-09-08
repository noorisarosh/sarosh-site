import express from "express";
import multer from "multer";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import OpenAI from "openai";

// Create app
const app = express();
const upload = multer();
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: "*" })); // Allow all origins (Chrome extension friendly)

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory conversation store (for demo only; replace with DB if needed)
const conversations = new Map<string, { role: string; content: string }[]>();

/**
 * POST /api/chat
 * Body: { prompt, conversationId?, metadata? }
 * Returns: { text, conversationId }
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { prompt, conversationId, metadata } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "Backend missing API key" });

    const newId = conversationId || uuidv4();
    const history = conversations.get(newId) || [];

    history.push({ role: "user", content: prompt });

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // lightweight multimodal model
      messages: history,
    });

    const assistantText = completion.choices[0]?.message?.content || "";

    history.push({ role: "assistant", content: assistantText });
    conversations.set(newId, history);

    return res.json({ text: assistantText, conversationId: newId });
  } catch (err: any) {
    console.error("Chat error:", err);
    return res
      .status(500)
      .json({ error: "Failed to generate chat response", details: err.message });
  }
});

/**
 * POST /api/vision
 * FormData: { image, prompt?, conversationId? }
 * Returns: { text, conversationId }
 */
app.post("/api/vision", upload.single("image"), async (req, res) => {
  try {
    const { prompt, conversationId } = req.body || {};
    if (!req.file) return res.status(400).json({ error: "Missing image" });
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "Backend missing API key" });

    const newId = conversationId || uuidv4();

    // Convert uploaded file to base64
    const base64Image = req.file.buffer.toString("base64");
    const dataUrl = `data:${req.file.mimetype};base64,${base64Image}`;

    // Call OpenAI vision
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful study assistant." },
        {
          role: "user",
          content: [
            { type: "text", text: prompt || "Analyze this image for study help" },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const assistantText = completion.choices[0]?.message?.content || "";

    return res.json({ text: assistantText, conversationId: newId });
  } catch (err: any) {
    console.error("Vision error:", err);
    return res
      .status(500)
      .json({ error: "Failed to analyze image", details: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`StudyAI backend running on http://localhost:${port}`)
);
