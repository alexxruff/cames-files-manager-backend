/**
 * El tope del monto de un contrato de obra, en pesos (D-90).
 *
 * No es una regla del negocio —nadie dijo que una obra no pueda costar más—:
 * es el cinturón que evita que un dedazo capture una cifra imposible y la ficha
 * del proyecto la enseñe como si nada. Vive aquí porque lo comparten el esquema
 * y la validación de entrada, y un número mágico en dos sitios se desincroniza.
 */
const MONTO_MAXIMO_CONTRATO = 9999999999.99

/** Los pesos se guardan con centavos y ni un decimal más. */
const DECIMALES_MONTO = 2

module.exports = { MONTO_MAXIMO_CONTRATO, DECIMALES_MONTO }
