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
      return res.status(400).json({ error: "No text provided to analyze" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing API key" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are a helpful assistant that provides detailed, comprehensive analyses while maintaining clarity." 
        },
        { 
          role: "user", 
          content: `Analyze this text in detail, make sure I understand but don't oversimplify. Include all important details:\n\n${text}` 
        }
      ],
      max_tokens: 1000,
    });

    const summary = completion.choices[0]?.message?.content || "Unable to generate detailed analysis";

    return res.status(200).json({ 
      summary: summary,
      type: "detailed_summary"
    });

  } catch (err) {
    console.error("Detailed summary error:", err);
    return res.status(500).json({ 
      error: "Failed to generate detailed summary", 
      details: err.message 
    });
  }
}
