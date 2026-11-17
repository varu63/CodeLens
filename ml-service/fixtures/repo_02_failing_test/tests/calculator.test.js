const test = require('node:test')
const assert = require('node:assert')
const { add } = require('../src/calculator')

test('adds two numbers', () => {
  assert.strictEqual(add(1, 1), 3)
})
