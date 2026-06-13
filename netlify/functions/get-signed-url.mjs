import crypto from 'crypto';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const apiKey = process.env.PINATA_API_KEY;
    const apiSecret = process.env.PINATA_API_SECRET;
    const jwt = process.env.PINATA_JWT;

    // Check if we have credentials
    if (!apiKey || !apiSecret) {
      throw new Error("Missing PINATA_API_KEY or PINATA_API_SECRET");
    }

    const { fileName } = JSON.parse(event.body || "{}");
    if (!fileName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'File name is required.' }) };
    }

    // Create a short-lived JWT manually
    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
      sub: apiKey,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60, // 60 seconds
      permissions: {
        endpoints: {
          "/pinning/pinFileToIPFS": {}
        }
      }
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    
    const signature = crypto.createHmac('sha256', apiSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    const token = `${encodedHeader}.${encodedPayload}.${signature}`;

    return {
      statusCode: 200,
      body: JSON.stringify({
        url: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
        token: token
      })
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};