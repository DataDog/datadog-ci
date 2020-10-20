import {Readable} from 'stream'

export const streamToString = (stream: Readable): Promise<string> => {
  const chunks: any[] = []

  return new Promise((resolve, reject) => {
    const handleData = (chunk: any) => chunks.push(chunk)
    const handleError = (error: any) => {
      stream.off('data', handleData)
      stream.off('end', handleEnd)

      reject(error)
    }
    const handleEnd = () => {
      stream.off('data', handleData)
      stream.off('error', handleError)

      resolve(chunks.join(''))
    }
    stream.on('data', handleData)
    stream.once('error', handleError)
    stream.once('end', handleEnd)

    stream.resume()
  })
}
