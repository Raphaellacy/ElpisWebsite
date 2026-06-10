import OpenAI from "openai";
import { PinataSDK } from "pinata";
import { parseMultipart } from '@netlify/functions';
import pdfParse from "pdf-parse";
import Epub from "epub-parser";

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
    // ✅ 1. PARSE FORM DATA
    const formData = await parseMultipart(event);
    
    const bookTitle = formData.get('bookTitle');
    const authorName = formData.get('authorName');
    const language = formData.get('language');
    const walletAddress = formData.get('walletAddress');
    const bookPrice = formData.get('bookPrice');
    const manuscript = formData.get('manuscript'); // The PDF/EPUB File

    if (!bookTitle || !authorName || !manuscript || !walletAddress) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
    }

    // ✅ 1.5 CHECK FILE SIZE (50MB Limit)
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB in bytes
    if (manuscript.size > MAX_SIZE) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: "File too large. Maximum size is 50MB." }) 
      };
    }

    // ✅ 2. EXTRACT TEXT FOR SAFETY SCREENING
    const buffer = Buffer.from(await manuscript.arrayBuffer());
    let manuscriptText = "";
    const contentType = manuscript.type; // e.g., 'application/pdf'

    console.log(`📄 Screening ${bookTitle} (${contentType})...`);

    if (contentType && contentType.includes('application/pdf')) {
      const pdfData = await pdfParse(buffer);
      manuscriptText = pdfData.text;
    } 
    else if (contentType && (contentType.includes('application/epub') || contentType.includes('application/zip'))) {
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
      return { statusCode: 400, body: JSON.stringify({ error: "Could not extract text for screening." }) };
    }

    // ✅ 3. AI SAFETY SCREENING (Check first 3000 chars for efficiency)
    const safetyCheck = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are the Elpis Guardian. Check the following text for prohibited content: Pornography, racism, offensive language, terrorism, hate speech, or child sexual abuse material. Reply only with 'SAFE' or 'UNSAFE'." },
        { role: "user", content: `Screen this text:\n\n${manuscriptText.substring(0, 3000)}` }
      ]
    });

    const verdict = safetyCheck.choices[0].message.content.trim().toUpperCase();
    
    if (verdict.includes("UNSAFE")) {
      return { 
        statusCode: 403, 
        body: JSON.stringify({ error: "Upload Rejected: Content violates Elpis Ethical Guidelines." }) 
      };
    }

    console.log("✅ Safety Screening Passed.");

    // ✅ 4. UPLOAD THE ACTUAL BOOK FILE (PDF/EPUB) TO PINATA
    const fileUpload = await pinata.upload.blob(buffer, {
      metadata: { name: manuscript.filename }
    });
    const fileHash = fileUpload.IpfsHash;

    // ✅ 5. PREPARE METADATA WITH THE DOWNLOAD URL
    const finalPrice = parseFloat(bookPrice) || 5.99;
    
    const metadata = {
      title: bookTitle,
      author: authorName,
      language: language || "en",
      price: finalPrice,
      walletAddress: walletAddress,
      status: "Active - Pending First Sale",
      timestamp: new Date().toISOString(),
      downloadUrl: `https://gateway.pinata.cloud/ipfs/${fileHash}`
    };

    // ✅ 6. UPLOAD METADATA TO PINATA
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
        fileHash: fileHash,
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