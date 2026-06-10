import { PinataSDK } from "pinata";

// Initialize Pinata SDK (Good practice, though we use fetch for the specific query)
const pinata = new PinataSDK({ 
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
});

export default async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };
  
  try {
    const { hash } = event.queryStringParameters;
    
    if (!hash) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing hash" }) };
    }

    // The webhook/function will name the final report: "Report_Final_{ORIGINAL_HASH}"
    const targetName = `Report_Final_${hash}`;

    // ✅ CORRECT: URL-encode the metadata JSON to prevent errors
    const metadataFilter = JSON.stringify({ name: targetName });
    const encodedMetadata = encodeURIComponent(metadataFilter);

    const url = `https://api.pinata.cloud/data/pinList?status=pinned&metadata=${encodedMetadata}`;

    const response = await fetch(url, {
      headers: { 
        'Authorization': `Bearer ${process.env.PINATA_JWT}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Pinata API Error: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.count > 0 && data.rows.length > 0) {
      const finalFile = data.rows[0];
      // Use the gateway from env or default
      const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud';
      const downloadUrl = `https://${gateway}/ipfs/${finalFile.ipfs_pin_hash}`;
      
      return { 
        statusCode: 200, 
        headers: {
          "Access-Control-Allow-Origin": "*", // Allow frontend to read this
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ready: true, downloadUrl: downloadUrl }) 
      };
    } else {
      // Not ready yet
      return { 
        statusCode: 200, 
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ready: false }) 
      };
    }

  } catch (error) {
    console.error("Check Status Error:", error);
    return { 
      statusCode: 500, 
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ error: error.message }) 
    };
  }
};