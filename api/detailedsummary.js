export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, image } = req.body;
    let messages = [{ role: "system", content: "You are an ai summarizer, summarize the text we send you and nothing else, if the text is too short to summarize, say it, summarize it simply but good, dont keep it too short, make sure they get all the details, give them the keypoints and what to get from this summary, ." }];

    if (image) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: message || "Analyze this image" },
          { type: "image_url", image_url: { url: image } }
        ]
      });
    } else if (message) {
      messages.push({ role: "user", content: message });
    } else {
      return res.status(400).json({ error: "Message or image is required" });
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
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
}
