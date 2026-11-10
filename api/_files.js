const sql = require('./_db');
const storage = require('./_storage');

// Vercel rejects bodies over 4.5 MB; 3 MiB of data is about 4.2 MB once base64-encoded.
const CHUNK_SIZE = 3 * 1024 * 1024;
const MAX_FILE_SIZE = 30 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'jpg', 'jpeg', 'png'];
const ALLOWED_EXTENSIONS = { pres: ['pptx'], doc: DOCUMENT_EXTENSIONS, task: DOCUMENT_EXTENSIONS };

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const SIGNATURES = {
  pdf: [0x25, 0x50, 0x44, 0x46],
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8, 0xff],
  jpeg: [0xff, 0xd8, 0xff],
  docx: ZIP, pptx: ZIP, xlsx: ZIP,
  doc: OLE, ppt: OLE, xls: OLE
};

function matchesSignature(extension, buffer) {
  if (extension === 'txt') return !buffer.includes(0);
  const signature = SIGNATURES[extension];
  return Boolean(signature) && signature.every((byte, index) => buffer[index] === byte);
}

function cleanFilename(value) {
  if (typeof value !== 'string') return '';
  const base = value.split(/[\\/]/).pop() || '';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(-200);
}

function extensionOf(filename) {
  const index = filename.lastIndexOf('.');
  return index > 0 ? filename.slice(index + 1).toLowerCase() : '';
}

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const publicFile = (row) => ({ id: row.id, name: row.filename, size: Number(row.size_bytes) });

// Returns the public descriptor of an attachable file, or null when it may not be attached.
async function findAttachable(fileId, { purpose, moduleId, stepType, ownerId = null }) {
  if (!isUuid(fileId)) return null;
  const rows = await sql`
    SELECT id, filename, size_bytes FROM np_files
    WHERE id=${fileId}::uuid AND purpose=${purpose} AND module_id=${moduleId}
      AND step_type=${stepType} AND status='ready'
      AND (${ownerId}::int IS NULL OR owner_id=${ownerId}::int)
    LIMIT 1`;
  return rows[0] ? publicFile(rows[0]) : null;
}

// Deleted rows hand back their Storage objects so those are removed too.
async function purgeStored(rows) {
  await storage.remove(rows.map((row) => row.storage_path));
}

async function deleteOtherContentFiles(moduleId, stepType, keepId) {
  await purgeStored(await sql`
    DELETE FROM np_files
    WHERE purpose='content' AND module_id=${moduleId} AND step_type=${stepType}
      AND (${keepId}::uuid IS NULL OR id <> ${keepId}::uuid)
    RETURNING storage_path`);
}

module.exports = {
  ALLOWED_EXTENSIONS, CHUNK_SIZE, MAX_FILE_SIZE,
  cleanFilename, deleteOtherContentFiles, extensionOf, findAttachable, isUuid, matchesSignature, publicFile, purgeStored
};
