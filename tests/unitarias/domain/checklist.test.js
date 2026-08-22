const {
  createChecklist,
  syncChecklist,
  resolveTemplate
} = require('../../../src/utils/domain')

const plantilla = (documentos, extra = {}) => ({
  clave: null,
  nombre: 'Plantilla',
  tiposContrato: ['indeterminado'],
  areas: null,
  documentos,
  ...extra
})

const renglon = (tipo, requerido = true, vigenciaMeses = null) => ({
  tipo,
  requerido,
  vigenciaMeses
})

const archivo = { nombre: 'ine.pdf', mime: 'application/pdf', tamanoBytes: 1024 }

describe('domain/createChecklist — spec 7.1', () => {
  it('crea un documento pendiente y vacío por cada renglón', () => {
    const documentos = createChecklist(
      plantilla([
        renglon('ine'),
        renglon('examen_medico', true, 12),
        renglon('cv', false)
      ])
    )

    expect(documentos).toHaveLength(3)
    expect(documentos[0]).toEqual({
      tipo: 'ine',
      requerido: true,
      estatus: 'pending',
      vigenciaMeses: null,
      vigenciaHasta: null,
      archivo: null,
      motivoRechazo: null,
      revisadoPor: null,
      revisadoEn: null,
      versiones: []
    })
    expect(documentos[1].vigenciaMeses).toBe(12)
    expect(documentos[2].requerido).toBe(false)
  })

  it('conserva el orden de la plantilla, que es el que el front pinta', () => {
    const documentos = createChecklist(plantilla([renglon('curp'), renglon('ine')]))
    expect(documentos.map((d) => d.tipo)).toEqual(['curp', 'ine'])
  })
})

describe('domain/syncChecklist — spec 7.2', () => {
  it('conserva estatus, archivo y versiones de lo que sigue en la plantilla', () => {
    const existentes = [
      {
        tipo: 'ine',
        requerido: true,
        estatus: 'validated',
        vigenciaMeses: null,
        vigenciaHasta: '2027-01-01',
        archivo,
        versiones: [{ version: 1, archivo, estatus: 'validated' }]
      }
    ]

    const [resultado] = syncChecklist(existentes, plantilla([renglon('ine', false, 24)]))

    expect(resultado.estatus).toBe('validated')
    expect(resultado.archivo).toEqual(archivo)
    expect(resultado.versiones).toHaveLength(1)
    // Sólo se actualizan estos dos.
    expect(resultado.requerido).toBe(false)
    expect(resultado.vigenciaMeses).toBe(24)
  })

  it('agrega en pending lo que la plantilla nueva pide', () => {
    const resultado = syncChecklist(
      [{ tipo: 'ine', requerido: true, estatus: 'validated', versiones: [] }],
      plantilla([renglon('ine'), renglon('nss')])
    )

    expect(resultado).toHaveLength(2)
    expect(resultado[1]).toMatchObject({ tipo: 'nss', estatus: 'pending', versiones: [] })
  })

  it('conserva como opcional lo que ya no pide la plantilla pero tiene versiones', () => {
    const resultado = syncChecklist(
      [
        { tipo: 'ine', requerido: true, estatus: 'pending', versiones: [] },
        {
          tipo: 'comprobante_estudios',
          requerido: true,
          estatus: 'validated',
          archivo,
          versiones: [{ version: 1, archivo, estatus: 'validated' }]
        }
      ],
      plantilla([renglon('ine')])
    )

    expect(resultado).toHaveLength(2)
    const conservado = resultado.find((d) => d.tipo === 'comprobante_estudios')
    // Nunca se borra trabajo hecho.
    expect(conservado.requerido).toBe(false)
    expect(conservado.estatus).toBe('validated')
    expect(conservado.versiones).toHaveLength(1)
  })

  it('descarta lo que ya no pide la plantilla y estaba vacío', () => {
    const resultado = syncChecklist(
      [
        { tipo: 'ine', requerido: true, estatus: 'pending', versiones: [] },
        { tipo: 'cv', requerido: true, estatus: 'pending', versiones: [] }
      ],
      plantilla([renglon('ine')])
    )

    expect(resultado.map((d) => d.tipo)).toEqual(['ine'])
  })

  it('no muta el checklist que recibe', () => {
    const existentes = [
      { tipo: 'ine', requerido: true, estatus: 'validated', versiones: [] }
    ]
    syncChecklist(existentes, plantilla([renglon('ine', false)]))
    expect(existentes[0].requerido).toBe(true)
  })
})

describe('domain/resolveTemplate — especificidad del spec 4', () => {
  const global = plantilla([renglon('ine')], {
    clave: 'plantilla-general',
    nombre: 'global sin área'
  })
  const globalConArea = plantilla([renglon('ine')], {
    nombre: 'global con área',
    areas: ['obra']
  })
  const delCliente = plantilla([renglon('ine')], {
    nombre: 'cliente sin área',
    clienteId: 'cliente-a'
  })
  const delClienteConArea = plantilla([renglon('ine')], {
    nombre: 'cliente con área',
    clienteId: 'cliente-a',
    areas: ['obra']
  })
  const todas = [global, globalConArea, delCliente, delClienteConArea]

  const elegir = (opciones) => resolveTemplate(todas, opciones)?.nombre

  it('fase 1 (sin cliente): prefiere la que empata el área', () => {
    expect(elegir({ area: 'obra', tipoContrato: 'indeterminado' })).toBe(
      'global con área'
    )
  })

  it('fase 1: cae a la global sin área cuando el área no empata', () => {
    expect(elegir({ area: 'ventas', tipoContrato: 'indeterminado' })).toBe(
      'global sin área'
    )
  })

  it('fase 2: la del cliente con área gana a todas', () => {
    expect(
      elegir({ area: 'obra', tipoContrato: 'indeterminado', clienteId: 'cliente-a' })
    ).toBe('cliente con área')
  })

  it('fase 2: la del cliente sin área gana a las globales', () => {
    expect(
      elegir({ area: 'ventas', tipoContrato: 'indeterminado', clienteId: 'cliente-a' })
    ).toBe('cliente sin área')
  })

  it('fase 2: un cliente sin plantillas propias usa las globales', () => {
    expect(
      elegir({ area: 'obra', tipoContrato: 'indeterminado', clienteId: 'cliente-z' })
    ).toBe('global con área')
  })

  it('filtra primero por tipo de contrato', () => {
    const soloPrueba = plantilla([renglon('ine')], {
      nombre: 'prueba',
      tiposContrato: ['prueba']
    })
    expect(
      resolveTemplate([global, soloPrueba], { area: 'obra', tipoContrato: 'prueba' })
        .nombre
    ).toBe('prueba')
  })

  it('sin plantilla compatible cae a plantilla-general como red de seguridad', () => {
    const rara = plantilla([renglon('ine')], {
      nombre: 'rara',
      tiposContrato: ['prueba']
    })
    expect(
      resolveTemplate([rara, global], { area: 'obra', tipoContrato: 'obra_determinada' })
        .nombre
    ).toBe('global sin área')
  })

  it('sin plantillas devuelve null en vez de reventar', () => {
    expect(
      resolveTemplate([], { area: 'obra', tipoContrato: 'indeterminado' })
    ).toBeNull()
  })

  it('trata una lista de áreas vacía igual que null (todas)', () => {
    const vacia = plantilla([renglon('ine')], { nombre: 'vacía', areas: [] })
    expect(
      resolveTemplate([vacia], { area: 'ventas', tipoContrato: 'indeterminado' }).nombre
    ).toBe('vacía')
  })
})
