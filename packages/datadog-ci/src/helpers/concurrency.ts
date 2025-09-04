import asyncPool from 'tiny-async-pool'

export const doWithMaxConcurrency = async <In, Out>(
  poolLimit: number,
  array: readonly In[],
  iteratorFn: (generator: In) => Promise<Out>
): Promise<Out[]> => {
  const results: Out[] = []

  for await (const out of asyncPool(poolLimit, array, iteratorFn)) {
    results.push(out)
  }

  return results
}
