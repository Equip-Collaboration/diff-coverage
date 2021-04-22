module.exports.sum2 = function sum2(a, b) {
  return a + b
}

module.exports.sumX = function sumX(...args) {
  return args.reduce((prev, curr) => prev + curr, 0)
}
