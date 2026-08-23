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
