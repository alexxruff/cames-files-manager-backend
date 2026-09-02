const express = require('express')
const request = require('supertest')

const { schema } = require('../../src/config/env.schema')
const {
  recibirArchivo,
  recibirArchivoHasta
} = require('../../src/middlewares/uploadMiddleware')
const { errorHandler } = require('../../src/middlewares/errorHandler')

/**
 * Los topes de subida (D-81).
 *
 * Son dos y no uno a propósito: el general subió a 30 MB porque un contrato de
 * obra escaneado pasa de 20, pero la importación de nómina se quedó abajo —
 * `exceljs` abre el libro entero en memoria y lo expande, así que ahí el archivo
 * grande es lo que tira la máquina—. Que el segundo no se arrastre con el
 * primero es justo lo que se vigila aquí.
 */
const MB = 1024 * 1024

/** Un servidor mínimo con un solo receptor, para probar el middleware solo. */
function servidorCon(receptor) {
  const app = express()
  app.post('/subir', receptor, (req, res) => res.json({ bytes: req.file?.size ?? 0 }))
  app.use(errorHandler)
  return app
}

describe('Los topes de subida', () => {
  describe('lo que dice el esquema del entorno', () => {
    const defaults = () =>
      schema.parse({
        MONGODB_URI: 'mongodb://127.0.0.1:27017',
        JWT_SECRET: 'secreto-de-pruebas-con-mas-de-32-caracteres-1234567890'
      })

    it('el general son 30 MB', () => {
      expect(defaults().MAX_UPLOAD_BYTES).toBe(30 * MB)
    })

    it('el de la importación de nómina son 10 MB, y es menor que el general', () => {
      const env = defaults()
      expect(env.MAX_IMPORT_UPLOAD_BYTES).toBe(10 * MB)
      expect(env.MAX_IMPORT_UPLOAD_BYTES).toBeLessThan(env.MAX_UPLOAD_BYTES)
    })
  })

  describe('el receptor con su propio tope', () => {
    const app = servidorCon(recibirArchivoHasta(2 * MB))

    it('deja pasar lo que cabe', async () => {
      const res = await request(app)
        .post('/subir')
        .attach('archivo', Buffer.alloc(MB, 0x20), 'cabe.bin')

      expect(res.status).toBe(200)
      expect(res.body.bytes).toBe(MB)
    })

    it('responde 413 diciendo el tope que aplicó, no el general', async () => {
      const res = await request(app)
        .post('/subir')
        .attach('archivo', Buffer.alloc(3 * MB, 0x20), 'no-cabe.bin')

      expect(res.status).toBe(413)
      expect(res.body.message).toBe('El archivo pasa de 2 MB. Comprímelo o divídelo.')
    })
  })

  describe('el receptor general', () => {
    it('acepta un archivo de 22 MB, que es lo que pesa un contrato de obra', async () => {
      const res = await request(servidorCon(recibirArchivo))
        .post('/subir')
        .attach('archivo', Buffer.alloc(22 * MB, 0x20), 'contrato.bin')

      expect(res.status).toBe(200)
      expect(res.body.bytes).toBe(22 * MB)
    })
  })
})
