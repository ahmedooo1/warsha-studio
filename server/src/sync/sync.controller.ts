// Sync routes. Every write names the rev it was made on and a unique change id; see sync.service.ts.
import {Body, Controller, Get, HttpCode, Param, Post, Put, Query, BadRequestException, ParseUUIDPipe} from '@nestjs/common';
import {Type} from 'class-transformer';
import {IsInt, IsObject, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested} from 'class-validator';
import {SyncService, SETTINGS_ID} from './sync.service.js';
import {Audit} from '../common/audit.js';
import {CurrentUser, Device, Roles, type AuthUser} from '../common/security.js';

export const PROJECT_ID = /^[\w-]{3,40}$/;
const CHANGE_ID = /^[\w-]{8,80}$/;
const MAX_JSON = 1_500_000;

class ProjectDataDto {
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @MaxLength(8) variant?: string;
  @IsObject() cfg: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(600_000) @Matches(/^(data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)?$/) thumb?: string;
  @IsOptional() @IsInt() @Min(0) updatedAt?: number;
}
class PutProjectDto {
  @IsInt() @Min(0) baseRev: number;
  @IsString() @Matches(CHANGE_ID) changeId: string;
  @ValidateNested() @Type(() => ProjectDataDto) data: ProjectDataDto;
}
class RemoveDto { @IsInt() @Min(1) baseRev: number; @IsString() @Matches(CHANGE_ID) changeId: string; }
class RestoreDto { @IsString() @Matches(CHANGE_ID) changeId: string; }
class SettingsDto {
  @IsInt() @Min(0) baseRev: number; @IsString() @Matches(CHANGE_ID) changeId: string;
  @IsObject() prices: Record<string, unknown>; @IsObject() fab: Record<string, unknown>;
}
class SettingsRestoreDto { @IsInt() @Min(0) baseRev: number; @IsString() @Matches(CHANGE_ID) changeId: string; }

const checkId = (id: string) => { if (!PROJECT_ID.test(id)) throw new BadRequestException('bad project id'); return id; };
const size = (v: unknown) => JSON.stringify(v).length;

@Controller('api')
export class SyncController {
  constructor(private sync: SyncService, private audit: Audit) {}

  @Get('sync/changes')
  changes(@Query('since') since = '0', @Query('limit') limit = '200') {
    const s = Math.max(0, Math.floor(Number(since) || 0)), l = Math.min(500, Math.max(1, Math.floor(Number(limit) || 200)));
    return this.sync.changes(s, l);
  }

  @Put('projects/:id')
  async put(@CurrentUser() me: AuthUser, @Device() device: string, @Param('id') id: string, @Body() b: PutProjectDto) {
    checkId(id);
    if (size(b.data.cfg) > MAX_JSON) throw new BadRequestException('design too large');
    const d = b.data;
    return this.sync.put(id, b.baseRev, b.changeId, {name: d.name.trim() || '-', phone: d.phone ?? '', note: d.note ?? '', variant: d.variant || null, cfg: d.cfg, thumb: d.thumb ?? '', updatedAt: d.updatedAt ?? Date.now()}, me.id, device);
  }

  @Post('projects/:id/delete') @HttpCode(200)
  async remove(@CurrentUser() me: AuthUser, @Device() device: string, @Param('id') id: string, @Body() b: RemoveDto) {
    const r = await this.sync.remove(checkId(id), b.baseRev, b.changeId, me.id, device);
    await this.audit.log(me.id, 'project_deleted', 'project', id);
    return r;
  }

  @Get('projects/:id/versions')
  versions(@Param('id') id: string) { return this.sync.versions(checkId(id)); }

  @Get('projects/:id/versions/:vid')
  async version(@Param('id') id: string, @Param('vid', ParseUUIDPipe) vid: string) {
    const v = await this.sync.version(checkId(id), vid);
    return {id: v.id, rev: v.rev, kind: v.kind, data: v.data, device: v.device, createdAt: v.createdAt, pinned: v.pinned};
  }

  @Post('projects/:id/versions/:vid/restore') @HttpCode(200)
  async restore(@CurrentUser() me: AuthUser, @Device() device: string, @Param('id') id: string, @Param('vid', ParseUUIDPipe) vid: string, @Body() b: RestoreDto) {
    const r = await this.sync.restore(checkId(id), vid, b.changeId, me.id, device);
    await this.audit.log(me.id, 'project_restored', 'project', id, {version: vid});
    return r;
  }

  @Get('trash')
  trash() { return this.sync.trash(); }

  // prices, identity and fabrication settings change what quotes say: owner only
  @Put('settings') @Roles('owner')
  async putSettings(@CurrentUser() me: AuthUser, @Device() device: string, @Body() b: SettingsDto) {
    if (size(b.prices) > MAX_JSON || size(b.fab) > 50_000) throw new BadRequestException('settings too large');
    const r = await this.sync.putSettings(b.baseRev, b.changeId, b.prices, b.fab, me.id, device);
    await this.audit.log(me.id, 'settings_changed', 'settings', '1');
    return r;
  }

  @Get('settings/versions')
  settingsVersions() { return this.sync.versions(SETTINGS_ID); }

  @Post('settings/versions/:vid/restore') @HttpCode(200) @Roles('owner')
  async restoreSettings(@CurrentUser() me: AuthUser, @Device() device: string, @Param('vid', ParseUUIDPipe) vid: string, @Body() b: SettingsRestoreDto) {
    const v = await this.sync.version(SETTINGS_ID, vid), d = v.data as {prices: Record<string, unknown>; fab: Record<string, unknown>};
    const r = await this.sync.putSettings(b.baseRev, b.changeId, d.prices, d.fab, me.id, device);
    await this.audit.log(me.id, 'settings_restored', 'settings', '1', {version: vid});
    return r;
  }
}
