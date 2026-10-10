import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import { GroupsService } from './groups.service';
import type {
  Group,
  CreateGroupDto,
  UpdateGroupDto,
  ListResponse,
} from '@shared/api.interface';

@Controller('api/portfolio/groups')
@NeedLogin()
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  async findAll(@Req() req: Request): Promise<ListResponse<Group>> {
    const { userId } = req.userContext;
    return this.groupsService.findAll(userId);
  }

  @Post()
  async create(
    @Body() dto: CreateGroupDto,
    @Req() req: Request,
  ): Promise<Group> {
    const { userId } = req.userContext;
    return this.groupsService.create(dto, userId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
    @Req() req: Request,
  ): Promise<Group> {
    const { userId } = req.userContext;
    return this.groupsService.update(id, dto, userId);
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ success: true }> {
    const { userId } = req.userContext;
    return this.groupsService.remove(id, userId);
  }
}
