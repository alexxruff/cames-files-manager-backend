const { body } = require('express-validator')

/**
 * Validación de la importación de colaboradores desde .xlsx (D-46).
 *
 * Las dos rutas reciben `multipart/form-data`, así que **todos los campos de
 * texto llegan como cadena**: `confirmarRfcDistinto` es `'true'`, no `true`. Por
 * eso se acepta la cadena y el controlador la interpreta; usar `.isBoolean()`
 * sin más rechazaría el envío normal de un formulario.
 *
 * Que el archivo venga, que sea un .xlsx de verdad y que traiga las columnas
 * esperadas NO se valida aquí: lo primero es el controlador (multer ya corrió) y
 * lo demás se comprueba por contenido en `utils/spreadsheet.js`, que es lo único
 * que no se puede falsificar con un nombre de archivo.
 */
const BOOLEANOS = ['true', 'false', '1', '0', 'on', true, false]

/**
 * `forzarArchivoPara` — los empleados cuyo conflicto se resuelve a favor del
 * archivo (D-57).
 *
 * En `multipart/form-data` una lista puede llegar de dos formas y las dos son
 * legítimas: el campo repetido (`forzarArchivoPara=a&forzarArchivoPara=b`), que
 * express entrega como arreglo, o una sola cadena separada por comas. Se aceptan
 * las dos y el controlador las normaliza.
 */
const aListaDeIds = (valor) => {
  if (valor === undefined || valor === null || valor === '') return []
  const crudos = Array.isArray(valor) ? valor : String(valor).split(',')
  return crudos.map((v) => String(v).trim()).filter(Boolean)
}

exports.aListaDeIds = aListaDeIds

exports.importEmployeesValidation = [
  body('empresaId')
    .exists()
    .withMessage('Indica la empresa a la que se importa el personal')
    .bail()
    .isMongoId()
    .withMessage('La empresa indicada no es válida'),

  body('confirmarRfcDistinto')
    .optional({ values: 'falsy' })
    .isIn(BOOLEANOS)
    .withMessage('confirmarRfcDistinto debe ser verdadero o falso'),

  body('forzarArchivoPara')
    .optional({ values: 'falsy' })
    .custom((valor) => {
      const ids = aListaDeIds(valor)
      const invalidos = ids.filter((id) => !/^[0-9a-fA-F]{24}$/.test(id))
      if (invalidos.length > 0) {
        throw new Error(
          `forzarArchivoPara debe traer ids de empleado válidos: ${invalidos.join(', ')}`
        )
      }
      return true
    })
]
