import OpenAI from "openai";
import { PinataSDK } from "pinata";
import pdfParse from "pdf-parse";
import Epub from "epub-parser";
import fetch from "node-fetch"; // Ensure node-fetch is installed or use global fetch in newer Node versions

// ✅ Initialize Clients
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinata = new PinataSDK({ 
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
});

export default async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // ✅ 1. PARSE JSON BODY (New Method)
    const { bookTitle, authorName, language, walletAddress, bookPrice, ipfsHash, fileName } = JSON.parse(event.body);
    
    if (!bookTitle || !authorName || !ipfsHash) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
    }

    console.log(`📄 Processing ${bookTitle} with IPFS Hash: ${ipfsHash}`);

    // ✅ 2. FETCH FILE FROM PINATA FOR SCREENING
    // We download the file temporarily to screen it with AI
    const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
    const response = await fetch(gatewayUrl);
    
    if (!response.ok) {
      throw new Error("Failed to fetch file from Pinata for screening.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    let manuscriptText = "";
    
    // Determine file type from fileName
    const fileType = fileName.split('.').pop().toLowerCase();

    console.log(`🔍 Screening ${bookTitle} (${fileType})...`);

    if (fileType === 'pdf') {
      const pdfData = await pdfParse(buffer);
      manuscriptText = pdfData.text;
    } 
    else if (fileType === 'epub') {
      const epub = new Epub(buffer);
      await new Promise((resolve, reject) => {
          epub.on("end", () => {
              manuscriptText = epub.flow.map(chapter => chapter.html).join("\n\n");
              manuscriptText = manuscriptText.replace(/<[^>]*>/g, " ");
              resolve();
          });
          epub.on("error", (err) => reject(err));
          epub.parse();
      });
    } 
    else {
      manuscriptText = buffer.toString('utf-8');
    }

    if (!manuscriptText || manuscriptText.length < 50) {
      // If we can't extract text, we might still allow it but flag it, or reject. 
      // For now, let's allow it but log a warning.
      console.warn("⚠️ Could not extract sufficient text for screening.");
    } else {
      // ✅ 3. AI SAFETY SCREENING
      const safetyCheck = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are the Elpis Guardian. Check the following text for prohibited content: Pornography, racism, offensive language, terrorism, hate speech, or child sexual abuse material. Reply only with 'SAFE' or 'UNSAFE'." },
          { role: "user", content: `Screen this text:\n\n${manuscriptText.substring(0, 3000)}` }
        ]
      });

      const verdict = safetyCheck.choices[0].message.content.trim().toUpperCase();
      
      if (verdict.includes("UNSAFE")) {
        // Optional: Delete the file from Pinata if unsafe? 
        // For now, we just reject the registration.
        return { 
          statusCode: 403, 
          body: JSON.stringify({ error: "Upload Rejected: Content violates Elpis Ethical Guidelines." }) 
        };
      }
      console.log("✅ Safety Screening Passed.");
    }

    // ✅ 4. PREPARE METADATA (File is already on Pinata, so we just record the hash)
    const finalPrice = parseFloat(bookPrice) || 5.99;
    
    const metadata = {
      title: bookTitle,
      author: authorName,
      language: language || "en",
      price: finalPrice,
      walletAddress: walletAddress || "PENDING",
      status: "Active - Pending First Sale",
      timestamp: new Date().toISOString(),
      fileHash: ipfsHash, // The hash of the actual book file
      downloadUrl: `https://gateway.pinata.cloud/ipfs/${ipfsHash}`
    };

    // ✅ 5. UPLOAD METADATA TO PINATA
    const metaUpload = await pinata.upload.json(metadata, {
      metadata: { 
        name: `${bookTitle.replace(/[^a-zA-Z0-9]/g, '_')}_metadata` 
      },
      groupId: process.env.PINATA_PUBLIC_GROUP_ID 
    });

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        message: "Book submitted successfully!", 
        ipfsHash: metaUpload.IpfsHash,
        fileHash: ipfsHash,
        priceSet: `€${finalPrice.toFixed(2)}`
      })
    };

  } catch (error) {
    console.error("Process Book Error:", error);
    return { 
      statusCode: 500, 
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ error: error.message || "Internal server error" }) 
    };
  }
};