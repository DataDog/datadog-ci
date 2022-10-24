import {readFileSync} from 'fs'

import {XMLParser, XMLValidator} from 'fast-xml-parser'

class PlistContent {
  private content: Record<string, unknown>
  constructor(content: Record<string, unknown>) {
    this.content = content
  }

  public getContent = () => this.content
}

export const parsePlist = (plistPath: string): PlistContent => {
  const xmlFileContentString = readFileSync(plistPath).toString()
  const validationOutput = XMLValidator.validate(xmlFileContentString)

  if (validationOutput !== true) {
    throw new Error(validationOutput.err.msg)
  }

  const xmlParser = new XMLParser({preserveOrder: true})
  const [_xmlHeader, plistDeclaration] = xmlParser.parse(xmlFileContentString)

  const plistContent = plistDeclaration.plist[0].dict

  return new PlistContent(plistContent)
}
