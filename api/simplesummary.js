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
    const { text, conversationId } = req.body || {};
    
    if (!text) {
      return res.status(400).json({ error: "Missing text to summarize" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing API key" });
    }

    const newId = conversationId || uuidv4();
    const history = conversations.get(newId) || [];
    
    // Add system prompt for simple summarization
    const systemPrompt = "summarize this simply but make sure i understand and keep it short";
    const userPrompt = `${systemPrompt}\n\n${text}`;
    
    history.push({ role: "user", content: userPrompt });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant that provides clear, concise summaries. Keep your responses short and easy to understand." },
        ...history
      ],
      max_tokens: 500, // Limit for simple summaries
      temperature: 0.7,
    });

    const summary = completion.choices[0]?.message?.content || "Unable to generate summary";
    
    history.push({ role: "assistant", content: summary });
    conversations.set(newId, history);

    return res.status(200).json({ 
      summary: summary,
      conversationId: newId,
      type: "simple_summary"
    });

  } catch (err: any) {
    console.error("Simple summary error:", err);
    return res.status(500).json({ 
      error: "Failed to generate simple summary", 
      details: err.message 
    });
  }
}
