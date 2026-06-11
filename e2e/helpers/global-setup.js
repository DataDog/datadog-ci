module.exports = function () {
  if (!process.env.DD_API_KEY && !process.env.DATADOG_API_KEY) {
    throw new Error(
      'Missing DD_API_KEY / DATADOG_API_KEY. Run e2e tests via: dd-auth --domain <your-org-domain> -- yarn test:e2e'
    )
  }
}
