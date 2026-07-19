import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

const REPLICATE_API_KEY = process.env.REPLICATE_API_KEY; 
const REPLICATE_ENDPOINT = "https://api.replicate.com/v1/predictions";
const FACE_SWAP_MODEL = "9a4298548422074c3f57258c5d544497314ae4112df80d116f0d2109e843d20d"; 

app.use(cors());
app.use(express.json());

app.post("/api/tshirt-preview", async (req, res) => {
  const { customerImageUrl, referenceStyleUrl, customerName } = req.body; 

  if (!customerImageUrl) {
    return res.status(400).json({ error: "Missing customerImageUrl." });
  }

  const targetDesignImage = referenceStyleUrl || "https://res.cloudinary.com/dugxzgkvy/image/upload/v1783858281/1000113069_l18mfk.png";

  // --- ROUTE 1: THE "ONLY YOU" DYNAMIC DESIGN ---
  if (targetDesignImage.includes("file_00000000cc487206952731e65f4f1c9c_1_nytg4a")) {
    console.log("Processing ONLY YOU structured layout via Cloudinary...");
    
    const safeName = encodeURIComponent((customerName || "YOU").toUpperCase().trim());
    
    const uploadPath = customerImageUrl.includes("/upload/") 
        ? customerImageUrl.split("/upload/")[1] 
        : customerImageUrl;
    const layerPath = uploadPath.replace(/\//g, ':');

  // 1. Force the image into a short 550px slice (h_550) to physically delete the mustache.
    // 2. Shift the clean eye-band UP by 60 pixels (y_-60) so it rests dead center in the transparent window.
    const cloudinaryCompositeUrl = `https://res.cloudinary.com/dugxzgkvy/image/upload/u_${layerPath}/w_1080,h_550,c_fill,g_face,z_2.0,e_grayscale/fl_layer_apply,g_center,y_-60/l_text:Arial_70_bold:${safeName},co_black/fl_layer_apply,g_south_east,x_100,y_155/file_00000000cc487206952731e65f4f1c9c_1_nytg4a`;

    console.log(`Structured Page Layout Complete: ${cloudinaryCompositeUrl}`);
    return res.json({ aiImageUrl: cloudinaryCompositeUrl });
  }

  // --- ROUTE 2: STANDARD AI FACE SWAP ---
  try {
    console.log(`Starting AI face swap for user image: ${customerImageUrl}`);

    const startResponse = await fetch(REPLICATE_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${REPLICATE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: FACE_SWAP_MODEL,
        input: {
          target_image: targetDesignImage, 
          swap_image: customerImageUrl     
        }
      })
    });

    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      throw new Error(`Replicate API Error: ${errorText}`);
    }

    let replicateData = await startResponse.json();
    const checkStatusUrl = replicateData.urls.get;
    let status = replicateData.status;

    console.log("AI is processing face swap. Waiting for completion...");

    while (status !== "succeeded" && status !== "failed") {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const pollResponse = await fetch(checkStatusUrl, {
        headers: {
          "Authorization": `Bearer ${REPLICATE_API_KEY}`,
          "Content-Type": "application/json"
        }
      });
      replicateData = await pollResponse.json();
      status = replicateData.status;
    }

    if (status === "failed") throw new Error("Face swap failed.");
    
    const outputUrl = Array.isArray(replicateData.output) ? replicateData.output[0] : replicateData.output;
    console.log(`Generation complete. AI Image URL: ${outputUrl}`);
    
    res.json({ aiImageUrl: outputUrl });

  } catch (error) {
    console.error("AI Generation Error:", error.message);
    res.status(500).json({ error: error.message || "An unexpected error occurred." });
  }
});

app.listen(PORT, () => {
  console.log(`Final Customizer Server running on port ${PORT}`);
});
