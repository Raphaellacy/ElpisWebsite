import { PinataSDK } from "pinata";

const pinata = new PinataSDK({ 
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
});

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { fileName } = JSON.parse(event.body || "{}");
    
    if (!fileName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'File name is required.' }) };
    }

    // Generate a signed URL using the SDK (This creates a valid signature)
    const signedUrl = await pinata.upload.generateSignedURL({
      expiresInSeconds: 60,
      metadata: {
        name: fileName,
        keyvalues: {
          type: "book_manuscript"
        }
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        url: signedUrl.url, 
        token: signedUrl.token 
      })
    };

  } catch (error) {
    console.error("Signed URL Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};