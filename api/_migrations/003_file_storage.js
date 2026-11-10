// Files uploaded while Supabase Storage is on keep their bytes there instead of in np_file_chunks.
module.exports = {
  version: '003_file_storage',
  async up(sql) {
    await sql`ALTER TABLE np_files ADD COLUMN IF NOT EXISTS storage_path TEXT`;
  }
};
