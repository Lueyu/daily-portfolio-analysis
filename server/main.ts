/**
 * Application entry point.
 *
 * Bootstraps the NestJS (Express) application: creates the Nest application from
 * `AppModule`, applies the shared platform configuration from
 * `@lark-apaas/fullstack-nestjs-core`, registers the Handlebars view engine for
 * server-rendered HTML pages, and starts listening on the configured host/port.
 * All business REST APIs are served under the `/api` prefix; the HTML view
 * engine exists only to render the built client SPA shell from `dist/client`.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { configureApp } from '@lark-apaas/fullstack-nestjs-core';
import { join } from 'path';
import { __express as hbsExpressEngine } from 'hbs';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

/**
 * Builds and starts the NestJS server.
 *
 * In development the process tolerates a dependency-resolution error instead of
 * aborting (`abortOnError`), which lets the dev server keep running; in other
 * environments it aborts on bootstrap errors as usual. Host/port are read from
 * `SERVER_HOST`/`SERVER_PORT` env vars with `localhost`/`3000` defaults.
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
  });
  await configureApp(app, {
    disableSwagger: true,
  });
  const logger = new Logger('Bootstrap');
  const host = process.env.SERVER_HOST || 'localhost';
  const port = Number(process.env.SERVER_PORT || '3000');

  // Register the view engine so the built client HTML pages in dist/client can be rendered.
  app.setBaseViewsDir(join(process.cwd(), 'dist/client'));
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  await app.listen(port, host);
  logger.log(`Server running on ${host}:${port}`);
  logger.log(`API endpoints ready at http://${host}:${port}/api`);
}

bootstrap();
