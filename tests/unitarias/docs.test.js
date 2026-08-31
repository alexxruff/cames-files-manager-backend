const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')

const { listRoutes } = require('../../src/utils/routeInventory')

/**
 * Guarda contra la documentación desfasada.
 *
 * Los documentos que cuentan cosas —cuántas colecciones hay, cuántas rutas
 * responden, cuántos endpoints trae cada entrega— se quedan viejos en silencio:
 * nadie recuerda actualizar una cifra al agregar una colección, y el número
 * sigue ahí, con toda la autoridad de estar escrito. Pasó con «13 colecciones»
 * (eran 14), «79 pruebas» (eran 842) y «estos 22 endpoints son TODO lo que
 * responde el servidor» (eran 79).
 *
 * Esta prueba compara esas cifras contra el código. Si falla, **el número del
 * documento es el que está mal**: corrígelo ahí, no aquí.
 */

const RAIZ = path.join(__dirname, '..', '..')
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8')

/** Rutas del router, contadas como método + ruta. */
function rutasDelRouter() {
  const router = require('../../src/api/v1/routes')
  return listRoutes(router, '/api/v1').flatMap((r) =>
    r.metodos.map((m) => `${m} ${r.ruta}`)
  )
}

describe('La documentación no se desfasó del código', () => {
  describe('cuántas colecciones hay', () => {
    /*
     * Se cuentan los modelos registrados, no las carpetas: es lo que Mongoose
     * crea de verdad. `src/models/index.js` los registra todos (D-31).
     */
    const total = () => {
      require('../../src/app')
      return new Set(Object.values(mongoose.models).map((m) => m.collection.name)).size
    }

    it.each([
      ['CLAUDE.md', /las (\d+) colecciones/],
      ['docs/ARQUITECTURA-DATOS.md', /Panorama: (\d+) colecciones/],
      ['docs/modelo-datos.md', /Las \*\*(\d+) que existen hoy\*\*/],
      ['docs/backend-spec.md', /mapa de las (\d+) colecciones/]
    ])('%s dice el número correcto', (archivo, patron) => {
      const encontrado = leer(archivo).match(patron)
      expect(encontrado).not.toBeNull()
      expect(Number(encontrado[1])).toBe(total())
    })
  })

  describe('cuántas rutas responden', () => {
    it('INTEGRACION-FRONTEND.md dice el número correcto', () => {
      /*
       * `/usuarios*` no cuenta: existe sólo para responder 410 y desaparece
       * cuando el front deje de llamarla.
       */
      const vivas = rutasDelRouter().filter((r) => !r.includes('/usuarios'))
      const encontrado = leer('docs/INTEGRACION-FRONTEND.md').match(
        /\*\*(\d+) rutas\*\* en pie/
      )

      expect(encontrado).not.toBeNull()
      expect(Number(encontrado[1])).toBe(vivas.length)
    })

    it('INTEGRACION-FRONTEND.md §9 lista todas las rutas pendientes del router', () => {
      const { RUTAS_PENDIENTES } = require('../../src/api/v1/routes')
      const documento = leer('docs/INTEGRACION-FRONTEND.md')

      const sinDocumentar = RUTAS_PENDIENTES.map((p) =>
        p.ruta.replace('/api/v1', '')
      ).filter((ruta) => !documento.includes(ruta))

      expect(sinDocumentar).toEqual([])
    })
  })

  describe('cuántos endpoints dice traer cada ENDPOINTS-*.md', () => {
    /*
     * Auto-consistencia: el número del encabezado contra los renglones de su
     * índice. No se compara con el router porque cada documento cubre una
     * entrega, no un prefijo de ruta.
     */
    it.each([
      ['docs/ENDPOINTS-PROYECTOS.md', 25],
      ['docs/ENDPOINTS-ADSCRIPCIONES.md', 6],
      ['docs/ENDPOINTS-EXPEDIENTES.md', 6],
      ['docs/ENDPOINTS-IMPORTACION.md', 2]
    ])('%s', (archivo, esperados) => {
      const contenido = leer(archivo)

      const declarados = contenido.match(/\*\*(\d+) endpoints/)
      expect(declarados).not.toBeNull()
      expect(Number(declarados[1])).toBe(esperados)

      const renglones = contenido.split('\n').filter((l) => /^\| \d+\s+\| `/.test(l))
      expect(renglones).toHaveLength(esperados)
    })
  })

  describe('cuántas decisiones hay', () => {
    it('ARQUITECTURA-DATOS.md cita el rango completo de DECISIONES.md', () => {
      const ultima = leer('docs/DECISIONES.md')
        .split('\n')
        .filter((l) => /^## D-\d+/.test(l))
        .pop()
      const numero = Number(ultima.match(/^## D-(\d+)/)[1])

      const citado = leer('docs/ARQUITECTURA-DATOS.md').match(/D-01 … D-(\d+)/)
      expect(citado).not.toBeNull()
      expect(Number(citado[1])).toBe(numero)
    })
  })
})
