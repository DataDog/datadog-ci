const waitFor = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000))

interface TriggerTrafficOptions {
  attempts?: number
  requiredSuccesses?: number
  intervalSeconds?: number
}

// Poll an HTTP endpoint until it serves successful responses, giving a freshly
// deployed app time to cold-start before we assert that telemetry flowed.
export const triggerTraffic = async (
  url: string,
  {attempts = 12, requiredSuccesses = 3, intervalSeconds = 10}: TriggerTrafficOptions = {}
): Promise<void> => {
  let successfulRequests = 0
  let lastError = ''

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(30_000)})
      const body = await response.text()
      console.log(`[traffic] attempt ${attempt}/${attempts} returned ${response.status}`)
      if (response.ok) {
        successfulRequests++
        if (successfulRequests >= requiredSuccesses) {
          return
        }
      } else {
        lastError = `${response.status}: ${body.slice(0, 200)}`
      }
    } catch (error) {
      lastError = String(error)
      console.log(`[traffic] attempt ${attempt}/${attempts} failed: ${lastError}`)
    }

    await waitFor(intervalSeconds)
  }

  throw new Error(`Failed to trigger traffic at ${url}: ${lastError}`)
}
