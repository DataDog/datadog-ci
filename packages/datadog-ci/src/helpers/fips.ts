import crypto from 'crypto'

export const enableFips = (fips: boolean, ignoreError = false) => {
  try {
    // FIX-ME The mark command is calling tag.execute function, and when doing so, the fips option
    // is not reduced to a boolean, but remains a clipanion option, mistakenly enabling fips.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
    if (fips === true) {
      crypto.setFips(true)
    }
  } catch (error) {
    if (!ignoreError) {
      throw error
    }
  }
}
