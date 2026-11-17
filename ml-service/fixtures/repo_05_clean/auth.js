module.exports = function requireAuth(req, res, next) {
  if (!req.headers.authorization) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  next()
}
