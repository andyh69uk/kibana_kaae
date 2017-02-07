var parseTime = require('parse-duration')

module.exports = function sumTime () {
  var args = Array.prototype.slice.call(arguments)
  return args.reduce(function (prev, curr) {
    if (typeof curr === 'string') {
      return prev + parseTime(curr)
    } else {
      return prev + curr
    }
  }, 0)
}
