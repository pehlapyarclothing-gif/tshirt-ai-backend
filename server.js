// server.js
//
// A small Express backend for creating AI-generated t-shirt previews from:
// 1) a customer-uploaded image URL
// 2) a reference style/template image URL
//
// SECURITY SETUP:
// - Never put your OpenAI API key in frontend code.
// - Keep it in a local .env file while developing.
// - In production, add it as a private environment variable in your host
//   dashboard, for example Render, Railway, Fly.io, Heroku, AWS, or Vercel.
//
// Example .env file:
// OPENAI_API_KEY=sk-your-real-key-here
// PORT=3000
// FRONTEND_ORIGIN=https://your-shopify-store.com
// ALLOWED_IMAGE_HOSTS=res.cloudinary.com,cdn.shopify.com

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { toFile } = require("openai/uploads");

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY. Add it to your .env file or hosting environment.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Allow your Shopify/frontend domain to call this backend.
// For local testing, leave FRONTEND_ORIGIN empty or set it to http://localhost:3000.
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || true,
  })
);

app.use(express.json({ limit: "1mb" }));

const PROMPT =
  "Apply the exact artistic style, colors, graphics, and layout from the reference design image onto the subject in the customer photo. Blend them to create a clean, high-contrast graphic t-shirt design with a transparent or opaque background, optimized for merchandise printing.";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB per input image.

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function assertAllowedImageHost(imageUrl) {
  const allowedHosts = (process.env.ALLOWED_IMAGE_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  // If ALLOWED_IMAGE_HOSTS is not set, any valid http/https image URL is allowed.
  // For production, set it to known hosts like: res.cloudinary.com,cdn.shopify.com
  if (allowedHosts.length === 0) return;

  const hostname = new URL(imageUrl).hostname.toLowerCase();
  if (!allowedHosts.includes(hostname)) {
    throw new Error(`Image host is not allowed: ${hostname}`);
  }
}

function extensionFromContentType(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

async function downloadImageAsOpenAIFile(imageUrl, fileBaseName) {
  if (!isValidHttpUrl(imageUrl)) {
    throw new Error(`Invalid image URL for ${fileBaseName}.`);
  }

  assertAllowedImageHost(imageUrl);

  const response = await fetch(imageUrl, {
    method: "GET",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Could not download ${fileBaseName}. HTTP ${response.status}`);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error(`${fileBaseName} must point directly to an image file.`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`${fileBaseName} is too large. Maximum size is 10 MB.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`${fileBaseName} is too large. Maximum size is 10 MB.`);
  }

  const extension = extensionFromContentType(contentType);
  const buffer = Buffer.from(arrayBuffer);

  return toFile(buffer, `${fileBaseName}.${extension}`, {
    type: contentType.split(";")[0],
  });
}

app.get("/health", (req, res) => {
  res.json({ success: true, status: "ok" });
});

app.post("/api/tshirt-preview", async (req, res) => {
  try {
    const { customerImageUrl, referenceStyleUrl } = req.body || {};

    if (!customerImageUrl || !referenceStyleUrl) {
      return res.status(400).json({
        success: false,
        error: "Please send both customerImageUrl and referenceStyleUrl.",
      });
    }

    // OpenAI image edits need actual image files/bytes, not just remote URLs.
    const [customerImage, referenceStyleImage] = await Promise.all([
      downloadImageAsOpenAIFile(customerImageUrl, "customer-image"),
      downloadImageAsOpenAIFile(referenceStyleUrl, "reference-style"),
    ]);

    // This calls POST /v1/images/edits.
    // The OpenAI Node SDK parameter is named `image`; passing an array sends
    // both images in one request so the model can use both references.
    const result = await openai.images.edit({
      model: "gpt-image-2",
      image: [customerImage, referenceStyleImage],
      prompt: PROMPT,
      size: "1024x1024",
      quality: "low",
    });

    const firstImage = result.data && result.data[0];
    const aiImageUrl =
      firstImage && firstImage.url
        ? firstImage.url
        : firstImage && firstImage.b64_json
          ? `data:image/png;base64,${firstImage.b64_json}`
          : null;

    if (!aiImageUrl) {
      throw new Error("OpenAI returned no image URL or base64 image data.");
    }

    return res.json({
      success: true,
      aiImageUrl,
    });
  } catch (error) {
    console.error("T-shirt preview generation failed:", error);

    return res.status(500).json({
      success: false,
      error: "AI image generation failed. Please try again.",
    });
  }
});

app.listen(port, () => {
  console.log(`T-shirt preview backend is running on port ${port}`);
});
