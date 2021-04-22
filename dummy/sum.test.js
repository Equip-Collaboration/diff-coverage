const { sum2, sumX, dummyFun } = require('./sum.js')

describe('sum2', () => {
  test('1 + 2 = 3', () => {
    expect(sum2(1, 2)).toBe(3)
  })
})

describe('sumX', () => {
  test('no args: 0 = 0', () => {
    expect(sumX()).toBe(0)
  })

  test('one arg: 1 = 1', () => {
    expect(sumX(1)).toBe(1)
  })

  test('three args: 1 + 2 + 3 = 6', () => {
    expect(sumX(1, 2, 3)).toBe(6)
  })
})

describe('dummyFun', () => {
  test('return "dummy string"', () => {
    expect(dummyFun()).toBe('dummy string')
  })
})
