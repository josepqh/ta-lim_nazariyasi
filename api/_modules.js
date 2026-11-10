const sql = require('./_db');

// Teachers manage the modules they created; the administrator manages every module.
// Sends the error response itself and returns null when the module may not be changed.
async function loadManagedModule(res, user, moduleId, { deleted = false } = {}) {
  if (!Number.isSafeInteger(moduleId) || moduleId < 1) {
    res.status(400).json({ error: 'Modul raqami noto‘g‘ri.' });
    return null;
  }
  const rows = await sql`
    SELECT id, created_by FROM np_modules
    WHERE id=${moduleId} AND (deleted_at IS NOT NULL) = ${deleted}::boolean LIMIT 1`;
  if (!rows.length) {
    res.status(404).json({ error: 'Modul topilmadi.' });
    return null;
  }
  if (!canManage(user, rows[0])) {
    res.status(403).json({ error: 'Bu modulni faqat uning muallifi yoki administrator o‘zgartira oladi.' });
    return null;
  }
  return rows[0];
}

function canManage(user, module) {
  return user.role === 'admin' || (user.role === 'teacher' && Number(module.created_by) === Number(user.id));
}

module.exports = { canManage, loadManagedModule };
