import stripe from 'stripe';

// Initialize Stripe with your Secret Key from Netlify Environment Variables
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);

// ✅ CHANGED TO 'export default' FOR NETLIFY COMPATIBILITY
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
    // Parse the data sent from your website (Book Title and Price)
    const { title, price, currency, downloadUrl } = JSON.parse(event.body);

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

    // Create a Stripe Checkout Session
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency || 'eur', // Default to Euro if not specified
            product_data: {
              name: title,
            },
            unit_amount: Math.round(price * 100), // Stripe expects amount in cents (e.g., €5.00 = 500)
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      // IMPORTANT: We pass the download URL in metadata so the webhook knows where to send the user
      metadata: {
        bookTitle: title,
        downloadUrl: downloadUrl || '' 
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
      body: JSON.stringify({ message: 'Internal Server Error' })
    };
  }
};