const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const ROOT = path.join(__dirname, '../');
let scriptPaths = require(path.join(ROOT, './package.json')).bin;

const INSERT = '#!/usr/bin/env node';

/**
 * The forEach loop below requires an object with script paths as properties to loop over. When the `bin` property in
 * the package.json only has a single property, then the object is converted to a string upon a `yarn install` call
 * (see: https://docs.npmjs.com/cli/v9/configuring-npm/package-json#bin). The string to object transformation here thus
 * allows us to support 1+ properties whilst keeping the loop below.
 */
if (typeof scriptPaths === 'string') {
  scriptPaths = { "datadog-ci": scriptPaths }
}

// Loop through all the bin we have in the package.json
Object.values(scriptPaths).forEach(async script => {
  const scriptPath = path.join(ROOT, script);
  const content = await promisify(fs.readFile)(scriptPath, 'utf8');
  if (!content.startsWith(INSERT)) {
    // Prepend it with the shebang config.
    await promisify(fs.writeFile)(scriptPath, `${INSERT}\n${content}`);
  }
  // Make it executable.
  await promisify(fs.chmod)(scriptPath, '755');
});
