const {
  detectarTipo,
  esPrevisualizable,
  extensionDeMime,
  mensajeTipoNoPermitido,
  TIPOS_PERMITIDOS
} = require('../../src/utils/fileTypes')
const { attachmentToJson, nombreDeDescarga } = require('../../src/utils/attachments')

/**
 * El tipo de un archivo se decide por su CONTENIDO (spec §6.5). La prueba que
 * importa no es que un PDF se reconozca: es que un archivo que MIENTE con su
 * nombre no pase, y que los formatos que comparten contenedor —DOCX y XLSX son
 * los dos un ZIP; DOC y XLS, los dos un OLE2— no se confundan entre sí.
 */

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32, 0x20)])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16)
])

/** Un ZIP con la entrada que delata a cada formato de Office moderno. */
const zipCon = (entrada) =>
  Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('[Content_Types].xml'),
    Buffer.from(entrada),
    Buffer.alloc(32)
  ])

/** Un OLE2 con el nombre del flujo interno, como lo guarda Office: UTF-16LE. */
const ole2Con = (flujo) =>
  Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(48),
    Buffer.from(flujo, 'utf16le'),
    Buffer.alloc(16)
  ])

describe('detectarTipo', () => {
  it('reconoce los que el navegador puede abrir, y lo dice', () => {
    for (const buffer of [PDF, JPG, PNG]) {
      expect(detectarTipo(buffer).previsualizable).toBe(true)
    }
    expect(detectarTipo(PDF).mime).toBe('application/pdf')
  })

  it('no le cree al nombre: un ejecutable con nombre .pdf no pasa', () => {
    const ejecutable = Buffer.from([0x4d, 0x5a, 0x90, 0x00])
    expect(detectarTipo(ejecutable, 'contrato.pdf')).toBeNull()
  })

  describe('Office moderno (D-78)', () => {
    it('distingue un DOCX de un XLSX por lo que trae dentro del ZIP', () => {
      expect(detectarTipo(zipCon('word/document.xml')).etiqueta).toBe('DOCX')
      expect(detectarTipo(zipCon('xl/workbook.xml')).etiqueta).toBe('XLSX')
    })

    it('un ZIP cualquiera NO es un documento', () => {
      expect(detectarTipo(zipCon('fotos/playa.jpg'), 'cosas.zip')).toBeNull()
    })

    it('ninguno se previsualiza: se descargan', () => {
      expect(detectarTipo(zipCon('word/document.xml')).previsualizable).toBe(false)
      expect(detectarTipo(zipCon('xl/workbook.xml')).previsualizable).toBe(false)
    })
  })

  describe('Office viejo, que comparte contenedor OLE2', () => {
    it('el flujo interno decide, no la extensión', () => {
      // Un libro de Excel al que alguien le puso .doc sigue siendo un XLS.
      expect(detectarTipo(ole2Con('Workbook'), 'reporte.doc').etiqueta).toBe('XLS')
      expect(detectarTipo(ole2Con('WordDocument'), 'oficio.xls').etiqueta).toBe('DOC')
    })

    it('sin flujo reconocible, la extensión desempata', () => {
      expect(detectarTipo(ole2Con('Nada'), 'oficio.doc').etiqueta).toBe('DOC')
      expect(detectarTipo(ole2Con('Nada'), 'reporte.xls').etiqueta).toBe('XLS')
      expect(detectarTipo(ole2Con('Nada'), 'quiensabe.bin')).toBeNull()
    })
  })

  describe('CSV, el único sin firma', () => {
    const csv = Buffer.from('nombre,rfc\nAna Ruiz,RUAA900101AB1\n')

    it('se acepta si el nombre lo declara y el contenido es texto', () => {
      expect(detectarTipo(csv, 'nomina.csv')).toMatchObject({
        mime: 'text/csv',
        previsualizable: false
      })
    })

    it('no se acepta sin la extensión: no hay con qué distinguirlo', () => {
      expect(detectarTipo(csv, 'nomina.txt')).toBeNull()
      expect(detectarTipo(csv)).toBeNull()
    })

    it('un binario con nombre .csv no cuela', () => {
      const binario = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00])
      expect(detectarTipo(binario, 'trampa.csv')).toBeNull()
    })

    it('los acentos son texto válido', () => {
      const conAcentos = Buffer.from('área,adscripción\nCampeche,Sí\n', 'utf8')
      expect(detectarTipo(conAcentos, 'áreas.csv').etiqueta).toBe('CSV')
    })
  })

  it('vacío o basura, nada', () => {
    expect(detectarTipo(Buffer.alloc(0), 'x.pdf')).toBeNull()
    expect(detectarTipo(null)).toBeNull()
  })
})

describe('el mensaje del 415', () => {
  it('enumera los tipos que sí se aceptan', () => {
    const mensaje = mensajeTipoNoPermitido(Buffer.from([0x4d, 0x5a]))
    for (const etiqueta of TIPOS_PERMITIDOS) expect(mensaje).toContain(etiqueta)
  })

  it('con una foto de iPhone explica qué hacer', () => {
    const heic = Buffer.concat([
      Buffer.alloc(4),
      Buffer.from('ftypheic'),
      Buffer.alloc(8)
    ])
    expect(mensajeTipoNoPermitido(heic)).toMatch(/HEIC/)
    expect(mensajeTipoNoPermitido(heic)).toMatch(/JPG o PDF/)
  })
})

describe('adjuntos', () => {
  const guardado = {
    nombre: 'escaneo (2) final_v3.pdf',
    mime: 'application/pdf',
    tamanoBytes: 1024,
    subidoPor: 'Ana Ruiz',
    subidoEn: new Date('2026-09-01T10:00:00Z'),
    claveAlmacenamiento: 'registros-obra/abc/def-uuid.pdf'
  }

  it('la clave de almacenamiento NUNCA sale', () => {
    expect(attachmentToJson(guardado).claveAlmacenamiento).toBeUndefined()
    expect(attachmentToJson(guardado).previsualizable).toBe(true)
  })

  it('sin archivo, null: no hay que distinguir «no hay» de «no se pudo»', () => {
    expect(attachmentToJson(null)).toBeNull()
    expect(attachmentToJson({ nombre: 'a.pdf' })).toBeNull()
  })

  it('se descarga con el nombre del DATO, no con el del archivo', () => {
    expect(nombreDeDescarga('OB-2026-0145', 'application/pdf')).toBe('OB-2026-0145.pdf')
  })

  it('limpia lo que no puede ir en un nombre de archivo', () => {
    expect(nombreDeDescarga('OB/2026\\0145', 'application/msword')).toBe(
      'OB-2026-0145.doc'
    )
  })

  it('la extensión sale del mime guardado, no del nombre original', () => {
    expect(extensionDeMime('text/csv')).toBe('csv')
    expect(extensionDeMime('application/inventado')).toBe('bin')
  })

  it('lo que no se previsualiza se sabe por el mime', () => {
    expect(esPrevisualizable('image/webp')).toBe(true)
    expect(esPrevisualizable('application/msword')).toBe(false)
  })
})
