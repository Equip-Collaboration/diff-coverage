module.exports.multX = function multX(...args) {
  return args.reduce((prev, curr) => prev * curr, 1)
}
