const { deriveAlerts } = require('../../../src/utils/domain')

const HOY = '2026-08-20'

const doc = (tipo, estatus, extra = {}) => ({
  tipo,
  requerido: true,
  estatus,
  versiones: [],
  ...extra
})

const expediente = (id, documentos, colaborador = {}) => ({
  _id: id,
  colaborador: {
    nombre: 'Ana Ruiz',
    puesto: 'Analista',
    area: 'administracion',
    activo: true,
    ...colaborador
  },
  documentos
})

describe('domain/deriveAlerts — spec 7.6', () => {
  it('deriva una alerta por documento según su estatus efectivo', () => {
    const alertas = deriveAlerts(
      [
        expediente('e1', [
          doc('contrato', 'validated', { vigenciaHasta: '2026-08-16' }), // vencido
          doc('examen_medico', 'validated', { vigenciaHasta: '2026-08-27' }), // por vencer
          doc('curp', 'rejected'),
          doc('alta_imss', 'pending'),
          doc('ine', 'validated'), // sin alerta
          doc('rfc', 'in_review') // sin alerta
        ])
      ],
      { hoy: HOY }
    )

    expect(alertas.map((a) => a.tipo)).toEqual([
      'vencido',
      'documento_rechazado',
      'por_vencer',
      'documento_faltante'
    ])
  })

  it('un colaborador dado de baja no genera ninguna alerta', () => {
    const alertas = deriveAlerts(
      [expediente('e1', [doc('ine', 'pending')], { activo: false })],
      { hoy: HOY }
    )
    expect(alertas).toEqual([])
  })

  it('un documento opcional sin subir no genera alerta de faltante', () => {
    const alertas = deriveAlerts(
      [expediente('e1', [doc('cv', 'pending', { requerido: false })])],
      { hoy: HOY }
    )
    expect(alertas).toEqual([])
  })

  it('un opcional vencido o rechazado SÍ genera alerta', () => {
    const alertas = deriveAlerts(
      [
        expediente('e1', [
          doc('examen_medico', 'validated', {
            requerido: false,
            vigenciaHasta: '2026-01-01'
          }),
          doc('cv', 'rejected', { requerido: false })
        ])
      ],
      { hoy: HOY }
    )
    expect(alertas.map((a) => a.tipo)).toEqual(['vencido', 'documento_rechazado'])
  })

  it('el id es estable entre recálculos', () => {
    const entrada = [expediente('665f', [doc('ine', 'pending')])]

    const primera = deriveAlerts(entrada, { hoy: HOY })
    const segunda = deriveAlerts(entrada, { hoy: HOY })

    expect(primera[0].id).toBe('665f:ine:documento_faltante')
    expect(segunda[0].id).toBe(primera[0].id)
  })

  it('ordena por severidad, luego por días restantes, luego por nombre', () => {
    const alertas = deriveAlerts(
      [
        expediente(
          'e1',
          [doc('examen_medico', 'validated', { vigenciaHasta: '2026-09-10' })],
          {
            nombre: 'Zulema'
          }
        ),
        expediente(
          'e2',
          [doc('contrato', 'validated', { vigenciaHasta: '2026-08-22' })],
          {
            nombre: 'Ana'
          }
        ),
        expediente('e3', [doc('ine', 'pending')], { nombre: 'Bruno' }),
        expediente('e4', [doc('curp', 'rejected')], { nombre: 'Carla' }),
        expediente('e5', [doc('nss', 'validated', { vigenciaHasta: '2026-08-01' })], {
          nombre: 'Diana'
        })
      ],
      { hoy: HOY }
    )

    expect(alertas.map((a) => [a.tipo, a.colaboradorNombre])).toEqual([
      ['vencido', 'Diana'],
      ['documento_rechazado', 'Carla'],
      ['por_vencer', 'Ana'], // vence en 2 días
      ['por_vencer', 'Zulema'], // vence en 21
      ['documento_faltante', 'Bruno']
    ])
  })

  it('a igualdad de severidad y días, ordena por nombre en español', () => {
    const alertas = deriveAlerts(
      [
        expediente('e1', [doc('ine', 'pending')], { nombre: 'Zamora' }),
        expediente('e2', [doc('ine', 'pending')], { nombre: 'Ávila' }),
        expediente('e3', [doc('ine', 'pending')], { nombre: 'Núñez' })
      ],
      { hoy: HOY }
    )
    expect(alertas.map((a) => a.colaboradorNombre)).toEqual(['Ávila', 'Núñez', 'Zamora'])
  })

  it('diasRestantes es negativo si venció y null si el documento no caduca', () => {
    const alertas = deriveAlerts(
      [
        expediente('e1', [
          doc('contrato', 'validated', { vigenciaHasta: '2026-08-16' }),
          doc('ine', 'pending')
        ])
      ],
      { hoy: HOY }
    )

    expect(alertas[0].diasRestantes).toBe(-4)
    expect(alertas[1].diasRestantes).toBeNull()
  })

  describe('mensajes, listos para pintar', () => {
    const mensajeDe = (documento) =>
      deriveAlerts([expediente('e1', [documento])], { hoy: HOY })[0].mensaje

    it('vencido dice cuántos días lleva', () => {
      expect(
        mensajeDe(doc('contrato', 'validated', { vigenciaHasta: '2026-08-16' }))
      ).toBe('Contrato de trabajo firmado venció hace 4 días.')
    })

    it('por vencer distingue hoy, mañana y varios días', () => {
      expect(mensajeDe(doc('examen_medico', 'validated', { vigenciaHasta: HOY }))).toBe(
        'Examen médico de ingreso vence hoy.'
      )
      expect(
        mensajeDe(doc('examen_medico', 'validated', { vigenciaHasta: '2026-08-27' }))
      ).toBe('Examen médico de ingreso vence en 7 días.')
    })

    it('usa el singular cuando es un solo día', () => {
      expect(
        mensajeDe(doc('examen_medico', 'validated', { vigenciaHasta: '2026-08-21' }))
      ).toBe('Examen médico de ingreso vence en 1 día.')
      expect(
        mensajeDe(doc('contrato', 'validated', { vigenciaHasta: '2026-08-19' }))
      ).toBe('Contrato de trabajo firmado venció hace 1 día.')
    })

    it('rechazado y faltante dicen qué hacer', () => {
      expect(mensajeDe(doc('curp', 'rejected'))).toBe(
        'CURP fue rechazado y hay que volver a subirlo.'
      )
      expect(mensajeDe(doc('alta_imss', 'pending'))).toBe(
        'Falta subir Alta ante el IMSS.'
      )
    })
  })

  it('arrastra los datos que el front pinta en la bandeja', () => {
    const [alerta] = deriveAlerts(
      [
        expediente(
          'e1',
          [doc('curp', 'rejected', { motivoRechazo: 'La imagen está borrosa' })],
          { nombre: 'Ana Ruiz', puesto: 'Analista', area: 'contabilidad' }
        )
      ],
      { hoy: HOY }
    )

    expect(alerta).toMatchObject({
      expedienteId: 'e1',
      colaboradorNombre: 'Ana Ruiz',
      colaboradorPuesto: 'Analista',
      area: 'contabilidad',
      tipoDocumento: 'curp',
      motivoRechazo: 'La imagen está borrosa'
    })
  })
})
