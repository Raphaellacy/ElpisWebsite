import OpenAI from "openai";
import { PinataSDK } from "pinata";
import pdfParse from "pdf-parse";
import Epub from "epub-parser";

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinata = new PinataSDK({ 
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
});

export default async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { manuscriptHash, bookTitle, authorName, language } = JSON.parse(event.body || "{}");

    if (!manuscriptHash) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing manuscriptHash" }) };
    }

    console.log(`🚀 Generating Insight Report for Hash: ${manuscriptHash}`);

    // 1. Fetch Manuscript from Pinata
    const fileRes = await fetch(`https://${process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'}/ipfs/${manuscriptHash}`);
    if (!fileRes.ok) throw new Error("Failed to fetch manuscript");
    
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    let manuscriptText = "";
    const contentType = fileRes.headers.get('content-type');

    // ✅ DETECT FILE TYPE AND EXTRACT FULL TEXT
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
              manuscriptText = manuscriptText.replace(/<[^>]*>/g, " "); // Clean HTML tags
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

    // 2. Generate the 5 Insights (Parallel for Speed - FULL MANUSCRIPT)
    console.log("🤖 Generating 5 AI Reports on Full Manuscript...");
    const [avatar, competitor, checklist, hooks, social] = await Promise.all([
      openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a supportive literary agent. Analyze the FULL manuscript to find the ideal reader. Be encouraging but precise." }, { role: "user", content: `Analyze the following FULL manuscript (Language: ${language}) and create a "Target Audience Avatar". Provide a detailed psychological profile of the ideal reader. Manuscript:\n\n${manuscriptText}` }]
      }),
      openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a supportive market analyst. Identify competitors but focus on how this book can uniquely shine." }, { role: "user", content: `Analyze the following FULL manuscript (Language: ${language}) and perform a "Competitor Analysis". Identify 3-5 similar best-selling books, their strengths/weaknesses, and how this book can outperform them with its unique voice. Manuscript:\n\n${manuscriptText}` }]
      }),
      openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a cheerful launch coach. Create a plan that feels manageable and exciting, not overwhelming." }, { role: "user", content: `Based on the following FULL manuscript (Language: ${language}), create a "30-Day Launch Checklist". A day-by-day action plan that builds momentum gently. Manuscript:\n\n${manuscriptText}` }]
      }),
      openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a creative branding expert. Find the heart of the story to create hooks." }, { role: "user", content: `Based on the following FULL manuscript (Language: ${language}), generate 3 powerful "Marketing Hook Suggestions". Unique taglines that capture the soul of the story. Manuscript:\n\n${manuscriptText}` }]
      }),
      openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "You are a social media strategist who loves stories. Suggest authentic ways to connect." }, { role: "user", content: `Based on the following FULL manuscript (Language: ${language}), create a "Social Media Content Plan". Specific ideas for posts that feel genuine and engaging. Manuscript:\n\n${manuscriptText}` }]
      })
    ]);

    // 3. Combine into Final Report
    const finalReport = {
      type: "INSIGHT_BLUEPRINT",
      title: bookTitle || "Unknown Title",
      author: authorName || "Unknown Author",
      language: language || "English",
      generatedAt: new Date().toISOString(),
      reports: {
        "1. Target Audience Avatar": avatar.choices[0].message.content,
        "2. Competitor Analysis": competitor.choices[0].message.content,
        "3. 30-Day Launch Checklist": checklist.choices[0].message.content,
        "4. Marketing Hook Suggestions": hooks.choices[0].message.content,
        "5. Social Media Content Plan": social.choices[0].message.content
      }
    };

    // 4. Upload to Pinata
    const reportName = `Report_Final_${manuscriptHash}`;
    const uploadResult = await pinata.upload.json(finalReport, {
      metadata: { 
        name: reportName,
        keyvalues: { type: "insight_report", originalHash: manuscriptHash }
      },
      groupId: process.env.PINATA_PUBLIC_GROUP_ID
    });

    console.log(`✅ Report Generated & Uploaded: ${uploadResult.IpfsHash}`);

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        message: "Report generated successfully", 
        ipfsHash: uploadResult.IpfsHash,
        downloadUrl: `https://${process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'}/ipfs/${uploadResult.IpfsHash}`
      })
    };

  } catch (error) {
    console.error("Generate Report Error:", error);
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