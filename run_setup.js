require('dotenv').config();
const setup = require('./api/setup');

const req = {};
const res = {
  status: function(s) {
    this.statusCode = s;
    return this;
  },
  json: function(data) {
    console.log(this.statusCode, data);
  }
};

setup(req, res).then(() => {
  console.log('Setup complete, exiting.');
  process.exit(0);
}).catch(console.error);
