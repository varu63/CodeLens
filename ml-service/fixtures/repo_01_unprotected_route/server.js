const express = require('express')
const requireAuth = require('./auth')

const app = express()

app.get('/health', (req, res) => res.json({ ok: true }))

app.get('/admin/users', (req, res) => res.json([]))

app.post('/admin/users', (req, res) => res.status(201).json({}))

app.get('/profile', requireAuth, (req, res) => res.json({ id: 1 }))

app.listen(3000)
