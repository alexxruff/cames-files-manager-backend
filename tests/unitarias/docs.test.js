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

  describe('las rutas que citan los documentos existen de verdad', () => {
    /*
     * El otro modo de mentir: no la cifra, sino la ruta. Un documento describe
     * `GET /adscripciones` con su forma de respuesta y sus filtros, el front la
     * llama, y contesta 404 porque nunca se implementó. Pasó: el catálogo de
     * `backend-spec.md` daba por vivas cinco rutas que sólo están planeadas, y
     * la tabla de «qué existe hoy» anunciaba un listado global de adscripciones
     * que no existe.
     *
     * Hay TRES desenlaces, no dos, y sólo el tercero es un error:
     *
     *   1. la ruta existe en el router                          → bien
     *   2. no existe, pero está declarada en `RUTAS_PENDIENTES`
     *      Y el documento la marca como pendiente en su renglón → bien
     *   3. cualquier otra cosa                                  → falla
     *
     * El caso 2 exige las dos mitades a propósito: que el código sepa que falta
     * no sirve de nada si quien lee la tabla no lo ve.
     */
    const DOCUMENTOS = [
      'docs/backend-spec.md',
      'docs/modelo-datos.md',
      'docs/CONTRATO-API.md'
    ]

    /*
     * Marca visible de «esto todavía no responde», en el renglón mismo. Los
     * límites de palabra son para que `datosPendientes` —un campo del contrato—
     * no pase por una marca de ruta pendiente.
     */
    const MARCA_PENDIENTE = /por construir|\bpendientes?\b|no existe|no se (hará|hace)/i

    const normalizar = (ruta) =>
      ruta
        .replace(/^\/api\/v1/, '')
        .replace(/:[A-Za-z]+/g, ':x')
        .replace(/\*$/, '')
        .replace(/\/$/, '') || '/'

    const rutas = () => {
      const router = require('../../src/api/v1/routes')
      return {
        vivas: listRoutes(router, '/api/v1').map((r) => normalizar(r.ruta)),
        pendientes: router.RUTAS_PENDIENTES.map((p) => normalizar(p.ruta))
      }
    }

    /**
     * Las rutas citadas en un documento, con su renglón. Se lee lo que va entre
     * comillas invertidas: es como se escribe una ruta en estos documentos.
     */
    function citas(archivo) {
      const encontradas = []

      leer(archivo)
        .split('\n')
        .forEach((linea, i) => {
          const spans = linea.match(/`[^`\n]+`/g) || []

          spans.forEach((span) => {
            const texto = span
              .slice(1, -1)
              .trim()
              .replace(/^(GET|POST|PATCH|PUT|DELETE)\s+/, '')
              .split(/[?\s]/)[0]

            if (!/^\/[a-z]/.test(texto)) return

            // `/adscripciones/:id[/estado]` son dos rutas, no una.
            const variantes = texto.includes('[')
              ? [texto.replace(/\[.*?\]/g, ''), texto.replace(/[[\]]/g, '')]
              : [texto]

            variantes.forEach((ruta) =>
              encontradas.push({
                ruta: normalizar(ruta),
                donde: `${archivo}:${i + 1}`,
                linea
              })
            )
          })
        })

      return encontradas
    }

    /** ¿`corta` es `larga` o un tramo suyo, cortando en `/`? */
    const esPrefijo = (larga, corta) => larga === corta || larga.startsWith(`${corta}/`)
    const esSufijo = (larga, corta) => larga === corta || larga.endsWith(corta)

    /**
     * `viva` · `prefijo` (el montaje del recurso: `/auth`) · `pendiente` ·
     * `fragmento` (un tramo suelto citado en prosa: «`/estado`») · `huerfana`.
     */
    function clasificar(cita, { vivas, pendientes }) {
      if (vivas.includes(cita.ruta)) return 'viva'
      if (vivas.some((v) => esPrefijo(v, cita.ruta))) return 'prefijo'
      if (pendientes.includes(cita.ruta)) return 'pendiente'
      if ([...vivas, ...pendientes].some((r) => esSufijo(r, cita.ruta)))
        return 'fragmento'
      return 'huerfana'
    }

    it.each(DOCUMENTOS)('%s no cita ninguna ruta inexistente', (archivo) => {
      const conocidas = rutas()
      const huerfanas = citas(archivo)
        .filter((c) => clasificar(c, conocidas) === 'huerfana')
        .map((c) => `${c.donde} → ${c.ruta}`)

      /*
       * Si esto falla: o la ruta se escribió mal, o el documento se adelantó al
       * código. Lo segundo se arregla declarándola en `RUTAS_PENDIENTES` del
       * router y marcándola en el renglón, no borrando la prueba.
       */
      expect(huerfanas).toEqual([])
    })

    it.each(DOCUMENTOS)(
      '%s marca como pendiente lo que todavía no responde',
      (archivo) => {
        const conocidas = rutas()
        const sinMarcar = citas(archivo)
          .filter((c) => clasificar(c, conocidas) === 'pendiente')
          .filter((c) => !MARCA_PENDIENTE.test(c.linea))
          .map((c) => `${c.donde} → ${c.ruta}`)

        expect(sinMarcar).toEqual([])
      }
    )

    it('el router y los documentos hablan de las mismas pendientes', () => {
      const { pendientes } = rutas()
      const citadas = new Set(DOCUMENTOS.flatMap((a) => citas(a).map((c) => c.ruta)))

      /*
       * Al revés: una ruta declarada pendiente en el código y que ningún
       * documento menciona es trabajo que nadie va a encontrar. `GET|PATCH
       * /plantillas-checklist` estuvo así hasta el 31 ago 2026: en el router y
       * en ESTADO.md, invisible en el spec que lee el front.
       */
      const huerfanasDelCodigo = pendientes.filter((p) => !citadas.has(p))

      expect(huerfanasDelCodigo).toEqual([])
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
