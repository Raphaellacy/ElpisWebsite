import stripe from 'stripe';

// Initialize Stripe with your Secret Key from Netlify Environment Variables
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);

export default async (event) => {
  // Only allow POST requests for security
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: 'Method Not Allowed' })
    };
  }

  try {
    // Parse the data sent from your website
    const { title, price, currency, downloadUrl, manuscriptHash, language, authorEmail, authorName } = JSON.parse(event.body);

    // Validate that we have the necessary info
    if (!title || !price) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: 'Missing title or price' })
      };
    }

    // ✅ DETERMINE SUCCESS URL BASED ON PRODUCT TYPE
    let successUrl;
    
    if (title.startsWith("Insight_Report_")) {
      // For Insight Reports: Redirect to status page with hash & lang
      if (!manuscriptHash) {
        throw new Error("Manuscript Hash is missing for Insight Report");
      }
      successUrl = `https://elpishouse.xyz/report-status.html?hash=${manuscriptHash}&lang=${encodeURIComponent(language || 'English')}`;
    } else {
      // For Normal Book Sales: Redirect to Library/Success Page
      successUrl = "https://elpishouse.xyz/books.html?success=true";
    }

    // Create a Stripe Checkout Session
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency || 'eur',
            product_data: {
              name: title,
            },
            unit_amount: Math.round(price * 100), // Stripe expects amount in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      // Pass all necessary data to the webhook via metadata
      metadata: {
        bookTitle: title,
        downloadUrl: downloadUrl || '',
        manuscriptHash: manuscriptHash || '',
        language: language || 'English',
        authorEmail: authorEmail || '',
        authorName: authorName || ''
      },
      success_url: `${process.env.URL}/.netlify/functions/stripe-webhook?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.URL}/cancelled.html`,
    });

    // Send the unique Stripe URL back to your website
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url: session.url })
    };

  } catch (error) {
    console.error('Stripe Error:', error);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: 'Internal Server Error', details: error.message })
    };
  }
};