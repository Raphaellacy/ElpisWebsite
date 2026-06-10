import { PinataSDK } from "pinata";

const pinata = new PinataSDK({ pinataJwt: process.env.PINATA_JWT });

export default async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405, body: "Method Not Allowed" };
  
  try {
    // Fetch all pinned files from Pinata
    const response = await fetch('https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=100', {
      headers: { 'Authorization': `Bearer ${process.env.PINATA_JWT}` }
    });
    const data = await response.json();
    
    // We return the raw data because your books.html handles the filtering and fetching of specific book details.
    // The important part is that the Metadata JSON files on Pinata MUST contain the 'downloadUrl' field.
    
    return {
      statusCode: 200,
      body: JSON.stringify(data)
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};