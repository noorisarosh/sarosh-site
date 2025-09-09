// Next.js / Vercel API route - chat2.js
// Accepts { message, image } where image is a data URL ("data:image/png;base64,...")
// Saves the image to /tmp, then attempts to call OpenAI Responses API to analyze the image.
// Returns JSON: { success: true, reply: "<ai text>" } on success, otherwise diagnostics.

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb", // allow larger images if needed
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
  // Using the OpenAI Responses API with an input that contains both text and an inline image data URL.
  // NOTE: The exact image support depends on your OpenAI model/access. If this call fails with an
  // error that images aren't allowed, you should upload the image to public storage and pass a public URL.
  const url = "https://api.openai.com/v1/responses";
  const body = {
    model: process.env.OPENAI_MODEL || "gpt-4o-mini", // adjust model if needed
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: userMessage },
          // Some OpenAI SDKs expect "input_image" or "image_url" shapes. We send this shape which many
          // newer Responses API examples accept. If you get validation errors, see fallback notes below.
          { type: "input_image", image_url: { url: dataUrl } }
        ]
      }
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

  const text = await res.text();
  // try to parse JSON, return parsed object or throw
  try {
    const json = JSON.parse(text);
    if (!res.ok) {
      const err = new Error("OpenAI API error");
      err.details = json;
      throw err;
    }
    // Responses API may return a top-level "output" or "result" object. Try common shapes:
    // - json.output_text or json.output[0].content[0].text  (varies)
    // We'll attempt to extract a plain text reply robustly:
    // 1) If there's a top-level `output_text` property, use it.
    if (json.output_text) return { success: true, reply: json.output_text, raw: json };
    // 2) If there is `output` with array, try to concatenate any text content
    if (Array.isArray(json.output)) {
      let collected = "";
      for (const item of json.output) {
        if (typeof item === "string") collected += item + "\n";
        if (item?.content && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text" && c.text) collected += c.text + "\n";
            if (c.type === "message" && c.text) collected += c.text + "\n";
            if (c.type === "text" && c.text) collected += c.text + "\n";
          }
        }
      }
      if (collected.trim()) return { success: true, reply: collected.trim(), raw: json };
    }
    // 3) Legacy responses shape: `json.choices[0].message.content`
    if (json?.choices?.[0]?.message?.content) {
      return { success: true, reply: json.choices[0].message.content, raw: json };
    }
    // fallback: return raw json as string
    return { success: true, reply: JSON.stringify(json).slice(0, 2000), raw: json };
  } catch (err) {
    // include raw text if JSON.parse failed
    throw new Error(`OpenAI response parse error: ${err.message}. Raw: ${text}`);
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

      // Attempt to call OpenAI to analyze the inline image
      try {
        const aiResult = await callOpenAIWithImage(image, message || "Please analyze this image and describe it.");
        // Return successful analysis
        return res.status(200).json({
          success: true,
          saved: { file: tmpPath, bytes: buffer.length },
          reply: aiResult.reply,
          raw: aiResult.raw || null
        });
      } catch (openAiErr) {
        console.error("OpenAI call failed:", openAiErr);
        // Return saved file diagnostics and the OpenAI error details
        return res.status(502).json({
          success: false,
          message: "Image saved but OpenAI analysis failed",
          file: tmpPath,
          bytes: buffer.length,
          openai_error: openAiErr?.details || openAiErr?.message || String(openAiErr)
        });
      }
    }

    // If no image, handle text-only flow (existing behavior)
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Text-only chat: use Chat Completions (legacy) or Responses API for text-only
    // For simplicity we'll call the chat completions endpoint as before:
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
