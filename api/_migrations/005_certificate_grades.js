// A certificate states the final result of the whole module: a percentage and a grade on the
// five-point scale. Certificates issued before grading existed keep empty values until the
// teacher scores the practical task and the reflection.
module.exports = {
  version: '005_certificate_grades',
  async up(sql) {
    await sql`ALTER TABLE np_certificates ADD COLUMN IF NOT EXISTS percent SMALLINT CHECK (percent BETWEEN 0 AND 100)`;
    await sql`ALTER TABLE np_certificates ADD COLUMN IF NOT EXISTS grade SMALLINT CHECK (grade BETWEEN 2 AND 5)`;
  }
};
