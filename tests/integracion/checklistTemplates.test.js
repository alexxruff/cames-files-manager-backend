const ChecklistTemplate = require('../../src/api/v1/checklistTemplates/checklistTemplateModel')
const {
  ensureBaseChecklistTemplates
} = require('../../src/services/seedChecklistTemplates')
const { resolveTemplate, createChecklist } = require('../../src/utils/domain')
const { DOCUMENT_TYPES } = require('../../src/constants')

describe('Plantillas base del checklist — spec 6.5', () => {
  beforeAll(() => ChecklistTemplate.init())

  describe('sembrado', () => {
    it('crea las cuatro plantillas base', async () => {
      const resultado = await ensureBaseChecklistTemplates()

      expect(resultado.creadas).toBe(4)
      const claves = (await ChecklistTemplate.find().select('clave')).map((p) => p.clave)
      expect(claves.sort()).toEqual([
        'plantilla-general',
        'plantilla-obra',
        'plantilla-prueba',
        'plantilla-temporal'
      ])
    })

    it('es idempotente: correrlo dos veces no duplica', async () => {
      await ensureBaseChecklistTemplates()
      const segunda = await ensureBaseChecklistTemplates()

      expect(segunda.creadas).toBe(0)
      expect(await ChecklistTemplate.countDocuments({})).toBe(4)
    })

    it('NO sobreescribe una plantilla base que alguien editó', async () => {
      await ensureBaseChecklistTemplates()

      await ChecklistTemplate.findOneAndUpdate(
        { clave: 'plantilla-general' },
        { nombre: 'General (ajustada por RH)' }
      )
      await ensureBaseChecklistTemplates()

      const plantilla = await ChecklistTemplate.findOne({ clave: 'plantilla-general' })
      expect(plantilla.nombre).toBe('General (ajustada por RH)')
    })

    it('las base son globales y no borrables', async () => {
      await ensureBaseChecklistTemplates()
      const plantillas = await ChecklistTemplate.find()

      for (const plantilla of plantillas) {
        expect(plantilla.esBase).toBe(true)
        expect(plantilla.clienteId).toBeNull()
      }
    })

    it('la general trae los 12 documentos y el examen médico con 12 meses', async () => {
      await ensureBaseChecklistTemplates()
      const general = await ChecklistTemplate.findOne({ clave: 'plantilla-general' })

      expect(general.documentos).toHaveLength(DOCUMENT_TYPES.length)
      expect(general.documentos.every((d) => d.requerido)).toBe(true)
      expect(
        general.documentos.find((d) => d.tipo === 'examen_medico').vigenciaMeses
      ).toBe(12)
      // El contrato no lleva meses: su vigencia sale de la fecha de término.
      expect(
        general.documentos.find((d) => d.tipo === 'contrato').vigenciaMeses
      ).toBeNull()
    })

    it('la de obra renueva el examen médico cada 6 meses y no pide estudios ni CV', async () => {
      await ensureBaseChecklistTemplates()
      const obra = await ChecklistTemplate.findOne({ clave: 'plantilla-obra' })

      const porTipo = Object.fromEntries(obra.documentos.map((d) => [d.tipo, d]))
      expect(porTipo.examen_medico.vigenciaMeses).toBe(6)
      expect(porTipo.comprobante_estudios.requerido).toBe(false)
      expect(porTipo.referencias_laborales.requerido).toBe(false)
      expect(porTipo.cv.requerido).toBe(false)
      expect(porTipo.ine.requerido).toBe(true)
      expect(obra.areas).toEqual(['obra', 'mantenimiento'])
    })
  })

  describe('validación del modelo', () => {
    it('exige al menos un documento requerido', async () => {
      await expect(
        ChecklistTemplate.create({
          nombre: 'Todo opcional',
          tiposContrato: ['indeterminado'],
          documentos: [{ tipo: 'ine', requerido: false }]
        })
      ).rejects.toThrow(/al menos un documento requerido/i)
    })

    it('exige al menos un documento y un tipo de contrato', async () => {
      await expect(
        ChecklistTemplate.create({ nombre: 'Vacía', tiposContrato: [], documentos: [] })
      ).rejects.toThrow()
    })

    it('rechaza tipos de documento inventados', async () => {
      await expect(
        ChecklistTemplate.create({
          nombre: 'Rara',
          tiposContrato: ['indeterminado'],
          documentos: [{ tipo: 'pasaporte_galactico', requerido: true }]
        })
      ).rejects.toThrow()
    })

    it('trata una lista de áreas vacía como "todas"', async () => {
      const plantilla = await ChecklistTemplate.create({
        nombre: 'Sin áreas',
        tiposContrato: ['indeterminado'],
        areas: [],
        documentos: [{ tipo: 'ine', requerido: true }]
      })
      expect(plantilla.areas).toBeNull()
      expect(plantilla.toJSON().areas).toBeNull()
    })

    it('no permite dos plantillas con la misma clave en el mismo cliente', async () => {
      await ensureBaseChecklistTemplates()
      await expect(
        ChecklistTemplate.create({
          clave: 'plantilla-general',
          nombre: 'Duplicada',
          tiposContrato: ['indeterminado'],
          documentos: [{ tipo: 'ine', requerido: true }]
        })
      ).rejects.toThrow()
    })
  })

  describe('resolución contra las plantillas sembradas de verdad', () => {
    let plantillas

    beforeEach(async () => {
      await ensureBaseChecklistTemplates()
      plantillas = (await ChecklistTemplate.find()).map((p) => p.toJSON())
    })

    const clave = (area, tipoContrato) =>
      resolveTemplate(plantillas, { area, tipoContrato }).clave

    it('obra con indeterminado usa la de obra, no la general', () => {
      expect(clave('obra', 'indeterminado')).toBe('plantilla-obra')
      expect(clave('mantenimiento', 'indeterminado')).toBe('plantilla-obra')
    })

    it('otras áreas con indeterminado usan la general', () => {
      expect(clave('ventas', 'indeterminado')).toBe('plantilla-general')
      expect(clave('contabilidad', 'indeterminado')).toBe('plantilla-general')
    })

    it('los temporales usan la temporal, salvo en obra', () => {
      expect(clave('ventas', 'determinado')).toBe('plantilla-temporal')
      expect(clave('proyectos', 'obra_determinada')).toBe('plantilla-temporal')
      expect(clave('obra', 'determinado')).toBe('plantilla-obra')
    })

    it('el periodo a prueba tiene la suya en cualquier área', () => {
      expect(clave('obra', 'prueba')).toBe('plantilla-prueba')
      expect(clave('ventas', 'prueba')).toBe('plantilla-prueba')
    })

    it('genera un checklist completo y en blanco a partir de la plantilla resuelta', () => {
      const plantilla = resolveTemplate(plantillas, {
        area: 'obra',
        tipoContrato: 'indeterminado'
      })
      const documentos = createChecklist(plantilla)

      expect(documentos).toHaveLength(DOCUMENT_TYPES.length)
      expect(documentos.every((d) => d.estatus === 'pending')).toBe(true)
      expect(documentos.every((d) => d.versiones.length === 0)).toBe(true)
      expect(documentos.find((d) => d.tipo === 'examen_medico').vigenciaMeses).toBe(6)
      expect(documentos.find((d) => d.tipo === 'cv').requerido).toBe(false)
    })
  })
})
