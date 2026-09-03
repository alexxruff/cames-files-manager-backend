const { body } = require('express-validator')
const { UPLOAD_TARGETS } = require('../constants')

/**
 * El permiso de subida directa (D-83).
 *
 * Lo que se valida aquí es la FORMA de lo que declara el navegador. Que el
 * tamaño sea de verdad ése, y que el contenido sea de un tipo permitido, no se
 * puede saber todavía: eso se comprueba contra el objeto real al confirmar.
 */
const ID = /^[a-f\d]{24}$/i

const idOpcional = (campo) =>
  body(campo)
    .optional({ values: 'falsy' })
    .custom((valor) => {
      if (!ID.test(String(valor))) throw new Error('El identificador no es válido')
      return true
    })

/**
 * `subidaId` en el cuerpo de una ruta que registra un adjunto (D-83): dice «el
 * archivo ya está en el almacenamiento, éste es el permiso». Opcional en todas:
 * el `multipart` de siempre sigue valiendo.
 */
exports.subidaIdOpcional = body('subidaId')
  .optional({ values: 'falsy' })
  .custom((valor) => {
    if (!ID.test(String(valor))) throw new Error('El permiso de subida no es válido')
    return true
  })

exports.createUploadValidation = [
  body('destino')
    .isIn(UPLOAD_TARGETS)
    .withMessage(`El destino debe ser uno de: ${UPLOAD_TARGETS.join(', ')}`),
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('El nombre del archivo es requerido')
    .bail()
    .isLength({ max: 260 })
    .withMessage('El nombre del archivo es demasiado largo'),
  body('tamanoBytes')
    .isInt({ min: 1 })
    .withMessage('El tamaño del archivo debe ser mayor que cero'),
  body('mime').optional({ values: 'falsy' }).trim().isLength({ max: 160 }),
  idOpcional('referencia.expedienteId'),
  idOpcional('referencia.proyectoId'),
  idOpcional('referencia.contratoId'),
  idOpcional('referencia.clienteId'),
  idOpcional('referencia.registroObraId'),
  idOpcional('referencia.empresaId'),
  idOpcional('referencia.maquinaId'),
  body('referencia.tipoDocumento')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 80 })
]
