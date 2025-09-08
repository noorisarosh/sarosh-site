import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory conversation store (temporary, resets on redeploy)
const conversations = new Map<string, { role: string; content: string }[]>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt, conversationId, metadata } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing API key" });
    }

    const newId = conversationId || uuidv4();
    const history = conversations.get(newId) || [];

    history.push({ role: "user", content: prompt });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: history,
    });

    const assistantText = completion.choices[0]?.message?.content || "";

    history.push({ role: "assistant", content: assistantText });
    conversations.set(newId, history);

    return res.status(200).json({ text: assistantText, conversationId: newId });
  } catch (err: any) {
    console.error("Chat error:", err);
    return res
      .status(500)
      .json({ error: "Failed to generate chat response", details: err.message });
  }
}

