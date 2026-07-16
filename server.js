/**
 * server.js — T-Shirt AI Preview Backend (GPT-4 Vision + Stability AI)
 */

import express from "express";
import cors    from "cors";
import OpenAI  from "openai";

/* ─── Boot ────────────────────────────────────────────────────────────── */

function parseCloudinaryUrl(url) {
  if (!url) throw new Error("CLOUDINARY_URL is not set.");
  const match = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  if (!match) throw new Error("CLOUDINARY_URL is malformed.");
  return { apiKey: match[1], apiSecret: match[2], cloudName: match[3] };
}

let cloudinary;
try {
  cloudinary = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
  console.log(`[Boot] Cloudinary ready — cloud: ${cloudinary.cloudName}`);
} catch (err) {
  console.error("[Boot] FATAL —", err.message);
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error("[Boot] FATAL — OPENAI_API_KEY is not set.");
  process.exit(1);
}

if (!process.env.STABILITY_API_KEY) {
  console.error("[Boot] FATAL — STABILITY_API_KEY is not set.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/", (_req, res) => res.json({ status: "ok", service: "tshirt-preview-v3", model: "gpt-4o + stability-inpaint" }));

/* ─── STEP 1: GPT-4 Vision analyses ONLY the customer image ─────────────── */

async function analyseCustomerImage(customerImageUrl, requestId) {
  console.log(`[${requestId}] GPT-4 Vision analysing subject...`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 300,
    messages: [
      {
        role: "system",
        content: `You are an expert image analyst. Look at the photo and describe ONLY the main subject in a highly detailed, concise phrase. Focus on the physical subject, colors, and pose. Do not mention the background.`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Describe the main subject:` },
          { type: "image_url", image_url: { url: customerImageUrl, detail: "low" } },
        ],
      },
    ],
  });

  const subjectDescription = response.choices[0]?.message?.content?.trim();
  if (!subjectDescription) throw new Error("GPT-4 Vision returned empty analysis.");
  return subjectDescription;
}

/* ─── STEP 2: Stability AI generates the design via Inpainting ──────────── */

async function generateDesignWithStability(subjectDescription, referenceStyleUrl, maskUrl, regenerateNote, requestId) {
  console.log(`[${requestId}] Fetching reference and mask images...`);
  
  // Download reference and mask to attach to the multipart form
  const [imageRes, maskRes] = await Promise.all([
     fetch(referenceStyleUrl),
     fetch(maskUrl)
  ]);
  
  if (!imageRes.ok || !maskRes.ok) throw new Error("Failed to fetch reference or mask image URLs.");

  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
  const maskBuffer = Buffer.from(await maskRes.arrayBuffer());
  
  let finalPrompt = `${subjectDescription}. High quality, professional lighting, centered.`;
  if (regenerateNote) {
     finalPrompt += ` Customer modification request: "${regenerateNote}".`;
  }

  console.log(`[${requestId}] Requesting Stability AI Inpaint API...`);

  const formData = new FormData();
  formData.append("image", new Blob([imageBuffer]), "image.png");
  formData.append("mask", new Blob([maskBuffer]), "mask.png");
  formData.append("prompt", finalPrompt);
  formData.append("output_format", "jpeg");
  
  const response = await fetch("https://api.stability.ai/v2beta/stable-image/edit/inpaint", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
      Accept: "image/*"
    },
    body: formData,
  });

  if (!response.ok) {
     const errorText = await response.text();
     throw new Error(`Stability AI Error (${response.status}): ${errorText}`);
  }

  // Returns arrayBuffer of the generated image
  const resultBuffer = Buffer.from(await response.arrayBuffer());
  return resultBuffer;
}

/* ─── STEP 3: Upload to Cloudinary permanently ───────────────────────────── */

async function uploadToCloudinary(imageBuffer, requestId) {
  console.log(`[${requestId}] Uploading generated image to Cloudinary...`);

  const credentials = Buffer.from(`${cloudinary.apiKey}:${cloudinary.apiSecret}`).toString("base64");
  
  // Convert buffer to Base64 Data URI for simple REST upload
  const base64DataUri = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

  const formData = new FormData();
  formData.append("file",      base64DataUri);
  formData.append("folder",    "tshirt-previews");
  formData.append("public_id", `preview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  formData.append("overwrite", "false");

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/image/upload`,
    {
      method:  "POST",
      headers: { Authorization: `Basic ${credentials}` },
      body:    formData,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Cloudinary upload failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  if (!data.secure_url) throw new Error("Cloudinary returned no secure_url.");

  console.log(`[${requestId}] Permanently stored: ${data.secure_url}`);
  return data.secure_url;
}

/* ─── Main endpoint ─────────────────────────────────────────────────────── */

app.post("/api/tshirt-preview", async (req, res) => {
  const requestId = `req_${Date.now()}`;
  console.log(`\n[${requestId}] New preview request`);

  const { customerImageUrl, referenceStyleUrl, maskUrl, regenerateNote } = req.body || {};

  if (!customerImageUrl || !referenceStyleUrl || !maskUrl) {
    return res.status(400).json({ success: false, error: "Missing required image URLs." });
  }

  console.log(`[${requestId}] regenNote: ${regenerateNote || "none"}`);

  try {
    const styleDescription = await analyseCustomerImage(customerImageUrl, requestId);
    const resultBuffer = await generateDesignWithStability(styleDescription, referenceStyleUrl, maskUrl, regenerateNote, requestId);
    const aiImageUrl = await uploadToCloudinary(resultBuffer, requestId);

    console.log(`[${requestId}] Complete — sending response\n`);
    return res.json({ success: true, aiImageUrl, styleDescription });

  } catch (err) {
    console.error(`[${requestId}] Error:`, err.message);
    return res.status(502).json({ success: false, error: err.message || "Internal server error" });
  }
});

app.use((err, _req, res, _next) => {
  console.error("[UnhandledError]", err);
  res.status(500).json({ success: false, error: "Internal server error." });
});

const PORT = parseInt(process.env.PORT || "10000", 10);
app.listen(PORT, () => {
  console.log(`[Boot] Server running on port ${PORT}`);
  console.log(`[Boot] POST /api/tshirt-preview — ready`);
});
