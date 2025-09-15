import formidable from "formidable";

export const config = {
  api: {
    bodyParser: false, // disable default JSON parser
  },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const form = formidable();
    const [fields, files] = await form.parse(req);

    const message = fields.message?.[0];
    const file = files.file?.[0];

    if (!message && !file) {
      return res.status(400).json({ error: "Message or file is required" });
    }

    let messages = [
      {
        role: "system",
        content:
          "You are an AI summarizer. Summarize the text we send you. If the text is too short to summarize, say it. Summarize simply but with enough detail, and include key points.",
      },
    ];

    if (message) {
      messages.push({ role: "user", content: message });
    }
    if (file) {
      // right now we’re not processing file contents, just acknowledging it
      messages.push({ role: "user", content: `File uploaded: ${file.originalFilename}` });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 1000,
      }),
    });

    const data = await response.json();

    res.status(200).json({
      reply: data.choices?.[0]?.message?.content || "No reply",
    });
  } catch (err) {
    console.error("Detailed summary backend error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
}
