const {
  deriveAlerts,
  deriveDocumentAlerts,
  deriveBirthdayAlerts,
  summarizeAlerts
} = require('../../../src/utils/domain/alerts')

/**
 * Alertas derivadas — SIN base de datos (spec §6.6, modelo-datos §6.4, D-47).
 *
 * Lo que estas pruebas cuidan, en orden de importancia:
 *
 * 1. **Que se resuelvan solas.** No hay estado que apagar: cambia la causa y la
 *    alerta desaparece. Hay una prueba por familia que lo comprueba pasando de
 *    un estado a otro.
 * 2. **Que el `id` sea estable entre recálculos.** El front lo usa como `key` de
 *    React; si cambia entre dos consultas, la bandeja parpadea.
 * 3. **Que un cumpleaños nunca tape un documento vencido.**
 */

const HOY = '2026-08-20'

const doc = (tipo, estatus, extra = {}) => ({
  tipo,
  requerido: true,
  estatus,
  versiones: [],
  ...extra
})

/** Una persona visible con su expediente, como la arma `alertService`. */
const entrada = (id, documentos = [], empleado = {}, adscripciones = null) => ({
  empleado: {
    _id: id,
    nombre: 'Ana Ruiz',
    activo: true,
    fechaNacimiento: null,
    ...empleado
  },
  categoriaNombre: 'Analista',
  adscripciones: adscripciones || [
    {
      empresaId: 'emp1',
      empresaNombre: 'Maquinaria Cames',
      areas: ['administracion'],
      activo: true
    }
  ],
  expediente: { _id: `exp-${id}`, documentos }
})

describe('domain/deriveAlerts', () => {
  describe('familia documento', () => {
    it('deriva una alerta por documento según su estatus efectivo', () => {
      const alertas = deriveAlerts(
        [
          entrada('e1', [
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
      expect(alertas.every((a) => a.origen === 'documento')).toBe(true)
    })

    it('un documento opcional sin subir no le falta a nadie', () => {
      const alertas = deriveAlerts(
        [entrada('e1', [doc('cv', 'pending', { requerido: false })])],
        { hoy: HOY }
      )
      expect(alertas).toEqual([])
    })

    it('lo que no está validado no vence: un in_review con vigencia pasada sigue sin alerta', () => {
      const alertas = deriveAlerts(
        [entrada('e1', [doc('contrato', 'in_review', { vigenciaHasta: '2026-01-01' })])],
        { hoy: HOY }
      )
      expect(alertas).toEqual([])
    })

    it('trae el motivo del rechazo, para no tener que abrir el expediente', () => {
      const [alerta] = deriveAlerts(
        [
          entrada('e1', [
            doc('curp', 'rejected', { motivoRechazo: 'La foto está borrosa' })
          ])
        ],
        { hoy: HOY }
      )
      expect(alerta.motivoRechazo).toBe('La foto está borrosa')
      expect(alerta.tipoDocumento).toBe('curp')
      expect(alerta.expedienteId).toBe('exp-e1')
    })

    /*
     * LA prueba de «se resuelve sola»: la misma persona, el mismo documento, y lo
     * único que cambia es que ya se subió y se validó. No hay que apagar nada.
     */
    it('subir y validar el documento hace desaparecer la alerta, sin tocar nada más', () => {
      const faltante = deriveAlerts([entrada('e1', [doc('ine', 'pending')])], {
        hoy: HOY
      })
      expect(faltante).toHaveLength(1)
      expect(faltante[0].tipo).toBe('documento_faltante')

      const resuelta = deriveAlerts([entrada('e1', [doc('ine', 'validated')])], {
        hoy: HOY
      })
      expect(resuelta).toEqual([])
    })

    it('renovar un documento vencido lo saca de la bandeja', () => {
      const vencido = deriveAlerts(
        [
          entrada('e1', [
            doc('examen_medico', 'validated', { vigenciaHasta: '2026-08-01' })
          ])
        ],
        { hoy: HOY }
      )
      expect(vencido[0].tipo).toBe('vencido')

      const renovado = deriveAlerts(
        [
          entrada('e1', [
            doc('examen_medico', 'validated', { vigenciaHasta: '2027-08-01' })
          ])
        ],
        { hoy: HOY }
      )
      expect(renovado).toEqual([])
    })
  })

  describe('familia cumpleaños', () => {
    const conCumple = (fechaNacimiento, nombre = 'Ana Ruiz') =>
      entrada('e1', [], { fechaNacimiento, nombre })

    it('avisa el mismo día, con mensaje de hoy', () => {
      const [alerta] = deriveAlerts([conCumple('1982-08-20')], { hoy: HOY })

      expect(alerta.tipo).toBe('cumpleanos')
      expect(alerta.origen).toBe('cumpleanos')
      expect(alerta.diasRestantes).toBe(0)
      expect(alerta.fecha).toBe('2026-08-20')
      expect(alerta.edad).toBe(44)
      expect(alerta.mensaje).toBe('Hoy es el cumpleaños de Ana Ruiz (cumple 44).')
    })

    it('avisa dentro de la ventana y no fuera de ella', () => {
      const dentro = deriveAlerts([conCumple('1990-08-27')], {
        hoy: HOY,
        diasCumpleanos: 7
      })
      expect(dentro).toHaveLength(1)
      expect(dentro[0].diasRestantes).toBe(7)

      // Un día más allá del umbral: la ventana es inclusiva en 7, no en 8.
      const fuera = deriveAlerts([conCumple('1990-08-28')], {
        hoy: HOY,
        diasCumpleanos: 7
      })
      expect(fuera).toEqual([])
    })

    it('con la ventana en 0 sólo avisa el mismo día', () => {
      expect(
        deriveAlerts([conCumple('1990-08-20')], { hoy: HOY, diasCumpleanos: 0 })
      ).toHaveLength(1)
      expect(
        deriveAlerts([conCumple('1990-08-21')], { hoy: HOY, diasCumpleanos: 0 })
      ).toEqual([])
    })

    /*
     * El equivalente de «se resuelve sola» para un cumpleaños: nadie lo cierra,
     * lo cierra el calendario. Al día siguiente ya no está en la bandeja.
     */
    it('al día siguiente del cumpleaños ya no aparece', () => {
      const elDia = deriveAlerts([conCumple('1990-08-20')], { hoy: '2026-08-20' })
      expect(elDia).toHaveLength(1)

      const alDiaSiguiente = deriveAlerts([conCumple('1990-08-20')], {
        hoy: '2026-08-21'
      })
      expect(alDiaSiguiente).toEqual([])
    })

    it('mañana y en varios días usan mensajes distintos', () => {
      const [manana] = deriveAlerts([conCumple('1990-08-21')], { hoy: HOY })
      expect(manana.mensaje).toBe('Mañana es el cumpleaños de Ana Ruiz (cumple 36).')

      const [enTres] = deriveAlerts([conCumple('1990-08-23')], { hoy: HOY })
      expect(enTres.mensaje).toBe('Ana Ruiz cumple años en 3 días (cumple 36).')
    })

    it('avisa al cruzar el fin de año', () => {
      const [alerta] = deriveAlerts([conCumple('1990-01-02')], {
        hoy: '2026-12-30',
        diasCumpleanos: 7
      })
      expect(alerta.diasRestantes).toBe(3)
      expect(alerta.fecha).toBe('2027-01-02')
      expect(alerta.edad).toBe(37)
    })

    // Sin esto, quien nació un 29 de febrero no aparecería tres de cada cuatro años.
    it('el 29 de febrero se celebra el 28 en los años no bisiestos', () => {
      const [noBisiesto] = deriveAlerts([conCumple('2000-02-29')], {
        hoy: '2027-02-25',
        diasCumpleanos: 7
      })
      expect(noBisiesto.fecha).toBe('2027-02-28')

      const [bisiesto] = deriveAlerts([conCumple('2000-02-29')], {
        hoy: '2028-02-25',
        diasCumpleanos: 7
      })
      expect(bisiesto.fecha).toBe('2028-02-29')
    })

    it('sin fecha de nacimiento no hay alerta, y no revienta', () => {
      expect(deriveAlerts([conCumple(null)], { hoy: HOY })).toEqual([])
      expect(deriveAlerts([conCumple('no es fecha')], { hoy: HOY })).toEqual([])
    })
  })

  describe('quién no genera alertas', () => {
    it('alguien dado de baja del sistema no genera ninguna, ni de documento ni de cumpleaños', () => {
      const alertas = deriveAlerts(
        [
          entrada('e1', [doc('ine', 'pending')], {
            activo: false,
            fechaNacimiento: '1990-08-20'
          })
        ],
        { hoy: HOY }
      )
      expect(alertas).toEqual([])
    })

    it('alguien sin adscripción activa tampoco', () => {
      const alertas = deriveAlerts(
        [
          entrada('e1', [doc('ine', 'pending')], { fechaNacimiento: '1990-08-20' }, [
            { empresaId: 'emp1', empresaNombre: 'X', areas: [], activo: false }
          ])
        ],
        { hoy: HOY }
      )
      expect(alertas).toEqual([])
    })

    it('alguien sin expediente todavía no genera alertas de documento, pero sí de cumpleaños', () => {
      const sinExpediente = {
        ...entrada('e1', [], { fechaNacimiento: '1990-08-20' }),
        expediente: null
      }
      const alertas = deriveAlerts([sinExpediente], { hoy: HOY })
      expect(alertas.map((a) => a.tipo)).toEqual(['cumpleanos'])
    })
  })

  describe('orden y estabilidad', () => {
    it('un cumpleaños nunca tapa un documento vencido', () => {
      const alertas = deriveAlerts(
        [
          entrada('e1', [doc('contrato', 'validated', { vigenciaHasta: '2026-08-01' })], {
            fechaNacimiento: '1990-08-20'
          })
        ],
        { hoy: HOY }
      )
      expect(alertas.map((a) => a.tipo)).toEqual(['vencido', 'cumpleanos'])
    })

    it('ordena por severidad, luego por días, luego por nombre', () => {
      const alertas = deriveAlerts(
        [
          entrada('e1', [doc('a', 'validated', { vigenciaHasta: '2026-08-25' })], {
            nombre: 'Zoe Zamora'
          }),
          entrada('e2', [doc('b', 'validated', { vigenciaHasta: '2026-08-22' })], {
            nombre: 'Ana Ruiz'
          }),
          entrada('e3', [doc('c', 'validated', { vigenciaHasta: '2026-08-22' })], {
            nombre: 'Álvaro Bravo'
          })
        ],
        { hoy: HOY }
      )

      // Los dos de 2 días primero, y entre ellos por nombre con acentos ignorados.
      expect(alertas.map((a) => [a.empleadoNombre, a.diasRestantes])).toEqual([
        ['Álvaro Bravo', 2],
        ['Ana Ruiz', 2],
        ['Zoe Zamora', 5]
      ])
    })

    it('el id es idéntico en dos consultas seguidas', () => {
      const entradas = [
        entrada('e1', [doc('ine', 'pending')], { fechaNacimiento: '1990-08-22' })
      ]
      const primera = deriveAlerts(entradas, { hoy: HOY })
      const segunda = deriveAlerts(entradas, { hoy: HOY })

      expect(primera.map((a) => a.id)).toEqual(segunda.map((a) => a.id))
      expect(primera).toHaveLength(2)
    })

    it('el id del cumpleaños no cambia durante la ventana, pero sí el año siguiente', () => {
      const persona = [entrada('e1', [], { fechaNacimiento: '1990-08-22' })]

      const aDosDias = deriveAlerts(persona, { hoy: '2026-08-20' })[0].id
      const elDia = deriveAlerts(persona, { hoy: '2026-08-22' })[0].id
      const proximoAnio = deriveAlerts(persona, { hoy: '2027-08-20' })[0].id

      expect(aDosDias).toBe(elDia)
      expect(proximoAnio).not.toBe(elDia)
    })

    it('el id lleva el origen, para que las dos familias no puedan chocar', () => {
      const alertas = deriveAlerts(
        [entrada('e1', [doc('ine', 'pending')], { fechaNacimiento: '1990-08-20' })],
        { hoy: HOY }
      )
      expect(alertas.find((a) => a.origen === 'documento').id).toMatch(/^documento:/)
      expect(alertas.find((a) => a.origen === 'cumpleanos').id).toMatch(/^cumpleanos:/)
    })
  })

  describe('el sobre común', () => {
    it('trae la persona, su puesto y sus empresas y áreas visibles', () => {
      const [alerta] = deriveAlerts([entrada('e1', [doc('ine', 'pending')])], {
        hoy: HOY
      })

      expect(alerta).toMatchObject({
        empleadoId: 'e1',
        empleadoNombre: 'Ana Ruiz',
        categoriaNombre: 'Analista',
        areas: ['administracion']
      })
      expect(alerta.empresas).toEqual([{ _id: 'emp1', nombre: 'Maquinaria Cames' }])
    })

    /*
     * El expediente es de la PERSONA y se comparte entre las empresas del grupo
     * (D-41): quien está en dos no tiene UN `empresaId`, y elegir uno sería
     * inventar de cuál es la alerta. Por eso `empresas[]` en plural. Ver D-47.
     */
    it('quien está en dos empresas trae las dos, y las áreas sin repetir', () => {
      const [alerta] = deriveAlerts(
        [
          entrada('e1', [doc('ine', 'pending')], {}, [
            { empresaId: 'emp1', empresaNombre: 'Cames', areas: ['obra'], activo: true },
            {
              empresaId: 'emp2',
              empresaNombre: 'Urba',
              areas: ['obra', 'proyectos'],
              activo: true
            },
            {
              empresaId: 'emp3',
              empresaNombre: 'Vieja',
              areas: ['ventas'],
              activo: false
            }
          ])
        ],
        { hoy: HOY }
      )

      expect(alerta.empresas.map((e) => e._id)).toEqual(['emp1', 'emp2'])
      expect(alerta.areas).toEqual(['obra', 'proyectos'])
    })
  })

  describe('familias por separado', () => {
    const persona = [
      entrada('e1', [doc('ine', 'pending')], { fechaNacimiento: '1990-08-20' })
    ]

    it('deriveDocumentAlerts sólo trae las de documento', () => {
      const alertas = deriveDocumentAlerts(persona, { hoy: HOY })
      expect(alertas.map((a) => a.origen)).toEqual(['documento'])
    })

    it('deriveBirthdayAlerts sólo trae las de cumpleaños', () => {
      const alertas = deriveBirthdayAlerts(persona, { hoy: HOY })
      expect(alertas.map((a) => a.origen)).toEqual(['cumpleanos'])
    })
  })

  describe('summarizeAlerts', () => {
    it('cuenta por tipo y deja en cero los que no hay', () => {
      const alertas = deriveAlerts(
        [
          entrada('e1', [doc('a', 'pending'), doc('b', 'rejected')], {
            fechaNacimiento: '1990-08-20'
          })
        ],
        { hoy: HOY }
      )

      expect(summarizeAlerts(alertas)).toEqual({
        total: 3,
        vencido: 0,
        documento_rechazado: 1,
        por_vencer: 0,
        documento_faltante: 1,
        cumpleanos: 1
      })
    })

    it('sin alertas, todo en cero', () => {
      expect(summarizeAlerts([])).toEqual({
        total: 0,
        vencido: 0,
        documento_rechazado: 0,
        por_vencer: 0,
        documento_faltante: 0,
        cumpleanos: 0
      })
    })
  })
})
