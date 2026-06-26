import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS security parameters for local development and future Vercel routing
  app.enableCors({
    origin: true, // We will tighten this down to explicit domains in production
    credentials: true,
  });

  // Attach global structural validation gaskets (DTO enforcement)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Automatically strips fields not defined in the DTO
      transform: true, // Casts network strings to primitive numbers/booleans natively
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Lotify Production Engine Online: Running on port ${port}`);
}
bootstrap();