const { randomInt } = require('node:crypto');

// Letters and digits that cannot be mistaken for each other when read aloud or typed (no 0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length) {
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

const normalizeCode = (value) => (typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

module.exports = { normalizeCode, randomCode };
