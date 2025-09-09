// chat2.js - Next/Vercel API route
// - Decodes incoming data URL, saves to /tmp
// - Optionally resizes/compresses (if sharp available)
// - Uploads to S3 (if AWS env vars present) and generates a presigned GET URL
// - Calls OpenAI Responses API with the public/presigned URL (not the inline data URL)
// - Returns the AI reply or helpful diagnostics
//
// Required environment variables for S3 flow:
// - OPENAI_API_KEY
// - AWS_ACCESS_KEY_ID
// - AWS_SECRET_ACCESS_KEY
// - AWS_REGION
// - AWS_S3_BUCKET
//
// If you don't want S3, the handler will still accept the image and attempt an inline call,
// but S3 is strongly recommended to avoid token explosion and policy/format issues.

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

export const config = {
  api: {
    bodyParser: { sizeLimit: "25mb" },
  },
};

function decodeDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

async function tryUploadToS3(buffer, contentType, key) {
  // lazily import AWS SDK v3 to avoid hard dependency if user doesn't have env vars
  const { S3Client, PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set");

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // you can set ACL: 'public-read' but it's better to use presigned URLs
    })
  );

  // create presigned GET URL valid for 1 hour
  const getCmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(s3Client, getCmd, { expiresIn: 3600 });
  return url;
}

async function callOpenAIWithImageUrl(imageUrl, userMessage = "Please analyze this image and describe what you see.") {
  const url = "https://api.openai.com/v1/responses";
  const body = {
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: userMessage },
          // send the public/presigned URL string (OpenAI expects a URL string for images)
          { type: "input_image", image_url: imageUrl }
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
  try {
    const json = JSON.parse(raw);
    if (!res.ok) {
      const err = new Error("OpenAI API error");
      err.details = json;
      throw err;
    }

    // Extract text reply
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
    return { success: true, reply: JSON.stringify(json).slice(0, 2000), raw: json };
  } catch (err) {
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

    if (!image && !message) return res.status(400).json({ error: "Message or image is required" });

    // If image present, decode & save
    if (image) {
      const decoded = decodeDataUrl(image);
      if (!decoded) return res.status(400).json({ success: false, error: "Invalid image data URL" });

      const ext = decoded.mime.split("/")[1] || "png";
      const filename = `area_${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
      const tmpPath = path.join("/tmp", filename);
      const buffer = Buffer.from(decoded.base64, "base64");
      await fs.promises.writeFile(tmpPath, buffer);
      console.log("Saved captured image:", tmpPath, "size bytes:", buffer.length);

      // If S3 env vars exist, upload and use presigned URL
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_REGION && process.env.AWS_S3_BUCKET) {
        try {
          const key = `assistai/${filename}`;
          const presignedUrl = await tryUploadToS3(buffer, decoded.mime, key);
          console.log("Uploaded to S3, presigned URL:", presignedUrl);

          // Build a clearer analysis prompt for better results
          const userPrompt = message || "Please analyze this screenshot. Describe visible UI elements, any text present (OCR), and summarize actions available. Return a short human-readable summary.";

          try {
            const aiResult = await callOpenAIWithImageUrl(presignedUrl, userPrompt);
            return res.status(200).json({
              success: true,
              saved: { file: tmpPath, bytes: buffer.length },
              reply: aiResult.reply,
              raw: aiResult.raw || null,
            });
          } catch (openAiErr) {
            console.error("OpenAI call failed after S3 upload:", openAiErr);
            const details = openAiErr?.details || openAiErr?.message || openAiErr?.raw || String(openAiErr);
            return res.status(502).json({
              success: false,
              message: "Image saved and uploaded, but OpenAI analysis failed",
              file: tmpPath,
              bytes: buffer.length,
              openai_error: details,
            });
          }
        } catch (s3Err) {
          console.error("S3 upload error:", s3Err);
          // Fall back to inline attempt if S3 fails
        }
      }

      // Fallback: try inline call (not recommended - may increase token usage)
      try {
        const prompt = message || "Please analyze this screenshot and describe what you see.";
        const aiResult = await callOpenAIWithImageUrl(image, prompt);
        return res.status(200).json({
          success: true,
          saved: { file: tmpPath, bytes: buffer.length },
          reply: aiResult.reply,
          raw: aiResult.raw || null,
        });
      } catch (err) {
        console.error("Inline OpenAI call failed:", err);
        const details = err?.details || err?.message || err?.raw || String(err);
        return res.status(502).json({
          success: false,
          message: "Image saved but OpenAI analysis failed (inline attempt)",
          file: tmpPath,
          bytes: buffer.length,
          openai_error: details,
          fallback: "Enable S3 env vars (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET) for robust handling."
        });
      }
    }

    // Text-only path
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

    return res.status(200).json({ success: true, reply: data.choices?.[0]?.message?.content || "No reply" });
  } catch (err) {
    console.error("Server error in chat2 handler:", err);
    return res.status(500).json({ error: "Something went wrong", details: String(err) });
  }
}
