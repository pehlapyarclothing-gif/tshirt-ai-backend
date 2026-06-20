require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 10000;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: "1mb" }));

// Decodes the credentials dynamically from your Render dashboard variable
function getCloudinaryCredentials() {
  const url = process.env.CLOUDINARY_URL || "";
  if (!url.startsWith("cloudinary://")) return null;
  
  try {
    const clearStr = url.replace("cloudinary://", "");
    const [auth, cloudName] = clearStr.split("@");
    const [apiKey, apiSecret] = auth.split(":");
    return { apiKey, apiSecret, cloudName };
  } catch (e) {
    console.error("Failed to parse CLOUDINARY_URL:", e);
    return null;
  }
}

app.get("/health", (req, res) => {
  res.json({ success: true, status: "ok" });
});

app.post('/api/tshirt-preview', async (req, res) => {
  try {
    const { customerImageUrl, referenceStyleUrl } = req.body || {};

    if (!customerImageUrl || !referenceStyleUrl) {
      return res.status(400).json({ success: false, error: "Please send both customerImageUrl and referenceStyleUrl." });
    }

    const creds = getCloudinaryCredentials();
    if (!creds) {
      throw new Error("Cloudinary configuration missing or invalid on Render environment panel.");
    }

    // Streetwear formatting prompt to maintain the bold "pehla pyar" look
    const basePrompt = `Streetwear graphic design layout for the brand pehla pyar, premium bold oversized t-shirt print style. Clean vector graphic layout matching reference template link ${referenceStyleUrl}, placing customer features from portrait link ${customerImageUrl} seamlessly into the main subject area. High resolution print file, isolated on clean background.`;
    const encodedPrompt = encodeURIComponent(basePrompt);
    const generationUrl = `https://image.pollinations.ai/p/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;

    // Build native multi-part form payload to deliver directly to Cloudinary's secure REST endpoint
    const formData = new FormData();
    formData.append("file", generationUrl);
    formData.append("upload_preset", "ml_default"); 
    formData.append("folder", "shopify_ai_previews");

    const cloudinaryRes = await fetch(`https://api.cloudinary.com/v1_1/${creds.cloudName}/image/upload`, {
      method: "POST",
      body: formData
    });

    const uploadData = await cloudinaryRes.json();
    
    if (!cloudinaryRes.ok || uploadData.error) {
      throw new Error(uploadData.error?.message || "Cloudinary native upload failed.");
    }

    // Returns the clean, secure asset path back to Shopify's preview layer
    return res.json({
      success: true,
      aiImageUrl: uploadData.secure_url
    });

  } catch (error) {
    console.error("T-shirt preview generation failed:", error);
    return res.status(500).json({ success: false, error: "AI image generation failed. Please try again." });
  }
});

app.listen(port, () => {
  console.log(`T-shirt preview backend running smoothly on port ${port}`);
});
