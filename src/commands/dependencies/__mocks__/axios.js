const axios = require('axios')

module.exports = axios
module.exports.create = jest.fn(() => () => Promise.resolve())
