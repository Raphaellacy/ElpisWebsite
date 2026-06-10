import { PinataSDK } from "pinata";

const pinata = new PinataSDK({ 
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
});

export default async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  
  try {
    // Handle File Upload (Multipart Form Data)
    const formData = await event.formData();
    const file = formData.get('manuscript');
    const title = formData.get('title') || 'Untitled';
    const language = formData.get('language') || 'English';
    const email = formData.get('email') || 'unknown';

    if (!file) {
      return { statusCode: 400, body: JSON.stringify({ error: "No file uploaded" }) };
    }

    // ✅ CHECK FILE SIZE (50MB Limit)
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB in bytes
    if (file.size > MAX_SIZE) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: "File too large. Maximum size is 50MB." }) 
      };
    }

    // Convert file to Buffer for Pinata
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create a unique filename
    const fileName = `Insight_${title.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.${file.name.split('.').pop()}`;

    // Upload to Pinata PRIVATE GROUP
    const upload = await pinata.upload.file(buffer, {
      metadata: {
        name: fileName,
        keyvalues: {
          type: "insight-analysis", // ✅ TAG FOR SEPARATION
          authorEmail: email,
          language: language,
          status: "pending-analysis"
        }
      },
      // ✅ EXPLICITLY USE THE PRIVATE GROUP ID FROM NETLIFY
      groupId: process.env.PINATA_PRIVATE_GROUP_ID 
    });

    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        hash: upload.IpfsHash, 
        message: "Stored securely for analysis",
        fileName: fileName
      }) 
    };

  } catch (error) {
    console.error("Temp Store Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};