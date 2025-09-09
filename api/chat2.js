// Next.js / Vercel API route - chat2.js
// - increases bodyParser size limit so base64 images can be accepted
// - if an `image` (data URL) is included, decodes and saves it to /tmp and returns diagnostics
// - retains original text-only OpenAI chat flow behaviour
//
// NOTE: This version does NOT attempt to send the image to OpenAI yet — first confirm the upload path works.
// Next step after confirming: upload the saved file to a public URL or to OpenAI's file endpoint and send an appropriate
// image-aware request to the OpenAI responses/vision endpoint.

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

export const config = {
  api: {
    // Increase request size limit so base64 images can be posted
    bodyParser: {
      sizeLimit: "15mb", // adjust as needed (e.g., "25mb")
    },
  },
};

function decodeDataUrl(dataUrl) {
  // Expect "data:image/png;base64,...."
  const match = /^data:(.+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return {
    mime: match[1],
    base64: match[2],
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, image } = req.body;

    // If there's an image, attempt to decode and save it
    if (image) {
      const decoded = decodeDataUrl(image);

      if (!decoded) {
        return res.status(400).json({ error: "Invalid image data URL" });
      }

      // create a random filename
      const ext = decoded.mime.split("/")[1] || "png";
      const filename = `area_${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
      const tmpPath = path.join("/tmp", filename);

      // decode base64 and write to file
      const buffer = Buffer.from(decoded.base64, "base64");
      await fs.promises.writeFile(tmpPath, buffer);

      console.log("Saved captured image:", tmpPath, "size bytes:", buffer.length);

      // Return a diagnostic response so frontend can confirm success
      // Later: you can upload tmpPath to a public store (S3, etc.) or send to OpenAI's file endpoint
      return res.status(200).json({
        success: true,
        message: "Image received and saved on server",
        file: tmpPath,
        bytes: buffer.length,
      });
    }

    // No image — original text-only flow
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Call OpenAI text chat as before
    const payloadMessages = [
      { role: "system", content: "You are a helpful AI assistant." },
      { role: "user", content: message },
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: payloadMessages,
        max_tokens: 1000,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI error response:", data);
      return res.status(502).json({ error: "OpenAI API error", details: data });
    }

    res.status(200).json({
      reply: data.choices?.[0]?.message?.content || "No reply",
    });
  } catch (err) {
    console.error("Server error in chat2 handler:", err);
    res.status(500).json({ error: "Something went wrong", details: String(err) });
  }
}
