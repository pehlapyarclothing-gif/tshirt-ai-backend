// ============================================
// BACKEND: server.js
// ============================================

const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();

// ── Middleware ──────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Environment Validation ──────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CLOUDINARY_URL = process.env.CLOUDINARY_URL;

if (!OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY is not set in environment variables.');
  process.exit(1);
}

if (!CLOUDINARY_URL) {
  console.error('FATAL: CLOUDINARY_URL is not set in environment variables.');
  console.error('Expected format: cloudinary://<api_key>:<api_secret>@<cloud_name>');
  process.exit(1);
}

// ── Parse CLOUDINARY_URL ─────────────────────
// Expected format: cloudinary://api_key:api_secret@cloud_name
let cloudinaryConfig;
try {
  const parsed = new URL(CLOUDINARY_URL);
  cloudinaryConfig = {
    cloudName: parsed.host,
    apiKey: parsed.username,
    apiSecret: parsed.password,
  };
  
  if (!cloudinaryConfig.cloudName || !cloudinaryConfig.apiKey || !cloudinaryConfig.apiSecret) {
    throw new Error('Incomplete Cloudinary credentials in URL');
  }
} catch (err) {
  console.error('FATAL: Invalid CLOUDINARY_URL format.', err.message);
  console.error('Expected: cloudinary://api_key:api_secret@cloud_name');
  process.exit(1);
}

// ── OpenAI Client ────────────────────────────
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// ── Helper: Upload image buffer to Cloudinary via native fetch ──
async function uploadToCloudinary(imageBuffer, publicIdPrefix = 'ai-preview') {
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `${publicIdPrefix}-${timestamp}-${Math.random().toString(36).substring(2, 10)}`;
  
  // Generate signature for Cloudinary upload
  const crypto = require('crypto');
  const signatureString = `public_id=${publicId}&timestamp=${timestamp}${cloudinaryConfig.apiSecret}`;
  const signature = crypto.createHash('sha1').update(signatureString).digest('hex');

  // Build multipart/form-data using native FormData (Node 18+)
  const formData = new FormData();
  formData.append('file', new Blob([imageBuffer], { type: 'image/png' }), 'generated-design.png');
  formData.append('api_key', cloudinaryConfig.apiKey);
  formData.append('timestamp', timestamp.toString());
  formData.append('public_id', publicId);
  formData.append('signature', signature);

  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`;

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudinary upload failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  
  if (!data.secure_url) {
    throw new Error('Cloudinary response missing secure_url');
  }

  return data.secure_url;
}

// ── Helper: Fetch image from URL to buffer ──
async function fetchImageBuffer(imageUrl) {
  const response = await fetch(imageUrl, { timeout: 30000 });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch image from URL (${response.status}): ${imageUrl}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── POST /api/tshirt-preview ────────────────
app.post('/api/tshirt-preview', async (req, res) => {
  const requestId = Math.random().toString(36).substring(2, 10).toUpperCase();
  const startTime = Date.now();
  
  console.log(`[${requestId}] Incoming request to /api/tshirt-preview`);
  
  try {
    // 1. Validate request body
    const { customerImageUrl, referenceStyleUrl } = req.body;
    
    if (!customerImageUrl || typeof customerImageUrl !== 'string') {
      console.warn(`[${requestId}] Missing or invalid customerImageUrl`);
      return res.status(400).json({
        success: false,
        error: 'Missing required field: customerImageUrl (string)',
      });
    }
    
    if (!referenceStyleUrl || typeof referenceStyleUrl !== 'string') {
      console.warn(`[${requestId}] Missing or invalid referenceStyleUrl`);
      return res.status(400).json({
        success: false,
        error: 'Missing required field: referenceStyleUrl (string)',
      });
    }

    // Basic URL validation
    try {
      new URL(customerImageUrl);
      new URL(referenceStyleUrl);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format provided for image URLs',
      });
    }

    console.log(`[${requestId}] customerImageUrl: ${customerImageUrl}`);
    console.log(`[${requestId}] referenceStyleUrl: ${referenceStyleUrl}`);

    // 2. Construct dynamic prompt for DALL-E 3
    // Injecting URLs as text context so DALL-E 3 can analyze them
    const prompt = `Create a premium streetwear graphic t-shirt design layout. 

Analyze the visual features, colors, composition, and subject matter from the customer reference image: ${customerImageUrl}

Then, mimic the layout structure, typography placement, artistic vibe, and overall design aesthetic from the reference style template: ${referenceStyleUrl}

Generate a high-quality, print-ready t-shirt design that blends the customer's visual content with the reference layout style. The design should be centered, suitable for direct-to-garment printing, and have a clean transparent or solid background depending on the reference style. Output as a single high-resolution square image.`;

    console.log(`[${requestId}] Calling DALL-E 3 with constructed prompt...`);

    // 3. Call DALL-E 3 generation API
    const dalleResponse = await openai.images.generate({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1, // DALL-E 3 only supports n=1
      size: '1024x1024',
      quality: 'standard',
      response_format: 'url',
    });

    const temporaryImageUrl = dalleResponse.data[0]?.url;
    
    if (!temporaryImageUrl) {
      throw new Error('DALL-E 3 response did not contain a generated image URL');
    }

    console.log(`[${requestId}] DALL-E 3 returned temporary URL: ${temporaryImageUrl}`);

    // 4. Fetch the temporary image and upload to Cloudinary for permanent storage
    console.log(`[${requestId}] Fetching temporary image from OpenAI...`);
    const imageBuffer = await fetchImageBuffer(temporaryImageUrl);
    
    console.log(`[${requestId}] Uploading to Cloudinary (${cloudinaryConfig.cloudName})...`);
    const permanentCloudinaryUrl = await uploadToCloudinary(imageBuffer, 'tshirt-ai-preview');
    
    const duration = Date.now() - startTime;
    console.log(`[${requestId}] Success! Cloudinary URL: ${permanentCloudinaryUrl} (${duration}ms)`);

    // 5. Return clean JSON response to storefront
    return res.status(200).json({
      success: true,
      aiImageUrl: permanentCloudinaryUrl,
      meta: {
        requestId,
        durationMs: duration,
      },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${requestId}] Error after ${duration}ms:`, error.message);
    
    // Determine appropriate status code
    let statusCode = 500;
    if (error.message.includes('Invalid URL')) statusCode = 400;
    if (error.message.includes('content policy')) statusCode = 400;
    if (error.message.includes('billing')) statusCode = 402;

    return res.status(statusCode).json({
      success: false,
      error: error.message || 'Internal server error during image generation',
      requestId,
    });
  }
});

// ── Health Check ────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    cloudinaryConfigured: !!cloudinaryConfig.cloudName,
  });
});

// ── Global Error Handlers ───────────────────
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  // Keep process alive for Render, but log critically
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// ── Start Server ────────────────────────────
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     T-Shirt AI Preview Server — Ready for Production       ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Port:        ${PORT.toString().padEnd(47)} ║`);
  console.log(`║  Cloudinary:  ${cloudinaryConfig.cloudName.padEnd(47)} ║`);
  console.log(`║  Endpoint:    /api/tshirt-preview (POST)                   ║`);
  console.log(`║  Health:      /health (GET)                                ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
});

module.exports = app; // For testing
