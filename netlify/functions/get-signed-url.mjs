import { PinataSDK } from "pinata";

export const handler = async (event) => {
  // 1. CHECK IF ENV VARIABLES EXIST
  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "MISSING PINATA_JWT ENV VARIABLE" })
    };
  }

  const pinata = new PinataSDK({ 
    pinataJwt: jwt,
    pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
  });

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { fileName } = JSON.parse(event.body || "{}");
    
    if (!fileName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'File name is required.' }) };
    }

    // 2. TRY TO GENERATE URL
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
    // 3. RETURN THE EXACT ERROR MESSAGE TO THE BROWSER
    return { 
      statusCode: 500, 
      body: JSON.stringify({ 
        error: "Function Crashed", 
        details: error.message,
        stack: error.stack 
      }) 
    };
  }
};