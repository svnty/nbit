import type { IncomingMessage } from 'http';

import { Headers, type HeadersInit } from '../Headers';
import type { Method } from '../types';

import { Body, type BodyInit } from './Body';

type RequestInit = {
  method?: Method | Lowercase<Method>;
  headers?: HeadersInit;
  body?: BodyInit;
};

const weakMap = new WeakMap<IncomingMessage, Request>();

// TODO:
//  - Deal with RequestOptions.bodyParserMaxLength
//  - Grab content-length and somehow pass it to body so it can error if mismatch (and error early if larger than allowed)
export class Request extends Body {
  readonly method: Method;
  readonly url: string;
  readonly headers: Headers;

  constructor(url: string, init?: RequestInit) {
    super(init?.body ?? null);
    this.url = url;
    this.method = (init?.method ? init.method.toUpperCase() : 'GET') as Method;
    this.headers = new Headers(init?.headers);
  }

  static fromNodeRequest(nodeRequest: IncomingMessage) {
    // Use a weakMap to always return the same instance for the same Node request.
    const request = weakMap.get(nodeRequest) ?? fromNodeRequest(nodeRequest);
    weakMap.set(nodeRequest, request);
    return request;
  }
}

function fromNodeRequest(nodeRequest: IncomingMessage) {
  const method = (nodeRequest.method ?? 'GET').toUpperCase() as Method;
  const pathname = nodeRequest.url ?? '/';
  const headers = Headers.fromNodeRawHeaders(nodeRequest.rawHeaders);
  // TODO: Do we need a fully qualified URL for the constructor here?
  // TODO: Somehow pass in applicationOptions for bodyParserMaxLength
  return new Request(pathname, {
    method,
    headers,
    body: nodeRequest,
  });
}
