require('dotenv').config();
const setup = require('./api/setup');

const req = {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.SETUP_SECRET || ''}` }
};
const res = {
  status: function(s) {
    this.statusCode = s;
    return this;
  },
  json: function(data) {
    console.log(this.statusCode || 200, data);
    if ((this.statusCode || 200) >= 400) process.exitCode = 1;
  }
};

setup(req, res).then(() => {
  if (!process.exitCode) console.log('Sozlash yakunlandi.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
