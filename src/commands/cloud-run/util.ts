import {GoogleAuth} from 'google-auth-library'

/**
 * Check if the user is authenticated with GCP.
 * @returns true if the user is authenticated, false otherwise
 */
export const checkAuthentication = async () => {
  const auth = new GoogleAuth()
  try {
    await auth.getApplicationDefault()

    return true
  } catch (_) {
    return false
  }
}
