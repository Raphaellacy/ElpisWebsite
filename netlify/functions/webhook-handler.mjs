import OpenAI from "openai";
import { PinataSDK } from "pinata";
import pdfParse from "pdf-parse";
import Epub from "epub-parser";

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinata = new PinataSDK({ 
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
});

// ✅ FUNCTION TO SEND YOU AN EMAIL REPORT VIA FORMSPREE
async function sendEmailNotification(subject, data) {
  try {
    const formData = new FormData();
    formData.append("subject", subject);
    Object.keys(data).forEach(key => {
      formData.append(key, data[key]);
    });

    await fetch("https://formspree.io/f/mkokeynk", {
      method: "POST",
      body: formData,
      headers: { 'Accept': 'application/json' }
    });
    console.log("✅ Email notification sent to Elpis Admin.");
  } catch (error) {
    console.error("Failed to send email notification:", error);
  }
}

export default async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const data = JSON.parse(event.body || "{}");
    
    // Only process finished payments
    if (data.payment_status !== 'finished') return { statusCode: 200, body: "Pending" };

    const orderDescription = data.order_description || "Untitled";
    const totalAmount = parseFloat(data.price_amount) || 0;
    const currency = data.price_currency || "EUR";
    
    // Parse Payload to get Author Info AND Manuscript Hash (for Insight)
    let payloadData = { wallet: "UNKNOWN", name: "Unknown", email: "Unknown", manuscriptHash: "", language: "English" };
    if (data.payload) {
      try {
        payloadData = JSON.parse(data.payload);
      } catch (e) {
        console.error("Failed to parse payload", e);
      }
    }

    const { wallet, name, email, manuscriptHash, language } = payloadData;

    // --- CHECK IF THIS IS AN INSIGHT REPORT (€39.99) ---
    if (orderDescription.startsWith("Insight_Report_")) {
      console.log(`🚀 Processing Insight Report for: ${orderDescription}`);
      
      if (!manuscriptHash) {
        throw new Error("Manuscript Hash missing for Insight Report");
      }

      // 1. Fetch the Manuscript from Pinata using the Hash
      const tempFileRes = await fetch(`https://${process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'}/ipfs/${manuscriptHash}`);
      if (!tempFileRes.ok) throw new Error("Failed to fetch manuscript from Pinata");
      
      const buffer = Buffer.from(await tempFileRes.arrayBuffer());
      let manuscriptText = "";

      // ✅ DETECT FILE TYPE AND EXTRACT TEXT
      const contentType = tempFileRes.headers.get('content-type');
      
      if (contentType && contentType.includes('application/pdf')) {
        console.log("📄 Detected PDF. Extracting full text...");
        const pdfData = await pdfParse(buffer);
        manuscriptText = pdfData.text;
      } 
      else if (contentType && (contentType.includes('application/epub') || contentType.includes('application/zip'))) {
        console.log("📖 Detected EPUB. Extracting full text...");
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
        console.log("📝 Detected Text. Reading directly...");
        manuscriptText = buffer.toString('utf-8');
      }

      if (!manuscriptText || manuscriptText.length < 100) {
        throw new Error("Could not extract sufficient text from the manuscript.");
      }

      // ✅ 1.5 SAFETY SCREENING (Elpis Guardian Check)
      console.log("🛡️ Running Safety Screening on Insight Manuscript...");
      const safetyCheck = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are the Elpis Guardian. Check the following text for prohibited content: Pornography, racism, offensive language, terrorism, hate speech, or child sexual abuse material. Reply only with 'SAFE' or 'UNSAFE'." },
          { role: "user", content: `Screen this text:\n\n${manuscriptText.substring(0, 3000)}` }
        ]
      });

      const verdict = safetyCheck.choices[0].message.content.trim().toUpperCase();
      
      if (verdict.includes("UNSAFE")) {
        console.log("❌ Insight Manuscript Rejected: Unsafe Content.");
        // Optional: Delete the manuscript immediately if unsafe
        await pinata.unpin(manuscriptHash);
        return { 
          statusCode: 403, 
          body: JSON.stringify({ error: "Upload Rejected: Content violates Elpis Ethical Guidelines." }) 
        };
      }
      console.log("✅ Safety Screening Passed.");

      const bookTitle = orderDescription.replace("Insight_Report_", "");

      // 2. Generate the 5 Specific Reports (FULL MANUSCRIPT)
      console.log("🤖 Generating 5 AI Reports on Full Manuscript...");
      
      const [avatar, competitor, checklist, hooks, social] = await Promise.all([
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a supportive literary agent." }, { role: "user", content: `Analyze the following FULL manuscript (Language: ${language}) and create a detailed "Target Audience Avatar". Manuscript:\n\n${manuscriptText}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a supportive market analyst." }, { role: "user", content: `Analyze the following FULL manuscript (Language: ${language}) and perform a "Competitor Analysis". Manuscript:\n\n${manuscriptText}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a cheerful launch coach." }, { role: "user", content: `Based on the following FULL manuscript (Language: ${language}), create a "30-Day Launch Checklist". Manuscript:\n\n${manuscriptText}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a creative branding expert." }, { role: "user", content: `Based on the following FULL manuscript (Language: ${language}), generate 3 powerful "Marketing Hook Suggestions". Manuscript:\n\n${manuscriptText}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a social media strategist." }, { role: "user", content: `Based on the following FULL manuscript (Language: ${language}), create a "Social Media Content Plan". Manuscript:\n\n${manuscriptText}` }]
        })
      ]);

      const finalReport = {
        type: "INSIGHT_BLUEPRINT",
        title: bookTitle,
        author: name,
        language: language,
        generatedAt: new Date().toISOString(),
        reports: {
          "1. Target Audience Avatar": avatar.choices[0].message.content,
          "2. Competitor Analysis": competitor.choices[0].message.content,
          "3. 30-Day Launch Checklist": checklist.choices[0].message.content,
          "4. Marketing Hook Suggestions": hooks.choices[0].message.content,
          "5. Social Media Content Plan": social.choices[0].message.content
        }
      };

      const finalFileName = `Report_Final_${manuscriptHash}`;
      await pinata.upload.json(finalReport, {
        metadata: { 
          name: finalFileName,
          keyvalues: { type: "insight_report", originalHash: manuscriptHash }
        },
        groupId: process.env.PINATA_PUBLIC_GROUP_ID
      });

      // ✅ DELETE THE TEMPORARY MANUSCRIPT FROM PINATA PRIVATE VAULT
      try {
        await pinata.unpin(manuscriptHash);
        console.log(`✅ Temporary manuscript ${manuscriptHash} deleted securely from Private Vault.`);
      } catch (deleteError) {
        console.error("Failed to delete temporary manuscript:", deleteError);
      }

      // ✅ SEND EMAIL REPORT FOR INSIGHT SALE
      await sendEmailNotification("New Insight Report Sale", {
        "Type": "Insight Report",
        "Book Title": bookTitle,
        "Author Name": name,
        "Author Email": email,
        "Amount": `${totalAmount} ${currency}`,
        "Status": "Report Generated & Manuscript Deleted"
      });

      console.log(`✅ Insight Report saved as ${finalFileName}`);
      return { statusCode: 200, body: JSON.stringify({ message: "Insight Report generated successfully", fileName: finalFileName }) };
    }

    // --- STANDARD BOOK SALE LOGIC ---
    // (This part remains the same as before...)
    console.log(`📚 Processing Standard Book Sale: ${orderDescription}`);
    const authorShare = totalAmount * 0.70;
    const elpisShare = totalAmount * 0.30;

    const salesRecord = {
      type: "SALES_TRANSACTION",
      bookTitle: orderDescription,
      authorName: name,
      authorEmail: email,
      authorWallet: wallet,
      totalSale: `${totalAmount} ${currency}`,
      authorPayoutDue: `${authorShare.toFixed(2)} ${currency}`,
      elpisRevenue: `${elpisShare.toFixed(2)} ${currency}`,
      transactionId: data.payin_id,
      timestamp: new Date().toISOString(),
      status: "READY_FOR_PAYOUT"
    };

    await pinata.upload.json(salesRecord, {
      metadata: {
        name: `SALES_REPORT_${orderDescription.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        keyvalues: { type: "financial_report" }
      },
      groupId: process.env.PINATA_PUBLIC_GROUP_ID
    });

    await sendEmailNotification("New Book Sale - Payout Required", {
      "Type": "Book Sale",
      "Book Title": orderDescription,
      "Author Name": name,
      "Author Email": email,
      "Author Wallet": wallet,
      "Total Sale": `${totalAmount} ${currency}`,
      "Payout Due (70%)": `${authorShare.toFixed(2)} ${currency}`,
      "Elpis Share (30%)": `${elpisShare.toFixed(2)} ${currency}`,
      "Transaction ID": data.payin_id
    });

    // (Reviews logic remains the same...)
    const [review1, review2] = await Promise.all([
      openaiClient.chat.completions.create({ 
        model: "gpt-4o-mini", 
        messages: [
          { role: "system", content: "You are 'Agent Alpha', a senior literary editor. Provide deep analysis with KINDNESS and TRUTH." },
          { role: "user", content: `Provide a deep literary analysis of the e-Book titled "${orderDescription}".` }] 
      }),
      openaiClient.chat.completions.create({ 
        model: "gpt-4o-mini", 
        messages: [
          { role: "system", content: "You are 'Agent Beta', a market strategist. Evaluate potential with ENCOURAGEMENT." },
          { role: "user", content: `Evaluate the market potential of the e-Book titled "${orderDescription}".` }] 
      })
    ]);

    const text1 = review1.choices[0].message.content;
    const text2 = review2.choices[0].message.content;

    const review3 = await openaiClient.chat.completions.create({ 
        model: "gpt-4o-mini", 
        messages: [
          { role: "system", content: "You are the 'Comparison Verdict'. Synthesize the reviews with wisdom." },
          { role: "user", content: `Compare the following two reviews of "${orderDescription}" and provide a final verdict:\n\nReview 1: ${text1}\n\nReview 2: ${text2}` }] 
    });
    const text3 = review3.choices[0].message.content;

    const reviewData = {
      type: "AI_REVIEWS_COMPLETE",
      bookTitle: orderDescription,
      reviewer1: text1,
      reviewer2: text2,
      comparisonVerdict: text3,
      timestamp: new Date().toISOString()
    };

    await pinata.upload.json(reviewData, {
      metadata: { name: `Reviews_${orderDescription.replace(/[^a-zA-Z0-9]/g, '_')}` },
      groupId: process.env.PINATA_PUBLIC_GROUP_ID
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Success! Sales Report, Email Notification, & 3 AI Reviews generated." })
    };

  } catch (error) {
    console.error("Webhook Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};