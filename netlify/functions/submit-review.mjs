import { PinataSDK } from "pinata";

const pinata = new PinataSDK({ 
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
});

export default async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    // ✅ ADDED readerName to the destructuring
    const { bookTitle, readerEmail, readerName, reviewText, rating, authorName } = JSON.parse(event.body || "{}");

    if (!bookTitle || !readerEmail || !reviewText || !rating) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
    }

    console.log(`🔍 Verifying purchase for: ${readerEmail} on ${bookTitle}`);

    // 1. SEARCH PINATA FOR A SALES RECORD MATCHING THIS EMAIL AND BOOK
    const metadataFilter = JSON.stringify({ keyvalues: { type: "financial_report" } });
    const encodedMetadata = encodeURIComponent(metadataFilter);
    
    const url = `https://api.pinata.cloud/data/pinList?status=pinned&metadata=${encodedMetadata}&pageLimit=300`;

    const response = await fetch(url, {
      headers: { 
        'Authorization': `Bearer ${process.env.PINATA_JWT}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error("Failed to query Pinata");

    const data = await response.json();
    let isVerified = false;

    // 2. CHECK EACH SALES RECORD TO SEE IF IT MATCHES
    if (data.rows && data.rows.length > 0) {
      for (const row of data.rows) {
        try {
          const fileRes = await fetch(`https://${process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'}/ipfs/${row.ipfs_pin_hash}`);
          if (fileRes.ok) {
            const saleData = await fileRes.json();
            
            // Check if the email and book title match
            if (saleData.authorEmail === readerEmail && saleData.bookTitle === bookTitle) {
              isVerified = true;
              break;
            }
          }
        } catch (e) {
          console.error("Error checking individual record", e);
        }
      }
    }

    if (!isVerified) {
      return { 
        statusCode: 403, 
        body: JSON.stringify({ error: "Verification Failed. You must purchase this book to leave a review." }) 
      };
    }

    // 3. SAVE THE VERIFIED REVIEW TO PINATA
    const reviewRecord = {
      type: "VERIFIED_REVIEW",
      bookTitle: bookTitle,
      authorName: authorName || "Unknown",
      reviewerName: readerName || "Anonymous", // ✅ SAVING THE PUBLIC NAME
      reviewerEmail: readerEmail, // Kept private in storage
      reviewText: reviewText,
      rating: parseInt(rating),
      verified: true,
      timestamp: new Date().toISOString()
    };

    const fileName = `Review_${bookTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    
    await pinata.upload.json(reviewRecord, {
      metadata: {
        name: fileName,
        keyvalues: { type: "verified_review", book: bookTitle }
      }
    });

    console.log(`✅ Verified Review saved for ${bookTitle} by ${readerName}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Review submitted successfully!", verified: true })
    };

  } catch (error) {
    console.error("Submit Review Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};