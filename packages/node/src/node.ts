import type { IncomingMessage, ServerResponse } from 'http';

import { createCreateApplication, HttpError, type Router } from './core';
import { isStaticFile, Response } from './Response';
import { Request } from './Request';
import type { Method } from './types';

async function routeRequest<T>(
  router: Router<T>,
  nodeRequest: IncomingMessage,
  getContext?: (request: Request<Method, string>) => object | undefined,
): Promise<Response> {
  const method = (nodeRequest.method ?? 'GET').toUpperCase();
  const path = nodeRequest.url ?? '/';
  try {
    const result = await router.route(method, path, (captures) => {
      const request = new Request(nodeRequest, Object.fromEntries(captures));
      const context = getContext?.(request);
      const requestWithContext =
        context === undefined ? request : Object.assign(request, context);
      return requestWithContext as unknown as T;
    });
    if (result === undefined) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
      });
    }
    // TODO: If result is an object containing a circular reference, this
    // next line will throw, resulting in a 500 response with no
    // indication of which handler caused it.
    return result instanceof Response ? result : Response.json(result);
  } catch (e) {
    if (e instanceof HttpError) {
      return new Response(e.message, {
        status: e.status,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
      });
    } else {
      return new Response(String(e), {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
      });
    }
  }
}

export const createApplication = createCreateApplication(
  (router, getContext) => {
    return async (
      nodeRequest: IncomingMessage,
      nodeResponse: ServerResponse,
    ) => {
      const response = await routeRequest(router, nodeRequest, getContext);
      const { status, headers, body } = response;
      if (isStaticFile(body)) {
        // TODO: Send file
        nodeResponse.writeHead(500);
        nodeResponse.end('Error: File serving not yet implemented');
      }
      // else if (body instanceof ReadableStream) {
      //   nodeResponse.writeHead(status, headers);
      //   body.pipe(nodeResponse);
      // }
      else {
        nodeResponse.writeHead(status, headers);
        if (body != null) {
          nodeResponse.write(body);
        }
        nodeResponse.end();
      }
    };
  },
);
