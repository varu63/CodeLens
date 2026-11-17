const express = require('express')
const requireAuth = require('./auth')

const app = express()

app.get('/health', (req, res) => res.json({ ok: true }))
app.post('/auth/login', (req, res) => res.json({ token: 'demo' }))
app.get('/users', requireAuth, (req, res) => res.json([]))
app.post('/users', requireAuth, (req, res) => res.status(201).json({}))

app.listen(3000)
