const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');

const ROOT = path.join(__dirname, '../');
const scriptPaths = require(path.join(ROOT, './package.json')).bin;
const execute = promisify(exec);

const INSERT = '#!/usr/bin/env node';

// Loop through all the bin we have in the package.json
Object.values(scriptPaths).forEach(async script => {
    const scriptPath = path.join(ROOT, script);
    const content = await fs.readFile(scriptPath, 'utf8');
    // Prepend it with the shebang config.
    await fs.writeFile(scriptPath, `${INSERT}\n${content}`);
    // Make it executable.
    await fs.chmod(scriptPath, '755');
});
