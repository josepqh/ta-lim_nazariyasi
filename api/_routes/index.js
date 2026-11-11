// Every API endpoint, by the name in /api/<name>. Static requires keep them all in one bundle.
module.exports = {
  articles: require('./articles'),
  audit: require('./audit'),
  auth: require('./auth'),
  certificates: require('./certificates'),
  chat: require('./chat'),
  contact: require('./contact'),
  content: require('./content'),
  errors: require('./errors'),
  files: require('./files'),
  groups: require('./groups'),
  images: require('./images'),
  modules: require('./modules'),
  profile: require('./profile'),
  progress: require('./progress'),
  quiz: require('./quiz'),
  setup: require('./setup'),
  stats: require('./stats'),
  users: require('./users')
};
