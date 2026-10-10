/**
 * Snapshots module.
 *
 * Wires the daily-snapshot feature: imports `FxModule` (via `forwardRef` to break
 * a potential circular dependency), exposes `SnapshotsController`, and
 * provides/exports `SnapshotsService`.
 */
import { Module, forwardRef } from '@nestjs/common';
import { SnapshotsController } from './snapshots.controller';
import { SnapshotsService } from './snapshots.service';
import { FxModule } from '../fx/fx.module';

/** NestJS module definition for the snapshots feature. */
@Module({
  imports: [forwardRef(() => FxModule)],
  controllers: [SnapshotsController],
  providers: [SnapshotsService],
  exports: [SnapshotsService],
})
export class SnapshotsModule {}
