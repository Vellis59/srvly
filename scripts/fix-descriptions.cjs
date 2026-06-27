const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(`
    SELECT id, recipe->>'content' as content
    FROM recipes 
    WHERE recipe IS NOT NULL 
      AND (description IS NULL OR description = '' OR description LIKE '>-%' OR description LIKE '|-%')
  `);
  console.log(`Apps with recipe data: ${rows.length}`);

  let fixed = 0;
  for (const { id, content } of rows) {
    if (!content) continue;

    let desc = null;
    for (const field of ['tagline', 'description']) {
      const re = new RegExp(`^${field}:\\s*>.?\\s*\\n\\s+(.+?)(?:\\n\\S|\\n\\n|\\z|$)`, 'ms');
      const m = content.match(re);
      if (m) {
        let d = m[1].replace(/\*\*/g, '').replace(/\n/g, ' ').trim();
        if (d.length > 30) { desc = d.slice(0, 300); break; }
      }
    }

    if (desc) {
      await client.query('UPDATE recipes SET description = $1 WHERE id = $2', [desc, id]);
      fixed++;
    }
  }

  console.log(`Fixed: ${fixed}/${rows.length}`);
  const { rows: [r] } = await client.query(`SELECT COUNT(*)::int as c FROM recipes WHERE LENGTH(description) > 50`);
  console.log(`Total with good descriptions: ${r.c}`);
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
