/**
 * Hello example controller (template/disabled).
 *
 * This entire file is scaffold/example code kept for reference only. It is fully
 * commented out, registers no routes, and is not active in the running app. It
 * demonstrates the expected controller pattern: routes under `/api`, extracting
 * `req.userContext.userId` for owner-scoped access, and delegating to a service.
 */
// /* Template code, example only. */
// import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, ParseIntPipe } from '@nestjs/common';
// import type { Request } from 'express';
// import { HelloService } from './hello.service';

// @Controller('api/hello')
// export class HelloController {
//   constructor(private readonly helloService: HelloService) {}

//   @Get('test')
//   async test(@Req() req: Request, @Query('limit') limit?: string) {
//     const { userId } = req.userContext;
//     const limitNum = limit ? parseInt(limit) : 5;
//     return this.helloService.test(userId, limitNum);
//   }
// }
