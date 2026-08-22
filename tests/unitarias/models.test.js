const mongoose = require('mongoose')
const { NOMBRES_DE_MODELOS } = require('../../src/models')

/**
 * Guarda contra el `MissingSchemaError`.
 *
 * Requerir la app tiene que dejar registrados TODOS los modelos, porque
 * `populate()` los resuelve por nombre en tiempo de ejecución. Esta prueba
 * importa la app **sin** las fábricas —que cargan todo y esconden el problema— y
 * comprueba el registro.
 */
describe('Registro de modelos', () => {
  it('cargar la app registra todos los modelos', () => {
    require('../../src/app')

    for (const nombre of NOMBRES_DE_MODELOS) {
      expect(Object.keys(mongoose.models)).toContain(nombre)
    }
  })

  it('cada referencia entre esquemas apunta a un modelo registrado', () => {
    require('../../src/app')

    const faltantes = []
    for (const [nombreModelo, modelo] of Object.entries(mongoose.models)) {
      modelo.schema.eachPath((ruta, tipo) => {
        const referencias = [tipo.options?.ref, tipo.caster?.options?.ref].filter(Boolean)
        for (const ref of referencias) {
          if (!mongoose.models[ref]) faltantes.push(`${nombreModelo}.${ruta} → ${ref}`)
        }
      })
    }

    expect(faltantes).toEqual([])
  })
})
