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
    .withMessage('confirmarRfcDistinto debe ser verdadero o falso')
]
