// Moves files that still live in np_file_chunks into Supabase Storage, one file at a time.
// Run locally with `npm run storage:migrate` after SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set;
// it runs on your machine, so a 30 MB file is not held back by the serverless body limit.
const storage = require('../api/_storage');

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain'
};

async function moveFilesToStorage(sql, { log = console.log } = {}) {
  if (!storage.isEnabled()) throw new Error('SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY sozlanmagan.');
  await storage.ensureBucket();
  const files = await sql`
    SELECT id, purpose, extension, filename FROM np_files
    WHERE storage_path IS NULL AND status='ready' ORDER BY created_at`;
  let moved = 0;
  for (const file of files) {
    const chunks = await sql`
      SELECT replace(encode(data, 'base64'), E'\n', '') AS data
      FROM np_file_chunks WHERE file_id=${file.id}::uuid ORDER BY chunk_index`;
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data, 'base64')));
    const path = `${file.purpose}/${file.id}.${file.extension}`;
    await storage.upload(path, bytes, CONTENT_TYPES[file.extension] || 'application/octet-stream');
    // The row points at Storage before the chunks go, so a crash in between loses nothing.
    await sql`UPDATE np_files SET storage_path=${path} WHERE id=${file.id}::uuid`;
    await sql`DELETE FROM np_file_chunks WHERE file_id=${file.id}::uuid`;
    moved += 1;
    log(`Ko‘chirildi: ${file.filename} (${bytes.length} bayt)`);
  }
  return moved;
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const sql = require('../api/_db');
  moveFilesToStorage(sql)
    .then((moved) => {
      console.log(`Tayyor: ${moved} ta fayl Storage’ga ko‘chirildi.`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { moveFilesToStorage };
