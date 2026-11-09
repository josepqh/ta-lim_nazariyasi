const { Pool } = require('pg');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL sozlanmagan.');

// sslmode in the URL would override the ssl option below.
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');

// One connection per serverless instance; Supabase's transaction pooler shares them on its side.
// The connection is encrypted; the certificate is not checked because Supabase signs it with its own CA.
const pool = new Pool({
  connectionString: url.toString(),
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000
});
pool.on('error', (error) => console.error('Database connection error:', error.message));

// Tagged template: every value is sent as a bound parameter, never joined into the SQL text.
async function sql(strings, ...values) {
  const text = strings.reduce((query, part, index) => `${query}$${index}${part}`);
  const { rows } = await pool.query(text, values);
  return rows;
}

module.exports = sql;
