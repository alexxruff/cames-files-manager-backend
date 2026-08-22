const { explicarErrorDeConexion } = require('../../src/config/database')

/**
 * Traducción de los errores del driver a algo accionable.
 *
 * El caso de la versión incompatible es real y costó un rato: en las máquinas del
 * equipo el 27017 lo ocupa un `mongo:3.6` (el de talentlink-backend) y Mongoose 8
 * exige 4.2+. El driver lo dice en inglés y hablando de "wire version"; aquí se
 * traduce a qué hacer, y se deja de reintentar porque esperar no lo arregla.
 */
describe('config/database — explicarErrorDeConexion', () => {
  const error = (mensaje) => new Error(mensaje)

  it('explica la versión incompatible y no reintenta', () => {
    const resultado = explicarErrorDeConexion(
      error(
        'Server at 127.0.0.1:27017 reports maximum wire version 6, but this ' +
          'version of the Node.js Driver requires at least 8 (MongoDB 4.2)'
      )
    )

    expect(resultado.reintentar).toBe(false)
    expect(resultado.mensaje).toMatch(/4\.2 o superior/)
    expect(resultado.mensaje).toMatch(/db:up/)
    expect(resultado.mensaje).toMatch(/27018/)
  })

  it('explica las credenciales rechazadas y no reintenta', () => {
    for (const texto of ['Authentication failed.', 'bad auth : authentication failed']) {
      const resultado = explicarErrorDeConexion(error(texto))
      expect(resultado.reintentar).toBe(false)
      expect(resultado.mensaje).toMatch(/credenciales/i)
    }
  })

  it('explica la lista de IPs de Atlas y no reintenta', () => {
    const resultado = explicarErrorDeConexion(
      error("Could not connect to any servers... an IP that isn't whitelisted")
    )
    expect(resultado.reintentar).toBe(false)
    expect(resultado.mensaje).toMatch(/Network Access/)
  })

  it('sí reintenta cuando el servidor puede estar levantando', () => {
    const rechazada = explicarErrorDeConexion(
      error('connect ECONNREFUSED 127.0.0.1:27018')
    )
    expect(rechazada.reintentar).toBe(true)
    expect(rechazada.mensaje).toMatch(/db:up/)

    const dns = explicarErrorDeConexion(
      error('getaddrinfo ENOTFOUND cluster0.mongodb.net')
    )
    expect(dns.reintentar).toBe(true)
    expect(dns.mensaje).toMatch(/host/i)
  })

  it('un error desconocido se reintenta y no inventa explicación', () => {
    expect(explicarErrorDeConexion(error('algo nunca visto'))).toEqual({
      mensaje: null,
      reintentar: true
    })
  })

  it('tolera que no venga un Error', () => {
    expect(explicarErrorDeConexion(undefined).reintentar).toBe(true)
    expect(explicarErrorDeConexion({}).mensaje).toBeNull()
  })
})
