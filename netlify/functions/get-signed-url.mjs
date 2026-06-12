export const handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // 1. Get Credentials from Netlify Environment Variables
    const apiKey = process.env.PINATA_API_KEY;
    const apiSecret = process.env.PINATA_API_SECRET;
    
    if (!apiKey || !apiSecret) {
      throw new Error('Pinata API Key or Secret is missing in environment variables.');
    }

    // 2. Parse the request body to get the file name
    const { fileName } = JSON.parse(event.body);
    
    if (!fileName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'File name is required.' })
      };
    }

    // 3. Generate a Short-Lived JWT for the Frontend
    // This allows the browser to upload directly to Pinata without exposing your main secret.
    
    const encoder = new TextEncoder();
    
    // Helper function for Base64URL encoding
    const base64Url = (data) => {
      return btoa(String.fromCharCode(...new Uint8Array(data)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    };

    // JWT Header
    const jwtHeader = {
      "alg": "HS256",
      "typ": "JWT"
    };
    
    // JWT Payload (Valid for 60 seconds)
    const jwtPayload = {
      "sub": apiKey,
      "iat": Math.floor(Date.now() / 1000),
      "exp": Math.floor(Date.now() / 1000) + 60, 
      "permissions": {
        "endpoints": {
          "/pinning/pinFileToIPFS": {}
        }
      }
    };

    // Encode Header and Payload
    const header = base64Url(encoder.encode(JSON.stringify(jwtHeader)));
    const payload = base64Url(encoder.encode(JSON.stringify(jwtPayload)));

    // Sign the JWT using Web Crypto API
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(apiSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign(
      'HMAC', 
      key, 
      encoder.encode(`${header}.${payload}`)
    );
    
    const signedJwt = `${header}.${payload}.${base64Url(signature)}`;
    
    // 4. Return the URL and the Temporary Token to the Browser
    return {
      statusCode: 200,
      body: JSON.stringify({
        url: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
        token: signedJwt
      })
    };

  } catch (error) {
    console.error("Error generating signed URL:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};