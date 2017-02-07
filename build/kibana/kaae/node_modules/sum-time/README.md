# sum-time

> Sum up time durations

* Parses [humanised times](https://github.com/jkroso/parse-duration) and ms
* As many arguments as desired to be summed

## Install

    $ npm install --save sum-time

## Usage

```js
const sumTime = require('sum-time')

sumTime('12h23m', 43 * 60 * 1000, '3h58m')
// = 61440000
```

## Licence

MIT &copy; [Ben Evans](https://bencevans.io)
