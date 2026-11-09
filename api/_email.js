// Returns one form per mailbox (Gmail ignores dots, +tags and the googlemail domain), or null if not a Gmail address.
function normalizeGmail(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().toLowerCase().match(/^([a-z0-9._+-]{1,64})@(gmail\.com|googlemail\.com)$/);
  if (!match) return null;
  const local = match[1].split('+')[0].replace(/\./g, '');
  return local ? `${local}@gmail.com` : null;
}

module.exports = { normalizeGmail };
