const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL || 'postgres://srvly:***@postgres:5432/srvly';

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // Get apps with bad descriptions
  const { rows } = await client.query(
    `SELECT id, icon FROM recipes WHERE LENGTH(description) < 50 OR description LIKE '>-%' OR description LIKE '|-%'`
  );
  console.log(`Apps needing descriptions: ${rows.length}`);

  let fixed = 0, errors = 0;
  for (const row of rows) {
    const domain = extractDomain(row.icon);
    if (!domain) { errors++; continue; }

    let desc = null;
    for (const proto of ['https', 'http']) {
      desc = await scrape(`${proto}://${domain}`);
      if (desc) break;
      if (!domain.startsWith('www.')) {
        desc = await scrape(`${proto}://www.${domain}`);
        if (desc) break;
      }
    }

    if (desc && desc.length > 30) {
      await client.query('UPDATE recipes SET description = $1 WHERE id = $2', [desc, row.id]);
      fixed++;
      if (fixed % 50 === 0) console.log(`  ${fixed} fixed...`);
    } else {
      errors++;
    }

    await sleep(250); // be polite
  }

  console.log(`\nDone! Fixed: ${fixed} | Errors: ${errors}`);
  await client.end();
}

function extractDomain(url) {
  const m = (url || '').match(/domain=([^&]+)/);
  if (m) {
    let d = m[1].replace(/https?:\/\//, '').split('/')[0].trim();
    if (d && d.includes('.') && d !== 'github.com') return d;
  }
  return null;
}

async function scrape(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; srvly-bot/1.0)' },
      signal: AbortSignal.timeout(5000)
    });
    const html = await resp.text();
    const m = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)
           || html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
    return m ? m[1].slice(0, 300).trim() : null;
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(console.error);
