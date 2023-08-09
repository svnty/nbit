import { StaticFile, type StaticFileInit } from './core/StaticFile';

export default class CustomResponse extends Response {
  static file(filePath: string, init?: StaticFileInit) {
    return new StaticFile(filePath, init);
  }
}
