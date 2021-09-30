export {}
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(a: number, b: number): R
    }
    interface Matchers<R> {
      toBeError(errorClass: Error, s: string): R
    }
  }
}
