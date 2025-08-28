const util = jest.requireActual('util')
const originalInspect = util.inspect

const newInspect = (object, options) => {
  return originalInspect(object, {...options, colors: false, depth: options.depth})
}

Object.assign(newInspect, originalInspect)
util.inspect = newInspect
module.exports = util
