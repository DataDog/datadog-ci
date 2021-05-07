const axios = require('axios')

module.exports = axios
module.exports.post = jest.fn(() => Promise.resolve())
