import axios from "axios";

export default async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  
  try {
    // ✅ Parse body including new fields for Insight Reports
    const { 
      bookTitle, 
      price, 
      currency = "EUR", 
      authorWallet, 
      authorName, 
      authorEmail, 
      manuscriptHash, 
      language 
    } = JSON.parse(event.body);
    
    if (!bookTitle || !price) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing bookTitle or price" }) };
    }

    // Prepare payload data for NOWPayments
    const payloadData = JSON.stringify({
      wallet: authorWallet,
      name: authorName,
      email: authorEmail,
      manuscriptHash: manuscriptHash || "", // ✅ Pass hash to webhook via payload
      language: language || "English"       // ✅ Pass language to webhook via payload
    });

    // ✅ Determine Success URL based on product type
    let successUrl;
    
    if (bookTitle.startsWith("Insight_Report_")) {
      // For Insight Reports: Redirect to the status page with hash & lang
      // We use the manuscriptHash passed in the body
      if (!manuscriptHash) {
        throw new Error("Manuscript Hash is missing for Insight Report");
      }
      successUrl = `https://elpishouse.xyz/report-status.html?hash=${manuscriptHash}&lang=${encodeURIComponent(language || 'English')}`;
    } else {
      // For Normal Book Sales: Redirect to Library
      successUrl = "https://elpishouse.xyz/books.html?success=true";
    }

    const response = await axios.post(
      "https://api.nowpayments.io/v1/invoice",
      {
        price_amount: parseFloat(price),
        price_currency: currency,
        pay_currency: "MATIC",
        order_id: `${bookTitle.replace(/\s+/g, '_')}_${Date.now()}`,
        order_description: bookTitle,
        ipn_callback_url: "https://elpishouse.xyz/.netlify/functions/webhook-handler",
        success_url: successUrl, // ✅ Dynamic URL
        cancel_url: "https://elpishouse.xyz/insight.html?canceled=true",
        payload: payloadData
      },
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Payment link created successfully",
        url: response.data.invoice_url
      })
    };

  } catch (error) {
    console.error("Create Payment Error:", error.response?.data || error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to create payment link",
        details: error.response?.data?.message || error.message
      })
    };
  }
};