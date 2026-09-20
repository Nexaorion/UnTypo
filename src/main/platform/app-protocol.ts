import { net, protocol } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEME = 'app';

export const registerAppScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        corsEnabled: true,
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
    },
  ]);
};

// Compiled output is dist/main/platform/; renderer assets live in dist/renderer/.
export const resolveRendererRoot = (moduleDirectory: string): string =>
  path.resolve(moduleDirectory, '../../renderer');

export const handleAppScheme = (): void => {
  const rendererRoot = resolveRendererRoot(__dirname);

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== 'renderer') {
      return new Response('Not found', { status: 404 });
    }

    const relativePath = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
    const requestedPath = path.resolve(rendererRoot, relativePath);
    const isInsideRenderer =
      requestedPath === rendererRoot || requestedPath.startsWith(`${rendererRoot}${path.sep}`);

    if (!isInsideRenderer || !existsSync(requestedPath)) {
      return new Response('Not found', { status: 404 });
    }

    return net.fetch(pathToFileURL(requestedPath).toString());
  });
};
