require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cloudinary = require("cloudinary"); // Fixed SDK import matching newer Node structures

const app = express();
const port = process.env.PORT || 10000;

// Correctly map your Render environment link to the Cloudinary engine instance
if (process.env.CLOUDINARY_URL) {
  cloudinary.config();
} else {
  console.warn("Warning: CLOUDINARY_URL missing in Environment Variables.");
}

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: "1mb" }));

app.post('/api/tshirt-preview', async (req, res) => {
  try {
    const { customerImageUrl, referenceStyleUrl } = req.body || {};

    if (!customerImageUrl || !referenceStyleUrl) {
      return res.status(400).json({ success: false, error: "Missing image links." });
    }

    // Creating a highly customized premium prompt instruction block
    const basePrompt = `Streetwear graphic design layout for the brand pehla pyar, premium bold oversized t-shirt print style. Clean vector graphic layout matching reference template link ${referenceStyleUrl}, placing customer features from portrait link ${customerImageUrl} seamlessly into the main subject area. High resolution print file, isolated on clean background.`;
    
    // Request a clean render instantly from the stable engine structure
    const encodedPrompt = encodeURIComponent(basePrompt);
    const generationUrl = `https://image.pollinations.ai/p/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;

    // FIXED LINE: Securely upload the free generation image straight into your permanent Cloudinary storage asset folder!
    const cloudinaryUpload = await cloudinary.v2.uploader.upload(generationUrl, {
      folder: "shopify_ai_previews",
      resource_type: "image"
    });

    return res.json({
      success: true,
      aiImageUrl: cloudinaryUpload.secure_url
    });

  } catch (error) {
    console.error("Preview setup failed:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`T-shirt preview engine running smoothly on port ${port}`);
});
