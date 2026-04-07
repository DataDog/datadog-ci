export const builtinPluginCommands = {
  "coverage": ["upload"],
  "deployment": ["correlate-image", "correlate", "gate", "mark"],
  "dora": ["deployment"],
  "gate": ["evaluate"],
  "junit": ["upload"],
  "sarif": ["upload"],
  "sbom": ["upload"],
}

export const allPluginCommands = {
  "aas": ["instrument", "uninstrument"],
  "cloud-run": ["flare", "instrument", "uninstrument"],
  "container-app": ["instrument", "uninstrument"],
  "coverage": ["upload"],
  "deployment": ["correlate-image", "correlate", "gate", "mark"],
  "dora": ["deployment"],
  "gate": ["evaluate"],
  "junit": ["upload"],
  "lambda": ["cloudwatch", "flare", "instrument", "uninstrument"],
  "sarif": ["upload"],
  "sbom": ["upload"],
  "stepfunctions": ["instrument", "uninstrument"],
  "synthetics": ["deploy-tests", "import-tests", "run-tests", "upload-application"],
  "terraform": ["upload"],
}
