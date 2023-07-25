const {execSync} = require('child_process')

const res = JSON.parse(execSync('yarn jest:show-config').toString())

console.log(res.configs[0].cacheDirectory)