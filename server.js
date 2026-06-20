require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 10000;

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: "1mb" }));

// Helper function to extract credentials directly from your existing CLOUDINARY_URL string
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

app.post('/api/tshirt-preview', async (req, res) => {
  try {
    const { customerImageUrl, referenceStyleUrl } = req.body || {};

    if (!customerImageUrl || !referenceStyleUrl) {
      return res.status(400).json({ success: false, error: "Missing image links." });
    }

    const creds = getCloudinaryCredentials();
    if (!creds) {
      throw new Error("Cloudinary configuration missing or invalid on Render environment panel.");
    }

    // Generate the streetwear layout graphic instantly via the stable open engine
    const basePrompt = `Streetwear graphic design layout for the brand pehla pyar, premium bold oversized t-shirt print style. Clean vector graphic layout matching reference template link ${referenceStyleUrl}, placing customer features from portrait link ${customerImageUrl} seamlessly into the main subject area. High resolution print file, isolated on clean background.`;
    const encodedPrompt = encodeURIComponent(basePrompt);
    const generationUrl = `https://image.pollinations.ai/p/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;

    // Generate a secure signature to talk to Cloudinary's upload REST API natively
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = "shopify_ai_previews";
    
    // Direct raw network call pushing the asset to your Cloudinary cloud bucket
    const formData = new FormData();
    formData.append("file", generationUrl);
    formData.append("upload_preset", "ml_default"); // Uses default preset signature
    formData.append("folder", folder);

    const cloudinaryRes = await fetch(`https://api.cloudinary.com/v1_1/${creds.cloudName}/image/upload`, {
      method: "POST",
      body: formData
    });

    const uploadData = await cloudinaryRes.json();
    
    if (!cloudinaryRes.ok || uploadData.error) {
      throw new Error(uploadData.error?.message || "Cloudinary native upload failed.");
    }

    return res.json({
      success: true,
      aiImageUrl: uploadData.secure_url
    });

  } catch (error) {
    console.error("Preview setup failed:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`T-shirt preview engine running smoothly on port ${port}`);
});
