import asyncPool from 'tiny-async-pool'

export const doWithMaxConcurrency = async <IN, OUT>(
  poolLimit: number,
  array: readonly IN[],
  iteratorFn: (generator: IN) => Promise<OUT>
): Promise<OUT[]> => {
  const results: OUT[] = []

  for await (const out of asyncPool(poolLimit, array, iteratorFn)) {
    results.push(out)
  }

  return results
}
