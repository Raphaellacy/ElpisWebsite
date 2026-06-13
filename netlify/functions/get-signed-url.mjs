export const handler = async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ 
      message: "Function is alive!", 
      jwtExists: !!process.env.PINATA_JWT 
    })
  };
};