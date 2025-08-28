const fs = jest.createMockFromModule('fs')

// aws sdk v3 still uses fs.promises instead of fs/promises
// this will be *hopefully* removed when they stop supporting
// node 12
fs.promises = {
  readFile: (_) => Promise.resolve()
}

fs.readFile = jest.fn()

module.exports = fs
