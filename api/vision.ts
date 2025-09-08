
import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const config = {
  api: {
    bodyParser: false, // we'll manually parse form-data
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const busboy = await import("busboy"); // dynamic import for form-data
    const bb = busboy.default({ headers: req.headers });

    let prompt = "Analyze this image for study help";
    let conversationId: string | undefined;
    let fileBuffer: Buffer | null = null;
    let fileType = "image/png";

    await new Promise<void>((resolve, reject) => {
      bb.on("file", (name, file, info) => {
        fileType = info.mimeType;
        const chunks: Buffer[] = [];
        file.on("data", (chunk) => chunks.push(chunk));
        file.on("end", () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      bb.on("field", (name, val) => {
        if (name === "prompt") prompt = val;
        if (name === "conversationId") conversationId = val;
      });

      bb.on("finish", () => resolve());
      bb.on("error", reject);

      req.pipe(bb as any);
    });

    if (!fileBuffer) return res.status(400).json({ error: "Missing image" });

    const base64Image = fileBuffer.toString("base64");
    const dataUrl = `data:${fileType};base64,${base64Image}`;
    const newId = conversationId || uuidv4();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful study assistant." },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    const assistantText = completion.choices[0]?.message?.content || "";

    return res.status(200).json({ text: assistantText, conversationId: newId });
  } catch (err: any) {
    console.error("Vision error:", err);
    return res
      .status(500)
      .json({ error: "Failed to analyze image", details: err.message });
  }
}
