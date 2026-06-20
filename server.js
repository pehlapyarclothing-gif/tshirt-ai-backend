const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const PROMPT_INSTRUCTIONS = `You are the elite Master Apparel Designer for the streetwear brand "pehla pyar". Your task is to generate a premium graphic design for an oversized t-shirt print by perfectly replicating the artistic style of the provided Reference Image.

CRITICAL DIRECTIVES FOR EXPERT EXECUTION:
1. ABSOLUTE STYLE REPLICATION: Analyze the Reference Image's exact medium (e.g., vintage halftone, high-contrast vector, grunge stencil, anime line art, retro typography, posterized screenprint texture). You must duplicate this exact visual medium perfectly. Do not alter the aesthetic category.
2. GRAPHIC LAYOUT & FRAMING: Maintain the identical structural layout, placement positioning, framing borders, background graphic elements, and typographic layout seen in the Reference Image. 
3. SUBJECT TRANSFORMATION: Extract the subject's facial features from the Customer Image and blend them seamlessly into the subject position of the Reference Image. The new subject must take on the exact color palette, shading style, line weight, and textural treatment of the original reference design.
4. FRONT-FACING COMPOSITION: The final output must be a clean, high-resolution, perfectly flat graphic design file optimized for direct garment printing (DTF/DTG). It must not be an image of a person wearing a t-shirt.
5. OVERSIZED STREETWEAR AESTHETIC: Ensure the final output matches the premium bold look of "pehla pyar" typography and oversized clothing graphics. No background noise outside of intended design elements.`;

app.post('/api/tshirt-preview', async (req, res) => {
  try {
    const { customerImageUrl, referenceStyleUrl } = req.body;

    if (!customerImageUrl || !referenceStyleUrl) {
      return res.status(400).json({ success: false, error: 'Missing image parameters' });
    }

    // Fixed configuration by removing the invalid response_format parameter
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: `${PROMPT_INSTRUCTIONS}\n\nCustomer uploaded face photo link to extract features from: ${customerImageUrl}\nReference design layout style image link to match exactly: ${referenceStyleUrl}`,
      n: 1,
      size: "1024x1024"
    });

    const aiImageUrl = response.data[0].url;
    res.json({ success: true, aiImageUrl });

  } catch (error) {
    console.error('OpenAI Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running smoothly on port ${PORT}`);
});
