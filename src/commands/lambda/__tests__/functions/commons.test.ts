import { getLayerName, getRegion } from '../../functions/commons'

describe('commons', () => {
  describe('getRegion', () => {
    test('should return the expected region', () => {
      const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
      const expectedRegion = 'us-east-1'

      const region = getRegion(functionARN)
      expect(region).toBe(expectedRegion)
    })

    test('should return undefined if Function ARN does not contain the region', () => {
      const functionName = 'lambda-hello-world'

      const region = getRegion(functionName)
      expect(region).toBe(undefined)
    })
  })

  describe('getLayerName', () => {
    test('should return the expected layer name', () => {
      const layerARN = 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:10'
      const expectedLayerName = 'Datadog-Node12-x'

      const layerName = getLayerName(layerARN)
      expect(layerName).toBe(expectedLayerName)
    })

    test('should return undefined if layer ARN does not contain the layer name', () => {
      const layerARN = 'arn:aws:lambda:invalid-layer:Datadog-Node12-x'

      const layerName = getLayerName(layerARN)
      expect(layerName).toBe(undefined)
    })
  })
})
