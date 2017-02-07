const test = require('tape')
const sumTime = require('./')

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

test('sumTime', function (t) {

  t.equal(
    sumTime('12h', '14h3m'),
    (12 * HOUR) + (14 * HOUR) + (3 * MINUTE),
    'two args'
  )

  t.equal(sumTime('1h', '3m', '4h'),
    (1 * HOUR) + (3 * MINUTE) + (4 * HOUR),
    'three args'
  )

  t.equal(
    sumTime('3h', 3 * HOUR),
    6 * HOUR,
    'varying inputs')

  t.end()
})
