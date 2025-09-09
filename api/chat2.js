// Next.js / Vercel API route - chat2.js
// Accepts { message, image } where image is a data URL ("data:image/png;base64,...")
// Saves the image to /tmp, then attempts to call OpenAI Responses API to analyze the image.
// If OpenAI rejects the inline image type, returns a clear diagnostic with recommendation to upload the file
// to public storage and resend with a public URL.

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

function decodeDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return {
    mime: match[1],
    base64: match[2],
  };
}

async function callOpenAIWithImage(dataUrl, userMessage = "Please analyze this image and describe what you see.") {
  // Send the image_url as a string (OpenAI expects a URL string, not an object).
  const url = "https://api.openai.com/v1/responses";
  const body = {
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: userMessage },
          // IMPORTANT: image_url must be a string (the URL). We're passing the full data URL string here.
          { type: "input_image", image_url: dataUrl }
        ],
      },
    ],
    max_output_tokens: 1000,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();

  // Try parse JSON
  try {
    const json = JSON.parse(raw);
    if (!res.ok) {
      const err = new Error("OpenAI API error");
      err.details = json;
      throw err;
    }

    // Try to extract text reply in a few common shapes
    if (json.output_text) return { success: true, reply: json.output_text, raw: json };
    if (Array.isArray(json.output)) {
      let collected = "";
      for (const item of json.output) {
        if (typeof item === "string") collected += item + "\n";
        if (item?.content && Array.isArray(item.content)) {
          for (const c of item.content) {
            if ((c.type === "output_text" || c.type === "text" || c.type === "message") && c.text) collected += c.text + "\n";
          }
        }
      }
      if (collected.trim()) return { success: true, reply: collected.trim(), raw: json };
    }
    if (json?.choices?.[0]?.message?.content) {
      return { success: true, reply: json.choices[0].message.content, raw: json };
    }

    // If we can't extract text, return raw JSON truncated
    return { success: true, reply: JSON.stringify(json).slice(0, 2000), raw: json };
  } catch (err) {
    // Include Raw body for debugging
    err.raw = raw;
    throw err;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, image } = req.body;

    // If there's an image data URL, decode and save it
    if (image) {
      const decoded = decodeDataUrl(image);
      if (!decoded) {
        return res.status(400).json({ success: false, error: "Invalid image data URL" });
      }

      const ext = decoded.mime.split("/")[1] || "png";
      const filename = `area_${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
      const tmpPath = path.join("/tmp", filename);
      const buffer = Buffer.from(decoded.base64, "base64");
      await fs.promises.writeFile(tmpPath, buffer);

      console.log("Saved captured image:", tmpPath, "size bytes:", buffer.length);

      // Attempt to call OpenAI to analyze the inline image (image_url as a string)
      try {
        const aiResult = await callOpenAIWithImage(image, message || "Please analyze this image and describe it.");
        return res.status(200).json({
          success: true,
          saved: { file: tmpPath, bytes: buffer.length },
          reply: aiResult.reply,
          raw: aiResult.raw || null
        });
      } catch (openAiErr) {
        console.error("OpenAI call failed:", openAiErr);

        // Detect the "invalid_type" style error that indicates OpenAI expected an actual URL or doesn't accept the inline data URL
        const details = openAiErr?.details || openAiErr?.message || openAiErr?.raw || String(openAiErr);

        // Provide a helpful fallback message describing next steps
        const fallbackAdvice = [
          "OpenAI rejected the inline data URL. Some OpenAI models/APIs expect a publicly-accessible image URL rather than a data: URI.",
          "Recommended fallback: upload the saved file to a public URL (S3, Cloudflare R2, or similar) and then call the Responses API with that public URL (replace the data URL with the public URL string).",
          "If you want, I can provide code to upload to S3/R2 (requires bucket credentials)."
        ].join(" ");

        return res.status(502).json({
          success: false,
          message: "Image saved but OpenAI analysis failed",
          file: tmpPath,
          bytes: buffer.length,
          openai_error: details,
          fallback: fallbackAdvice
        });
      }
    }

    // Text-only flow
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

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
        model: process.env.OPENAI_MODEL || "gpt-4o",
        messages: payloadMessages,
        max_tokens: 1000,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI chat error:", data);
      return res.status(502).json({ error: "OpenAI API error", details: data });
    }

    return res.status(200).json({
      success: true,
      reply: data.choices?.[0]?.message?.content || "No reply"
    });
  } catch (err) {
    console.error("Server error in chat2 handler:", err);
    return res.status(500).json({ error: "Something went wrong", details: String(err) });
  }
}
