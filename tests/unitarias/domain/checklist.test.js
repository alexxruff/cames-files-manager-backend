const {
  resolveTemplate,
  unirRenglones,
  construirChecklist,
  syncChecklist,
  createChecklist
} = require('../../../src/utils/domain')

const plantilla = (extra = {}) => ({
  _id: extra._id || 'p1',
  clave: null,
  activo: true,
  nombre: 'Plantilla',
  tiposContrato: ['indeterminado'],
  areas: null,
  empresaId: null,
  documentos: [{ tipo: 'ine', requerido: true, vigenciaMeses: null }],
  ...extra
})

const renglon = (tipo, requerido = true, vigenciaMeses = null) => ({
  tipo,
  requerido,
  vigenciaMeses
})

describe('domain/resolveTemplate — especificidad (modelo-datos §6.2)', () => {
  const global = plantilla({
    _id: 'g',
    nombre: 'global sin área',
    clave: 'plantilla-general'
  })
  const globalConArea = plantilla({
    _id: 'ga',
    nombre: 'global con área',
    areas: ['operaciones_urbanizadora']
  })
  const deEmpresa = plantilla({
    _id: 'e',
    nombre: 'empresa sin área',
    empresaId: 'emp-1'
  })
  const deEmpresaConArea = plantilla({
    _id: 'ea',
    nombre: 'empresa con área',
    empresaId: 'emp-1',
    areas: ['operaciones_urbanizadora']
  })
  const todas = [global, globalConArea, deEmpresa, deEmpresaConArea]

  const elegir = (opciones) => resolveTemplate(todas, opciones)?.nombre

  it('la de la empresa que empata área gana a todas', () => {
    expect(
      elegir({
        empresaId: 'emp-1',
        areas: ['operaciones_urbanizadora'],
        tipoContrato: 'indeterminado'
      })
    ).toBe('empresa con área')
  })

  it('la de la empresa sin área gana a las globales', () => {
    expect(
      elegir({ empresaId: 'emp-1', areas: ['comercial'], tipoContrato: 'indeterminado' })
    ).toBe('empresa sin área')
  })

  it('una empresa sin plantillas propias usa las globales', () => {
    expect(
      elegir({
        empresaId: 'emp-9',
        areas: ['operaciones_urbanizadora'],
        tipoContrato: 'indeterminado'
      })
    ).toBe('global con área')
    expect(
      elegir({ empresaId: 'emp-9', areas: ['comercial'], tipoContrato: 'indeterminado' })
    ).toBe('global sin área')
  })

  it('empata si CUALQUIERA de sus áreas coincide', () => {
    // Una adscripción puede tener varias áreas.
    expect(
      elegir({
        empresaId: 'emp-9',
        areas: ['comercial', 'operaciones_urbanizadora'],
        tipoContrato: 'indeterminado'
      })
    ).toBe('global con área')
  })

  it('filtra primero por tipo de contrato', () => {
    const soloPrueba = plantilla({
      _id: 'pr',
      nombre: 'prueba',
      tiposContrato: ['prueba']
    })
    expect(
      resolveTemplate([global, soloPrueba], {
        areas: ['operaciones_urbanizadora'],
        tipoContrato: 'prueba'
      }).nombre
    ).toBe('prueba')
  })

  it('ignora las plantillas desactivadas', () => {
    const inactiva = plantilla({
      _id: 'i',
      nombre: 'inactiva',
      areas: ['operaciones_urbanizadora'],
      activo: false
    })
    expect(
      resolveTemplate([inactiva, global], {
        areas: ['operaciones_urbanizadora'],
        tipoContrato: 'indeterminado'
      }).nombre
    ).toBe('global sin área')
  })

  it('sin ninguna compatible cae a plantilla-general', () => {
    const rara = plantilla({ _id: 'r', nombre: 'rara', tiposContrato: ['prueba'] })
    expect(
      resolveTemplate([rara, global], {
        areas: ['operaciones_urbanizadora'],
        tipoContrato: 'obra_determinada'
      }).nombre
    ).toBe('global sin área')
  })

  it('sin plantillas devuelve null en vez de reventar', () => {
    expect(
      resolveTemplate([], {
        areas: ['operaciones_urbanizadora'],
        tipoContrato: 'indeterminado'
      })
    ).toBeNull()
  })
})

describe('domain/unirRenglones — la condición más estricta gana', () => {
  it('requerido gana a opcional', () => {
    const union = unirRenglones([[renglon('cv', false)], [renglon('cv', true)]])
    expect(union).toEqual([{ tipo: 'cv', requerido: true, vigenciaMeses: null }])
  })

  it('la vigencia más corta gana', () => {
    const union = unirRenglones([
      [renglon('examen_medico', true, 12)],
      [renglon('examen_medico', true, 6)]
    ])
    expect(union[0].vigenciaMeses).toBe(6)
  })

  it('una vigencia nula no compite: significa "no caduca"', () => {
    expect(
      unirRenglones([
        [renglon('examen_medico', true, null)],
        [renglon('examen_medico', true, 6)]
      ])[0].vigenciaMeses
    ).toBe(6)
    expect(
      unirRenglones([[renglon('ine', true, null)], [renglon('ine', true, null)]])[0]
        .vigenciaMeses
    ).toBeNull()
  })

  it('suma los tipos que sólo pide una de las plantillas', () => {
    const union = unirRenglones([
      [renglon('ine'), renglon('cv')],
      [renglon('ine'), renglon('alta_imss')]
    ])
    expect(union.map((r) => r.tipo)).toEqual(['ine', 'cv', 'alta_imss'])
  })

  it('sin plantillas devuelve una lista vacía', () => {
    expect(unirRenglones([])).toEqual([])
  })
})

describe('domain/construirChecklist — el expediente es de la persona', () => {
  const deObra = plantilla({
    _id: 'operaciones_urbanizadora',
    nombre: 'operaciones_urbanizadora',
    areas: ['operaciones_urbanizadora'],
    documentos: [renglon('ine'), renglon('cv', false), renglon('examen_medico', true, 6)]
  })
  const general = plantilla({
    _id: 'gen',
    clave: 'plantilla-general',
    nombre: 'general',
    documentos: [renglon('ine'), renglon('cv'), renglon('examen_medico', true, 12)]
  })

  it('une lo que exigen las plantillas de TODAS sus adscripciones activas', () => {
    const { documentos, plantillas } = construirChecklist(
      [
        {
          empresaId: 'e1',
          areas: ['finanzas'],
          tipoContrato: 'indeterminado',
          activo: true
        },
        {
          empresaId: 'e2',
          areas: ['operaciones_urbanizadora'],
          tipoContrato: 'indeterminado',
          activo: true
        }
      ],
      [deObra, general]
    )

    const porTipo = Object.fromEntries(documentos.map((d) => [d.tipo, d]))
    // La de obra no pide CV; la general sí. Requerido gana.
    expect(porTipo.cv.requerido).toBe(true)
    // 6 meses gana a 12.
    expect(porTipo.examen_medico.vigenciaMeses).toBe(6)
    expect(plantillas.sort()).toEqual(['gen', 'operaciones_urbanizadora'])
  })

  it('los documentos nacen pendientes y sin versiones', () => {
    const { documentos } = construirChecklist(
      [
        {
          empresaId: 'e1',
          areas: ['operaciones_urbanizadora'],
          tipoContrato: 'indeterminado',
          activo: true
        }
      ],
      [deObra]
    )

    expect(documentos.every((d) => d.estatus === 'pending')).toBe(true)
    expect(documentos.every((d) => d.versiones.length === 0)).toBe(true)
    expect(documentos[0].archivo).toBeNull()
  })

  it('las adscripciones dadas de baja no cuentan', () => {
    const { plantillas } = construirChecklist(
      [
        {
          empresaId: 'e1',
          areas: ['operaciones_urbanizadora'],
          tipoContrato: 'indeterminado',
          activo: false
        },
        {
          empresaId: 'e2',
          areas: ['comercial'],
          tipoContrato: 'indeterminado',
          activo: true
        }
      ],
      [deObra, general]
    )
    expect(plantillas).toEqual(['gen'])
  })

  it('sin adscripciones no hay checklist', () => {
    expect(construirChecklist([], [general])).toEqual({ documentos: [], plantillas: [] })
  })
})

describe('domain/syncChecklist — nunca se pierde trabajo hecho', () => {
  const archivo = { nombre: 'ine.pdf', mime: 'application/pdf', tamanoBytes: 1024 }

  it('conserva estatus, archivo y versiones de lo que sigue pidiéndose', () => {
    const [resultado] = syncChecklist(
      [
        {
          tipo: 'ine',
          requerido: true,
          estatus: 'validated',
          vigenciaMeses: null,
          vigenciaHasta: '2027-01-01',
          archivo,
          versiones: [{ version: 1, archivo, estatus: 'validated' }]
        }
      ],
      [renglon('ine', false, 24)]
    )

    expect(resultado.estatus).toBe('validated')
    expect(resultado.versiones).toHaveLength(1)
    // Sólo se actualizan estos dos.
    expect(resultado.requerido).toBe(false)
    expect(resultado.vigenciaMeses).toBe(24)
  })

  it('agrega en pending lo que la unión nueva pide', () => {
    const resultado = syncChecklist(
      [{ tipo: 'ine', requerido: true, estatus: 'validated', versiones: [] }],
      [renglon('ine'), renglon('nss')]
    )
    expect(resultado).toHaveLength(2)
    expect(resultado[1]).toMatchObject({ tipo: 'nss', estatus: 'pending' })
  })

  it('conserva como opcional lo que ya no se pide pero tiene versiones', () => {
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
      [renglon('ine')]
    )

    const conservado = resultado.find((d) => d.tipo === 'comprobante_estudios')
    expect(conservado.requerido).toBe(false)
    expect(conservado.estatus).toBe('validated')
    expect(conservado.versiones).toHaveLength(1)
  })

  it('descarta lo que ya no se pide y estaba vacío', () => {
    const resultado = syncChecklist(
      [
        { tipo: 'ine', requerido: true, estatus: 'pending', versiones: [] },
        { tipo: 'cv', requerido: true, estatus: 'pending', versiones: [] }
      ],
      [renglon('ine')]
    )
    expect(resultado.map((d) => d.tipo)).toEqual(['ine'])
  })

  it('no muta el checklist que recibe', () => {
    const documentos = [
      { tipo: 'ine', requerido: true, estatus: 'validated', versiones: [] }
    ]
    syncChecklist(documentos, [renglon('ine', false)])
    expect(documentos[0].requerido).toBe(true)
  })
})

describe('domain/createChecklist — a partir de UNA plantilla', () => {
  it('crea un documento en blanco por renglón, en el orden de la plantilla', () => {
    const documentos = createChecklist(
      plantilla({ documentos: [renglon('curp'), renglon('ine'), renglon('cv', false)] })
    )

    expect(documentos.map((d) => d.tipo)).toEqual(['curp', 'ine', 'cv'])
    expect(documentos[2].requerido).toBe(false)
    expect(documentos[0]).toMatchObject({ estatus: 'pending', versiones: [] })
  })
})
