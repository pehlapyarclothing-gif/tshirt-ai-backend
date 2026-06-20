const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PROMPT_INSTRUCTIONS = `Streetwear graphic design layout for the brand "pehla pyar", premium oversized t-shirt print style, highly detailed graphic.`;

app.post('/api/tshirt-preview', async (req, res) => {
  try {
    const { customerImageUrl, referenceStyleUrl } = req.body;

    if (!customerImageUrl || !referenceStyleUrl) {
      return res.status(400).json({ success: false, error: 'Missing image parameters' });
    }

    // Using an instantly available open-architecture design generator model 
    const response = await fetch(
      "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
      {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({
          inputs: `${PROMPT_INSTRUCTIONS} Combine features from face source ${customerImageUrl} seamlessly into layout theme ${referenceStyleUrl}`
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Engine responded with status: ${response.status}`);
    }

    const blob = await response.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const base64Image = buffer.toString('base64');
    const aiImageUrl = `data:image/jpeg;base64,${base64Image}`;

    res.json({ success: true, aiImageUrl });

  } catch (error) {
    console.error('Generation Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running smoothly on port ${PORT}`);
});
