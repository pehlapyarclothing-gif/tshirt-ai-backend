/**
 * server.js — T-Shirt AI Preview Backend (GPT-4 Vision + DALL-E 3)
 * ─────────────────────────────────────────────────────────────────────────
 * Flow:
 *   1. Receive customerImageUrl + referenceStyleUrl + tshirtColor + regenerateNote
 *   2. GPT-4 Vision READS both images visually → produces a rich style description
 *   3. DALL-E 3 GENERATES a new design using that rich description
 *   4. Upload result to Cloudinary permanently
 *   5. Return { success, aiImageUrl, styleDescription } to storefront
 *
 * Environment variables:
 *   OPENAI_API_KEY  — your OpenAI secret key
 *   CLOUDINARY_URL  — cloudinary://<api_key>:<api_secret>@<cloud_name>
 *   PORT            — optional, defaults to 10000
 */
 
import express from "express";
import cors    from "cors";
import OpenAI  from "openai";
 
/* ─── Boot: parse Cloudinary credentials ───────────────────────────────── */
 
function parseCloudinaryUrl(url) {
  if (!url) throw new Error("CLOUDINARY_URL environment variable is not set.");
  const match = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  if (!match) throw new Error(
    "CLOUDINARY_URL is malformed. Expected: cloudinary://API_KEY:API_SECRET@CLOUD_NAME"
  );
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
 
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
 
/* ─── Express setup ─────────────────────────────────────────────────────── */
 
const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
 
app.get("/", (_req, res) =>
  res.json({ status: "ok", service: "tshirt-preview-v2", model: "gpt-4o + dall-e-3" })
);
 
/* ─── STEP 1: GPT-4 Vision analyses both images ─────────────────────────── */
 
async function analyseImagesWithVision(customerImageUrl, referenceStyleUrl, requestId) {
  console.log(`[${requestId}] GPT-4 Vision analysing both images...`);
 
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1200,
    messages: [
      {
        role: "system",
        content: `You are a senior streetwear graphic designer and creative director.
Your job is to analyse two images and write a precise, detailed design brief
that a text-to-image AI (DALL-E 3) can use to generate an accurate result.
Be extremely specific about colors, layout, typography style, graphic elements,
mood, texture, and composition. Output ONLY the design brief — no preamble, no explanation.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyse these two images carefully and produce a detailed design brief:
 
IMAGE 1 — Customer uploaded image (extract: main subject, colors, mood, shapes, any text):`,
          },
          {
            type:      "image_url",
            image_url: { url: customerImageUrl, detail: "high" },
          },
          {
            type: "text",
            text: `IMAGE 2 — Brand reference design (extract: layout structure, typography style, graphic hierarchy, color palette, background treatment, placement of elements, overall vibe):`,
          },
          {
            type:      "image_url",
            image_url: { url: referenceStyleUrl, detail: "high" },
          },
          {
            type: "text",
            text: `Now write a DALL-E 3 image generation prompt that:
1. Uses the customer image main subject/motif as the HERO graphic element
2. Replicates the reference design EXACT layout, typography style, color palette, and composition
3. The result should look like it genuinely belongs to the same brand as the reference
4. Specify: background color, text placement, graphic position, border/frame style if any, texture
5. End with: "Flat lay product photo of a [COLOR] t-shirt showing this graphic design. Studio lighting, clean background."
 
Write the prompt now:`,
          },
        ],
      },
    ],
  });
 
  const styleDescription = response.choices[0]?.message?.content?.trim();
  if (!styleDescription) throw new Error("GPT-4 Vision returned empty analysis.");
 
  console.log(`[${requestId}] Vision analysis complete (${styleDescription.length} chars)`);
  return styleDescription;
}
 
/* ─── STEP 2: DALL-E 3 generates the design ─────────────────────────────── */
 
async function generateDesignWithDalle(styleDescription, tshirtColor, regenerateNote, requestId) {
  console.log(`[${requestId}] DALL-E 3 generating design...`);
 
  const colorInstruction = tshirtColor
    ? `The t-shirt color is ${tshirtColor}.`
    : "The t-shirt is white.";
 
  const regenInstruction = regenerateNote
    ? `Customer feedback for this regeneration: "${regenerateNote}". Adjust accordingly.`
    : "";
 
  const finalPrompt = `${styleDescription}
 
${colorInstruction} ${regenInstruction}
 
Important: This must look like a real wearable garment graphic — print-ready quality,
centered composition, no background clutter. Photorealistic t-shirt mockup.`;
 
  const imageResponse = await openai.images.generate({
    model:           "dall-e-2",
    prompt:          finalPrompt,
    n:               1,
    size:            "1024x1024",
    quality:         "hd",
  });
 
  const dalleUrl = imageResponse.data?.[0]?.url ?? imageResponse.data?.[0]?.b64_json;
  if (!dalleUrl) throw new Error("DALL-E 3 returned no image URL.");
 
  console.log(`[${requestId}] DALL-E 3 image generated`);
  return dalleUrl;
}
 
/* ─── STEP 3: Upload to Cloudinary permanently ───────────────────────────── */
 
async function uploadToCloudinary(dalleUrl, requestId) {
  console.log(`[${requestId}] Uploading to Cloudinary...`);
 
  const credentials = Buffer.from(
    `${cloudinary.apiKey}:${cloudinary.apiSecret}`
  ).toString("base64");
 
  const formData = new FormData();
  formData.append("file",      dalleUrl);
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
 
  const { customerImageUrl, referenceStyleUrl, tshirtColor, regenerateNote } = req.body || {};
 
  if (!customerImageUrl || typeof customerImageUrl !== "string") {
    return res.status(400).json({ success: false, error: "Missing customerImageUrl" });
  }
  if (!referenceStyleUrl || typeof referenceStyleUrl !== "string") {
    return res.status(400).json({ success: false, error: "Missing referenceStyleUrl" });
  }
 
  console.log(`[${requestId}] tshirtColor: ${tshirtColor || "not specified"}`);
  console.log(`[${requestId}] regenNote  : ${regenerateNote || "none"}`);
 
  try {
    const styleDescription = await analyseImagesWithVision(
      customerImageUrl, referenceStyleUrl, requestId
    );
 
    const dalleUrl = await generateDesignWithDalle(
      styleDescription, tshirtColor, regenerateNote, requestId
    );
 
    const aiImageUrl = await uploadToCloudinary(dalleUrl, requestId);
 
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
 
