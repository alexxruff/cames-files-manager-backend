/**
 * La clave de almacenamiento: es lo que separa un bucket ordenado de una
 * inyección de rutas.
 *
 * `env` está congelado, así que el prefijo no se puede cambiar en caliente: hay
 * que recargar los módulos con `process.env` ya puesto.
 */
function conPrefijo(prefijo) {
  jest.resetModules()
  const anterior = process.env.R2_PREFIX
  process.env.R2_PREFIX = prefijo
  try {
    return require('../../src/services/storageService')
  } finally {
    process.env.R2_PREFIX = anterior
  }
}

const DATOS = {
  empleadoId: '6a8a076d2d83d48577c1abfa',
  tipo: 'ine',
  version: 1,
  extension: 'pdf'
}

describe('construirClave', () => {
  afterAll(() => jest.resetModules())

  it('sin prefijo, cuelga de la raíz del bucket', () => {
    const clave = conPrefijo('').construirClave(DATOS)
    expect(clave).toMatch(
      /^expedientes\/6a8a076d2d83d48577c1abfa\/ine\/v1-[0-9a-f-]{36}\.pdf$/
    )
  })

  it('con prefijo, todo va bajo esa carpeta', () => {
    // El bucket se comparte con otros proyectos: `cames-files/employes-files/`.
    const clave = conPrefijo('employes-files').construirClave(DATOS)
    expect(clave).toMatch(
      /^employes-files\/expedientes\/6a8a076d2d83d48577c1abfa\/ine\/v1-[0-9a-f-]{36}\.pdf$/
    )
  })

  it('las barras de sobra del prefijo no producen claves con //', () => {
    const clave = conPrefijo('/employes-files/').construirClave(DATOS)
    expect(clave.startsWith('employes-files/expedientes/')).toBe(true)
    expect(clave).not.toContain('//')
  })

  it('la extensión se limpia: la clave no la controla quien sube', () => {
    const storage = conPrefijo('')
    const clave = storage.construirClave({ ...DATOS, extension: '../../etc/passwd' })
    expect(clave).not.toContain('..')
    expect(clave).not.toContain('/etc/')
    expect(clave.endsWith('.etcpasswd')).toBe(true)
  })
})

/**
 * La clave de un adjunto administrativo (D-79). Mismo riesgo que la del
 * expediente y mismo blindaje: nada de lo que escribe el usuario entra en la
 * ruta.
 */
describe('construirClaveAdjunto', () => {
  const DATOS_ADJUNTO = {
    carpeta: 'registros-obra',
    ids: ['6a8a076d2d83d48577c1abfa', '6a8a076d2d83d48577c1abfb'],
    extension: 'pdf'
  }

  afterAll(() => jest.resetModules())

  it('cuelga del cliente y termina en el registro, con uuid', () => {
    const clave = conPrefijo('').construirClaveAdjunto(DATOS_ADJUNTO)
    expect(clave).toMatch(
      /^registros-obra\/6a8a076d2d83d48577c1abfa\/6a8a076d2d83d48577c1abfb-[0-9a-f-]{36}\.pdf$/
    )
  })

  it('dos subidas del mismo registro no comparten clave: reemplazar no pisa', () => {
    const storage = conPrefijo('')
    expect(storage.construirClaveAdjunto(DATOS_ADJUNTO)).not.toBe(
      storage.construirClaveAdjunto(DATOS_ADJUNTO)
    )
  })

  it('respeta el prefijo del bucket compartido', () => {
    const clave = conPrefijo('employes-files').construirClaveAdjunto(DATOS_ADJUNTO)
    expect(clave.startsWith('employes-files/registros-obra/')).toBe(true)
  })

  it('ni los ids ni la extensión pueden meter rutas', () => {
    const clave = conPrefijo('').construirClaveAdjunto({
      carpeta: 'registros-obra',
      ids: ['../../etc', 'passwd/../..'],
      extension: '../sh'
    })
    expect(clave).not.toContain('..')
    expect(clave.split('/')).toHaveLength(3)
  })
})
