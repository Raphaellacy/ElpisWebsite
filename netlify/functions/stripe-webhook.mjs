import stripe from 'stripe';
import OpenAI from "openai";
import { PinataSDK } from "pinata";
import pdfParse from "pdf-parse";
import Epub from "epub-parser";
import fetch from "node-fetch";

// ✅ Initialize Clients
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinata = new PinataSDK({ 
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
});

// Helper to send email notifications
async function sendEmailNotification(subject, data) {
  try {
    const formData = new FormData();
    formData.append("subject", subject);
    Object.keys(data).forEach(key => formData.append(key, data[key]));
    await fetch("https://formspree.io/f/mkokeynk", {
      method: "POST",
      body: formData,
      headers: { 'Accept': 'application/json' }
    });
  } catch (error) { console.error("Email Error:", error); }
}

export default async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const sig = event.headers['stripe-signature'];
  let payload = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
  let eventObj;

  try {
    eventObj = stripeClient.webhooks.constructEvent(payload, sig, endpointSecret);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (eventObj.type === 'checkout.session.completed') {
    const session = eventObj.data.object;
    const metadata = session.metadata;
    const amountTotal = session.amount_total / 100; // Convert cents to EUR
    
    const { bookTitle, downloadUrl, manuscriptHash, language, authorEmail, authorName } = metadata;

    // --- CHECK IF THIS IS AN INSIGHT REPORT ---
    if (bookTitle && bookTitle.startsWith("Insight_Report_")) {
      console.log(`💳 Stripe: Processing Insight Report for ${bookTitle}`);
      
      if (!manuscriptHash) {
        console.error("Missing Hash for Insight");
        return { statusCode: 200, body: 'Success' }; // Prevent retry loops
      }

      // Trigger the Report Generation (Same logic as Crypto Webhook)
      // We call the generate-report function internally or duplicate the logic here.
      // For simplicity, we will duplicate the core logic to ensure it runs immediately.
      
      try {
        // 1. Fetch & Screen
        const fileRes = await fetch(`https://gateway.pinata.cloud/ipfs/${manuscriptHash}`);
        const buffer = Buffer.from(await fileRes.arrayBuffer());
        let text = "";
        if (fileRes.headers.get('content-type')?.includes('pdf')) {
          text = (await pdfParse(buffer)).text;
        } else {
          // Simplified EPUB handling for brevity - use full logic in production
          text = buffer.toString('utf-8'); 
        }

        // 2. Safety Check
        const safety = await openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Reply SAFE or UNSAFE." }, { role: "user", content: `Screen: ${text.substring(0,3000)}` }]
        });
        
        if (safety.choices[0].message.content.includes("UNSAFE")) {
          await pinata.unpin(manuscriptHash);
          return { statusCode: 200, body: 'Unsafe Content' };
        }

        // 3. Generate Report (Calling the function logic)
        // Note: In a real scenario, you might want to import the generate-report logic 
        // or call it via HTTP. Here we assume the report-status.html will trigger it,
        // OR we trigger it here. To keep it simple, we'll let the user's browser trigger it
        // via report-status.html, but we record the sale now.
        
        await sendEmailNotification("New Insight Sale (Stripe)", {
          "Book": bookTitle, "Author": authorName, "Amount": amountTotal + " EUR"
        });

      } catch (e) { console.error("Insight Error:", e); }

      // Redirect to Status Page
      return {
        statusCode: 302,
        headers: { Location: `https://elpishouse.xyz/report-status.html?hash=${manuscriptHash}&lang=${language}` }
      };
    }

    // --- STANDARD BOOK SALE ---
    console.log(`💳 Stripe: Processing Book Sale for ${bookTitle}`);
    
    // 1. Record Sale
    const authorShare = amountTotal * 0.70;
    const salesRecord = {
      type: "SALES_TRANSACTION",
      bookTitle: bookTitle,
      authorName: authorName || "Unknown",
      authorEmail: authorEmail || "Unknown",
      totalSale: `${amountTotal} EUR`,
      authorPayoutDue: `${authorShare.toFixed(2)} EUR`,
      transactionId: session.id,
      timestamp: new Date().toISOString(),
      status: "READY_FOR_PAYOUT"
    };

    await pinata.upload.json(salesRecord, {
      metadata: { name: `SALE_${session.id}`, keyvalues: { type: "financial_report" } },
      groupId: process.env.PINATA_PUBLIC_GROUP_ID
    });

    // 2. Notify Admin
    await sendEmailNotification("New Book Sale (Stripe)", {
      "Book": bookTitle, "Amount": amountTotal + " EUR", "Payout": authorShare.toFixed(2) + " EUR"
    });

    // 3. Trigger AI Reviews (Optional: You can duplicate the review logic here 
    // or let it happen on first download. For now, we redirect to library.)
    
    return {
      statusCode: 302,
      headers: { Location: "https://elpishouse.xyz/books.html?success=true" }
    };
  }

  return { statusCode: 200, body: 'Success' };
};