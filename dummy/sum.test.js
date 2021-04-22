const { sum2 } = require('./sum.js')

describe('sum2', () => {
  test('1 + 2 = 3', () => {
    expect(sum2(1, 2)).toBe(3)
  })
})
