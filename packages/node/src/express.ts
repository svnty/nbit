import { relative } from 'path';

import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from 'express';

import { defineAdapter } from './core';
import { StaticFile } from './core/StaticFile';
import { defineErrors } from './core/support/defineErrors';
import { Response } from './Response';
import { resolveFilePath } from './fs';
import { isReadable, toReadStream } from './support/streams';
import { Headers } from './Headers';
import { Request } from './Request';
import { pipeStreamAsync } from './support/pipeStreamAsync';

const Errors = defineErrors({
  // This is a placeholder for when no route matches so we can easily identify
  // it as a special case of error and hand control over to Express.
  NoRouteError: 'No Route',
});

export const createApplication = defineAdapter((applicationOptions) => {
  // TODO: This is pretty hacky, consider a different approach.
  const toStaticFile = new WeakMap<Response, StaticFile>();
  const toError = new WeakMap<Response, Error>();

  return {
    onError: (request, error) => {
      const response = new Response(String(error), { status: 500 });
      toError.set(response, error);
      return response;
    },
    toResponse: async (request, result) => {
      if (result instanceof StaticFile) {
        const staticFile = result;
        const response = new Response(staticFile.filePath);
        toStaticFile.set(response, staticFile);
        return response;
      }
      if (result instanceof Response) {
        return result;
      }
      if (result === undefined) {
        throw new Errors.NoRouteError();
      }
      return Response.json(result);
    },
    createNativeHandler: (getResponse) => {
      const handleRequest = async (
        expressRequest: ExpressRequest,
        expressResponse: ExpressResponse,
        next: NextFunction,
      ) => {
        const request = Request.fromNodeRequest(expressRequest);
        const response = await getResponse(request);
        const error = toError.get(response);
        if (error) {
          return error instanceof Errors.NoRouteError ? next() : next(error);
        }
        const staticFile = toStaticFile.get(response);
        if (staticFile) {
          const { filePath, options, responseInit: init } = staticFile;
          const { cachingHeaders = true, maxAge } = options;
          // Resolve the file path relative to the project root.
          const resolved = resolveFilePath(filePath, applicationOptions);
          if (!resolved) {
            // TODO: Better error
            expressResponse.writeHead(403);
            expressResponse.end('Unable to serve file');
            return;
          }
          const [fullFilePath, allowedRoot] = resolved;
          expressResponse.status(init.status ?? 200);
          expressResponse.sendFile(
            // Pass the file path relative to allowedRoot. Express will not
            // serve the file if it does not exist within the allowed root.
            relative(allowedRoot, fullFilePath),
            {
              root: allowedRoot,
              headers: new Headers(init.headers).toNodeHeaders(),
              // Note: Express always sends the ETag header
              lastModified: cachingHeaders,
              maxAge: typeof maxAge === 'number' ? maxAge * 1000 : undefined,
            },
            next,
          );
          return;
        }
        const { status, statusText, headers, body } = response;
        if (isReadable(body)) {
          const readStream = toReadStream(body);
          await pipeStreamAsync(readStream, expressResponse, {
            beforeFirstWrite: () =>
              expressResponse.writeHead(
                status,
                statusText,
                headers.toNodeHeaders(),
              ),
          });
        } else {
          expressResponse.writeHead(
            status,
            statusText,
            headers.toNodeHeaders(),
          );
          if (body != null) {
            expressResponse.write(body);
          }
          expressResponse.end();
        }
      };
      return (
        expressRequest: ExpressRequest,
        expressResponse: ExpressResponse,
        next: NextFunction,
      ) => {
        handleRequest(expressRequest, expressResponse, next).catch((e) => {
          const error = e instanceof Error ? e : new Error(String(e));
          // Normally we'd pass the error on to next() but in this case it seems
          // something went wrong with streaming so we'll end the request here.
          if (!expressResponse.headersSent) {
            expressResponse.writeHead(500);
            expressResponse.end(String(error));
          } else {
            expressResponse.end();
          }
        });
      };
    },
  };
});
