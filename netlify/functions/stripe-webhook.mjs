import stripe from 'stripe';

// ✅ Initialize Stripe
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// ✅ CHANGED TO 'export default' FOR NETLIFY COMPATIBILITY
export default async (event) => {
  // ✅ 1. ONLY ALLOW POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  
  // ✅ 2. GET RAW BODY FOR SIGNATURE VERIFICATION
  // Netlify sometimes provides the body as a base64 string or parsed JSON. 
  // For Stripe webhooks, we need the exact raw string.
  let payload;
  if (typeof event.body === 'string') {
    payload = event.body;
  } else {
    // If it's already an object or buffer, convert it back to string
    payload = JSON.stringify(event.body);
  }

  let eventObj;

  try {
    // ✅ 3. VERIFY THE EVENT CAME FROM STRIPE
    eventObj = stripeClient.webhooks.constructEvent(payload, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook Error:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // ✅ 4. HANDLE THE SUCCESSFUL PAYMENT
  if (eventObj.type === 'checkout.session.completed') {
    const session = eventObj.data.object;
    
    // ✅ 5. GET THE DOWNLOAD URL DIRECTLY FROM METADATA
    const downloadUrl = session.metadata.downloadUrl;
    
    if (!downloadUrl) {
      console.error("No download URL found in session metadata");
      return {
        statusCode: 302,
        headers: { Location: 'https://elpishouse.xyz' }
      };
    }

    // ✅ 6. REDIRECT THE USER TO THE DOWNLOAD LINK
    return {
      statusCode: 302,
      headers: {
        Location: downloadUrl
      },
      body: ''
    };
  }

  return { statusCode: 200, body: 'Success' };
};