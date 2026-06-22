const waitFor = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000))

interface TriggerTrafficOptions {
  attempts?: number
  requiredSuccesses?: number
  intervalSeconds?: number
}

// Poll an HTTP endpoint until it serves several successful responses. This does two things before
// we assert that telemetry flowed: it confirms the app is reliably up (cold starts return
// intermittent failures interleaved with the occasional 200, so a single success can be a fluke),
// and it drives sustained load -- the trace/log pipeline warms up a beat after the app starts
// serving, so the earliest requests' telemetry can be dropped, and we keep hitting the app so it
// actually reaches Datadog.
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
