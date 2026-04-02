// api/stock.js
export default async function handler(req, res) {
  const { ticker, type } = req.query;

  if (!ticker) {
    return res.status(400).json({ error: "Ticker is required" });
  }

  // Determine which Yahoo endpoint to hit
  const interval = type === 'chart' ? '1wk' : '1d';
  const range = type === 'chart' ? '2y' : '1y';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&corsDomain=finance.yahoo.com`;

  try {
    const response = await fetch(url, {
      headers: {
        // Essential: This makes the request look like it's coming from a browser
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/'
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo responded with ${response.status}`);
    }

    const data = await response.json();
    
    // Set cache headers to avoid hitting Yahoo too frequently (5 minute cache)
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json(data);
  } catch (error) {
    console.error("Proxy Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch stock data" });
  }
}
