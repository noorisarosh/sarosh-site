
// /api/summarize.js
export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      const response = await fetch("https://huggingface.co/spaces/Saroshasdsd/my-summarizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();
      res.status(200).json(data);
    } catch (error) {
      res.status(500).json({ error: "Summarizer backend failed" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
