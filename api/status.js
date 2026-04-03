export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const configured = !!process.env.GROQ_API_KEY;
  
  return new Response(JSON.stringify({ configured }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
