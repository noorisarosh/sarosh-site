import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "Missing text to summarize" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing API key" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // ✅ Use a real model
      messages: [
        { 
          role: "system", 
          content: "You are a helpful assistant that provides clear, concise summaries. Keep your responses short and easy to understand." 
        },
        { 
          role: "user", 
          content: `Summarize this text simply but make sure I understand and keep it short:\n\n${text}` 
        }
      ],
      max_tokens: 500,
    });

    const summary = completion.choices[0]?.message?.content || "Unable to generate summary";

    return res.status(200).json({ 
      summary: summary,
      type: "simple_summary"
    });

  } catch (err) {
    console.error("Simple summary error:", err);
    return res.status(500).json({ 
      error: "Failed to generate simple summary", 
      details: err.message 
    });
  }
}
