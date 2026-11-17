const express = require('express')
const requireAuth = require('./auth')

const app = express()

app.get('/report', requireAuth, (req, res) => {
  setTimeout(() => res.json({ rows: [] }), 750)
})

app.get('/health', (req, res) => res.json({ ok: true }))

app.listen(3000)
