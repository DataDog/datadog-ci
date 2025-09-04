import path from 'node:path'

const changeDirToPackageRoot = () => {
  const {testPath} = expect.getState()
  if (!testPath) {
    return
  }

  // Assumes all tests are in the `./packages` directory
  const packagesDir = path.join(__dirname, 'packages')
  const relativeToPackagesDir = path.relative(packagesDir, testPath)
  const packageName = relativeToPackagesDir.split(path.sep)[0]
  const packageRoot = path.join(packagesDir, packageName)
  process.chdir(packageRoot)
}

// Ensure tests that reference './src/...' run with CWD at the package root.
// This allows to run `yarn test <file>` on files from any package.
changeDirToPackageRoot()
