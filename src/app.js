const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const env = require('./config/env')
const routes = require('./api/v1/routes')
const { AppError, errorHandler, notFoundHandler } = require('./middlewares/errorHandler')
const { requestContext, requestLogger } = require('./middlewares/requestContext')
const { apiLimiter } = require('./middlewares/rateLimiters')

const app = express()

// Detrás de proxy (Fly.io, nginx): sin esto `req.ip` es la del proxy y el rate
// limit por IP no distingue a nadie.
app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(helmet())

/**
 * CORS con lista blanca desde el entorno (`CORS_ORIGINS`).
 * En `talentlink-backend` los orígenes estaban escritos en el código, así que
 * cada dominio nuevo exigía un despliegue.
 */
const corsOptions = {
  origin(origin, callback) {
    // Sin `Origin`: peticiones del mismo servidor, curl o health checks.
    if (!origin) return callback(null, true)
    if (env.CORS_ORIGINS.includes(origin)) return callback(null, true)
    return callback(new AppError(403, 'Origen no permitido por la política de CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'X-Requested-With',
    'X-Request-Id'
  ],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600
}
app.use(cors(corsOptions))

// Los archivos de expediente NO viajan como JSON: van por multipart con su
// propio límite (10 MB, spec 13). 1 MB alcanza de sobra para cualquier cuerpo.
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

app.use(compression())
app.use(requestContext)
app.use(requestLogger)
app.use('/api/v1', apiLimiter)

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'API de expedientes laborales (Urbacames)',
    data: { version: 'v1', base: '/api/v1' }
  })
})

app.use('/api/v1', routes)

app.use(notFoundHandler)
app.use(errorHandler)

module.exports = app
