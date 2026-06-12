import OpenAI from "openai";
import { PinataSDK } from "pinata";
import pdfParse from "pdf-parse";
import Epub from "epub-parser";

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinata = new PinataSDK({ 
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'
});

// Helper to split text into chunks of ~20,000 words
function splitTextIntoChunks(text, chunkSize = 20000) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }
  return chunks;
}

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

    // 2. CHECK SIZE AND CHUNK IF NECESSARY
    const wordCount = manuscriptText.split(/\s+/).length;
    console.log(`📊 Manuscript Word Count: ${wordCount}`);

    let avatarText, competitorText, checklistText, hooksText, socialText;

    if (wordCount > 80000) {
      console.log("⚠️ Large Manuscript Detected. Using Chunked Analysis...");
      const chunks = splitTextIntoChunks(manuscriptText, 20000);
      
      // For large books, we analyze the first chunk for Hooks/Avatar (usually established early)
      // and summarize the rest for Competitors/Checklist. 
      // To keep it simple and fast, we will analyze the FIRST and LAST chunks for a balanced view.
      
      const firstChunk = chunks[0];
      const lastChunk = chunks[chunks.length - 1];
      const combinedSample = `${firstChunk}\n\n...\n\n${lastChunk}`;

      // Run AI on the Sample
      const [avatar, competitor, checklist, hooks, social] = await Promise.all([
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a supportive literary agent." }, { role: "user", content: `Analyze this sample from a large manuscript (Language: ${language}) to create a "Target Audience Avatar". Sample:\n\n${combinedSample}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a supportive market analyst." }, { role: "user", content: `Analyze this sample from a large manuscript (Language: ${language}) for "Competitor Analysis". Sample:\n\n${combinedSample}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a cheerful launch coach." }, { role: "user", content: `Based on this sample from a large manuscript (Language: ${language}), create a "30-Day Launch Checklist". Sample:\n\n${combinedSample}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a creative branding expert." }, { role: "user", content: `Based on this sample from a large manuscript (Language: ${language}), generate 3 "Marketing Hook Suggestions". Sample:\n\n${combinedSample}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a social media strategist." }, { role: "user", content: `Based on this sample from a large manuscript (Language: ${language}), create a "Social Media Content Plan". Sample:\n\n${combinedSample}` }]
        })
      ]);

      avatarText = avatar.choices[0].message.content;
      competitorText = competitor.choices[0].message.content;
      checklistText = checklist.choices[0].message.content;
      hooksText = hooks.choices[0].message.content;
      socialText = social.choices[0].message.content;

    } else {
      // Standard Processing for Smaller Books
      console.log("🤖 Generating 5 AI Reports on Full Manuscript...");
      const [avatar, competitor, checklist, hooks, social] = await Promise.all([
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a supportive literary agent." }, { role: "user", content: `Analyze the FULL manuscript (Language: ${language}) and create a "Target Audience Avatar". Manuscript:\n\n${manuscriptText}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a supportive market analyst." }, { role: "user", content: `Analyze the FULL manuscript (Language: ${language}) and perform a "Competitor Analysis". Manuscript:\n\n${manuscriptText}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a cheerful launch coach." }, { role: "user", content: `Based on the FULL manuscript (Language: ${language}), create a "30-Day Launch Checklist". Manuscript:\n\n${manuscriptText}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a creative branding expert." }, { role: "user", content: `Based on the FULL manuscript (Language: ${language}), generate 3 powerful "Marketing Hook Suggestions". Manuscript:\n\n${manuscriptText}` }]
        }),
        openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "You are a social media strategist." }, { role: "user", content: `Based on the FULL manuscript (Language: ${language}), create a "Social Media Content Plan". Manuscript:\n\n${manuscriptText}` }]
        })
      ]);

      avatarText = avatar.choices[0].message.content;
      competitorText = competitor.choices[0].message.content;
      checklistText = checklist.choices[0].message.content;
      hooksText = hooks.choices[0].message.content;
      socialText = social.choices[0].message.content;
    }

    // 3. Combine into Final Report
    const finalReport = {
      type: "INSIGHT_BLUEPRINT",
      title: bookTitle || "Unknown Title",
      author: authorName || "Unknown Author",
      language: language || "English",
      wordCount: wordCount,
      generatedAt: new Date().toISOString(),
      reports: {
        "1. Target Audience Avatar": avatarText,
        "2. Competitor Analysis": competitorText,
        "3. 30-Day Launch Checklist": checklistText,
        "4. Marketing Hook Suggestions": hooksText,
        "5. Social Media Content Plan": socialText
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