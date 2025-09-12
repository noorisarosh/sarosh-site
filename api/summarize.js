// /api/summarize.js (Vercel serverless function)
// Deploy this file to Vercel in your project under /api/summarize.js
// Configure HF_SPACE_URL below to your Hugging Face Space endpoint if different.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // If your Hugging Face Space is named Saroshasdsd/my-summarizer, the public URL usually follows:
  // https://Saroshasdsd-my-summarizer.hf.space
  // and your app.py exposes /summarize, so final URL:
  const HF_SPACE_URL = process.env.HF_SPACE_URL || "https://Saroshasdsd-my-summarizer.hf.space/summarize";

  try {
    // Expecting { text: "..." } in the body
    const body = req.body && Object.keys(req.body).length ? req.body : await new Promise(r => {
      let data = "";
      req.on("data", chunk => data += chunk);
      req.on("end", () => r(JSON.parse(data || "{}")));
    });

    const hfResponse = await fetch(HF_SPACE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body.text }),
      // you can add timeout or other options here
    });

    const text = await hfResponse.text();
    // If HF returned non-JSON (e.g., errors), return details
    if (!hfResponse.ok) {
      let details = text;
      try { details = JSON.parse(text); } catch (e) {}
      res.status(502).json({ error: "HuggingFace space request failed", details });
      return;
    }

    // parse JSON success response
    let data;
    try { data = JSON.parse(text); } catch (err) { data = { summary: text }; }

    // Relay the HF space response to client
    res.status(200).json(data);
  } catch (error) {
    console.error("summarize.js error:", error);
    res.status(500).json({ error: "Summarizer backend failed", details: String(error) });
  }
}
